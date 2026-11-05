"""PostgreSQL integration tests for composite integrity and administrative APIs."""
from uuid import uuid4

from django.db import IntegrityError, connection, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from .authentication import SupabasePrincipal
from .models import (
    AIProviderConfig, Assessment, AuditEvent, ContactMessage, Course,
    Institution, InstitutionMembership, UserProfile,
)
from .test_support import ensure_auth_users


class PublicSchemaMappingTests(TestCase):
    def test_models_map_to_external_tables_and_do_not_manage_schema(self):
        from . import models
        table_map = {
            "Course": "course", "Student": "student", "Rubric": "rubric",
            "RubricCriterion": "rubric_criterion", "RubricLevel": "rubric_level",
            "Assessment": "assessment", "Question": "question", "Enrollment": "enrollment",
            "Submission": "submission", "SubmissionAnswer": "submission_answer",
            "Correction": "correction", "CorrectionCriterionResult": "correction_criterion_result",
            "CorrectionRevision": "correction_revision", "AIGeneration": "ai_generation",
            "AuditEvent": "audit_event", "ContactMessage": "contact_message",
            "UserProfile": "user_profile", "Institution": "institution",
            "InstitutionMembership": "institution_membership", "AIProviderConfig": "ai_provider_config",
        }
        for model_name, table_name in table_map.items():
            model = getattr(models, model_name)
            self.assertFalse(model._meta.managed, model_name)
            self.assertEqual(model._meta.db_table, table_name)
        for model_name in ("RubricCriterion", "RubricLevel", "Assessment", "Question", "Enrollment", "Submission", "SubmissionAnswer", "Correction", "CorrectionCriterionResult", "CorrectionRevision", "AIGeneration"):
            model = getattr(models, model_name)
            for field in model._meta.fields:
                if field.is_relation and field.many_to_one:
                    self.assertFalse(field.db_constraint, f"{model_name}.{field.name} would create a simple FK")

    def test_reference_schema_contains_composite_fk_not_separate_simple_fk(self):
        self.assertEqual(connection.vendor, "postgresql")
        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT pg_get_constraintdef(oid, true)
                FROM pg_constraint WHERE conname='fk_assessment_course_owner'
            """)
            definition = cursor.fetchone()[0]
        self.assertIn("FOREIGN KEY (course_id, owner_id)", definition)
        self.assertIn("REFERENCES course(id, owner_id)", definition)


class PublicContactMessageTests(TestCase):
    def setUp(self):
        self.teacher_id = uuid4()
        ensure_auth_users(self.teacher_id)
        self.payload = {
            "name": "Docente de prueba", "email": "DOCENTE@example.test",
            "subject": "Consulta de demostración", "message": "Necesito información sobre la plataforma MaestrIA.",
        }

    def test_anonymous_contact_persists_public_message_without_internal_fields(self):
        response = APIClient().post("/api/contact/", self.payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        message = ContactMessage.objects.get(email="docente@example.test")
        self.assertIsNone(message.user_id)
        self.assertEqual(message.status, "new")
        self.assertEqual(message.source, "public_web")
        self.assertEqual(message.category, "general")
        self.assertEqual(message.internal_notes, "")
        self.assertNotIn("internal_notes", response.data)

    def test_authenticated_contact_uses_supabase_identity_and_never_client_user_id(self):
        client = APIClient()
        client.force_authenticate(user=SupabasePrincipal(id=str(self.teacher_id)))
        response = client.post("/api/contact/", self.payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        message = ContactMessage.objects.get(email="docente@example.test")
        self.assertEqual(str(message.user_id), str(self.teacher_id))

    def test_public_form_rejects_privileged_workflow_fields(self):
        payload = {**self.payload, "status": "handled", "assigned_to": str(self.teacher_id), "internal_notes": "nota"}
        response = APIClient().post("/api/contact/", payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(ContactMessage.objects.exists())

    def test_message_longer_than_postgres_check_is_rejected_by_serializer(self):
        response = APIClient().post("/api/contact/", {**self.payload, "message": "x" * 4001}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_public_contact_rejects_non_object_json(self):
        response = APIClient().post("/api/contact/", ["invalid", "shape"], format="json")
        self.assertEqual(response.status_code, 400)


class GlobalAdminContactTests(TestCase):
    def setUp(self):
        self.admin_id, self.teacher_id = uuid4(), uuid4()
        ensure_auth_users(self.admin_id, self.teacher_id)
        UserProfile.objects.create(user_id=self.admin_id, role="admin", status="active", email="admin@example.test")
        UserProfile.objects.create(user_id=self.teacher_id, role="teacher", status="active", email="teacher@example.test")
        self.client = APIClient()
        self.client.force_authenticate(user=SupabasePrincipal(id=str(self.admin_id)))
        self.message = ContactMessage.objects.create(
            name="Remitente", email="sender@example.test", subject="Consulta",
            message="Mensaje sintético para pruebas.",
        )

    def test_admin_lists_filters_and_updates_contact_message_with_audit(self):
        response = self.client.get("/api/admin/contact-messages/?status=new&q=sender")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        update = self.client.patch(
            f"/api/admin/contact-messages/{self.message.pk}/",
            {"status": "handled", "internal_notes": "Seguimiento interno", "assigned_to": str(self.admin_id)},
            format="json",
        )
        self.assertEqual(update.status_code, 200, update.data)
        self.assertEqual(update.data["internal_notes"], "Seguimiento interno")
        self.assertEqual(update.data["status"], "handled")
        self.message.refresh_from_db()
        self.assertIsNotNone(self.message.assigned_at)
        self.assertIsNotNone(self.message.handled_at)
        event = AuditEvent.objects.get(event_type="contact_message.updated", object_id=str(self.message.pk))
        self.assertEqual(str(event.actor_user_id), str(self.admin_id))
        self.assertEqual(event.request_id is not None, True)

    def test_assignment_rejects_non_admin_and_public_endpoint_never_exposes_notes(self):
        bad = self.client.patch(
            f"/api/admin/contact-messages/{self.message.pk}/",
            {"assigned_to": str(self.teacher_id)}, format="json",
        )
        self.assertEqual(bad.status_code, 400)
        public = APIClient().post("/api/contact/", {
            "name": "Otra persona", "email": "other@example.test", "subject": "Asunto",
            "message": "Un mensaje suficientemente largo.",
        }, format="json")
        self.assertEqual(public.status_code, 201)
        self.assertNotIn("internal_notes", public.data)

    def test_teacher_cannot_access_global_admin_endpoints(self):
        teacher = APIClient()
        teacher.force_authenticate(user=SupabasePrincipal(id=str(self.teacher_id)))
        response = teacher.get("/api/admin/contact-messages/")
        self.assertEqual(response.status_code, 403)
        users = teacher.get("/api/admin/users/")
        self.assertEqual(users.status_code, 403)

    def test_admin_can_assign_only_existing_auth_identity_with_admin_role(self):
        unknown_user = uuid4()
        ensure_auth_users(unknown_user)
        response = self.client.patch(
            f"/api/admin/contact-messages/{self.message.pk}/",
            {"assigned_to": str(unknown_user)}, format="json",
        )
        self.assertEqual(response.status_code, 400)


class GlobalRoleAndInstitutionTests(TestCase):
    def setUp(self):
        self.admin_id, self.superadmin_id, self.teacher_id, self.dept_id = (uuid4() for _ in range(4))
        ensure_auth_users(self.admin_id, self.superadmin_id, self.teacher_id, self.dept_id)
        UserProfile.objects.create(user_id=self.admin_id, role="admin", status="active")
        UserProfile.objects.create(user_id=self.superadmin_id, role="superadmin", status="active")
        UserProfile.objects.create(user_id=self.teacher_id, role="teacher", status="active")
        UserProfile.objects.create(user_id=self.dept_id, role="teacher", status="active")
        self.admin = APIClient()
        self.admin.force_authenticate(user=SupabasePrincipal(id=str(self.admin_id)))
        self.superadmin = APIClient()
        self.superadmin.force_authenticate(user=SupabasePrincipal(id=str(self.superadmin_id)))

    def test_regular_admin_can_create_teacher_profile_but_not_global_admin(self):
        new_teacher, new_admin = uuid4(), uuid4()
        ensure_auth_users(new_teacher, new_admin)
        allowed = self.admin.post("/api/admin/users/", {
            "user_id": str(new_teacher), "role": "teacher", "email": "new-teacher@example.test",
        }, format="json")
        self.assertEqual(allowed.status_code, 201, allowed.data)
        denied = self.admin.post("/api/admin/users/", {
            "user_id": str(new_admin), "role": "superadmin", "email": "new-admin@example.test",
        }, format="json")
        self.assertEqual(denied.status_code, 400)

    def test_superadmin_is_protected_from_being_last_active_superadmin(self):
        response = self.superadmin.patch(
            f"/api/admin/users/{UserProfile.objects.get(user_id=self.superadmin_id).pk}/",
            {"status": "suspended"}, format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(UserProfile.objects.get(user_id=self.superadmin_id).status, "active")
        # PostgreSQL trigger is the final guard even if an application caller bypasses DRF.
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                UserProfile.objects.filter(user_id=self.superadmin_id).update(status="suspended")
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                UserProfile.objects.filter(user_id=self.superadmin_id).delete()
        self.assertEqual(UserProfile.objects.get(user_id=self.superadmin_id).status, "active")

    def test_institution_and_memberships_are_scoped_for_department_admin(self):
        institution = Institution.objects.create(name="Instituto", slug="instituto")
        membership = InstitutionMembership.objects.create(
            institution=institution, user_id=self.dept_id, role="department_admin", status="active",
        )
        dept_client = APIClient()
        dept_client.force_authenticate(user=SupabasePrincipal(id=str(self.dept_id)))
        institutions = dept_client.get("/api/admin/institutions/")
        self.assertEqual(institutions.status_code, 200)
        self.assertEqual([row["id"] for row in institutions.data], [institution.pk])
        memberships = dept_client.get("/api/admin/institution-memberships/")
        self.assertEqual(memberships.status_code, 200)
        self.assertEqual([row["id"] for row in memberships.data], [membership.pk])
        self.assertEqual(dept_client.post("/api/admin/ai-providers/", {"provider": "mock"}, format="json").status_code, 403)

    def test_regular_teacher_sees_only_own_institution_membership(self):
        other_id = uuid4()
        ensure_auth_users(other_id)
        institution = Institution.objects.create(name="Instituto compartido", slug="instituto-compartido")
        own = InstitutionMembership.objects.create(
            institution=institution, user_id=self.teacher_id, role="teacher", status="active",
        )
        InstitutionMembership.objects.create(
            institution=institution, user_id=other_id, role="teacher", status="active",
        )
        teacher = APIClient()
        teacher.force_authenticate(user=SupabasePrincipal(id=str(self.teacher_id)))
        response = teacher.get("/api/admin/institution-memberships/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.data], [own.pk])

    def test_institution_admin_cannot_assign_global_or_self_memberships(self):
        institution_admin_id, target_id = uuid4(), uuid4()
        ensure_auth_users(institution_admin_id, target_id)
        institution = Institution.objects.create(name="Institución administrada", slug="institucion-administrada")
        manager_membership = InstitutionMembership.objects.create(
            institution=institution, user_id=institution_admin_id, role="institution_admin", status="active",
        )
        client = APIClient()
        client.force_authenticate(user=SupabasePrincipal(id=str(institution_admin_id)))
        forbidden_role = client.post("/api/admin/institution-memberships/", {
            "institution": institution.pk, "user_id": str(target_id), "role": "institution_admin",
        }, format="json")
        self.assertEqual(forbidden_role.status_code, 403)
        self_membership = client.patch(
            f"/api/admin/institution-memberships/{manager_membership.pk}/", {"status": "suspended"}, format="json",
        )
        self.assertEqual(self_membership.status_code, 403)
        put = client.put(
            f"/api/admin/institution-memberships/{manager_membership.pk}/",
            {"institution": institution.pk, "user_id": str(institution_admin_id), "role": "teacher", "status": "active"},
            format="json",
        )
        self.assertEqual(put.status_code, 405)

    def test_ai_provider_settings_are_admin_only_and_do_not_store_secrets(self):
        forbidden = APIClient()
        forbidden.force_authenticate(user=SupabasePrincipal(id=str(self.teacher_id)))
        self.assertEqual(forbidden.get("/api/admin/ai-providers/").status_code, 403)
        response = self.admin.post("/api/admin/ai-providers/", {
            "provider": "mock", "enabled": True, "timeout_seconds": 18, "model_name": "",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertNotIn("api_key", response.data)
        self.assertTrue(AIProviderConfig.objects.filter(provider="mock", enabled=True).exists())


class CompositeOwnershipConstraintTests(TestCase):
    def test_assessment_cannot_reference_another_owners_course(self):
        owner_a, owner_b = uuid4(), uuid4()
        ensure_auth_users(owner_a, owner_b)
        course = Course.objects.create(owner_id=owner_a, name="Curso A")
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Assessment.objects.create(owner_id=owner_b, course_id=course.pk, title="Cross tenant")
