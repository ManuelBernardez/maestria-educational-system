#!/usr/bin/env python3
"""Reproduce POST /api/submissions/<id>/generate-correction/ y muestra status/detalle."""
import os
import sys
import traceback
from pathlib import Path

import django

BASE = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BASE))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
os.chdir(BASE)
django.setup()

from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.authentication import SupabasePrincipal
from apps.core.models import PROCESSING_LEASE_MINUTES, Submission

owner = "c15fbd27-c011-47fe-abce-4ab0b30e0cd8"

# Reclama leases vencidos para que el endpoint no responda "ya se está procesando".
cutoff = timezone.now() - timedelta(minutes=PROCESSING_LEASE_MINUTES)
stuck = Submission.objects.filter(status="processing", updated_at__lt=cutoff)
print("leases vencidos reclamados:", list(stuck.values_list("id", flat=True)))
stuck.update(status="pending", updated_at=timezone.now())

for sid in (int(x) for x in sys.argv[1:] or ["6"]):
    # Reclama también leases frescos del mismo id: sabemos que son intentos
    # muertos del entorno de desarrollo, no workers reales.
    Submission.objects.filter(pk=sid, status="processing").update(
        status="pending", updated_at=timezone.now(),
    )
    sub = Submission.objects.filter(pk=sid).first()
    print(f"\n=== POST generate-correction submission {sid} (status={sub.status if sub else None}) ===")
    client = APIClient()
    client.force_authenticate(user=SupabasePrincipal(id=owner))
    try:
        response = client.post(f"/api/submissions/{sid}/generate-correction/", {}, format="json", HTTP_HOST="localhost")
        print("status:", response.status_code)
        try:
            print("body:", response.data)
        except Exception:
            print("raw:", response.content[:2000])
    except Exception:
        traceback.print_exc()
    sub.refresh_from_db()
    print("status tras la llamada:", sub.status, "| updated_at:", sub.updated_at)
