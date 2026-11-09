-- Migration 20261109174649 / maestria_integrity_and_audit_retention
-- Auditoría técnica 2026-11-09 (docs/auditoria/AUDITORIA_TECNICA_MAESTRIA.md):
--   AUD-028  una sola propuesta pending_review por entrega, también en la base.
--   AUD-008  borrar una identidad de Supabase Auth ya no elimina su traza de auditoría.
-- No borra filas. Todo corre en una sola transacción.
--
-- Datos verificados en producción antes de escribirla (2026-11-09, sólo conteos):
--   entregas con más de una corrección pending_review = 0.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. AUD-028: hoy la regla sólo la garantizan los locks de la API
--    (api_views/submissions.py). El índice parcial la vuelve una invariante.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_correction_per_submission
  ON public.correction (submission_id)
  WHERE status = 'pending_review';

-- ---------------------------------------------------------------------------
-- 2. AUD-008: audit_event.owner_id tenía ON DELETE CASCADE hacia auth.users, así que
--    eliminar una cuenta borraba también la evidencia de quién aprobó qué calificación.
--    Ahora la fila se conserva y queda desvinculada (owner_id NULL), igual que
--    actor_user_id, que ya usaba SET NULL. La política RLS de lectura por dueño sigue
--    válida: una fila sin dueño no es visible para ningún docente.
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_event ALTER COLUMN owner_id DROP NOT NULL;

ALTER TABLE public.audit_event DROP CONSTRAINT IF EXISTS core_auditevent_owner_auth_user_fk;
ALTER TABLE public.audit_event
  ADD CONSTRAINT core_auditevent_owner_auth_user_fk
  FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE SET NULL;

COMMIT;
