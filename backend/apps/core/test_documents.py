"""Pruebas puras (sin base de datos) de la extracción de texto y del contexto que recibe la IA."""
import asyncio
import io
import json

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.exceptions import ValidationError

from . import ai
from .api_views.common import _read_document


def _upload(name, data):
    return SimpleUploadedFile(name, data)


def test_docx_keeps_tables_in_document_order():
    from docx import Document

    document = Document()
    document.add_paragraph("Respuesta: la Revolución de Mayo.")
    table = document.add_table(rows=2, cols=3)
    table.cell(0, 0).text = "Causa"
    table.cell(0, 1).text = "Consecuencia"
    table.cell(0, 2).text = "Fuente"
    table.cell(1, 0).text = "Invasiones inglesas"
    table.cell(1, 1).merge(table.cell(1, 2)).text = "Milicias criollas"
    document.add_paragraph("Conclusión final.")
    buffer = io.BytesIO()
    document.save(buffer)

    text, source_type = _read_document(_upload("respuesta.docx", buffer.getvalue()))

    assert source_type == "docx"
    assert "Causa | Consecuencia | Fuente" in text
    # La celda combinada aparece una sola vez.
    assert "Invasiones inglesas | Milicias criollas" in text
    assert text.count("Milicias criollas") == 1
    assert text.index("Respuesta") < text.index("Causa") < text.index("Conclusión")


def test_plain_text_accepts_utf8_bom_and_windows_1252():
    assert _read_document(_upload("a.md", "﻿Árbol".encode("utf-8")))[0] == "Árbol"
    assert _read_document(_upload("a.txt", "Educación cívica: ñandú".encode("cp1252")))[0] == "Educación cívica: ñandú"


def test_nul_bytes_are_removed_before_saving():
    # PostgreSQL rechaza NUL en columnas de texto: antes terminaba en error 500.
    assert _read_document(_upload("a.txt", b"hola\x00 mundo"))[0] == "hola mundo"


def test_password_protected_pdf_has_a_clear_message():
    from pypdf import PdfWriter

    writer = PdfWriter()
    writer.add_blank_page(200, 200)
    writer.encrypt("secreta")
    buffer = io.BytesIO()
    writer.write(buffer)

    with pytest.raises(ValidationError) as error:
        _read_document(_upload("protegido.pdf", buffer.getvalue()))
    assert "contraseña" in str(error.value.detail)


def test_correction_context_puts_prompt_first_and_includes_expected_answer():
    from types import SimpleNamespace

    from .api_views.submissions import correction_context

    assessment = SimpleNamespace(instructions="Indicaciones generales", objectives="Objetivo", reference_material="R" * (ai.REFERENCE_CONTEXT_CHARS + 500))
    question = SimpleNamespace(prompt="Explicá la fotosíntesis", expected_answer="Luz, agua y CO2 producen glucosa")
    context = correction_context(assessment, question)

    assert context.startswith("CONSIGNA ESPECÍFICA:\nExplicá la fotosíntesis")
    assert "Luz, agua y CO2 producen glucosa" in context
    assert "Indicaciones generales" in context and "Objetivo" in context
    assert context.count("R") >= ai.REFERENCE_CONTEXT_CHARS and "R" * (ai.REFERENCE_CONTEXT_CHARS + 1) not in context
    assert len(context) <= ai.MAX_CORRECTION_QUESTION_CHARS

    # Peor caso: todos los campos al máximo siguen entrando completos en el tope del proveedor.
    full = correction_context(
        SimpleNamespace(instructions="I" * 8000, objectives="O" * 5000, reference_material="M" * 50_000),
        SimpleNamespace(prompt="P" * 8000, expected_answer="E" * 8000),
    )
    assert len(full) <= ai.MAX_CORRECTION_QUESTION_CHARS


def test_correction_context_without_question_lists_every_question():
    """«Todas las consignas»: la IA recibe cada consigna (antes sólo llegaba la primera)."""
    from types import SimpleNamespace

    from .api_views.submissions import correction_context

    assessment = SimpleNamespace(instructions="Indicaciones generales", objectives="Objetivo", reference_material="")
    questions = [
        SimpleNamespace(prompt="Explicá la fotosíntesis", expected_answer="Luz y agua", max_score=4),
        SimpleNamespace(prompt="Compará respiración y fotosíntesis", expected_answer="", max_score=6),
    ]
    context = correction_context(assessment, None, questions)
    assert context.startswith("LA RESPUESTA ABARCA LAS 2 CONSIGNAS")
    assert "CONSIGNA 1 (puntaje máximo 4):\nExplicá la fotosíntesis" in context
    assert "CONSIGNA 2 (puntaje máximo 6):\nCompará respiración y fotosíntesis" in context
    assert "Luz y agua" in context and "Indicaciones generales" in context

    # Peor caso con muchas consignas largas: sigue dentro del tope del proveedor.
    many = [SimpleNamespace(prompt="P" * 3000, expected_answer="E" * 3000, max_score=10) for _ in range(20)]
    full = correction_context(
        SimpleNamespace(instructions="I" * 8000, objectives="O" * 5000, reference_material="M" * 50_000), None, many,
    )
    assert len(full) <= ai.MAX_CORRECTION_QUESTION_CHARS


def test_gemini_correction_receives_full_composed_context(monkeypatch):
    captured = {}

    async def fake_gemini_json(*, context, **kwargs):
        captured.update(context)
        return json.dumps({"summary": "", "criteria": [{"criterion": "A", "score": 1, "max_score": 10}], "feedback": ""})

    monkeypatch.setattr(ai, "_gemini_json", fake_gemini_json)
    material = "M" * ai.REFERENCE_CONTEXT_CHARS
    question = "CONSIGNA ESPECÍFICA:\nExplicá X\n\nOBJETIVOS DE APRENDIZAJE:\n" + "O" * 5000 + "\n\nMATERIAL DE REFERENCIA:\n" + material
    asyncio.run(ai.generate_correction(
        question=question, answer="respuesta", rubric=[{"name": "A", "max_score": 10}], max_score=10,
        provider_config={"provider": "gemini", "model_name": "test"},
    ))

    # Antes se cortaba en 8.000 caracteres y la IA perdía el material (y a veces la consigna).
    assert captured["question"] == question
    assert len(question) <= ai.MAX_CORRECTION_QUESTION_CHARS
