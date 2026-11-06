#!/usr/bin/env python3
"""Reclama leases «processing» expirados con la misma regla del backend (MVP)."""
import os
import sys
from datetime import timedelta
from pathlib import Path

import django

BASE = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BASE))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
os.chdir(BASE)
django.setup()

from django.utils import timezone

from apps.core.models import PROCESSING_LEASE_MINUTES, Submission

cutoff = timezone.now() - timedelta(minutes=PROCESSING_LEASE_MINUTES)
stuck = list(Submission.objects.filter(status="processing", updated_at__lt=cutoff))
if not stuck:
    print("Sin leases expirados.")
else:
    reclaimed = Submission.objects.filter(
        id__in=[item.id for item in stuck], status="processing", updated_at__lt=cutoff,
    ).update(status="pending", updated_at=timezone.now())
    print(f"Reclamadas {reclaimed} entregas:", [(item.id, item.assessment_id) for item in stuck])
