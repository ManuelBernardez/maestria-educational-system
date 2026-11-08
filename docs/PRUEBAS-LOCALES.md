# Pruebas locales sin tocar Supabase de producción

Guía para levantar MaestrIA contra un PostgreSQL local y ejecutar la suite sin
riesgo de escribir en la base real ni de enviar datos a un proveedor de IA.

## 1. PostgreSQL local (Docker)

```bash
docker run -d --name maestria-pg-local -e POSTGRES_PASSWORD=localtest \
  -e POSTGRES_DB=maestria_local -p 127.0.0.1:55432:5432 postgres:16-alpine
```

Instalar el esquema (orden obligatorio):

```bash
docker exec -i maestria-pg-local psql -v ON_ERROR_STOP=1 -U postgres -d maestria_local < db/local_supabase_stub.sql
docker exec -i maestria-pg-local psql -v ON_ERROR_STOP=1 -U postgres -d maestria_local < db/maestria_schema_v2.sql
docker exec -i maestria-pg-local psql -v ON_ERROR_STOP=1 -U postgres -d maestria_local < db/maestria_schema_v2_contract_alignment.sql
```

`maestria_schema_v2.sql` sólo no alcanza: sin el script de alineación faltan
columnas, índices y triggers que usa el backend (la verificación da 68 errores).

## 2. Variables de entorno

`backend/settings.py` carga `backend/.env` pero **las variables exportadas en la
terminal tienen prioridad**. Para una sesión local segura, exportá al menos:

```bash
export DEBUG=True
export DATABASE_URL="postgresql://postgres:localtest@127.0.0.1:55432/maestria_local"
export AI_PROVIDER=mock GEMINI_API_KEY="" OPENAI_API_KEY="" AI_EXTERNAL_PROCESSING_APPROVED=False
```

Con `DEBUG=True` el caché de los límites de frecuencia es `locmem` (memoria del
proceso). Para probar el caché compartido de producción, exportá también
`CACHE_BACKEND=database`: usa la tabla `public.django_cache`, que el script de
alineación ya crea. Con `DEBUG=False` el arranque exige `CACHE_BACKEND=database`.

Verificación de sólo lectura del esquema:

```bash
cd backend && .venv/bin/python manage.py verify_public_schema
```

Debe terminar con `Esquema compatible: 20 tablas, 19 FK compuestas, ...`.

## 3. Suite backend

```bash
cd backend && .venv/bin/pytest -q
```

`conftest.py` se niega a ejecutar si `DATABASE_URL` apunta a `*.supabase.co` /
`*.supabase.com`, y fuerza `AI_PROVIDER=mock` con credenciales vacías.

La suite pasa con los dos cachés; para correrla como en producción:

```bash
cd backend && CACHE_BACKEND=database .venv/bin/pytest -q
```

## 4. Servidor y navegador

```bash
cd backend && .venv/bin/python manage.py runserver 127.0.0.1:8000
```

El inicio de sesión usa Supabase Auth. Para probar el espacio docente de punta a
punta hace falta un proyecto Supabase **de desarrollo** (no el de producción):
configurar `SUPABASE_URL` y `SUPABASE_ANON_KEY` de ese proyecto, crear usuarios de
prueba allí y agregar `http://127.0.0.1:8000` a las Redirect URLs. El perfil de
cada usuario se crea en `public.user_profile` mediante el trigger de `auth.users`;
con la base local, insertar el mismo `id` del usuario de Supabase en `auth.users`.

## 5. Chequeos de frontend

```bash
npm run check:frontend
```

Requiere `python` en el PATH (en macOS suele ser `python3`: usar el intérprete
del entorno virtual o un alias) y Node.js 18 o superior.
