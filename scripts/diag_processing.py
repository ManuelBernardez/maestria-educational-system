#!/usr/bin/env python3
"""Diagnóstico puntual: entregas en «processing» y su antigüedad."""
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

from apps.core.models import Submission

now = timezone.now()
rows = list(
    Submission.objects.filter(status="processing").order_by("-updated_at")
    .values("id", "assessment_id", "assessment__title", "updated_at", "owner_id")[:10]
)
if not rows:
    print("Sin entregas en estado processing.")
for r in rows:
    age = now - r["updated_at"]
    total_seconds = int(age.total_seconds())
    label = f"{total_seconds // 3600}h {total_seconds % 3600 // 60}m {total_seconds % 60}s"
    fresh = "VIGENTE" if total_seconds < 15 * 60 else "EXPIRADO"
    print(f"processing id={r['id']} assessment={r['assessment_id']} ({r['assessment__title']}) edad={label} lease={fresh} owner={r['owner_id']}")
