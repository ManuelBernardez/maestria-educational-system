-- Migration 20261110050729 / maestria_user_profile_avatar
-- Foto de perfil del docente, guardada en la base como data URL (imagen ya recortada y
-- reducida en el navegador a 256x256, del orden de 10-40 KB).
-- Es aditiva: agrega una columna con valor por defecto, no modifica ni borra filas.
-- maestria_app ya tiene SELECT/INSERT/UPDATE sobre toda la tabla user_profile.

BEGIN;

ALTER TABLE public.user_profile
  ADD COLUMN IF NOT EXISTS avatar_data text NOT NULL DEFAULT '';

ALTER TABLE public.user_profile DROP CONSTRAINT IF EXISTS user_profile_avatar_data_valid;
ALTER TABLE public.user_profile
  ADD CONSTRAINT user_profile_avatar_data_valid CHECK (
    avatar_data = ''
    OR (
      length(avatar_data) <= 200000
      AND avatar_data ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
    )
  );

COMMENT ON COLUMN public.user_profile.avatar_data IS
  'Foto de perfil como data URL (jpeg, png o webp en base64, máx. 200.000 caracteres). Vacía = iniciales.';

COMMIT;
