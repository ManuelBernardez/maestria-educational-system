"""Regresiones de la auditoría técnica 2026-11-09 (docs/auditoria/AUDITORIA_TECNICA_MAESTRIA.md).

Corren sobre el esquema real de producción (conftest.py), con sus índices únicos.
"""
from decimal import Decimal
from unittest import mock
from uuid import uuid4

from django.core.cache import caches
from django.test import RequestFactory, TestCase, override_settings
from rest_framework.test import APIClient

from . import ai_guard
from .authentication import SupabasePrincipal
from .client_ip import client_ip
from .models import (
    AIGeneration, AIProviderConfig, Assessment, AuditEvent, Correction, Course, Enrollment, Question,
    Rubric, RubricCriterion, RubricLevel, Student, Submission, SubmissionAnswer, UserProfile,
)
from .test_support import ensure_auth_users


def _client_for(user_id):
    client = APIClient()
    client.force_authenticate(user=SupabasePrincipal(id=str(user_id)))
    return client


class SchemaContractTests(TestCase):
    """AUD-004: la base de pruebas es el snapshot de producción + migraciones pendientes."""

    def test_test_database_satisfies_the_production_contract(self):
        from io import StringIO

        from django.core.management import call_command
        output = StringIO()
        call_command("verify_public_schema", stdout=output, stderr=output)
        self.assertIn("Esquema compatible", output.getvalue())


class QuestionReorderTests(TestCase):
    """AUD-002: intercambiar posiciones choca con uniq_question_position_per_assessment."""

    def setUp(self):
        self.owner_id = uuid4()
        ensure_auth_users(self.owner_id)
        self.client = _client_for(self.owner_id)
        self.assessment = Assessment.objects.create(owner_id=self.owner_id, title="Evaluación")
        self.q1 = Question.objects.create(owner_id=self.owner_id, assessment=self.assessment, prompt="Uno", position=1)
        self.q2 = Question.objects.create(owner_id=self.owner_id, assessment=self.assessment, prompt="Dos", position=2)
        self.q3 = Question.objects.create(owner_id=self.owner_id, assessment=self.assessment, prompt="Tres", position=3)

    def test_reorder_swaps_positions_atomically(self):
        response = self.client.post(
            f"/api/assessments/{self.assessment.pk}/reorder-questions/",
            {"order": [self.q2.pk, self.q1.pk, self.q3.pk]}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([item["id"] for item in response.data["questions"]], [self.q2.pk, self.q1.pk, self.q3.pk])
        positions = dict(Question.objects.filter(assessment=self.assessment).values_list("pk", "position"))
        self.assertEqual(positions, {self.q2.pk: 1, self.q1.pk: 2, self.q3.pk: 3})
        self.assertTrue(AuditEvent.objects.filter(owner_id=self.owner_id, event_type="questions.reordered").exists())

    def test_reorder_rejects_incomplete_or_foreign_lists(self):
        url = f"/api/assessments/{self.assessment.pk}/reorder-questions/"
        self.assertEqual(self.client.post(url, {"order": [self.q1.pk, self.q2.pk]}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {"order": [self.q1.pk, self.q1.pk, self.q3.pk]}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {"order": "x"}, format="json").status_code, 400)
        other = uuid4()
        ensure_auth_users(other)
        foreign = _client_for(other).post(url, {"order": [self.q3.pk, self.q2.pk, self.q1.pk]}, format="json")
        self.assertEqual(foreign.status_code, 404)
        positions = dict(Question.objects.filter(assessment=self.assessment).values_list("pk", "position"))
        self.assertEqual(positions, {self.q1.pk: 1, self.q2.pk: 2, self.q3.pk: 3})

    def test_position_collision_through_patch_is_a_conflict_not_a_server_error(self):
        response = self.client.patch(f"/api/questions/{self.q1.pk}/", {"position": 2}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertNotIn("uniq_", str(response.data))


class IntegrityErrorTranslationTests(TestCase):
    """AUD-003: violaciones de restricciones reales → 409, nunca 500."""

    def setUp(self):
        self.owner_id = uuid4()
        ensure_auth_users(self.owner_id)
        self.client = _client_for(self.owner_id)
        self.course = Course.objects.create(owner_id=self.owner_id, name="Curso")
        self.student = Student.objects.create(owner_id=self.owner_id, name="Estudiante")

    def test_re_enrolling_reactivates_the_inactive_enrollment(self):
        enrollment = Enrollment.objects.create(owner_id=self.owner_id, course=self.course, student=self.student, status="inactive")
        response = self.client.post("/api/enrollments/", {
            "course": self.course.pk, "student": self.student.pk, "status": "active", "notes": "Vuelve",
        }, format="json")
        self.assertIn(response.status_code, (200, 201), response.data)
        self.assertEqual(response.data["id"], enrollment.pk)
        enrollment.refresh_from_db()
        self.assertEqual(enrollment.status, "active")
        self.assertEqual(Enrollment.objects.filter(course=self.course, student=self.student).count(), 1)

    def test_duplicate_active_enrollment_is_still_rejected(self):
        Enrollment.objects.create(owner_id=self.owner_id, course=self.course, student=self.student, status="active")
        response = self.client.post("/api/enrollments/", {"course": self.course.pk, "student": self.student.pk}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_invalid_enrollment_course_filter_is_a_bad_request(self):
        self.assertEqual(self.client.get("/api/enrollments/?course=abc").status_code, 400)

    def test_deleting_a_rubric_with_criteria_is_a_conflict(self):
        rubric = Rubric.objects.create(owner_id=self.owner_id, title="Rúbrica")
        RubricCriterion.objects.create(owner_id=self.owner_id, rubric=rubric, name="Criterio", position=1)
        response = self.client.delete(f"/api/rubrics/{rubric.pk}/")
        self.assertEqual(response.status_code, 409)
        self.assertTrue(Rubric.objects.filter(pk=rubric.pk).exists())


class AIProviderGateTests(TestCase):
    """AUD-012 y AUD-003: habilitar IA externa exige superadmin + confirmación auditada."""

    def setUp(self):
        self.admin_id, self.superadmin_id = uuid4(), uuid4()
        ensure_auth_users(self.admin_id, self.superadmin_id)
        UserProfile.objects.filter(user_id=self.admin_id).update(role="admin")
        UserProfile.objects.filter(user_id=self.superadmin_id).update(role="superadmin")
        self.admin = _client_for(self.admin_id)
        self.superadmin = _client_for(self.superadmin_id)
        self.payload = {"provider": "gemini", "model_name": "gemini-x", "enabled": True, "timeout_seconds": 30}

    def test_regular_admin_cannot_enable_external_provider(self):
        response = self.admin.post("/api/admin/ai-providers/", {**self.payload, "confirm_external_processing": True}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(AIProviderConfig.objects.exists())

    def test_superadmin_must_confirm_external_processing(self):
        response = self.superadmin.post("/api/admin/ai-providers/", self.payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("confirm_external_processing", response.data)
        confirmed = self.superadmin.post("/api/admin/ai-providers/", {**self.payload, "confirm_external_processing": True}, format="json")
        self.assertEqual(confirmed.status_code, 201, confirmed.data)
        event = AuditEvent.objects.get(event_type="ai_provider_config.created", object_id=str(confirmed.data["id"]))
        self.assertTrue(event.detail["external_processing_confirmed"])

    def test_disabled_or_mock_providers_need_no_confirmation(self):
        self.assertEqual(self.admin.post("/api/admin/ai-providers/", {**self.payload, "enabled": False}, format="json").status_code, 201)
        self.assertEqual(self.admin.post("/api/admin/ai-providers/", {"provider": "mock", "enabled": True, "timeout_seconds": 30}, format="json").status_code, 201)

    def test_enabling_a_second_provider_is_a_conflict(self):
        AIProviderConfig.objects.create(provider="mock", enabled=True)
        response = self.superadmin.post("/api/admin/ai-providers/", {**self.payload, "confirm_external_processing": True}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertIn("otro proveedor", response.data["detail"])


class AICapacityGuardTests(TestCase):
    """AUD-001/AUD-005: cupo de IA por proceso y cuota diaria persistente."""

    def setUp(self):
        self.owner_id = uuid4()
        ensure_auth_users(self.owner_id)
        self.client = _client_for(self.owner_id)
        caches["shared"].clear()
        self.assessment = Assessment.objects.create(owner_id=self.owner_id, title="Evaluación IA", objectives="Objetivo")

    @override_settings(AI_MAX_CONCURRENT_REQUESTS=1, AI_SLOT_WAIT_SECONDS=0)
    def test_busy_slots_return_503_without_calling_the_provider(self):
        semaphore = ai_guard._get_semaphore()
        self.assertTrue(semaphore.acquire(timeout=1))
        try:
            with mock.patch("apps.core.api_views.catalog.generate_questions") as provider:
                response = self.client.post(f"/api/assessments/{self.assessment.pk}/generate-questions/", {"count": 2}, format="json")
            provider.assert_not_called()
        finally:
            semaphore.release()
        self.assertEqual(response.status_code, 503)
        self.assertIn("Retry-After", response.headers)
        self.assertFalse(AIGeneration.objects.filter(owner_id=self.owner_id).exists())

    @override_settings(AI_DAILY_LIMIT_PER_USER=2)
    def test_daily_quota_is_enforced_from_persisted_generations(self):
        for _ in range(2):
            AIGeneration.objects.create(owner_id=self.owner_id, task="generate_questions", provider="mock", status="succeeded")
        response = self.client.post(f"/api/assessments/{self.assessment.pk}/generate-questions/", {"count": 2}, format="json")
        self.assertEqual(response.status_code, 429)

    def test_slot_is_released_after_a_generation(self):
        response = self.client.post(f"/api/assessments/{self.assessment.pk}/generate-questions/", {"count": 2}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        semaphore = ai_guard._get_semaphore()
        acquired = [semaphore.acquire(timeout=0) for _ in range(ai_guard._semaphore_size)]
        for ok in acquired:
            if ok:
                semaphore.release()
        self.assertTrue(all(acquired))


class ClientIPTests(TestCase):
    """AUD-005: X-Forwarded-For (falsificable en Render) no identifica al cliente."""

    @override_settings(TRUSTED_CLIENT_IP_HEADERS=["True-Client-IP", "CF-Connecting-IP"])
    def test_trusted_cloudflare_header_wins_and_forwarded_for_is_ignored(self):
        request = RequestFactory().get("/", HTTP_X_FORWARDED_FOR="1.2.3.4", HTTP_CF_CONNECTING_IP="203.0.113.7", REMOTE_ADDR="10.0.0.1")
        self.assertEqual(client_ip(request), "203.0.113.7")
        spoof_only = RequestFactory().get("/", HTTP_X_FORWARDED_FOR="1.2.3.4", REMOTE_ADDR="10.0.0.1")
        self.assertEqual(client_ip(spoof_only), "10.0.0.1")
        garbage = RequestFactory().get("/", HTTP_TRUE_CLIENT_IP="not-an-ip", REMOTE_ADDR="10.0.0.1")
        self.assertEqual(client_ip(garbage), "10.0.0.1")

    @override_settings(TRUSTED_CLIENT_IP_HEADERS=[])
    def test_development_uses_remote_addr_only(self):
        request = RequestFactory().get("/", HTTP_CF_CONNECTING_IP="203.0.113.7", REMOTE_ADDR="127.0.0.1")
        self.assertEqual(client_ip(request), "127.0.0.1")


class LeastPrivilegeRoleTests(TestCase):
    """AUD-006: la API completa funciona con `maestria_app` (sin BYPASSRLS ni acceso a auth)."""

    def setUp(self):
        self.owner_id, self.superadmin_id, self.other_id = uuid4(), uuid4(), uuid4()
        ensure_auth_users(self.owner_id, self.superadmin_id, self.other_id)
        UserProfile.objects.filter(user_id=self.superadmin_id).update(role="superadmin")
        from django.db import connection
        with connection.cursor() as cursor:
            # TestCase envuelve cada test en una transacción: el rol vuelve a postgres al final.
            cursor.execute("SET LOCAL ROLE maestria_app")

    def test_core_teacher_and_admin_flows_run_as_app_role(self):
        teacher = _client_for(self.owner_id)
        course = teacher.post("/api/courses/", {"name": "Curso con rol mínimo"}, format="json")
        self.assertEqual(course.status_code, 201, course.data)
        student = teacher.post("/api/students/", {"name": "Estudiante", "course": course.data["id"]}, format="json")
        self.assertEqual(student.status_code, 201, student.data)
        assessment = teacher.post("/api/assessments/", {"title": "Evaluación", "course": course.data["id"]}, format="json")
        self.assertEqual(assessment.status_code, 201, assessment.data)
        q1 = teacher.post("/api/questions/", {"assessment": assessment.data["id"], "prompt": "Uno"}, format="json")
        q2 = teacher.post("/api/questions/", {"assessment": assessment.data["id"], "prompt": "Dos"}, format="json")
        self.assertEqual((q1.status_code, q2.status_code), (201, 201))
        reorder = teacher.post(f"/api/assessments/{assessment.data['id']}/reorder-questions/", {"order": [q2.data["id"], q1.data["id"]]}, format="json")
        self.assertEqual(reorder.status_code, 200, reorder.data)
        submission = teacher.post("/api/submissions/", {
            "assessment": assessment.data["id"], "question": q1.data["id"], "student": student.data["id"],
            "answer_text": "Respuesta del estudiante para corregir.",
        }, format="json")
        self.assertEqual(submission.status_code, 201, submission.data)
        proposal = teacher.post(f"/api/submissions/{submission.data['id']}/generate-correction/", {}, format="json")
        self.assertEqual(proposal.status_code, 201, proposal.data)
        self.assertEqual(teacher.get("/api/dashboard/overview/").status_code, 200)

        admin = _client_for(self.superadmin_id)
        membership_target = admin.post("/api/admin/users/", {"user_id": str(self.other_id), "role": "teacher", "status": "active"}, format="json")
        # El perfil ya existe (trigger de Auth): el validador consulta Auth vía la función.
        self.assertIn(membership_target.status_code, (201, 400))
        unknown = admin.post("/api/admin/users/", {"user_id": str(uuid4()), "role": "teacher", "status": "active"}, format="json")
        self.assertEqual(unknown.status_code, 400)
        self.assertIn("Supabase Auth", str(unknown.data))
        from django.db import connection
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_user")
            self.assertEqual(cursor.fetchone()[0], "maestria_app")

    def test_app_role_cannot_rewrite_audit_or_read_auth(self):
        from django.db import DatabaseError, connection, transaction
        AuditEvent.objects.create(owner_id=self.owner_id, event_type="t", object_type="t", object_id="1")
        for statement in ("DELETE FROM public.audit_event", "UPDATE public.correction_revision SET reason = 'x'", "SELECT 1 FROM auth.users"):
            with self.subTest(statement=statement), self.assertRaises(DatabaseError), transaction.atomic(), connection.cursor() as cursor:
                cursor.execute(statement)


class TenantIsolationSweepTests(TestCase):
    """AUD-006: el backend no está sujeto a RLS, así que cada endpoint debe aislar por dueño.

    Recorre TODOS los recursos docentes del router con un segundo docente. Si se agrega
    un recurso nuevo al router sin incluirlo aquí, el test falla y obliga a cubrirlo.
    """

    TEACHER_PREFIXES = frozenset({
        "courses", "enrollments", "assessments", "students", "rubrics", "rubric-criteria",
        "rubric-levels", "questions", "submissions", "submission-answers", "corrections",
    })

    def setUp(self):
        self.owner, self.intruder = uuid4(), uuid4()
        ensure_auth_users(self.owner, self.intruder)
        o = self.owner
        course = Course.objects.create(owner_id=o, name="Curso privado")
        student = Student.objects.create(owner_id=o, name="Estudiante privado")
        enrollment = Enrollment.objects.create(owner_id=o, course=course, student=student)
        rubric = Rubric.objects.create(owner_id=o, title="Rúbrica privada")
        criterion = RubricCriterion.objects.create(owner_id=o, rubric=rubric, name="Criterio", position=1)
        level = RubricLevel.objects.create(owner_id=o, criterion=criterion, name="Nivel", score=Decimal(1), position=1)
        assessment = Assessment.objects.create(owner_id=o, title="Evaluación privada", course=course)
        question = Question.objects.create(owner_id=o, assessment=assessment, prompt="Consigna", position=1)
        submission = Submission.objects.create(owner_id=o, assessment=assessment, student=student, answer_text="Respuesta privada")
        answer = SubmissionAnswer.objects.create(owner_id=o, submission=submission, question=question, answer_text="Respuesta")
        correction = Correction.objects.create(owner_id=o, submission=submission, proposal={"criteria": []})
        self.objects = {
            "courses": course, "enrollments": enrollment, "assessments": assessment, "students": student,
            "rubrics": rubric, "rubric-criteria": criterion, "rubric-levels": level, "questions": question,
            "submissions": submission, "submission-answers": answer, "corrections": correction,
        }

    def test_sweep_covers_every_teacher_resource_in_the_router(self):
        from .urls import router
        registered = {prefix for prefix, _viewset, _basename in router.registry if not prefix.startswith("admin/")}
        self.assertEqual(registered, self.TEACHER_PREFIXES)

    def test_another_teacher_cannot_list_read_modify_or_delete_owner_rows(self):
        intruder = _client_for(self.intruder)
        for prefix, obj in self.objects.items():
            with self.subTest(prefix=prefix):
                listing = intruder.get(f"/api/{prefix}/?page_size=100")
                self.assertEqual(listing.status_code, 200)
                rows = listing.data["results"] if isinstance(listing.data, dict) else listing.data
                self.assertNotIn(obj.pk, [row.get("id") for row in rows])
                self.assertEqual(intruder.get(f"/api/{prefix}/{obj.pk}/").status_code, 404)
                self.assertIn(intruder.patch(f"/api/{prefix}/{obj.pk}/", {}, format="json").status_code, (404, 405))
                self.assertIn(intruder.delete(f"/api/{prefix}/{obj.pk}/").status_code, (404, 405))
                self.assertTrue(type(obj).objects.filter(pk=obj.pk).exists())

    def test_aggregate_endpoints_do_not_leak_owner_rows(self):
        intruder = _client_for(self.intruder)
        overview = intruder.get("/api/dashboard/overview/")
        self.assertEqual(overview.status_code, 200)
        self.assertEqual(overview.data["courses"], [])
        self.assertEqual(overview.data["assessments"], [])
        assessment = self.objects["assessments"]
        self.assertEqual(intruder.get(f"/api/correction-workspace/?assessment={assessment.pk}").status_code, 404)
        self.assertEqual(intruder.get("/api/audit-events/").data, [])
