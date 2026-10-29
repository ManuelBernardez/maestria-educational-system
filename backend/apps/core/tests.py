import asyncio
from django.test import SimpleTestCase, Client
from .ai import _mock, _validate_proposal, default_rubric_for_question, generate_questions
from .authentication import SupabasePrincipal

class AIAdapterTests(SimpleTestCase):
    def test_mock_is_marked_as_demo(self):
        result = _mock("¿Qué es una célula?", "Unidad básica de los seres vivos", [{"name": "Comprensión", "max_score": 5}], 5)
        self.assertTrue(result["demo"])
        self.assertTrue(result["warnings"])

    def test_score_is_clamped_to_maximum(self):
        result = _validate_proposal({"criteria": [{"criterion": "X", "score": 99, "max_score": 5, "evidence": "x"}]}, [], 5)
        self.assertEqual(result["criteria"][0]["score"], 5)

    def test_rubric_names_and_max_scores_are_preserved(self):
        result = _validate_proposal({"criteria": [{"criterion": "Inventado", "score": 50, "max_score": 100, "justification": "ok", "evidence": "inventado"}]}, [{"name": "Comprensión", "max_score": 5}], 5, "Respuesta breve")
        self.assertEqual(result["criteria"][0]["criterion"], "Comprensión")
        self.assertEqual(result["criteria"][0]["max_score"], 5)
        self.assertEqual(result["criteria"][0]["score"], 5)
        self.assertEqual(result["criteria"][0]["evidence"], "")
        self.assertTrue(result["warnings"])


    def test_level_strengths_and_suggestions_are_preserved(self):
        answer = "La fotosíntesis usa luz y agua para producir glucosa."
        rubric = [{"name": "Comprensión conceptual", "max_score": 5, "levels": [
            {"name": "Inicial", "score": 0}, {"name": "Logrado", "score": 4},
        ]}]
        result = _validate_proposal({
            "summary": "La respuesta identifica parte del proceso.",
            "criteria": [{"criterion": "Comprensión conceptual", "score": 4, "level": "Logrado",
                          "justification": "Relaciona luz y agua con la producción de glucosa.",
                          "evidence": "La fotosíntesis usa luz y agua"}],
            "feedback": "Buen comienzo.",
            "strengths": ["Identifica los insumos principales."],
            "improvement_suggestions": ["Explicar el rol del dióxido de carbono."],
        }, rubric, 5, answer)
        self.assertEqual(result["criteria"][0]["level"], "Logrado")
        self.assertEqual(result["strengths"], ["Identifica los insumos principales."])
        self.assertEqual(result["improvement_suggestions"], ["Explicar el rol del dióxido de carbono."])
        self.assertEqual(result["criteria"][0]["evidence"], "La fotosíntesis usa luz y agua")


    def test_no_rubric_fallback_preserves_small_question_maximum(self):
        rubric = default_rubric_for_question(0.25)
        self.assertEqual(rubric[0]["max_score"], 0.25)

    def test_no_rubric_fallback_keeps_score_within_question_maximum(self):
        rubric = default_rubric_for_question(5)
        self.assertEqual(len(rubric), 1)
        self.assertEqual(rubric[0]["max_score"], 5)
        result = _validate_proposal({
            "criteria": [
                {"criterion": "Criterio inventado 1", "score": 5, "max_score": 5},
                {"criterion": "Criterio inventado 2", "score": 5, "max_score": 5},
            ]
        }, rubric, 5, "Respuesta del estudiante")
        self.assertEqual(len(result["criteria"]), 1)
        self.assertLessEqual(result["suggested_total"], 5)
        self.assertEqual(result["criteria"][0]["max_score"], 5)
        self.assertAlmostEqual(result["suggested_total"], 5)
        self.assertTrue(any("varios subcriterios" in warning for warning in result["warnings"]))

    def test_invalid_literal_evidence_is_removed(self):
        result = _validate_proposal({"criteria": [{"criterion": "X", "score": 2, "evidence": "texto inventado"}]}, [], 5, "respuesta real")
        self.assertEqual(result["criteria"][0]["evidence"], "")
        self.assertTrue(result["warnings"])

    def test_mock_question_generation_is_explicitly_demo(self):
        from unittest.mock import patch
        with patch.dict("os.environ", {"AI_PROVIDER": "mock"}):
            result = asyncio.run(generate_questions(title="Ciencias", subject="Ciencias Naturales", level="Secundaria", objectives="Comprender", instructions="Fotosíntesis", count=3))
        self.assertEqual(len(result["questions"]), 3)
        self.assertTrue(result["demo"])


class AIRubricTests(SimpleTestCase):
    def test_mock_rubric_is_marked_as_demo_and_editable(self):
        from unittest.mock import patch
        from .ai import generate_rubric
        with patch.dict("os.environ", {"AI_PROVIDER": "mock"}):
            result = asyncio.run(generate_rubric(title="Evaluación de Ciencias", subject="Ciencias", level="Secundaria", objectives="Explicar la fotosíntesis", instructions="Analizar la respuesta con argumentos", question_prompts=["Explicá el proceso de fotosíntesis"], reference_material="Apunte sobre clorofila", count=3))
        self.assertTrue(result["demo"])
        self.assertEqual(len(result["criteria"]), 3)
        self.assertTrue(result["warnings"])


class SupabasePrincipalTests(SimpleTestCase):
    def test_authenticated_principal_exposes_pk_for_drf_throttling(self):
        # DRF's UserRateThrottle keys authenticated users by request.user.pk.
        principal = SupabasePrincipal(id="d708b9e3-2b1c-4bce-8b6f-3f91d045d117")
        self.assertEqual(principal.pk, principal.id)
        self.assertTrue(principal.is_authenticated)


class APIRootTests(SimpleTestCase):
    def test_root_describes_api_without_debug_404(self):
        response = Client().get("/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["service"], "MaestrIA API")
        self.assertEqual(response.json()["endpoints"]["health"], "/api/health/")

    def test_health_endpoint_is_public(self):
        response = Client().get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")

from uuid import uuid4
from django.test import TestCase
from rest_framework.test import APIClient
from .models import Course


class TenantIsolationTests(TestCase):
    def setUp(self):
        self.owner_a = str(uuid4())
        self.owner_b = str(uuid4())
        Course.objects.create(owner_id=self.owner_a, name="Curso A")
        self.course_b = Course.objects.create(owner_id=self.owner_b, name="Curso B")
        self.client = APIClient()

    def test_course_list_only_returns_current_owner(self):
        from .authentication import SupabasePrincipal
        self.client.force_authenticate(user=SupabasePrincipal(id=self.owner_a))
        response = self.client.get("/api/courses/")
        self.assertEqual(response.status_code, 200)
        names = [item["name"] for item in response.data]
        self.assertEqual(names, ["Curso A"])

    def test_cross_tenant_course_is_not_retrievable(self):
        from .authentication import SupabasePrincipal
        self.client.force_authenticate(user=SupabasePrincipal(id=self.owner_a))
        response = self.client.get(f"/api/courses/{self.course_b.pk}/")
        self.assertEqual(response.status_code, 404)

    def test_owner_id_from_client_is_ignored_on_create(self):
        from .authentication import SupabasePrincipal
        self.client.force_authenticate(user=SupabasePrincipal(id=self.owner_a))
        response = self.client.post("/api/courses/", {"name": "Curso propio", "owner_id": self.owner_b}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(str(Course.objects.get(pk=response.data["id"]).owner_id), self.owner_a)

    def test_course_name_duplicate_ignoring_case_is_rejected(self):
        from .authentication import SupabasePrincipal
        self.client.force_authenticate(user=SupabasePrincipal(id=self.owner_a))
        response = self.client.post("/api/courses/", {"name": "curso a"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)

    def test_database_constraint_prevents_case_only_duplicate_course_names(self):
        from django.db import IntegrityError, transaction
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Course.objects.create(owner_id=self.owner_a, name="curso a")

    def test_student_creation_requires_a_course(self):
        from .authentication import SupabasePrincipal
        self.client.force_authenticate(user=SupabasePrincipal(id=self.owner_a))
        response = self.client.post("/api/students/", {"name": "Estudiante sin curso"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("course", response.data)

    def test_student_creation_creates_active_enrollment_in_selected_course(self):
        from .authentication import SupabasePrincipal
        from .models import Enrollment, Student
        self.client.force_authenticate(user=SupabasePrincipal(id=self.owner_a))
        own_course = Course.objects.get(owner_id=self.owner_a)
        response = self.client.post("/api/students/", {"name": "Estudiante de prueba", "course": own_course.id}, format="json")
        self.assertEqual(response.status_code, 201)
        student = Student.objects.get(pk=response.data["id"])
        enrollment = Enrollment.objects.get(student=student)
        self.assertEqual(enrollment.course_id, own_course.id)
        self.assertEqual(enrollment.status, "active")
        self.assertEqual(str(student.owner_id), self.owner_a)

    def test_student_cannot_be_assigned_to_another_teachers_course(self):
        from .authentication import SupabasePrincipal
        self.client.force_authenticate(user=SupabasePrincipal(id=self.owner_a))
        response = self.client.post("/api/students/", {"name": "Estudiante ajeno", "course": self.course_b.id}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Course.objects.filter(owner_id=self.owner_a, name="Estudiante ajeno").exists())


class SupabaseClaimsValidationTests(SimpleTestCase):
    def test_rejects_service_role(self):
        from jwt import InvalidTokenError
        from .authentication import _principal_from_claims
        with self.assertRaises(InvalidTokenError):
            _principal_from_claims({"sub": "d708b9e3-2b1c-4bce-8b6f-3f91d045d117", "role": "service_role"})

    def test_rejects_anonymous_user(self):
        from jwt import InvalidTokenError
        from .authentication import _principal_from_claims
        with self.assertRaises(InvalidTokenError):
            _principal_from_claims({"sub": "d708b9e3-2b1c-4bce-8b6f-3f91d045d117", "role": "authenticated", "is_anonymous": True})

    def test_requires_uuid_subject_and_authenticated_role(self):
        from jwt import InvalidTokenError
        from .authentication import _principal_from_claims
        with self.assertRaises((InvalidTokenError, ValueError)):
            _principal_from_claims({"sub": "not-a-uuid", "role": "authenticated"})
        principal = _principal_from_claims({"sub": "d708b9e3-2b1c-4bce-8b6f-3f91d045d117", "role": "authenticated", "email": "teacher@example.org"})
        self.assertEqual(principal.email, "teacher@example.org")


class GeminiAdapterTests(SimpleTestCase):
    def test_extracts_json_from_gemini_response(self):
        from .ai import _extract_gemini_response
        raw = _extract_gemini_response({
            "candidates": [{"content": {"parts": [{"text": '{"ok": true}'}]}, "finishReason": "STOP"}]
        })
        self.assertEqual(raw, '{"ok": true}')

    def test_rejects_empty_gemini_response(self):
        from .ai import _extract_gemini_response
        with self.assertRaises(ValueError):
            _extract_gemini_response({"candidates": []})

    def test_external_provider_fails_closed_without_processing_approval(self):
        from unittest.mock import patch
        from .ai import generate_correction
        with patch.dict("os.environ", {"AI_PROVIDER": "gemini", "AI_EXTERNAL_PROCESSING_APPROVED": "false", "GEMINI_API_KEY": "not-used"}):
            with self.assertRaisesRegex(RuntimeError, "envío de contenido"):
                asyncio.run(generate_correction(
                    question="¿Qué es la fotosíntesis?", answer="Usa luz.",
                    rubric=[{"name": "Comprensión", "max_score": 10}], max_score=10,
                ))

    def test_external_provider_requires_an_api_key(self):
        from unittest.mock import patch
        from .ai import _gemini_json
        env = {"AI_EXTERNAL_PROCESSING_APPROVED": "true", "AI_GEMINI_PAID_TIER_CONFIRMED": "true", "GEMINI_API_KEY": "", "AI_TIMEOUT_SECONDS": "10"}
        with patch.dict("os.environ", env):
            with self.assertRaisesRegex(RuntimeError, "GEMINI_API_KEY"):
                asyncio.run(_gemini_json(system_instruction="Devolvé JSON", context={"test": True}))

    def test_gemini_free_tier_is_blocked_for_regular_requests(self):
        from unittest.mock import patch
        from .ai import _assert_external_ai_approved
        env = {
            "AI_EXTERNAL_PROCESSING_APPROVED": "true",
            "AI_GEMINI_PAID_TIER_CONFIRMED": "false",
            "AI_GEMINI_FREE_TIER_SYNTHETIC_EVAL": "false",
        }
        with patch.dict("os.environ", env):
            with self.assertRaisesRegex(RuntimeError, "nivel pago"):
                _assert_external_ai_approved("gemini")

    def test_gemini_free_tier_allowed_only_for_explicit_synthetic_evaluation(self):
        from unittest.mock import patch
        from .ai import _assert_external_ai_approved
        env = {
            "AI_EXTERNAL_PROCESSING_APPROVED": "true",
            "AI_GEMINI_PAID_TIER_CONFIRMED": "false",
            "AI_GEMINI_FREE_TIER_SYNTHETIC_EVAL": "true",
        }
        with patch.dict("os.environ", env):
            _assert_external_ai_approved("gemini", allow_free_tier_synthetic=True)
            with self.assertRaisesRegex(RuntimeError, "nivel pago"):
                _assert_external_ai_approved("gemini", allow_free_tier_synthetic=False)


class DemoDatasetTests(TestCase):
    """The practice dataset belongs only to the authenticated teacher and is repeatable."""
    def setUp(self):
        from uuid import uuid4
        from rest_framework.test import APIClient
        from .authentication import SupabasePrincipal
        self.owner_id = str(uuid4())
        self.client = APIClient()
        self.client.force_authenticate(user=SupabasePrincipal(id=self.owner_id))

    def test_seed_creates_course_students_rubric_assessment_and_answers(self):
        from .models import Assessment, Enrollment, Question, Rubric, RubricCriterion, Student, Submission
        response = self.client.post("/api/demo/seed/", {}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["submission_count"], 3)
        self.assertEqual(Course.objects.filter(owner_id=self.owner_id, name__startswith="Ejemplo MaestrIA").count(), 1)
        self.assertEqual(Student.objects.filter(owner_id=self.owner_id, external_code__startswith="DEMO-FOTO-").count(), 3)
        self.assertEqual(Enrollment.objects.filter(owner_id=self.owner_id, status="active").count(), 3)
        self.assertEqual(Assessment.objects.filter(owner_id=self.owner_id, pk=response.data["assessment_id"]).count(), 1)
        self.assertEqual(Question.objects.filter(owner_id=self.owner_id, assessment_id=response.data["assessment_id"]).count(), 1)
        self.assertEqual(Rubric.objects.filter(owner_id=self.owner_id, title__startswith="Ejemplo MaestrIA").count(), 1)
        self.assertEqual(RubricCriterion.objects.filter(owner_id=self.owner_id, rubric__title__startswith="Ejemplo MaestrIA").count(), 3)
        sample_submissions = Submission.objects.filter(owner_id=self.owner_id, assessment_id=response.data["assessment_id"], answer_text__gt="")
        self.assertEqual(sample_submissions.count(), 3)
        self.assertFalse(sample_submissions.exclude(source_filename="").exists())

    def test_seed_is_idempotent_and_does_not_duplicate_students_or_submissions(self):
        from .models import Student, Submission
        first = self.client.post("/api/demo/seed/", {}, format="json")
        second = self.client.post("/api/demo/seed/", {}, format="json")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["assessment_id"], second.data["assessment_id"])
        self.assertEqual(Student.objects.filter(owner_id=self.owner_id, external_code__startswith="DEMO-FOTO-").count(), 3)
        self.assertEqual(Submission.objects.filter(owner_id=self.owner_id, assessment_id=first.data["assessment_id"]).count(), 3)

    def test_another_teacher_cannot_read_the_seeded_assessment(self):
        from uuid import uuid4
        from .authentication import SupabasePrincipal
        first = self.client.post("/api/demo/seed/", {}, format="json")
        self.client.force_authenticate(user=SupabasePrincipal(id=str(uuid4())))
        response = self.client.get(f"/api/assessments/{first.data['assessment_id']}/")
        self.assertEqual(response.status_code, 404)

    def test_practice_correction_rejects_mock_provider(self):
        from unittest.mock import patch
        from .models import Submission
        seeded = self.client.post("/api/demo/seed/", {}, format="json")
        submission = Submission.objects.filter(owner_id=self.owner_id, assessment_id=seeded.data["assessment_id"]).first()
        with patch.dict("os.environ", {"AI_PROVIDER": "mock"}):
            response = self.client.post(f"/api/submissions/{submission.id}/generate-correction/", {}, format="json")
        self.assertEqual(response.status_code, 503)
        self.assertIn("no se generarán puntajes simulados", response.data["detail"])
