"""Pruebas puras (sin base de datos) de la validación tolerante de evidencia literal."""
from .ai import _validate_proposal, evidence_in_text, locate_evidence

SOURCE = "El  estudiante dijo:\nla “fotosíntesis” es un proceso — clave.\r\nOtra línea."


def test_exact_and_whitespace_tolerant_match():
    assert locate_evidence("Otra línea.", SOURCE) == "Otra línea."
    assert locate_evidence("estudiante dijo: la", SOURCE) == "estudiante dijo:\nla"


def test_typographic_quotes_and_dashes_are_tolerated():
    found = locate_evidence('la "fotosíntesis" es un proceso - clave.', SOURCE)
    assert found == "la “fotosíntesis” es un proceso — clave."


def test_invented_quotes_are_rejected():
    assert locate_evidence("texto inventado", SOURCE) == ""
    assert evidence_in_text("texto inventado", SOURCE) is False
    assert evidence_in_text("", SOURCE) is True


def test_validate_proposal_keeps_exact_source_text_and_warns():
    result = _validate_proposal(
        {"criteria": [{"criterion": "A", "score": 5, "max_score": 10, "evidence": "proceso  clave"}]},
        [{"name": "A", "max_score": 10}], 10, "un proceso\n clave. fin",
    )
    # Texto exacto de la fuente, extendido a la oración completa que contiene la cita.
    assert result["criteria"][0]["evidence"] == "un proceso\n clave."
    assert any("ajustó" in warning for warning in result["warnings"])


def test_sentence_evidence_extends_fragments_to_complete_sentences():
    from .ai import MAX_SENTENCE_EVIDENCE_CHARS, sentence_evidence
    source = "Primero hay luz. La fotosíntesis produce glucosa y libera oxígeno. Al final, todo vive."
    # Un fragmento cortado se completa hasta el comienzo y el punto de su oración.
    assert sentence_evidence("produce glucosa", source) == "La fotosíntesis produce glucosa y libera oxígeno."
    # Una cita que abarca dos oraciones conserva ambas, completas.
    assert sentence_evidence("luz. La fotosíntesis", source) == "Primero hay luz. La fotosíntesis produce glucosa y libera oxígeno."
    # Los decimales y los saltos de línea se respetan como límites correctos.
    assert sentence_evidence("vale 3.14 en", "El número pi vale 3.14 en este caso. Fin.") == "El número pi vale 3.14 en este caso."
    assert sentence_evidence("segunda", "primera línea\nsegunda línea sin punto\ntercera") == "segunda línea sin punto"
    # Cierres de cita después del punto se incluyen.
    assert sentence_evidence("dijo", "Él «dijo que sí.» Después.") == "Él «dijo que sí.»"
    # Una oración demasiado larga deja la cita literal que eligió la IA.
    long_source = "Inicio " + "palabra " * (MAX_SENTENCE_EVIDENCE_CHARS // 8 + 10) + "clave final."
    assert sentence_evidence("palabra clave", long_source) == "palabra clave"
    # Nunca acepta texto que no esté en la respuesta.
    assert sentence_evidence("texto inventado", source) == ""


def test_final_grade_never_goes_below_one():
    from .ai import final_grade
    zero = [{"score": 0, "max_score": 10, "weight": 1}, {"score": 0, "max_score": 10, "weight": 1}]
    assert final_grade(zero) == 1.0
    assert final_grade([{"score": 7.5, "max_score": 10}]) == 7.5
    assert final_grade([{"score": 0.4, "max_score": 10}]) == 1.0
    # Varias consignas: suma por consigna, con el piso aplicado sólo a la nota final.
    grouped = [{"score": 0, "max_score": 5, "question_id": 1}, {"score": 3, "max_score": 5, "question_id": 2}]
    assert final_grade(grouped) == 3.0
    # Una escala total menor que 1 no se infla.
    assert final_grade([{"score": 0, "max_score": 0.5}]) == 0.0


def test_weighted_total_applies_weights():
    from .ai import weighted_total, weighted_total_by_question
    # Suma simple 15/20; ponderada: (1*0.2 + 0.5*0.8) = 0.6 de 20 -> 12.
    criteria = [
        {"score": 10, "max_score": 10, "weight": 20},
        {"score": 5, "max_score": 10, "weight": 80},
    ]
    assert weighted_total(criteria) == 12.0
    assert weighted_total([{"score": 5, "max_score": 10, "weight": 1}, {"score": 10, "max_score": 10, "weight": 1}]) == 15.0
    assert weighted_total([{"score": 3, "max_score": 10, "weight": 0}]) == 3.0  # pesos todos 0 -> equiponderado
    grouped = criteria + [{"score": 4, "max_score": 5, "weight": 1, "question_id": 7}]
    assert weighted_total_by_question(grouped) == 16.0
