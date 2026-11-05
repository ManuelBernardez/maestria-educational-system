"""Helpers for PostgreSQL integration tests only."""
from django.db import connection


def ensure_auth_users(*user_ids):
    if connection.vendor != "postgresql":
        raise RuntimeError("These integration tests require PostgreSQL and auth.users.")
    with connection.cursor() as cursor:
        cursor.executemany(
            "INSERT INTO auth.users (id) VALUES (%s) ON CONFLICT (id) DO NOTHING",
            [(str(user_id),) for user_id in user_ids if user_id],
        )
        # En Supabase un trigger crea el perfil docente de cada usuario de Auth.
        # El esquema de pruebas no tiene ese trigger, así que se replica aquí.
        cursor.executemany(
            "INSERT INTO public.user_profile (user_id, email, role, status) "
            "VALUES (%s, %s, 'teacher', 'active') ON CONFLICT (user_id) DO NOTHING",
            [(str(user_id), f"{user_id}@test.local") for user_id in user_ids if user_id],
        )
