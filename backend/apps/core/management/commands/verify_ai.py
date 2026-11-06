"""Check effective AI configuration and optionally exercise every AI workflow.

Default (no network requests):
    python manage.py verify_ai

Live test uses only the synthetic sample data embedded below:
    python manage.py verify_ai --live

For Gemini Free Tier there are no extra gates for this synthetic test: los datos
usados son exclusivamente sintéticos.
"""
import asyncio
import json
import os
import time

import httpx
from django.core.management.base import BaseCommand, CommandError

from apps.core.ai import (
    _provider_settings,
    generate_correction,
    generate_questions,
    generate_rubric,
)
from apps.core.api_views.common import active_ai_provider_config


class Command(BaseCommand):
    help = "Verifica la configuración efectiva de IA y, opcionalmente, ejecuta pruebas sintéticas en vivo."

    def add_arguments(self, parser):
        parser.add_argument("--live", action="store_true", help="Envía ejemplos sintéticos al proveedor configurado.")

    def handle(self, *args, **options):

        try:
            database_config = active_ai_provider_config()
        except Exception as exc:
            raise CommandError(
                "No se pudo leer ai_provider_config desde PostgreSQL. Verificá la conexión y el esquema; "
                "no se asumirá que el .env es la configuración efectiva."
            ) from exc

        provider, model, timeout = _provider_settings(database_config)
        source = "base de datos" if database_config else "variables de entorno"
        self.stdout.write(f"Proveedor efectivo: {provider} (origen: {source})")
        self.stdout.write(f"Modelo: {model or '(no aplica)'}")
        self.stdout.write(f"Timeout por solicitud: {timeout}s")

        if provider == "mock":
            self.stdout.write(self.style.WARNING("Modo MOCK: solo devuelve contenido demostrativo; no prueba un modelo real."))
            if options["live"]:
                raise CommandError("El proveedor efectivo es MOCK. Elegí un proveedor real para la prueba en vivo.")
            return

        try:
            if provider == "gemini":
                if not os.getenv("GEMINI_API_KEY", "").strip():
                    raise RuntimeError("Falta GEMINI_API_KEY en el entorno del backend.")
            elif provider == "openai" and not os.getenv("OPENAI_API_KEY", "").strip():
                raise RuntimeError("Falta OPENAI_API_KEY en el entorno del backend.")
        except RuntimeError as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(self.style.SUCCESS("La configuración está completa a nivel local."))
        if not options["live"]:
            self.stdout.write("No se hizo ninguna llamada externa. Ejecutá con --live para probar el proveedor con ejemplos sintéticos.")
            return

        sample_question = "Explicá por qué la luz es necesaria para la fotosíntesis y qué función cumple el agua."
        sample_answer = "La luz aporta energía para la fotosíntesis. El agua participa en el proceso y aporta hidrógeno; junto con el dióxido de carbono la planta produce materia orgánica."
        sample_rubric = [
            {"name": "Comprensión conceptual", "description": "Explica la función de la luz y el agua.", "max_score": 5, "weight": 1, "levels": []},
            {"name": "Precisión científica", "description": "Relaciona agua, dióxido de carbono y materia orgánica.", "max_score": 5, "weight": 1, "levels": []},
        ]
        started = time.monotonic()

        async def run_checks():
            limits = httpx.Limits(max_connections=1, max_keepalive_connections=1)
            async with httpx.AsyncClient(timeout=timeout, limits=limits) as client:
                correction = await generate_correction(
                    question=sample_question,
                    answer=sample_answer,
                    rubric=sample_rubric,
                    max_score=10,
                    feedback_style="constructivo",
                    provider_config=database_config,
                    http_client=client,
                )
                questions = await generate_questions(
                    title="Fotosíntesis", subject="Ciencias Naturales", level="Secundaria",
                    objectives="Comprender el proceso de fotosíntesis.",
                    instructions=sample_question, count=2,
                    provider_config=database_config,
                    http_client=client,
                )
                rubric = await generate_rubric(
                    title="Fotosíntesis", subject="Ciencias Naturales", level="Secundaria",
                    objectives="Evaluar comprensión del proceso de fotosíntesis.",
                    instructions=sample_question,
                    question_prompts=[sample_question], count=2,
                    provider_config=database_config,
                    http_client=client,
                )
            return correction, questions, rubric

        try:
            correction, questions, rubric = asyncio.run(run_checks())
        except Exception as exc:
            from apps.core.api_views.common import ai_error_code, ai_error_http_status
            raise CommandError(
                f"La prueba en vivo falló: {ai_error_code(exc)} (HTTP sugerido {ai_error_http_status(exc)}). "
                "No se muestran cuerpos del proveedor ni credenciales."
            ) from exc

        if correction.get("demo") or questions.get("demo") or rubric.get("demo"):
            raise CommandError("El proveedor devolvió contenido demostrativo; la prueba real no se considera válida.")
        if not correction.get("criteria") or len(questions.get("questions", [])) < 1 or len(rubric.get("criteria", [])) < 2:
            raise CommandError("Una de las operaciones devolvió una estructura incompleta.")

        elapsed = round(time.monotonic() - started, 2)
        result = {
            "provider": provider,
            "model": model,
            "checks": {
                "correction": "ok",
                "question_generation": "ok",
                "rubric_generation": "ok",
            },
            "correction_criteria": len(correction["criteria"]),
            "questions": len(questions["questions"]),
            "rubric_criteria": len(rubric["criteria"]),
            "elapsed_seconds": elapsed,
            "data_used": "synthetic_only",
            "human_review_required": True,
        }
        self.stdout.write(self.style.SUCCESS("Las tres operaciones de IA respondieron y superaron las validaciones estructurales."))
        self.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
