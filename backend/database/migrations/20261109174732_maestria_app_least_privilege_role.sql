-- Migration 20261109174732 / maestria_app_least_privilege_role
-- Auditoría técnica 2026-11-09, AUD-006.
--
-- Situación verificada: Django se conecta como `postgres` (DATABASE_URL de Render,
-- usuario postgres.<ref>). Ese rol tiene BYPASSRLS, puede ejecutar DDL, leer y
-- modificar auth.* (hashes de contraseñas, tokens de refresco) y administrar roles.
-- Un error de la aplicación o una inyección SQL tendrían ese alcance.
--
-- Este script crea `maestria_app`, un rol de mínimo privilegio para el backend:
--   * sin BYPASSRLS, sin DDL, sin CREATEROLE, sin acceso al esquema auth;
--   * sólo los comandos DML que usa el código, tabla por tabla;
--   * audit_event, correction_revision y ai_generation quedan de sólo inserción
--     (la traza y las revisiones de calificaciones no se pueden editar ni borrar);
--   * la verificación de identidades de Auth pasa por una función SECURITY DEFINER
--     que sólo responde verdadero/falso.
--
-- RLS: el backend atiende docentes y administradores con una única conexión, así que
-- las políticas para maestria_app permiten todas las filas y el aislamiento entre
-- docentes lo aplica la API (cubierto por TenantIsolationSweepTests). Las políticas
-- `*_owner_isolation` para `authenticated` siguen protegiendo el acceso directo.
--
-- Después de aplicar este script (no contiene secretos):
--   1. ALTER ROLE maestria_app WITH PASSWORD '<contraseña larga y aleatoria>';
--   2. En Render, DATABASE_URL con usuario `maestria_app.<project_ref>` y esa contraseña
--      (mismo host del pooler en modo sesión, puerto 5432).
--   3. Verificar /api/health/ y un flujo docente; el rollback es volver a la URI anterior.
-- Idempotente: se puede ejecutar más de una vez.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maestria_app') THEN
    CREATE ROLE maestria_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
  END IF;
END $$;

ALTER ROLE maestria_app CONNECTION LIMIT 40;
ALTER ROLE maestria_app SET search_path = public;
-- Ninguna consulta del backend debería tardar tanto; corta bloqueos patológicos.
ALTER ROLE maestria_app SET statement_timeout = '30s';
ALTER ROLE maestria_app SET idle_in_transaction_session_timeout = '60s';

GRANT USAGE ON SCHEMA public TO maestria_app;

-- Lectura y escritura completas sobre los datos de negocio.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.course, public.student, public.enrollment,
  public.rubric, public.rubric_criterion, public.rubric_level,
  public.assessment, public.question,
  public.submission, public.submission_answer,
  public.correction, public.correction_criterion_result,
  public.institution, public.institution_membership,
  public.ai_provider_config, public.contact_message,
  public.django_cache
TO maestria_app;

-- Perfiles: la administración crea y actualiza; nunca borra (estado deleted).
GRANT SELECT, INSERT, UPDATE ON public.user_profile TO maestria_app;

-- Traza inmutable desde la aplicación.
GRANT SELECT, INSERT ON public.audit_event, public.correction_revision, public.ai_generation TO maestria_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO maestria_app;

-- Políticas: maestria_app no tiene BYPASSRLS, así que necesita una política explícita
-- en cada tabla con RLS. Los GRANT de arriba siguen limitando los comandos.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'course', 'student', 'enrollment', 'rubric', 'rubric_criterion', 'rubric_level',
    'assessment', 'question', 'submission', 'submission_answer', 'correction',
    'correction_criterion_result', 'correction_revision', 'ai_generation', 'audit_event',
    'institution', 'institution_membership', 'ai_provider_config', 'contact_message',
    'user_profile', 'django_cache'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS maestria_app_backend_access ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY maestria_app_backend_access ON public.%I FOR ALL TO maestria_app USING (true) WITH CHECK (true)',
      t
    );
  END LOOP;
END $$;

-- Verificación de identidades de Supabase Auth sin dar acceso al esquema auth.
CREATE OR REPLACE FUNCTION public.maestria_auth_user_exists(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id);
$$;

REVOKE ALL ON FUNCTION public.maestria_auth_user_exists(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.maestria_auth_user_exists(uuid) FROM anon, authenticated, service_role';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.maestria_auth_user_exists(uuid) TO maestria_app;

COMMIT;
