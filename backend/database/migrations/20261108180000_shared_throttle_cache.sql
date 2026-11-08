-- MaestrIA — tabla de caché compartida para los límites de frecuencia (F-10).
--
-- Los throttles de DRF guardaban sus contadores en la memoria de cada worker de
-- Gunicorn: con 2 workers cada límite se duplicaba y se reiniciaba en cada deploy.
-- Con CACHE_BACKEND=database, Django guarda esos contadores en esta tabla.
--
-- Estructura: la misma que genera `python manage.py createcachetable` para
-- django.core.cache.backends.db.DatabaseCache (Django 5.2). Sin FK.
-- Contenido: claves `throttle_<scope>_<ip o id de usuario>` y la lista de
-- instantes de cada pedido, con vencimiento de 1 hora como máximo. No guarda
-- contenido de pedidos. Como las claves incluyen IPs, la tabla queda cerrada
-- a la API REST de Supabase (RLS activado y sin permisos para anon/authenticated).
--
-- Idempotente: se puede correr más de una vez. No modifica otras tablas.
-- Orden de despliegue: correr este script ANTES de desplegar con
-- CACHE_BACKEND=database; sin la tabla, los pedidos con límite fallan con error 500.

BEGIN;

CREATE TABLE IF NOT EXISTS public.django_cache (
  cache_key varchar(255) NOT NULL PRIMARY KEY,
  value text NOT NULL,
  expires timestamp with time zone NOT NULL
);

CREATE INDEX IF NOT EXISTS django_cache_expires ON public.django_cache (expires);

ALTER TABLE public.django_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.django_cache FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.django_cache IS
  'Caché de Django (DatabaseCache) para contadores de límites de frecuencia. Datos efímeros: se puede vaciar sin pérdida.';

COMMIT;

-- Verificación posterior (sólo lectura):
--   cd backend && python manage.py verify_public_schema
