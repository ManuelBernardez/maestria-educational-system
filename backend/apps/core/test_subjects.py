"""Fase 1: materias con varias comisiones y evaluaciones asignadas a más de una comisión."""
from pathlib import Path
from uuid import uuid4

from django.db import connection
from django.test import TestCase
from rest_framework.test import APIClient

from .authentication import SupabasePrincipal
from .models import (
    Assessment, AssessmentCourse, Correction, Course, Enrollment, Question, Student, Subject, Submission,
)
from .test_support import ensure_auth_users

MIGRATION = Path(__file__).resolve().parents[2] / "database" / "migrations" / "20261120214005_maestria_subjects_and_sections.sql"


class SubjectsAndSectionsTests(TestCase):
    def setUp(self):
        self.owner_id = uuid4()
        ensure_auth_users(self.owner_id)
        self.client = APIClient()
        self.client.force_authenticate(user=SupabasePrincipal(id=str(self.owner_id)))

    def _subject_with_sections(self):
        subject = self.client.post("/api/subjects/", {"name": "Programación I", "level": "Universitario"}, format="json")
        self.assertEqual(subject.status_code, 201, subject.data)
        sections = []
        for name, shift in (("1K1", "manana"), ("1K2", "tarde"), ("1K3", "noche")):
            response = self.client.post("/api/courses/", {"name": name, "subject_id": subject.data["id"], "shift": shift, "academic_year": "2026"}, format="json")
            self.assertEqual(response.status_code, 201, response.data)
            sections.append(response.data)
        return subject.data, sections

    def test_one_subject_groups_several_sections(self):
        subject, sections = self._subject_with_sections()
        self.assertEqual({item["subject"] for item in sections}, {"Programación I"})
        self.assertEqual(sections[2]["shift_label"], "Noche")
        nav = self.client.get("/api/subjects/?nav=1")
        self.assertEqual(nav.status_code, 200)
        row = nav.data["results"][0]
        self.assertEqual(row["course_count"], 3)
        self.assertEqual([item["name"] for item in row["courses"]], ["1K1", "1K2", "1K3"])
        # Texto heredado para la versión anterior desplegada.
        self.assertEqual(Course.objects.get(pk=sections[0]["id"]).subject, "Programación I")

    def test_same_section_name_is_allowed_in_another_subject(self):
        self._subject_with_sections()
        other = self.client.post("/api/courses/", {"name": "1K1", "subject": "Matemática Discreta", "academic_year": "2026"}, format="json")
        self.assertEqual(other.status_code, 201, other.data)
        self.assertEqual(other.data["subject"], "Matemática Discreta")
        self.assertEqual(Subject.objects.filter(owner_id=self.owner_id).count(), 2)

    def test_typed_subject_name_reuses_the_existing_subject(self):
        subject, _ = self._subject_with_sections()
        response = self.client.post("/api/courses/", {"name": "1K4", "subject": "programación i"}, format="json")
        self.assertEqual(response.data["subject_id"], subject["id"])

    def test_assessment_is_assigned_to_several_sections_of_its_subject(self):
        subject, sections = self._subject_with_sections()
        response = self.client.post("/api/assessments/", {"title": "Parcial 1", "subject_id": subject["id"], "course_ids": [sections[0]["id"], sections[1]["id"]]}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["course_ids"], [sections[0]["id"], sections[1]["id"]])
        assessment = Assessment.objects.get(pk=response.data["id"])
        self.assertEqual(assessment.course_id, sections[0]["id"], "comisión principal heredada")
        self.assertEqual(assessment.subject, "Programación I")
        listed = self.client.get(f"/api/assessments/?course={sections[1]['id']}")
        self.assertEqual([item["id"] for item in listed.data["results"]], [assessment.pk])
        self.assertEqual(self.client.get(f"/api/assessments/?course={sections[2]['id']}").data["results"], [])
        # Reasignar: se quitan las que ya no van.
        self.client.patch(f"/api/assessments/{assessment.pk}/", {"course_ids": [sections[2]["id"]]}, format="json")
        self.assertEqual(list(AssessmentCourse.objects.filter(assessment=assessment).values_list("course_id", flat=True)), [sections[2]["id"]])

    def test_sections_from_another_subject_are_rejected(self):
        subject, sections = self._subject_with_sections()
        other = self.client.post("/api/courses/", {"name": "A", "subject": "Otra materia"}, format="json").data
        response = self.client.post("/api/assessments/", {"title": "Parcial", "subject_id": subject["id"], "course_ids": [sections[0]["id"], other["id"]]}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("course_ids", response.data)

    def test_legacy_single_course_payload_still_works(self):
        _, sections = self._subject_with_sections()
        response = self.client.post("/api/assessments/", {"title": "TP", "course": sections[0]["id"]}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["course_ids"], [sections[0]["id"]])
        self.assertEqual(response.data["subject"], "Programación I")

    def test_submission_course_follows_the_student_enrollment(self):
        subject, sections = self._subject_with_sections()
        assessment = self.client.post("/api/assessments/", {"title": "Parcial", "subject_id": subject["id"], "course_ids": [sections[0]["id"], sections[1]["id"]]}, format="json").data
        ana = Student.objects.create(owner_id=self.owner_id, name="Ana")
        Enrollment.objects.create(owner_id=self.owner_id, course_id=sections[1]["id"], student=ana)
        response = self.client.post("/api/submissions/", {"assessment": assessment["id"], "student": ana.pk, "answer_text": "Respuesta"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["course"], sections[1]["id"])
        outsider = Student.objects.create(owner_id=self.owner_id, name="Sin comisión")
        rejected = self.client.post("/api/submissions/", {"assessment": assessment["id"], "student": outsider.pk, "answer_text": "Respuesta"}, format="json")
        self.assertEqual(rejected.status_code, 400)
        anonymous = self.client.post("/api/submissions/", {"assessment": assessment["id"], "student_name": "Sin registrar", "answer_text": "R"}, format="json")
        self.assertEqual(anonymous.status_code, 400, "con varias comisiones hay que elegir una")
        chosen = self.client.post("/api/submissions/", {"assessment": assessment["id"], "course": sections[0]["id"], "student_name": "Sin registrar", "answer_text": "R"}, format="json")
        self.assertEqual(chosen.status_code, 201, chosen.data)

    def test_grades_export_is_per_section(self):
        subject, sections = self._subject_with_sections()
        assessment = Assessment.objects.get(pk=self.client.post("/api/assessments/", {"title": "Parcial", "subject_id": subject["id"], "course_ids": [sections[0]["id"], sections[1]["id"]]}, format="json").data["id"])
        Question.objects.create(owner_id=self.owner_id, assessment=assessment, prompt="P", max_score=10, position=1)
        for name, section in (("Ana", sections[0]), ("Beto", sections[1])):
            student = Student.objects.create(owner_id=self.owner_id, name=name)
            Enrollment.objects.create(owner_id=self.owner_id, course_id=section["id"], student=student)
            submission = Submission.objects.create(owner_id=self.owner_id, assessment=assessment, student=student, course_id=section["id"], answer_text="R", status="approved")
            Correction.objects.create(owner_id=self.owner_id, submission=submission, status="approved", total_score=8, proposal={"criteria": []}, approved_at="2026-11-20T10:00:00Z")
        lines = self.client.get(f"/api/courses/{sections[1]['id']}/grades-export/").content.decode("utf-8").lstrip("﻿").strip().split("\r\n")
        self.assertEqual(lines[0], "Estudiante;Legajo;Correo;Parcial;Promedio (sobre 10)")
        self.assertEqual(lines[1:], ["Beto;;;8;8"])

    def test_archiving_a_subject_archives_its_sections(self):
        subject, sections = self._subject_with_sections()
        self.assertEqual(self.client.delete(f"/api/subjects/{subject['id']}/").status_code, 204)
        self.assertFalse(Course.objects.filter(pk__in=[item["id"] for item in sections], active=True).exists())


class SubjectsMigrationBackfillTests(TestCase):
    """La migración agrupa los cursos existentes en materias sin perder relaciones."""

    def _run_migration_again(self):
        import sqlparse
        with connection.cursor() as cursor:
            for statement in sqlparse.split(MIGRATION.read_text(encoding="utf-8")):
                if statement.strip().rstrip(";").upper() in {"BEGIN", "COMMIT"}:
                    continue
                cursor.execute(statement)

    def test_backfill_creates_subjects_and_links_and_is_idempotent(self):
        owner = uuid4()
        ensure_auth_users(owner)
        # Datos con la forma anterior: materia como texto y sin vínculos.
        historia_a = Course.objects.create(owner_id=owner, name="Historia · 5° A", subject="Historia")
        historia_b = Course.objects.create(owner_id=owner, name="Historia · 5° B", subject="historia")
        suelto = Course.objects.create(owner_id=owner, name="Taller de lectura")
        assessment = Assessment.objects.create(owner_id=owner, title="Revolución de Mayo", course=historia_b, subject="Historia")
        student = Student.objects.create(owner_id=owner, name="Ana")
        submission = Submission.objects.create(owner_id=owner, assessment=assessment, student=student, answer_text="R")

        self._run_migration_again()
        self._run_migration_again()

        subjects = {item.name: item for item in Subject.objects.filter(owner_id=owner)}
        self.assertEqual(set(subjects), {"Historia", "Taller de lectura"})
        for course in (historia_a, historia_b):
            course.refresh_from_db()
            self.assertEqual(course.subject_ref_id, subjects["Historia"].pk)
        suelto.refresh_from_db()
        self.assertEqual(suelto.subject_ref_id, subjects["Taller de lectura"].pk)
        assessment.refresh_from_db()
        self.assertEqual(assessment.subject_ref_id, subjects["Historia"].pk)
        self.assertEqual(list(AssessmentCourse.objects.filter(assessment=assessment).values_list("course_id", flat=True)), [historia_b.pk])
        submission.refresh_from_db()
        self.assertEqual(submission.course_id, historia_b.pk)
