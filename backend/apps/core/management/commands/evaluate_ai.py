"""Evaluate AI proposal invariants against a small synthetic Spanish-language set.

Example:
  AI_PROVIDER=gemini AI_EXTERNAL_PROCESSING_APPROVED=True python manage.py evaluate_ai

The score bands are calibration hints, not objective ground truth. A teacher should
review each generated result before judging pedagogical quality. Only synthetic data
is included in the fixture; never add real student work without explicit approval.
"""
import asyncio
import json
import math
import os
import time
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.core.ai import generate_correction


class Command(BaseCommand):
    help = "Evalúa propuestas de IA con respuestas sintéticas y métricas de calidad."

    def add_arguments(self, parser):
        parser.add_argument("--output", help="Ruta opcional para guardar resultados JSON.")
        parser.add_argument("--fail-on-calibration", action="store_true", help="Devuelve código de error si algún puntaje queda fuera del rango de referencia.")

    def handle(self, *args, **options):
        provider = os.getenv("AI_PROVIDER", "mock").strip().lower()
        if provider == "mock":
            raise CommandError("El benchmark necesita un proveedor real. Configurá AI_PROVIDER=gemini y una GEMINI_API_KEY válida.")
        free_synthetic_mode = (
            provider == "gemini"
            and os.getenv("AI_GEMINI_PAID_TIER_CONFIRMED", "false").strip().lower() not in {"1", "true", "yes", "on"}
        )
        if free_synthetic_mode and os.getenv("AI_GEMINI_FREE_TIER_SYNTHETIC_EVAL", "false").strip().lower() not in {"1", "true", "yes", "on"}:
            raise CommandError(
                "Gemini requiere nivel pago para contenido real. Para correr solo estos ejemplos sintéticos en el nivel gratuito, "
                "configurá AI_EXTERNAL_PROCESSING_APPROVED=True y AI_GEMINI_FREE_TIER_SYNTHETIC_EVAL=True."
            )

        fixture_path = Path(__file__).resolve().parents[2] / "fixtures" / "ai_eval_cases.json"
        cases = json.loads(fixture_path.read_text(encoding="utf-8"))
        results = []
        invariant_failures = 0
        calibration_misses = 0

        for case in cases:
            case_started = time.perf_counter()
            try:
                proposal = asyncio.run(generate_correction(
                    question=case["question"],
                    answer=case["answer"],
                    rubric=case["rubric"],
                    max_score=sum(float(item["max_score"]) for item in case["rubric"]),
                    feedback_style="constructivo",
                    allow_free_tier_synthetic=free_synthetic_mode,
                ))
                latency_ms = round((time.perf_counter() - case_started) * 1000, 1)
                expected_names = [item["name"].casefold().strip() for item in case["rubric"]]
                returned_names = [str(item.get("criterion", "")).casefold().strip() for item in proposal.get("criteria", [])]
                scores_valid = all(
                    0 <= float(item.get("score", -1)) <= float(item.get("max_score", -1))
                    for item in proposal.get("criteria", [])
                )
                evidence_items = [str(item.get("evidence", "")) for item in proposal.get("criteria", []) if item.get("evidence")]
                evidence_valid = all(evidence in case["answer"] for evidence in evidence_items)
                structure_valid = (
                    returned_names == expected_names
                    and len(proposal.get("criteria", [])) == len(expected_names)
                    and scores_valid
                    and evidence_valid
                    and isinstance(proposal.get("feedback"), str)
                    and len(proposal.get("feedback", "").strip()) >= 30
                )
                total = float(proposal.get("suggested_total", sum(float(x.get("score", 0)) for x in proposal.get("criteria", []))))
                score_min, score_max = case["expected_total_range"]
                calibrated = score_min <= total <= score_max
                if not structure_valid:
                    invariant_failures += 1
                if not calibrated:
                    calibration_misses += 1
                results.append({
                    "id": case["id"], "area": case["area"], "provider": provider,
                    "model": os.getenv("GEMINI_MODEL", "") if provider == "gemini" else os.getenv("OPENAI_MODEL", "") if provider == "openai" else os.getenv("OLLAMA_MODEL", ""),
                    "structural_invariants_ok": structure_valid,
                    "latency_ms": latency_ms,
                    "rubric_names_aligned": returned_names == expected_names,
                    "scores_within_bounds": scores_valid,
                    "literal_evidence_valid": evidence_valid,
                    "feedback_present": len(proposal.get("feedback", "").strip()) >= 30,
                    "suggested_total": round(total, 2),
                    "reference_range": [score_min, score_max],
                    "within_reference_range": calibrated,
                    "human_review_question": case["human_review_question"],
                    "proposal": proposal,
                })
                self.stdout.write(f"{'OK' if structure_valid else 'FALLÓ'} {case['id']}: {total:.2f}/{sum(float(x['max_score']) for x in case['rubric']):.2f}; rango de referencia {'OK' if calibrated else 'REVISAR'}")
            except Exception as exc:
                invariant_failures += 1
                results.append({"id": case["id"], "area": case["area"], "provider": provider, "latency_ms": round((time.perf_counter() - case_started) * 1000, 1), "error": type(exc).__name__, "message": str(exc)[:500]})
                self.stderr.write(f"ERROR {case['id']}: {type(exc).__name__}: {exc}")

        summary = {
            "provider": provider,
            "model": os.getenv("GEMINI_MODEL", "") if provider == "gemini" else os.getenv("OPENAI_MODEL", "") if provider == "openai" else os.getenv("OLLAMA_MODEL", ""),
            "cases": len(cases),
            "invariant_failures": invariant_failures,
            "calibration_misses": calibration_misses,
            "invariant_pass_rate": round((len(cases) - invariant_failures) / len(cases), 4),
            "calibration_pass_rate": round((len(cases) - calibration_misses) / len(cases), 4),
            "mean_latency_ms": round(sum(result.get("latency_ms", 0) for result in results) / len(results), 1),
            "p95_latency_ms": round(sorted(result.get("latency_ms", 0) for result in results)[max(0, math.ceil(len(results) * 0.95) - 1)], 1),
            "notice": "Los rangos son orientativos; el juicio de calidad pedagógica requiere revisión humana.",
            "results": results,
        }
        rendered = json.dumps(summary, ensure_ascii=False, indent=2)
        if options.get("output"):
            Path(options["output"]).write_text(rendered + "\n", encoding="utf-8")
            self.stdout.write(f"Resultados guardados en {options['output']}")
        self.stdout.write("\nResumen:\n" + json.dumps({k: v for k, v in summary.items() if k != "results"}, ensure_ascii=False, indent=2))
        if invariant_failures or (options.get("fail_on_calibration") and calibration_misses):
            raise CommandError("La evaluación detectó fallas estructurales o de calibración; revisá el informe JSON.")
