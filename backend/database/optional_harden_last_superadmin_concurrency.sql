-- OPCIONAL: endurece la protección del último superadministrador ante escrituras SQL concurrentes.
-- Aplicar manualmente sólo después de verificar el trigger canónico y hacer backup.
-- No crea tablas ni modifica filas. Agrega un BEFORE STATEMENT trigger para adquirir
-- el mismo advisory lock que usa Django antes de tomar bloqueos por fila.

CREATE OR REPLACE FUNCTION public.maestria_lock_superadmin_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM pg_advisory_xact_lock(1297303908, 1);
    RETURN NULL; -- statement-level trigger
END;
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relname = 'user_profile'
           AND t.tgname = 'trg_user_profile_superadmin_guard_lock'
           AND NOT t.tgisinternal
    ) THEN
        EXECUTE 'CREATE TRIGGER trg_user_profile_superadmin_guard_lock '
             || 'BEFORE UPDATE OF role, status OR DELETE ON public.user_profile '
             || 'FOR EACH STATEMENT EXECUTE FUNCTION public.maestria_lock_superadmin_guard()';
    END IF;
END;
$$;

-- El trigger de fila canónico conserva su validación de último superadmin.
-- La adquisición repetida del mismo advisory xact lock dentro de una transacción
-- es segura; el lock de sentencia anterior garantiza el orden antes de bloquear filas.
CREATE OR REPLACE FUNCTION public.maestria_guard_last_superadmin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_remaining integer;
BEGIN
    PERFORM pg_advisory_xact_lock(1297303908, 1);

    IF TG_OP = 'DELETE' THEN
        IF OLD.role = 'superadmin' AND OLD.status = 'active' THEN
            SELECT count(*) INTO v_remaining
              FROM public.user_profile
             WHERE role = 'superadmin'
               AND status = 'active'
               AND user_id <> OLD.user_id;
            IF v_remaining = 0 THEN
                RAISE EXCEPTION 'No se puede eliminar el último superadministrador activo.' USING ERRCODE = '23514';
            END IF;
        END IF;
        RETURN OLD;
    END IF;

    IF OLD.role = 'superadmin' AND OLD.status = 'active'
       AND (NEW.role <> 'superadmin' OR NEW.status <> 'active') THEN
        SELECT count(*) INTO v_remaining
          FROM public.user_profile
         WHERE role = 'superadmin'
           AND status = 'active'
           AND user_id <> OLD.user_id;
        IF v_remaining = 0 THEN
            RAISE EXCEPTION 'No se puede degradar ni suspender al último superadministrador activo.' USING ERRCODE = '23514';
        END IF;
    END IF;

    IF NEW.role IS DISTINCT FROM OLD.role THEN
        NEW.role_updated_at := now();
    END IF;

    IF OLD.role IN ('admin', 'superadmin') AND OLD.status = 'active'
       AND (NEW.role NOT IN ('admin', 'superadmin') OR NEW.status <> 'active') THEN
        UPDATE public.contact_message SET assigned_to = NULL WHERE assigned_to = OLD.user_id;
    END IF;

    IF NEW.status = 'suspended' THEN
        IF OLD.status IS DISTINCT FROM 'suspended' THEN
            NEW.suspended_at := now();
        ELSE
            NEW.suspended_at := coalesce(NEW.suspended_at, OLD.suspended_at, now());
        END IF;
    ELSE
        NEW.suspended_at := NULL;
        NEW.suspended_by := NULL;
        NEW.suspension_reason := '';
    END IF;

    RETURN NEW;
END;
$$;
