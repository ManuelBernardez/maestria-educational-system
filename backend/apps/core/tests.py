import asyncio
from django.test import SimpleTestCase, Client, override_settings
from .ai import _mock, _validate_proposal, ai_error_code, default_rubric_for_question, generate_questions
from .authentication import SupabasePrincipal
from .api_views.common import ai_error_http_status

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


class AIErrorTelemetryTests(SimpleTestCase):
    def test_http_errors_store_only_status_code(self):
        import httpx
        request = httpx.Request("POST", "https://example.invalid")
        response = httpx.Response(429, request=request, text="sensitive provider body")
        error = httpx.HTTPStatusError("sensitive provider body", request=request, response=response)
        self.assertEqual(ai_error_code(error), "HTTP_429")

    def test_missing_api_key_has_stable_category(self):
        self.assertEqual(ai_error_code(RuntimeError("Falta GEMINI_API_KEY en el entorno del backend.")), "MISSING_GEMINI_API_KEY")

    def test_timeout_has_stable_category(self):
        import httpx
        self.assertEqual(ai_error_code(httpx.ReadTimeout("private timeout data")), "PROVIDER_TIMEOUT")

    def test_timeout_maps_to_gateway_timeout(self):
        import httpx
        self.assertEqual(ai_error_http_status(httpx.ReadTimeout("provider timed out")), 504)

    def test_missing_provider_credentials_map_to_service_unavailable(self):
        self.assertEqual(ai_error_http_status(RuntimeError("Falta GEMINI_API_KEY en el entorno del backend.")), 503)


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


# Estas pruebas no usan la base: con CACHE_BACKEND=database el throttle consultaría la
# tabla de caché, así que se fija el caché en memoria. El throttle se prueba aparte.
@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "api-root-tests"}})
class APIRootTests(SimpleTestCase):
    def test_root_serves_the_frontend_with_strict_csp_and_api_stays_json(self):
        home = Client().get("/")
        self.assertEqual(home.status_code, 200)
        self.assertIn("text/html", home["Content-Type"])
        csp = home["Content-Security-Policy"]
        self.assertIn("script-src 'self'", csp)
        self.assertIn("style-src 'self' https://fonts.googleapis.com", csp)
        self.assertIn("connect-src 'self' https://*.supabase.co https://*.supabase.com", csp)
        self.assertNotIn("unsafe-inline", csp)
        health = Client().get("/api/health/")
        self.assertEqual(health["Content-Type"], "application/json")
        # The HTML policy (style-src/connect-src for the browser app) must not leak into
        # API JSON; the API gets its own deny-all policy from ApiServerTimingMiddleware.
        api_csp = health["Content-Security-Policy"]
        self.assertIn("default-src 'none'", api_csp)
        self.assertIn("frame-ancestors 'none'", api_csp)
        self.assertNotIn("connect-src", api_csp)
        self.assertNotIn("style-src", api_csp)

    def test_unknown_api_route_returns_json_404_even_for_post(self):
        for method in ("get", "post"):
            response = getattr(Client(enforce_csrf_checks=True), method)("/api/no-existe/")
            self.assertEqual(response.status_code, 404, method)
            self.assertEqual(response["Content-Type"], "application/json")

    def test_frontend_file_view_is_confined_to_html_directory(self):
        # frontend/js/config.js exists, but scripts must only be served under /assets/.
        response = Client().get("/..%2fjs%2fconfig.js")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(Client().get("/plantilla-estudiantes.csv").status_code, 200)

    def test_static_js_and_css_are_revalidated_but_images_keep_default_cache(self):
        from config.settings import _whitenoise_headers

        for url in ("/assets/js/workspace.js", "/assets/js/modules/core/state.js", "/assets/css/workspace.css"):
            headers = {}
            _whitenoise_headers(headers, "", url)
            self.assertEqual(headers.get("Cache-Control"), "no-cache", url)
        headers = {}
        _whitenoise_headers(headers, "", "/assets/images/maestria-mark.svg")
        self.assertNotIn("Cache-Control", headers)

    def test_health_endpoint_is_public(self):
        response = Client().get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "ok")
        self.assertEqual(response["Cache-Control"], "no-store")
        self.assertIn("camera=()", response["Permissions-Policy"])

from uuid import uuid4
from django.test import TestCase
from rest_framework.test import APIClient
from .models import Course
from .test_support import ensure_auth_users


class TenantIsolationTests(TestCase):
    def setUp(self):
        self.owner_a = str(uuid4())
        self.owner_b = str(uuid4())
        ensure_auth_users(self.owner_a, self.owner_b)
        Course.objects.create(owner_id=self.owner_a, name="Curso A")
        self.course_b = Course.objects.create(owner_id=self.owner_b, name="Curso B")
        self.client = APIClient()

    def test_course_list_only_returns_current_owner(self):
        from .authentication import SupabasePrincipal
        self.client.force_authenticate(user=SupabasePrincipal(id=self.owner_a))
        response = self.client.get("/api/courses/")
        self.assertEqual(response.status_code, 200)
        names = [item["name"] for item in response.data["results"]]
        self.assertEqual(names, ["Curso A"])

    def test_course_list_uses_bounded_page_number_pagination(self):
        from .authentication import SupabasePrincipal
        self.client.force_authenticate(user=SupabasePrincipal(id=self.owner_a))
        Course.objects.create(owner_id=self.owner_a, name="Curso A2")
        response = self.client.get("/api/courses/?page_size=1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertIsNotNone(response.data["next"])

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

    def test_reference_schema_does_not_claim_a_database_unique_course_name_index(self):
        # The canonical SQL has no case-insensitive unique index for course.name.
        # The API enforces this for application writes under an owner-row lock.
        duplicate = Course.objects.create(owner_id=self.owner_a, name="curso a")
        self.assertTrue(Course.objects.filter(owner_id=self.owner_a, pk=duplicate.pk).exists())

    def test_active_enrollment_rejects_archived_course(self):
        from .authentication import SupabasePrincipal
        from .models import Student
        self.client.force_authenticate(user=SupabasePrincipal(id=self.owner_a))
        course = Course.objects.get(owner_id=self.owner_a)
        course.active = False
        course.save(update_fields=["active"])
        student = Student.objects.create(owner_id=self.owner_a, name="Estudiante de prueba")
        response = self.client.post("/api/enrollments/", {"course": course.id, "student": student.id, "status": "active"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("course", response.data)

    def test_active_enrollment_rejects_inactive_student(self):
        from .authentication import SupabasePrincipal
        from .models import Student
        self.client.force_authenticate(user=SupabasePrincipal(id=self.owner_a))
        course = Course.objects.get(owner_id=self.owner_a)
        student = Student.objects.create(owner_id=self.owner_a, name="Estudiante inactivo", active=False)
        response = self.client.post("/api/enrollments/", {"course": course.id, "student": student.id, "status": "active"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("student", response.data)

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


class AIConfigurationStatusTests(SimpleTestCase):
    def test_provider_runtime_failures_keep_bad_gateway_status(self):
        from .api_views.common import ai_error_http_status
        self.assertEqual(ai_error_http_status(RuntimeError("Falla transitoria del proveedor")), 502)


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

    def test_external_provider_requires_an_api_key(self):
        from unittest.mock import patch
        from .ai import _gemini_json
        env = {"GEMINI_API_KEY": "", "AI_TIMEOUT_SECONDS": "10"}
        with patch.dict("os.environ", env):
            with self.assertRaisesRegex(RuntimeError, "GEMINI_API_KEY"):
                asyncio.run(_gemini_json(system_instruction="Devolvé JSON", context={"test": True}))


class DemoDatasetTests(TestCase):
    """The practice dataset belongs only to the authenticated teacher and is repeatable."""
    def setUp(self):
        from uuid import uuid4
        from rest_framework.test import APIClient
        from .authentication import SupabasePrincipal
        self.owner_id = str(uuid4())
        ensure_auth_users(self.owner_id)
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
        other_id = str(uuid4())
        ensure_auth_users(other_id)
        self.client.force_authenticate(user=SupabasePrincipal(id=other_id))
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


class WorkspacePermissionTests(SimpleTestCase):
    def setUp(self):
        from .permissions import IsWorkspaceUser
        self.permission = IsWorkspaceUser()
        self.request = type("Request", (), {})()
        self.request.user = SupabasePrincipal(id="d708b9e3-2b1c-4bce-8b6f-3f91d045d117")

    def test_missing_profile_is_denied(self):
        from unittest.mock import patch
        with patch("apps.core.permissions.active_profile", return_value=None):
            self.assertFalse(self.permission.has_permission(self.request, None))

    def test_teacher_profile_is_allowed(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        profile = SimpleNamespace(role="teacher", status="active")
        with patch("apps.core.permissions.active_profile", return_value=profile):
            self.assertTrue(self.permission.has_permission(self.request, None))

    def test_student_profile_is_not_allowed_into_teacher_workspace(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        profile = SimpleNamespace(role="student", status="active")
        with patch("apps.core.permissions.active_profile", return_value=profile):
            self.assertFalse(self.permission.has_permission(self.request, None))


from django.core.cache import cache
from django.test import RequestFactory, override_settings
from django.conf import settings as django_settings

from .network import client_ip, proxy_header_shape


def _rest_framework_with(num_proxies):
    return {**django_settings.REST_FRAMEWORK, "NUM_PROXIES": num_proxies}


class ContactThrottleProxyTests(TestCase):
    """F-10: la identidad del throttle no puede depender de la parte de X-Forwarded-For
    que escribe el cliente. ContactRateThrottle permite 5 mensajes por hora."""

    payload = {
        "name": "Persona de prueba", "email": "contacto@example.test",
        "subject": "Consulta de prueba", "message": "Mensaje de prueba para validar el límite de contacto.",
    }

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def _post(self, forwarded=None, remote_addr="10.0.0.5"):
        extra = {"REMOTE_ADDR": remote_addr}
        if forwarded is not None:
            extra["HTTP_X_FORWARDED_FOR"] = forwarded
        return APIClient().post("/api/contact/", self.payload, format="json", **extra)

    @override_settings(REST_FRAMEWORK=_rest_framework_with(1))
    def test_same_forwarded_for_is_throttled_on_sixth_post(self):
        statuses = [self._post("198.51.100.1, 203.0.113.7").status_code for _ in range(6)]
        self.assertEqual(statuses, [201] * 5 + [429])

    @override_settings(REST_FRAMEWORK=_rest_framework_with(1))
    def test_spoofed_client_part_with_same_proxy_ip_is_still_throttled(self):
        # El cliente cambia su parte del header en cada pedido; la IP que agrega el proxy
        # (la última) es la misma, así que todos los pedidos cuentan contra el mismo límite.
        statuses = [self._post(f"198.51.100.{n}, 203.0.113.7").status_code for n in range(1, 7)]
        self.assertEqual(statuses, [201] * 5 + [429])

    @override_settings(REST_FRAMEWORK=_rest_framework_with(2))
    def test_two_proxies_use_the_ip_added_by_the_first_trusted_proxy(self):
        # Cliente → Cloudflare (agrega 203.0.113.7) → Render (agrega la IP de Cloudflare).
        statuses = [self._post(f"198.51.100.{n}, 203.0.113.7, 172.70.{n}.1").status_code for n in range(1, 7)]
        self.assertEqual(statuses, [201] * 5 + [429])

    @override_settings(REST_FRAMEWORK=_rest_framework_with(0))
    def test_zero_proxies_uses_remote_addr_and_ignores_forwarded_for(self):
        statuses = [self._post(f"198.51.100.{n}, 203.0.113.{n}").status_code for n in range(1, 7)]
        self.assertEqual(statuses, [201] * 5 + [429])
        # Otra REMOTE_ADDR es otro cliente: tiene su propio cupo.
        self.assertEqual(self._post("198.51.100.1", remote_addr="10.0.0.6").status_code, 201)

    def test_authenticated_user_keeps_own_quota_regardless_of_ip(self):
        teacher_id = uuid4()
        ensure_auth_users(teacher_id)
        client = APIClient()
        client.force_authenticate(user=SupabasePrincipal(id=str(teacher_id)))
        statuses = [
            client.post("/api/contact/", self.payload, format="json", REMOTE_ADDR=f"10.0.0.{n}").status_code
            for n in range(1, 7)
        ]
        self.assertEqual(statuses, [201] * 5 + [429])


class ClientIpTests(SimpleTestCase):
    """La auditoría identifica al cliente con el mismo criterio que los throttles."""

    def _request(self, forwarded=None, remote_addr="10.0.0.5", **extra):
        meta = {"REMOTE_ADDR": remote_addr, **extra}
        if forwarded is not None:
            meta["HTTP_X_FORWARDED_FOR"] = forwarded
        return RequestFactory().get("/api/health/", **meta)

    @override_settings(REST_FRAMEWORK=_rest_framework_with(0))
    def test_zero_proxies_returns_remote_addr(self):
        self.assertEqual(client_ip(self._request("198.51.100.9, 203.0.113.7")), "10.0.0.5")

    @override_settings(REST_FRAMEWORK=_rest_framework_with(1))
    def test_one_proxy_returns_last_forwarded_entry(self):
        self.assertEqual(client_ip(self._request("198.51.100.9, 203.0.113.7")), "203.0.113.7")
        self.assertEqual(client_ip(self._request()), "10.0.0.5")

    @override_settings(REST_FRAMEWORK=_rest_framework_with(2))
    def test_invalid_value_is_not_stored(self):
        self.assertIsNone(client_ip(self._request("no-es-una-ip, 203.0.113.7")))

    def test_probe_reports_shape_without_ips(self):
        shape = proxy_header_shape(self._request(
            "198.51.100.9, 203.0.113.7, 172.70.1.1", HTTP_TRUE_CLIENT_IP="203.0.113.7",
        ))
        self.assertEqual(shape["xff_entradas"], 3)
        self.assertEqual(shape["true_client_ip_en_xff"], "-2")
        self.assertEqual(shape["cf_connecting_ip_en_xff"], "ausente")
        self.assertNotIn("203.0.113.7", str(shape))

from django.core.cache.backends.db import DatabaseCache
from django.core.cache.backends.locmem import LocMemCache
from django.test import RequestFactory

from .throttles import ContactRateThrottle


class SharedThrottleCacheTests(TestCase):
    """F-10: con 2 workers de Gunicorn cada proceso tiene su propio objeto de caché.
    Con DatabaseCache todos leen y escriben la misma tabla, así que el contador es único."""

    def _worker_throttle(self, cache_backend):
        throttle = ContactRateThrottle()  # 5/hour
        throttle.cache = cache_backend
        return throttle

    def _allowed(self, throttle):
        request = RequestFactory().post("/api/contact/", REMOTE_ADDR="10.0.0.5")
        request.user = None  # pedido anónimo
        return throttle.allow_request(request, view=None)

    def test_two_workers_with_database_cache_share_one_counter(self):
        # Dos instancias independientes del backend, como en dos procesos distintos.
        worker_a = DatabaseCache("django_cache", {})
        worker_b = DatabaseCache("django_cache", {})
        worker_a.clear()
        self.addCleanup(worker_a.clear)
        results = [self._allowed(self._worker_throttle(worker_a)) for _ in range(3)]
        results += [self._allowed(self._worker_throttle(worker_b)) for _ in range(3)]
        self.assertEqual(results, [True] * 5 + [False])

    def test_two_workers_with_process_memory_count_separately(self):
        # Lo que pasaba antes: cada proceso con su LocMemCache permite 5 por su cuenta.
        worker_a = LocMemCache("worker-a", {})
        worker_b = LocMemCache("worker-b", {})
        self.addCleanup(worker_a.clear)
        self.addCleanup(worker_b.clear)
        results = [self._allowed(self._worker_throttle(worker_a)) for _ in range(3)]
        results += [self._allowed(self._worker_throttle(worker_b)) for _ in range(3)]
        self.assertEqual(results, [True] * 6)

    def test_database_cache_entries_expire(self):
        backend = DatabaseCache("django_cache", {})
        self.addCleanup(backend.clear)
        backend.set("throttle_contact_10.0.0.9", [1.0], timeout=0)
        self.assertIsNone(backend.get("throttle_contact_10.0.0.9"))


class CacheSettingsTests(SimpleTestCase):
    """El arranque falla con un mensaje claro si producción no tiene caché compartida."""

    def _load_settings(self, **env):
        import os, subprocess, sys
        from pathlib import Path
        base = {k: v for k, v in os.environ.items() if k not in {"CACHE_BACKEND", "DEBUG"}}
        base.update({"DJANGO_SECRET_KEY": "x" * 60, **env})
        return subprocess.run(
            [sys.executable, "-c", "import config.settings as s; print(s.CACHES['default']['BACKEND'])"],
            cwd=Path(__file__).resolve().parents[2], env=base, capture_output=True, text=True, timeout=60,
        )

    def test_production_without_cache_backend_fails_at_startup(self):
        result = self._load_settings(DEBUG="False")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("CACHE_BACKEND debe ser 'database'", result.stderr)

    def test_production_rejects_process_memory_cache(self):
        result = self._load_settings(DEBUG="False", CACHE_BACKEND="locmem")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("CACHE_BACKEND=locmem no se permite con DEBUG=False", result.stderr)

    def test_production_with_database_cache_loads(self):
        result = self._load_settings(DEBUG="False", CACHE_BACKEND="database")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("DatabaseCache", result.stdout)
