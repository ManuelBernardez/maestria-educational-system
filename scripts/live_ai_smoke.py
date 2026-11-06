#!/usr/bin/env python3
"""Smoke test HTTP real contra el proveedor configurado en backend/.env.

Uso: backend\\.venv\\Scripts\\python.exe scripts\\live_ai_smoke.py
Solo envía el ejemplo sintético embebido; no requiere Django ni base de datos.
"""
import asyncio
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"

# Carga mínima del .env (KEY=VALUE por línea) sin dependencias externas.
def load_env(path: Path) -> dict:
    env = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()
        import os
        os.environ.setdefault(key.strip(), value.strip())
    return env

def main() -> int:
    import httpx  # se importa tras cargar el entorno

    sys.path.insert(0, str(BACKEND))
    import importlib.util
    spec = importlib.util.spec_from_file_location("maestria_ai", BACKEND / "apps" / "core" / "ai.py")
    ai = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = ai
    spec.loader.exec_module(ai)

    import os
    provider = os.getenv("AI_PROVIDER", "mock")
    model = os.getenv("GEMINI_MODEL", "")
    print(f"Proveedor: {provider} · Modelo: {model or '(no aplica)'}")

    question = "Explicá por qué la luz es necesaria para la fotosíntesis y qué función cumple el agua."
    answer = "La luz aporta energía para la fotosíntesis. El agua participa y aporta hidrógeno; junto con el dióxido de carbono la planta produce materia orgánica."
    rubric = [
        {"name": "Comprensión conceptual", "description": "Explica la función de la luz y el agua.", "max_score": 5, "weight": 1, "levels": []},
        {"name": "Precisión científica", "description": "Relaciona agua, dióxido de carbono y materia orgánica.", "max_score": 5, "weight": 1, "levels": []},
    ]

    async def run():
        limits = httpx.Limits(max_connections=1, max_keepalive_connections=1)
        async with httpx.AsyncClient(limits=limits) as client:
            correction = await ai.generate_correction(
                question=question, answer=answer, rubric=rubric, max_score=10,
                feedback_style="constructivo", provider_config=None, http_client=client,
            )
            questions = await ai.generate_questions(
                title="Fotosíntesis", subject="Ciencias Naturales", level="Secundaria",
                objectives="Comprender el proceso de fotosíntesis.", instructions=question,
                count=2, provider_config=None, http_client=client,
            )
            rubric_gen = await ai.generate_rubric(
                title="Fotosíntesis", subject="Ciencias Naturales", level="Secundaria",
                objectives="Evaluar comprensión del proceso de fotosíntesis.",
                instructions=question, question_prompts=[question], count=2,
                provider_config=None, http_client=client,
            )
        return correction, questions, rubric_gen

    correlation, questions, rubric_gen = asyncio.run(run())

    assert not correlation.get("demo") and not questions.get("demo") and not rubric_gen.get("demo"), "Devolvió contenido demostrativo"
    assert correlation.get("criteria") and questions.get("questions") and rubric_gen.get("criteria"), "Estructura incompleta"

    print("CORRECCIÓN: total propuesto =", correlation.get("suggested_total"))
    for item in correlation["criteria"]:
        print(f"  - {item['criterion']}: {item['score']}/{item['max_score']} · evidencia: {str(item['evidence'])[:60]!r}")
    print("PREGUNTAS:", [q["prompt"][:60] for q in questions["questions"]])
    print("RÚBRICA:", [c["name"] for c in rubric_gen["criteria"]])
    print("Smoke test OK: las tres operaciones de IA respondieron y validaron.")
    return 0

if __name__ == "__main__":
    load_env(BACKEND / ".env")
    sys.exit(main())
