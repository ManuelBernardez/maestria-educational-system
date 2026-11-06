#!/usr/bin/env python3
"""Diagnóstico: entregas 6 y 7 (Ecosistemas), correcciones e intentos de IA."""
import os
import sys
from pathlib import Path

import django

BASE = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BASE))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
os.chdir(BASE)
django.setup()

from django.utils import timezone

from apps.core.models import AIGeneration, Correction, Submission, SubmissionAnswer


def p(*args):
    try:
        print(*args)
    except UnicodeEncodeError:
        print(str(args).encode("ascii", "replace").decode("ascii"))


p("now:", timezone.now())

for sid in (6, 7):
    sub = Submission.objects.filter(pk=sid).first()
    if not sub:
        p(f"\nsubmission {sid}: NO EXISTE")
        continue
    p(f"\n=== submission {sid} ===")
    p({"status": sub.status, "updated_at": str(sub.updated_at), "created": str(sub.created_at),
       "assessment": sub.assessment_id, "question": sub.question_id,
       "answer_len": len(sub.answer_text or ""), "student": sub.student_name,
       "answers": list(SubmissionAnswer.objects.filter(submission=sub).values_list("id", "question_id"))})
    p("correcciones:", list(
        Correction.objects.filter(submission=sub).values("id", "status", "provider", "created_at")
    ))
    p("ultimas IAGeneration:", list(
        AIGeneration.objects.filter(submission=sub).order_by("-created_at")
        .values("id", "task", "status", "error_code", "created_at")[:5]
    ))

p("\n=== preguntas de la evaluación 1 ===")
from apps.core.models import Assessment, Question
assessment = Assessment.objects.filter(pk=1).first()
p({"assessment": str(assessment), "status": assessment.status if assessment else None})
for q in Question.objects.filter(assessment_id=1).values("id", "position", "max_score", "prompt"):
    p(q)
