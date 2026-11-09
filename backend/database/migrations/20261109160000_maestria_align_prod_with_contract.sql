-- Migration 20261109160000 / maestria_align_prod_with_contract
-- Alinea producción con el contrato del backend en los dos puntos donde el
-- código tiene razón y la base no (ver docs/auditoria/AUDITORIA-SUPABASE-2026-11-09.md §7).
-- No borra filas. Todo corre en una sola transacción.
--
-- Datos verificados en producción antes de escribirla (2026-11-09):
--   largo máximo actual: audit_event.actor_role = 10, audit_event.request_id = 36,
--   contact_message.category = 7, contact_message.source = 10.
--   Todos entran en los nuevos límites.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Largos de varchar iguales a backend/apps/core/models.py
--    (AuditEvent.actor_role max_length=24, request_id=128;
--     ContactMessage.category=80, source=80). Hoy son varchar sin límite, así
--    que la base no impone lo que el ORM valida.
-- ---------------------------------------------------------------------------

ALTER TABLE public.audit_event
  ALTER COLUMN actor_role TYPE varchar(24),
  ALTER COLUMN request_id TYPE varchar(128);

ALTER TABLE public.contact_message
  ALTER COLUMN category TYPE varchar(80),
  ALTER COLUMN source   TYPE varchar(80);

-- ---------------------------------------------------------------------------
-- 2. Guard del último superadmin con SQLSTATE 23514 (check_violation).
--    Producción tiene una versión anterior que usa el SQLSTATE por defecto
--    (P0001). Django lo convierte en InternalError y no en IntegrityError,
--    que es lo que espera admin_api_tests.py
--    (test_superadmin_is_protected_from_being_last_active_superadmin).
--    El cuerpo es idéntico al de db/maestria_schema_v2_contract_alignment.sql.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.maestria_guard_last_superadmin()
RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog, public, pg_temp AS $$
DECLARE remaining integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.role = 'superadmin' AND OLD.status = 'active' THEN
      SELECT count(*) INTO remaining FROM public.user_profile
       WHERE role = 'superadmin' AND status = 'active' AND user_id <> OLD.user_id;
      IF remaining = 0 THEN
        RAISE EXCEPTION 'No se puede eliminar el último superadministrador activo.' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.role = 'superadmin' AND OLD.status = 'active' AND (NEW.role <> 'superadmin' OR NEW.status <> 'active') THEN
    SELECT count(*) INTO remaining FROM public.user_profile
     WHERE role = 'superadmin' AND status = 'active' AND user_id <> OLD.user_id;
    IF remaining = 0 THEN
      RAISE EXCEPTION 'No se puede degradar ni suspender al último superadministrador activo.' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role THEN NEW.role_updated_at := now(); END IF;
  IF OLD.role IN ('admin','superadmin') AND OLD.status = 'active'
     AND (NEW.role NOT IN ('admin','superadmin') OR NEW.status <> 'active') THEN
    UPDATE public.contact_message SET assigned_to = NULL WHERE assigned_to = OLD.user_id;
  END IF;
  IF NEW.status = 'suspended' THEN
    IF OLD.status IS DISTINCT FROM 'suspended' THEN NEW.suspended_at := now();
    ELSE NEW.suspended_at := coalesce(NEW.suspended_at, OLD.suspended_at, now()); END IF;
  ELSE
    NEW.suspended_at := NULL; NEW.suspended_by := NULL; NEW.suspension_reason := '';
  END IF;
  RETURN NEW;
END $$;

-- Misma lógica que producción; se reemplaza para que el código fuente sea
-- idéntico al del repo (producción lo tiene con saltos de línea CRLF y otro formato).
CREATE OR REPLACE FUNCTION public.maestria_contact_message_admin_workflow()
RETURNS trigger LANGUAGE plpgsql SET search_path TO pg_catalog, public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.assigned_to IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.user_profile up
        WHERE up.user_id = NEW.assigned_to AND up.role IN ('admin','superadmin') AND up.status = 'active') THEN
    RAISE EXCEPTION 'El responsable asignado debe ser un administrador activo.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_to IS NOT NULL AND NEW.assigned_at IS NULL THEN NEW.assigned_at := now(); END IF;
    IF NEW.status = 'handled' AND NEW.handled_at IS NULL THEN NEW.handled_at := now(); END IF;
  ELSE
    IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
      NEW.assigned_at := CASE WHEN NEW.assigned_to IS NULL THEN NULL ELSE now() END;
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      NEW.handled_at := CASE WHEN NEW.status = 'handled' THEN now() ELSE NULL END;
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Son funciones de trigger y nadie debe invocarlas directamente
-- (igual que en contract_alignment). CREATE OR REPLACE conserva el ACL anterior,
-- por eso se revoca de forma explícita.
REVOKE EXECUTE ON FUNCTION public.maestria_guard_last_superadmin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.maestria_contact_message_admin_workflow() FROM PUBLIC;

COMMIT;
