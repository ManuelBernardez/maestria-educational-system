"""Calidad de la IA: consignas sin repeticiones, avisos de contexto y devoluciones por criterio."""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

import httpx
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from .ai import _validate_proposal, dedupe_questions, generate_questions, generate_rubric, questions_are_similar
from .authentication import SupabasePrincipal
from .context_quality import assess_context
from .models import Assessment, Correction, Question, Rubric, RubricCriterion, RubricLevel, Submission
from .test_support import ensure_auth_users


class QuestionSimilarityTests(SimpleTestCase):
    def test_identical_and_paraphrased_questions_are_similar(self):
        base = "Explicá las causas de la Revolución de Mayo y relacionalas con un ejemplo."
        self.assertTrue(questions_are_similar(base, base))
        self.assertTrue(questions_are_similar(base, "explicá las causas de la revolución de mayo y relacionalas con un ejemplo"))
        self.assertTrue(questions_are_similar(base, "Explicá cuáles fueron las causas de la Revolución de Mayo, relacionándolas con un ejemplo."))

    def test_different_questions_are_not_similar(self):
        self.assertFalse(questions_are_similar(
            "Explicá las causas de la Revolución de Mayo.",
            "Compará el modelo agroexportador con la industrialización por sustitución de importaciones.",
        ))

    def test_dedupe_drops_repeats_against_existing_and_within_batch(self):
        candidates = [
            {"prompt": "Explicá qué es la fotosíntesis y por qué es importante."},
            {"prompt": "Explicá qué es la fotosíntesis y por qué resulta importante."},
            {"prompt": "Calculá cuánta energía absorbe una hoja en una hora con los datos del apunte."},
            {"prompt": "Describí el ciclo del agua."},
        ]
        kept, dropped = dedupe_questions(candidates, ["Describí el ciclo del agua en la naturaleza."])
        self.assertEqual([item["prompt"] for item in kept], [candidates[0]["prompt"], candidates[2]["prompt"]])
        self.assertEqual(dropped, 2)


def _gemini_response(payload):
    return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(payload, ensure_ascii=False)}]}, "finishReason": "STOP"}]})


class GenerateQuestionsTests(SimpleTestCase):
    CONFIG = {"provider": "gemini", "model_name": "modelo-prueba", "timeout_seconds": 30}

    def _run(self, responses, **kwargs):
        sent = []

        def handler(request):
            sent.append(json.loads(json.loads(request.content)["contents"][0]["parts"][0]["text"]))
            return _gemini_response(responses[len(sent) - 1])

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                return await generate_questions(title="T", subject="Historia", level="5°", objectives="O", instructions="I", provider_config=self.CONFIG, http_client=client, **kwargs)
        with patch.dict("os.environ", {"GEMINI_API_KEY": "k"}):
            return asyncio.run(run()), sent

    def test_existing_questions_and_variation_are_sent_and_repeats_retried(self):
        existing = "Explicá las causas de la Revolución de Mayo."
        first = {"questions": [
            {"prompt": "Explicá las causas de la Revolución de Mayo.", "max_score": 2},
            {"prompt": "Analizá el rol del Cabildo abierto del 22 de mayo en la destitución del virrey.", "max_score": 2},
        ], "observations": ["Faltan criterios de evaluación: agregá una rúbrica."]}
        retry = {"questions": [{"prompt": "Compará la Primera Junta con la Junta Grande según su composición.", "max_score": 2, "expected_answer": "Menciona diputados del interior."}]}
        result, sent = self._run([first, retry], count=2, existing_questions=[existing])
        self.assertEqual(len(sent), 2, "una repetida provoca un único reintento por la que falta")
        self.assertIn(existing, sent[0]["existing_questions"])
        self.assertTrue(sent[0]["variation_focus"])
        self.assertEqual(sent[1]["count"], 1)
        self.assertEqual([item["prompt"] for item in result["questions"]], [first["questions"][1]["prompt"], retry["questions"][0]["prompt"]])
        self.assertEqual(result["questions"][1]["expected_answer"], "Menciona diputados del interior.")
        self.assertEqual(result["observations"], ["Faltan criterios de evaluación: agregá una rúbrica."])
        self.assertEqual(result["warnings"], [])

    def test_warns_when_only_repeats_remain_after_retry(self):
        repeated = {"questions": [{"prompt": "Explicá las causas de la Revolución de Mayo."}]}
        result, sent = self._run([{"questions": [repeated["questions"][0], {"prompt": "Describí el virreinato del Río de la Plata y su economía."}]}, repeated], count=2, existing_questions=["Explicá las causas de la Revolución de Mayo."])
        self.assertEqual(len(result["questions"]), 1)
        self.assertTrue(result["warnings"])

    def test_mock_skips_templates_already_used(self):
        with patch.dict("os.environ", {"AI_PROVIDER": "mock"}):
            first = asyncio.run(generate_questions(title="T", subject="Química", level="L", objectives="O", instructions="I", count=3))
            second = asyncio.run(generate_questions(title="T", subject="Química", level="L", objectives="O", instructions="I", count=3, existing_questions=[item["prompt"] for item in first["questions"]]))
        self.assertFalse({item["prompt"] for item in first["questions"]} & {item["prompt"] for item in second["questions"]})


class RubricLevelsTests(SimpleTestCase):
    def test_ai_levels_are_kept_and_invalid_levels_dropped(self):
        payload = {"rubric_title": "R", "criteria": [
            {"name": "Precisión", "max_score": 10, "weight": 50, "levels": [
                {"name": "Inicial", "description": "Confunde fotosíntesis con respiración.", "score": 0},
                {"name": "Destacado", "description": "Explica las dos fases con ejemplos.", "score": 15},
            ]},
            {"name": "Argumentación", "max_score": 10, "weight": 50, "levels": "no es una lista"},
        ]}

        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: _gemini_response(payload))) as client:
                return await generate_rubric(title="T", subject="S", level="L", objectives="O", count=2, provider_config=GenerateQuestionsTests.CONFIG, http_client=client)
        with patch.dict("os.environ", {"GEMINI_API_KEY": "k"}):
            result = asyncio.run(run())
        self.assertEqual(result["criteria"][0]["levels"][1]["score"], 10, "el puntaje del nivel no supera el máximo")
        self.assertEqual(result["criteria"][1]["levels"], [])


class StudentFeedbackTests(SimpleTestCase):
    def test_proposal_keeps_feedback_per_criterion(self):
        data = {"criteria": [{"criterion": "A", "score": 1, "justification": "J", "student_feedback": "Explicaste X; te faltó Y. Probá Z.", "evidence": ""}], "feedback": "F"}
        result = _validate_proposal(data, [{"name": "A", "max_score": 2}], 2, "respuesta")
        self.assertEqual(result["criteria"][0]["student_feedback"], "Explicaste X; te faltó Y. Probá Z.")

    def test_old_proposals_without_student_feedback_still_validate(self):
        result = _validate_proposal({"criteria": [{"criterion": "A", "score": 1}]}, [{"name": "A", "max_score": 2}], 2, "respuesta")
        self.assertEqual(result["criteria"][0]["student_feedback"], "")


class ContextQualityTests(SimpleTestCase):
    def _assessment(self, **fields):
        return SimpleNamespace(**{"objectives": "", "instructions": "", "reference_material": "", **fields})

    def test_empty_context_reports_missing_objectives_instructions_and_criteria(self):
        codes = [note["code"] for note in assess_context(self._assessment(), questions=[], rubrics=[])]
        self.assertEqual(codes[:3], ["objectives_missing", "instructions_missing", "criteria_missing"])
        self.assertIn("reference_missing", codes)

    def test_short_and_topic_only_objectives_get_a_writing_suggestion(self):
        notes = assess_context(self._assessment(objectives="La célula", instructions="x", reference_material="apunte"))
        codes = {note["code"] for note in notes}
        self.assertTrue({"objectives_short", "objectives_not_observable"} <= codes)
        self.assertTrue(all(note["suggestion"] for note in notes))

    def test_complete_context_has_no_notes(self):
        assessment = self._assessment(
            objectives="Que el estudiante explique la estructura de la célula eucariota, compare sus organelas y justifique su función con ejemplos del apunte.",
            instructions="Respondé cada consigna con una justificación.", reference_material="Apunte de biología celular.",
        )
        question = SimpleNamespace(prompt="Compará…", expected_answer="Menciona núcleo y mitocondrias.", position=1, rubric_id=None)
        rubric = SimpleNamespace(title="R", prefetched_criteria=[SimpleNamespace(name="A", description="Explica con precisión la función de cada organela citada.", weight=1, prefetched_levels=[])])
        self.assertEqual(assess_context(assessment, questions=[question], rubrics=[rubric]), [])


class EditorContextNotesAndApprovalTests(TestCase):
    def setUp(self):
        self.owner_id = uuid4()
        ensure_auth_users(self.owner_id)
        self.client = APIClient()
        self.client.force_authenticate(user=SupabasePrincipal(id=str(self.owner_id)))
        self.assessment = Assessment.objects.create(owner_id=self.owner_id, title="Evaluación")

    def test_editor_returns_context_notes(self):
        response = self.client.get(f"/api/assessments/{self.assessment.pk}/editor/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("objectives_missing", [note["code"] for note in response.data["context_notes"]])

    def test_generate_questions_sends_saved_and_session_questions_to_avoid(self):
        Question.objects.create(owner_id=self.owner_id, assessment=self.assessment, prompt="Consigna guardada", max_score=2)
        with patch("apps.core.api_views.catalog.run_with_deadline", return_value={"questions": [{"prompt": "Nueva"}], "demo": False, "warnings": []}) as runner:
            response = self.client.post(f"/api/assessments/{self.assessment.pk}/generate-questions/", {"count": 1, "avoid": ["Vista antes"]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(runner.call_args.kwargs["existing_questions"], ["Consigna guardada", "Vista antes"])
        self.assertIn("context_notes", response.data)

    def test_rubric_with_ai_levels_is_created_in_bulk(self):
        response = self.client.post("/api/rubrics/create-with-criteria/", {"title": "R", "scale_type": "both", "criteria": [
            {"name": "A", "max_score": 4, "weight": 33.3333, "levels": [{"name": "Inicial", "description": "No identifica.", "score": 0}, {"name": "Logrado", "description": "Identifica y explica.", "score": 4}]},
            {"name": "B", "max_score": 6, "weight": 66.6667},
        ]}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        rubric = Rubric.objects.get(pk=response.data["id"])
        criteria = list(RubricCriterion.objects.filter(rubric=rubric).order_by("position"))
        self.assertEqual([criterion.position for criterion in criteria], [1, 2])
        self.assertEqual(list(RubricLevel.objects.filter(criterion=criteria[0]).values_list("description", flat=True)), ["No identifica.", "Identifica y explica."])
        self.assertEqual(RubricLevel.objects.filter(criterion=criteria[1]).count(), 4, "sin niveles propuestos se usan los genéricos")

    def test_rubric_level_above_maximum_is_rejected(self):
        response = self.client.post("/api/rubrics/create-with-criteria/", {"title": "R", "criteria": [
            {"name": "A", "max_score": 2, "levels": [{"name": "Alto", "score": 5}]}, {"name": "B"},
        ]}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Rubric.objects.filter(owner_id=self.owner_id).exists(), "todo o nada")

    def test_approval_keeps_only_known_fields_and_student_feedback(self):
        submission = Submission.objects.create(owner_id=self.owner_id, assessment=self.assessment, answer_text="Respuesta del estudiante.", status="review")
        proposal = {"summary": "S", "feedback": "F", "strengths": ["a"], "improvement_suggestions": ["b"], "warnings": [], "demo": False,
                    "criteria": [{"criterion": "A", "score": 1, "max_score": 2, "justification": "J", "student_feedback": "Para vos.", "evidence": ""}]}
        correction = Correction.objects.create(owner_id=self.owner_id, submission=submission, provider="gemini", proposal=proposal, total_score=1)
        final = {**proposal, "criteria": [{**proposal["criteria"][0], "student_feedback": "Editada por el docente."}], "injected": "<script>", "demo": True}
        response = self.client.post(f"/api/corrections/{correction.pk}/approve/", {"final_result": final, "teacher_feedback": "General"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        correction.refresh_from_db()
        self.assertNotIn("injected", correction.final_result)
        self.assertFalse(correction.final_result["demo"], "demo sale de la propuesta guardada, no del cliente")
        self.assertEqual(correction.final_result["criteria"][0]["student_feedback"], "Editada por el docente.")
        self.assertEqual(correction.criterion_results.get().feedback, "Editada por el docente.")
