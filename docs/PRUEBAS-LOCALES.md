# Pruebas locales sin tocar Supabase de producción

Guía para levantar MaestrIA contra un PostgreSQL local y ejecutar la suite sin
riesgo de escribir en la base real ni de enviar datos a un proveedor de IA.

## 1. Base de datos local

### Opción A (recomendada): Supabase local, igual a producción

Requiere Docker Desktop. La CLI ya es devDependency del repo.

```bash
npx supabase start -x realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor
docker exec -i supabase_db_maestria-starter psql -v ON_ERROR_STOP=1 -U postgres -d postgres < db/maestria_schema.sql
# Luego, en orden, las migraciones de backend/database/migrations/ posteriores a
# la versión que indica el encabezado de db/maestria_schema.sql:
docker exec -i supabase_db_maestria-starter psql -v ON_ERROR_STOP=1 -U postgres -d postgres < backend/database/migrations/20261109160000_maestria_align_prod_with_contract.sql
```

URL de la base: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Para
empezar de cero: `npx supabase db reset`. Para apagar: `npx supabase stop`.

### Opción B: PostgreSQL plano (esquema histórico)

Más liviana, pero instala el esquema histórico v2: sirve para la suite y el
verificador, aunque **no** es idéntico a producción (ver
`docs/auditoria/AUDITORIA-SUPABASE-2026-11-09.md` §7).

```bash
docker run -d --name maestria-pg-local -e POSTGRES_PASSWORD=localtest \
  -e POSTGRES_DB=maestria_local -p 127.0.0.1:55432:5432 postgres:16-alpine
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

Verificación de sólo lectura del esquema:

```bash
cd backend && .venv/bin/python manage.py verify_public_schema
```

Debe terminar con `Esquema compatible: 20 tablas, 19 FK compuestas, ...`.

## 3. Suite backend

```bash
cd backend && .venv/bin/pytest -q
```

pytest crea su propia base desechable en el mismo servidor y le instala **el esquema de
producción**: `db/local_supabase_stub.sql` + `db/maestria_schema.sql` + las migraciones de
`backend/database/migrations/` posteriores a la versión del encabezado del snapshot (ver
`backend/conftest.py`). No existe un esquema de pruebas aparte: si una migración nueva
cambia índices o restricciones, la suite la aplica automáticamente, y
`SchemaContractTests` ejecuta `verify_public_schema` contra esa base. Con Supabase local
(opción A) usá `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

`conftest.py` se niega a ejecutar si `DATABASE_URL` apunta a `*.supabase.co` /
`*.supabase.com`, y fuerza `AI_PROVIDER=mock` con credenciales vacías.

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
