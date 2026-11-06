#!/usr/bin/env python3
"""Inspecciona la función del trigger y tablas tocadas por maestria_touch_updated_at."""
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

with connection.cursor() as cur:
    cur.execute("SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'maestria_touch_updated_at'")
    row = cur.fetchone()
    print("=== función trigger ===")
    print(row[0] if row else "(no existe)")

    cur.execute(
        """
        SELECT event_object_table, trigger_name, action_timing, event_manipulation
        FROM information_schema.triggers
        WHERE trigger_name LIKE '%touch_updated_at%'
        ORDER BY event_object_table
        """
    )
    print("\n=== triggers de updated_at ===")
    for r in cur.fetchall():
        print(" ", r)
