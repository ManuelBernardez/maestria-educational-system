#!/usr/bin/env python3
"""¿Por qué falla updated_at == reservation_timestamp? Detecta triggers y prueba un save."""
import os
import sys
from pathlib import Path

import django

BASE = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BASE))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
os.chdir(BASE)
django.setup()

from django.db import connection
from django.utils import timezone

from apps.core.models import Submission

table = Submission._meta.db_table
print("db_table:", table)

with connection.cursor() as cur:
    cur.execute(
        """
        SELECT event_object_schema, event_object_table, trigger_name,
               action_timing, event_manipulation, action_statement
        FROM information_schema.triggers
        WHERE event_object_table = %s
        ORDER BY trigger_name
        """,
        [table],
    )
    rows = cur.fetchall()
    print("\ntriggers:")
    for r in rows:
        print(" ", r)
    if not rows:
        print("  (ninguno)")

sub = Submission.objects.filter(status="pending").order_by("-id").first()
if sub is None:
    print("\nNo hay submission pendiente para probar.")
    sys.exit()

print("\nprueba de save(): submission", sub.id, "status", sub.status)
inst = Submission.objects.get(pk=sub.id)
before = inst.updated_at
inst.status = inst.status  # no-op change con update_fields
inst.save(update_fields=["status", "updated_at"])
print("instance.updated_at tras save:", inst.updated_at)
fresh = Submission.objects.get(pk=sub.id)
print("DB updated_at tras save:      ", fresh.updated_at)
print("¿iguales?:", inst.updated_at == fresh.updated_at)
print("delta:", (fresh.updated_at - inst.updated_at) if fresh.updated_at >= inst.updated_at else inst.updated_at - fresh.updated_at)
