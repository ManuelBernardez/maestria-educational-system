#!/usr/bin/env python3
"""Fuerza el drop de la base de tests colgada (sesiones residuales de pytest)."""
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
    cur.execute("SELECT current_database()")
    print("conectado a:", cur.fetchone()[0])
    # Termina sesiones residuales y elimina la base de tests colgada.
    cur.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'test_postgres' AND pid <> pg_backend_pid()")
    print("sesiones terminadas:", len(cur.fetchall()))
    cur.execute("SELECT 1 FROM pg_database WHERE datname = 'test_postgres'")
    if cur.fetchone():
        cur.execute("DROP DATABASE test_postgres WITH (FORCE)")
        print("test_postgres eliminada.")
    else:
        print("test_postgres no existe.")
