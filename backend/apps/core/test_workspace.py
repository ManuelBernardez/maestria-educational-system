"""Regression tests for the compact, owner-scoped workspace APIs."""
from uuid import uuid4

from django.test import TestCase
from rest_framework.test import APIClient

from .authentication import SupabasePrincipal
from .models import Assessment, Course, Correction, Enrollment, Rubric, RubricCriterion, RubricLevel, Student, Submission




class DashboardOverviewApiTests(TestCase):
    def setUp(self):
        self.owner_id = uuid4()
        self.other_owner_id = uuid4()
        self.client = APIClient()
        self.client.force_authenticate(user=SupabasePrincipal(id=str(self.owner_id)))

    def test_dashboard_overview_requires_authentication(self):
        unauthenticated = APIClient()
        response = unauthenticated.get("/api/dashboard/overview/")
        self.assertEqual(response.status_code, 401)

    def test_dashboard_overview_is_compact_and_scoped_to_authenticated_owner(self):
        course = Course.objects.create(owner_id=self.owner_id, name="Materia propia")
        student = Student.objects.create(owner_id=self.owner_id, name="Estudiante propio")
        Enrollment.objects.create(owner_id=self.owner_id, course=course, student=student, status="active")
        assessment = Assessment.objects.create(
            owner_id=self.owner_id, course=course, title="Evaluación propia", status="ready",
        )
        submission = Submission.objects.create(
            owner_id=self.owner_id, assessment=assessment, student=student,
            student_name=student.name, answer_text="Respuesta sintética",
        )
        Correction.objects.create(
            owner_id=self.owner_id, submission=submission, status="pending_review",
            proposal={"summary": "Este texto no debe viajar en el panel"},
        )

        foreign_course = Course.objects.create(owner_id=self.other_owner_id, name="Materia ajena")
        foreign_assessment = Assessment.objects.create(
            owner_id=self.other_owner_id, course=foreign_course, title="Evaluación ajena",
        )
        foreign_submission = Submission.objects.create(
            owner_id=self.other_owner_id, assessment=foreign_assessment,
            student_name="Estudiante ajeno", answer_text="Respuesta privada ajena",
        )
        Correction.objects.create(
            owner_id=self.other_owner_id, submission=foreign_submission,
            proposal={"summary": "Privado"},
        )

        response = self.client.get("/api/dashboard/overview/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual([item["id"] for item in response.data["courses"]], [course.id])
        self.assertEqual(response.data["courses"][0]["student_count"], 1)
        self.assertEqual(response.data["courses"][0]["assessment_count"], 1)
        self.assertEqual([item["title"] for item in response.data["assessments"]], ["Evaluación propia"])
        self.assertEqual(response.data["summary"]["pending_corrections"], 1)
        self.assertEqual(response.data["summary"]["courses"], 1)
        self.assertEqual(response.data["summary"]["assessments"], 1)
        self.assertEqual(response.data["summary"]["students"], 1)
        self.assertEqual(response.data["summary"]["submissions"], 1)
        self.assertEqual(response.data["course_correction_counts"], [{
            "course_id": course.id, "status": "pending_review", "count": 1,
        }])
        self.assertNotIn("proposal", response.data)
        self.assertNotIn("answer_text", response.data)


class CorrectionWorkspaceApiTests(TestCase):
    def setUp(self):
        self.owner_id = uuid4()
        self.other_owner_id = uuid4()
        self.client = APIClient()
        self.client.force_authenticate(user=SupabasePrincipal(id=str(self.owner_id)))
        self.assessment = Assessment.objects.create(
            owner_id=self.owner_id,
            title="Evaluación propia",
            subject="Ciencias",
            level="Secundaria",
            instructions="Explicá el proceso.",
        )
        self.other_assessment = Assessment.objects.create(
            owner_id=self.other_owner_id,
            title="Evaluación ajena",
        )

    def test_workspace_only_returns_owner_data(self):
        response = self.client.get("/api/correction-workspace/")
        self.assertEqual(response.status_code, 200)
        titles = [item["title"] for item in response.data["assessments"]]
        self.assertEqual(titles, ["Evaluación propia"])
        self.assertEqual(response.data["selected_assessment"]["id"], self.assessment.id)
        self.assertNotIn("Evaluación ajena", titles)

    def test_workspace_summary_without_assessment_returns_selector_only(self):
        with self.assertNumQueries(2):
            response = self.client.get("/api/correction-workspace/?summary=1")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["selected_assessment"])
        self.assertEqual([item["id"] for item in response.data["assessments"]], [self.assessment.id])
        self.assertEqual(response.data["students"], [])
        self.assertEqual(response.data["rubrics"], [])
        self.assertEqual(response.data["questions"], [])
        self.assertEqual(response.data["submissions"], [])
        self.assertEqual(response.data["corrections"], [])

    def test_workspace_does_not_disclose_foreign_assessment(self):
        response = self.client.get(f"/api/correction-workspace/?assessment={self.other_assessment.id}")
        self.assertEqual(response.status_code, 404)

    def test_workspace_summary_bounds_answer_payload_and_omits_correction_json(self):
        Student.objects.create(owner_id=self.owner_id, name="Estudiante compacto", email="alumno@example.test")
        submission = Submission.objects.create(
            owner_id=self.owner_id, assessment=self.assessment,
            student_name="Estudiante sintético", answer_text="A" * 10_000,
        )
        Correction.objects.create(
            owner_id=self.owner_id, submission=submission, provider="mock",
            proposal={"summary": "B" * 8_000, "criteria": [{"criterion": "Criterio", "score": 1, "max_score": 2}]},
        )
        rubric = Rubric.objects.create(owner_id=self.owner_id, title="Rúbrica compacta")
        criterion = RubricCriterion.objects.create(owner_id=self.owner_id, rubric=rubric, name="Comprensión", max_score=10)
        RubricLevel.objects.create(owner_id=self.owner_id, criterion=criterion, name="Inicial", description="Descripción extensa que no se necesita en el selector", score=2)

        response = self.client.get(f"/api/correction-workspace/?assessment={self.assessment.id}&summary=1")

        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(response.data["submissions"][0]["answer_text"]), 301)
        self.assertNotIn("answers", response.data["submissions"][0])
        self.assertNotIn("enrollments", response.data["students"][0])
        self.assertNotIn("proposal", response.data["corrections"][0])
        self.assertNotIn("final_result", response.data["corrections"][0])
        compact_rubric = next(item for item in response.data["rubrics"] if item["id"] == rubric.id)
        self.assertNotIn("levels", compact_rubric["criteria"][0])
        self.assertEqual(set(compact_rubric["criteria"][0].keys()), {"id", "name", "max_score"})

    def test_course_navigation_endpoint_omits_expensive_counts(self):
        course = Course.objects.create(owner_id=self.owner_id, name="Curso de navegación", subject="Ciencias")

        response = self.client.get("/api/courses/?nav=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["id"], course.id)
        self.assertEqual(set(response.data[0].keys()), {"id", "name", "subject", "level", "academic_year", "active"})

    def test_course_filters_limit_assessments_and_correction_summaries(self):
        course_a = Course.objects.create(owner_id=self.owner_id, name="Curso A")
        course_b = Course.objects.create(owner_id=self.owner_id, name="Curso B")
        assessment_a = Assessment.objects.create(owner_id=self.owner_id, course=course_a, title="Evaluación A")
        assessment_b = Assessment.objects.create(owner_id=self.owner_id, course=course_b, title="Evaluación B")
        submission_a = Submission.objects.create(owner_id=self.owner_id, assessment=assessment_a, student_name="Estudiante A", answer_text="Respuesta A")
        submission_b = Submission.objects.create(owner_id=self.owner_id, assessment=assessment_b, student_name="Estudiante B", answer_text="Respuesta B")
        correction_a = Correction.objects.create(owner_id=self.owner_id, submission=submission_a, proposal={"criteria": []})
        Correction.objects.create(owner_id=self.owner_id, submission=submission_b, proposal={"criteria": []})

        assessments_response = self.client.get(f"/api/assessments/?course={course_a.id}")
        corrections_response = self.client.get(f"/api/corrections/?summary=1&course={course_a.id}")

        self.assertEqual(assessments_response.status_code, 200)
        self.assertEqual([item["id"] for item in assessments_response.data], [assessment_a.id])
        self.assertEqual(corrections_response.status_code, 200)
        self.assertEqual([item["id"] for item in corrections_response.data], [correction_a.id])

    def test_workspace_get_does_not_delete_synthetic_corrections(self):
        # GET is read-only. Cleaning demo data belongs to the explicit POST seed flow.
        from .models import Submission
        practice = Assessment.objects.create(
            owner_id=self.owner_id,
            title="Ejemplo MaestrIA · Práctica de ciencias",
            subject="Ciencias",
        )
        submission = Submission.objects.create(
            owner_id=self.owner_id, assessment=practice,
            student_name="Estudiante ficticio", answer_text="Respuesta de práctica",
            status="review",
        )
        correction = Correction.objects.create(
            owner_id=self.owner_id, submission=submission, provider="mock",
            proposal={"demo": True, "criteria": [{"criterion": "Comprensión", "score": 1, "max_score": 2}]},
        )

        response = self.client.get(f"/api/correction-workspace/?assessment={practice.id}")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(Correction.objects.filter(pk=correction.pk).exists())
        submission.refresh_from_db()
        self.assertEqual(submission.status, "review")

    def test_submission_list_returns_bounded_preview_not_full_answer(self):
        from .models import Submission
        submission = Submission.objects.create(
            owner_id=self.owner_id, assessment=self.assessment,
            student_name="Estudiante ficticio", answer_text="A" * 10_000,
        )

        response = self.client.get("/api/submissions/")

        self.assertEqual(response.status_code, 200)
        item = next(row for row in response.data if row["id"] == submission.pk)
        self.assertLessEqual(len(item["answer_text"]), 301)
        self.assertNotIn("answers", item)
        self.assertNotEqual(item["answer_text"], "A" * 10_000)

    def test_concurrent_correction_request_does_not_call_provider_twice(self):
        from unittest.mock import patch
        from .models import Submission

        submission = Submission.objects.create(
            owner_id=self.owner_id, assessment=self.assessment,
            student_name="Estudiante ficticio", answer_text="Respuesta de prueba",
            status="processing",
        )
        with patch("apps.core.views.generate_correction") as provider:
            response = self.client.post(
                f"/api/submissions/{submission.id}/generate-correction/", {}, format="json",
            )

        self.assertEqual(response.status_code, 400)
        self.assertIn("procesando", str(response.data).lower())
        provider.assert_not_called()
        submission.refresh_from_db()
        self.assertEqual(submission.status, "processing")

    def test_demo_correction_cannot_be_approved_even_if_client_calls_api_directly(self):
        submission = Submission.objects.create(
            owner_id=self.owner_id,
            assessment=self.assessment,
            student_name="Estudiante de prueba",
            answer_text="Respuesta sintética",
        )
        correction = Correction.objects.create(
            owner_id=self.owner_id,
            submission=submission,
            provider="mock",
            proposal={"demo": True, "criteria": [{"criterion": "Comprensión", "score": 1, "max_score": 2}]},
        )
        response = self.client.post(
            f"/api/corrections/{correction.id}/approve/",
            {"final_result": correction.proposal, "teacher_feedback": "Prueba"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        correction.refresh_from_db()
        self.assertEqual(correction.status, "pending_review")

    def test_correction_with_mismatched_owner_is_not_visible(self):
        submission = Submission.objects.create(
            owner_id=self.owner_id,
            assessment=self.assessment,
            student_name="Estudiante de prueba",
            answer_text="Respuesta sintética",
        )
        Correction.objects.create(
            owner_id=self.other_owner_id,
            submission=submission,
            proposal={"criteria": [{"criterion": "Comprensión", "score": 1, "max_score": 2}]},
        )
        response = self.client.get("/api/corrections/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])

    def test_empty_proposal_cannot_be_approved(self):
        submission = Submission.objects.create(
            owner_id=self.owner_id,
            assessment=self.assessment,
            student_name="Estudiante de prueba",
            answer_text="Respuesta sintética",
        )
        correction = Correction.objects.create(
            owner_id=self.owner_id,
            submission=submission,
            proposal={"criteria": []},
        )
        response = self.client.post(
            f"/api/corrections/{correction.id}/approve/",
            {"final_result": correction.proposal, "teacher_feedback": "Prueba"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        correction.refresh_from_db()
        self.assertEqual(correction.status, "pending_review")

    def test_assessment_editor_returns_compact_data_for_owner(self):
        response = self.client.get(f"/api/assessments/{self.assessment.id}/editor/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["assessment"]["id"], self.assessment.id)
        self.assertNotIn("reference_material", response.data["assessment"])
        self.assertIsInstance(response.data["questions"], list)

    def test_assessment_editor_hides_foreign_assessment(self):
        response = self.client.get(f"/api/assessments/{self.other_assessment.id}/editor/")
        self.assertEqual(response.status_code, 404)

    def test_question_cannot_be_moved_to_another_assessment(self):
        from .models import Question
        destination = Assessment.objects.create(
            owner_id=self.owner_id, title="Otra evaluación propia",
        )
        question = Question.objects.create(
            owner_id=self.owner_id, assessment=self.assessment,
            prompt="Pregunta original", max_score=10, position=1,
        )

        response = self.client.patch(
            f"/api/questions/{question.id}/",
            {"assessment": destination.id}, format="json",
        )

        self.assertEqual(response.status_code, 400)
        question.refresh_from_db()
        self.assertEqual(question.assessment_id, self.assessment.id)

    def test_submission_cannot_be_reassigned_to_another_assessment(self):
        destination = Assessment.objects.create(
            owner_id=self.owner_id, title="Otra evaluación propia",
        )
        submission = Submission.objects.create(
            owner_id=self.owner_id, assessment=self.assessment,
            student_name="Estudiante ficticio", answer_text="Respuesta original",
        )

        response = self.client.patch(
            f"/api/submissions/{submission.id}/",
            {"assessment": destination.id}, format="json",
        )

        self.assertEqual(response.status_code, 400)
        submission.refresh_from_db()
        self.assertEqual(submission.assessment_id, self.assessment.id)

    def test_correction_summary_does_not_return_proposal_or_student_details(self):
        submission = Submission.objects.create(
            owner_id=self.owner_id, assessment=self.assessment,
            student_name="Nombre sensible de prueba", answer_text="Respuesta privada",
        )
        Correction.objects.create(
            owner_id=self.owner_id, submission=submission, provider="mock",
            proposal={"demo": True, "criteria": [{"criterion": "Criterio", "score": 1}]},
        )

        response = self.client.get("/api/corrections/?summary=1")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertTrue({"id", "submission", "status", "provider", "total_score", "submission_title", "student_name"}.issubset(response.data[0].keys()))
        self.assertNotIn("proposal", response.data[0])
        self.assertNotIn("final_result", response.data[0])


class AtomicRubricCreationTests(TestCase):
    def setUp(self):
        self.owner_id = uuid4()
        self.client = APIClient()
        self.client.force_authenticate(user=SupabasePrincipal(id=str(self.owner_id)))

    def test_rubric_with_criteria_and_levels_is_created_in_one_request(self):
        response = self.client.post(
            "/api/rubrics/create-with-criteria/",
            {
                "title": "Rúbrica de prueba",
                "scale_type": "both",
                "criteria": [
                    {"name": "Comprensión", "description": "Explica conceptos", "max_score": 5},
                    {"name": "Argumentación", "description": "Justifica ideas", "max_score": 10},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        rubric = Rubric.objects.get(owner_id=self.owner_id, title="Rúbrica de prueba")
        self.assertEqual(rubric.criteria.count(), 2)
        self.assertEqual(RubricLevel.objects.filter(criterion__rubric=rubric).count(), 8)

    def test_invalid_level_rolls_back_the_entire_rubric(self):
        response = self.client.post(
            "/api/rubrics/create-with-criteria/",
            {
                "title": "Rúbrica que no debe quedar a medias",
                "scale_type": "both",
                "criteria": [
                    {"name": "Comprensión", "max_score": 5, "levels": [{"name": "Excede", "score": 6}]},
                    {"name": "Argumentación", "max_score": 10},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Rubric.objects.filter(owner_id=self.owner_id, title="Rúbrica que no debe quedar a medias").exists())
        self.assertEqual(RubricCriterion.objects.filter(owner_id=self.owner_id).count(), 0)


class StudentCourseAssignmentTests(TestCase):
    def setUp(self):
        self.owner_id = uuid4()
        self.other_owner_id = uuid4()
        self.course = Course.objects.create(
            owner_id=self.owner_id, name="Ciencias 2.º año", subject="Ciencias Naturales"
        )
        self.other_course = Course.objects.create(
            owner_id=self.other_owner_id, name="Curso ajeno"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=SupabasePrincipal(id=str(self.owner_id)))

    def test_student_creation_requires_course(self):
        response = self.client.post("/api/students/", {"name": "Estudiante sin curso"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("course", response.data)

    def test_student_creation_assigns_enrollment_atomically(self):
        from .models import Enrollment, Student
        response = self.client.post(
            "/api/students/",
            {"name": "Julia Pérez", "course": self.course.id},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        student = Student.objects.get(pk=response.data["id"])
        self.assertTrue(Enrollment.objects.filter(owner_id=self.owner_id, student=student, course=self.course, status="active").exists())
        self.assertEqual(response.data["enrollments"][0]["course_name"], self.course.name)

    def test_duplicate_student_external_code_is_rejected_without_partial_enrollment(self):
        from .models import Enrollment, Student
        first = self.client.post(
            "/api/students/",
            {"name": "Julia Pérez", "course": self.course.id, "external_code": "ALU-001"},
            format="json",
        )
        self.assertEqual(first.status_code, 201, first.data)
        second = self.client.post(
            "/api/students/",
            {"name": "Julia Pérez duplicada", "course": self.course.id, "external_code": "ALU-001"},
            format="json",
        )
        self.assertEqual(second.status_code, 400)
        self.assertEqual(Student.objects.filter(owner_id=self.owner_id, external_code="ALU-001").count(), 1)
        self.assertEqual(Enrollment.objects.filter(owner_id=self.owner_id, course=self.course).count(), 1)

    def test_student_cannot_be_assigned_to_another_teachers_course(self):
        response = self.client.post(
            "/api/students/",
            {"name": "No corresponde", "course": self.other_course.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["course"][0], "Elegí una materia o curso activo antes de agregar al estudiante.")


class DemoDatasetSeedTests(TestCase):
    def setUp(self):
        self.owner_id = uuid4()
        self.other_owner_id = uuid4()
        self.client = APIClient()
        self.client.force_authenticate(user=SupabasePrincipal(id=str(self.owner_id)))

    def test_seed_creates_course_students_assessment_rubric_and_submissions(self):
        from .models import Assessment, Course, Enrollment, Question, Rubric, Student, Submission
        response = self.client.post("/api/demo/seed/", {}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["submission_count"], 3)
        course = Course.objects.get(pk=response.data["course_id"], owner_id=self.owner_id)
        assessment = Assessment.objects.get(pk=response.data["assessment_id"], owner_id=self.owner_id)
        self.assertEqual(assessment.course_id, course.id)
        self.assertEqual(Question.objects.filter(owner_id=self.owner_id, assessment=assessment).count(), 1)
        self.assertEqual(Rubric.objects.filter(owner_id=self.owner_id, title__contains="Ejemplo MaestrIA").count(), 1)
        self.assertEqual(Student.objects.filter(owner_id=self.owner_id, external_code__startswith="DEMO-FOTO-").count(), 3)
        self.assertEqual(Enrollment.objects.filter(owner_id=self.owner_id, course=course, status="active").count(), 3)
        self.assertEqual(Submission.objects.filter(owner_id=self.owner_id, assessment=assessment, status="pending").count(), 3)

    def test_seed_is_idempotent_and_scoped_to_current_owner(self):
        from .models import Course, Submission
        first = self.client.post("/api/demo/seed/", {}, format="json")
        second = self.client.post("/api/demo/seed/", {}, format="json")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["assessment_id"], second.data["assessment_id"])
        self.assertEqual(Course.objects.filter(owner_id=self.owner_id, name="Ejemplo MaestrIA · Ciencias Naturales").count(), 1)
        self.assertEqual(Submission.objects.filter(owner_id=self.owner_id).count(), 3)
        other_client = APIClient()
        other_client.force_authenticate(user=SupabasePrincipal(id=str(self.other_owner_id)))
        other = other_client.post("/api/demo/seed/", {}, format="json")
        self.assertNotEqual(first.data["assessment_id"], other.data["assessment_id"])
        self.assertEqual(Course.objects.filter(owner_id=self.other_owner_id, name="Ejemplo MaestrIA · Ciencias Naturales").count(), 1)
