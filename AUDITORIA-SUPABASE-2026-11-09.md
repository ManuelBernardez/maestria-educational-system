# Auditoría Supabase y entorno local — 2026-11-09

Registro de lo que se revisó, cambió y probó en la base de datos de MaestrIA y en el entorno de desarrollo durante la sesión del 2026-11-09.

- **Proyecto Supabase:** `xxutiwcbpyafwkmwiyec` (`https://xxutiwcbpyafwkmwiyec.supabase.co`), Postgres 17.11
- **Rama de git:** `chore/db-hardening` (sale de `main` en `56a6196`)
- **Herramientas:** servidor MCP de Supabase en modo **solo lectura** (`read_only=true` en `.mcp.json`), Supabase CLI 2.122.1, Docker Desktop 29.8.1

---

## 1. Resumen

| Paso | Estado |
|---|---|
| Auditoría de producción (tablas, relaciones, RLS, políticas, migraciones, índices, advisors) | ✅ Hecho, solo lectura |
| Migración de limpieza `20261109140000_maestria_db_cleanup.sql` | ✅ Escrita y commiteada |
| Entorno Supabase local en F: | ✅ Creado y funcionando |
| Prueba de la migración en local | ✅ Aprobada |
| Aplicación en producción | ✅ La aplicó el usuario a mano desde el SQL Editor (el MCP es de solo lectura). Se verificó después (ver §6) |

---

## 2. Auditoría de producción (estado inicial)

### Esquemas y tablas
- `public`: 21 tablas, todas con RLS activo.
- Datos: entre 0 y 46 filas por tabla. Es un volumen de desarrollo o demo.
- Esquemas administrados por Supabase: `auth` (27), `storage` (10), `realtime` (3), `vault` (1), `supabase_migrations` (1).

### Relaciones
Casi todas las FK son **compuestas con el dueño**: `(x_id, owner_id) → tabla(id, owner_id)`. Así la base impide referencias entre docentes distintos aunque falle el backend. Todos los `owner_id` y las columnas de auditoría (`*_by`) apuntan a `auth.users`.

### RLS y políticas
- 15 tablas tienen `*_owner_isolation` (`ALL`, `authenticated`, `(select auth.uid()) = owner_id`).
- `user_profile`, `institution` e `institution_membership` solo permiten leer el registro propio.
- `ai_provider_config`, `contact_message` y `django_cache` tienen RLS activo pero ninguna política, así que nadie accede por la API.
- `anon` y `authenticated` **no tienen GRANT** sobre ninguna tabla de `public`. Todo el acceso pasa por Django con el rol `postgres` (`BYPASSRLS`). Las políticas funcionan como segunda capa de defensa.

### Migraciones
- Hay una sola registrada: `20261105202119 maestria_v1_0_2_hardening`.
- El esquema base (`db/maestria_schema_v2.sql` y `db/maestria_schema_v2_contract_alignment.sql`) se aplicó a mano y **no figura en el historial**.
- Django usa `managed = False` y no gestiona el esquema.

### Advisors
| Tipo | Hallazgo | Nivel | Acción |
|---|---|---|---|
| Rendimiento | 12 pares de índices duplicados | WARN | Migración de limpieza |
| Rendimiento | 8 FK sin índice (columnas `*_by` y `contact_message.user_id`) | INFO | Migración de limpieza |
| Rendimiento | 61 índices "sin uso" | INFO | Ninguna: con tablas tan chicas Postgres hace seq scan y la estadística no dice nada |
| Seguridad | 3 tablas con RLS y sin políticas | INFO | Ninguna: es intencional, son solo para el backend |
| Seguridad | Protección contra contraseñas filtradas desactivada | WARN | **Pendiente** (§9): requiere plan Pro |

### Origen de los índices duplicados
- `maestria_schema_v2.sql` crea las constraints `uniq_*_id_owner`, y las FK compuestas dependen de su índice.
- `contract_alignment.sql` agrega después índices sueltos idénticos con nombre `uq_*`, que son los que exige `manage.py verify_public_schema`.
- Los 3 duplicados comunes (`*_idx` y `ix_*`) tienen el mismo origen.

---

## 3. Migración de limpieza

Archivo: `backend/database/migrations/20261109140000_maestria_db_cleanup.sql`. Corre en una sola transacción y no toca datos.

1. **9 pares UNIQUE `(id, owner_id)`:** se borra el índice suelto `uq_*` y se renombra la constraint `uniq_*` a `uq_*`. Renombrar la constraint también renombra su índice. Queda un único índice con el nombre del contrato y las FK no se modifican.
2. **3 índices comunes duplicados:** se borran los de `maestria_schema_v2.sql` y quedan los `ix_*`.
3. **8 índices nuevos** para las FK hacia `auth.users`.
4. **`audit_event`:** la política `ALL` se reemplaza por `audit_event_owner_read`, solo `SELECT`. Así un dueño no podría modificar ni borrar su auditoría si algún día se otorgan GRANTs.

### Reversión (si hiciera falta)
```sql
BEGIN;
DROP POLICY IF EXISTS audit_event_owner_read ON public.audit_event;
CREATE POLICY audit_event_owner_isolation ON public.audit_event FOR ALL TO authenticated
  USING ((SELECT auth.uid()) = owner_id) WITH CHECK ((SELECT auth.uid()) = owner_id);
DROP INDEX IF EXISTS public.ix_ai_provider_config_updated_by, public.ix_contact_message_user,
  public.ix_institution_created_by, public.ix_institution_updated_by,
  public.ix_institution_membership_invited_by, public.ix_institution_membership_updated_by,
  public.ix_user_profile_role_updated_by, public.ix_user_profile_suspended_by;
-- Los índices duplicados no se recrean: no aportan nada.
COMMIT;
```
Los nombres `uq_*` también conviene dejarlos: son los que exige el verificador de Django.

---

## 4. Entorno local (nuevo)

### Antes
- Docker Desktop estaba instalado en `C:\Program Files\Docker` y **apagado**.
- Su disco de datos (`docker_data.vhdx`, **14,35 GB**) estaba en `C:\Users\…\AppData\Local\Docker\wsl\disk`.
- En C: quedaban **7,9 GB libres**: no alcanzaba para las imágenes de Supabase.
- No había Supabase CLI ni carpeta `supabase/` en el repo.

### Cambios
| Cambio | Quién | Detalle |
|---|---|---|
| Disco de datos de Docker movido a `F:\DockerData\DockerDesktopWSL\` | Usuario, desde la interfaz de Docker Desktop (Resources → Advanced → Disk image location) | Se conservaron las imágenes. C: pasó de 7,9 GB a **22,1 GB libres** |
| Docker Desktop, WSL, Node 26 y npm 11 | — | **No se reinstalaron**: siguen en C:. Solo se movieron los datos |
| `npm i -D supabase@2` | Claude | CLI 2.122.1 en `node_modules` del repo, en F: (~154 MB) |
| `npx supabase init` | Claude | `supabase/config.toml` con Postgres 17, igual que producción, y `supabase/.gitignore` |
| `npx supabase start -x realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor` | Claude | Imágenes de Docker: ~8,9 GB en total, todas dentro del disco virtual en F:. De eso, ~2,6 GB se pueden recuperar, incluidas imágenes de realtime y storage que se descargaron aunque no se usan |

### Servicios locales
| Servicio | URL |
|---|---|
| Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (credenciales locales por defecto de la CLI) |
| API | http://127.0.0.1:54321 |
| Studio | http://127.0.0.1:54323 |
| Mailpit | http://127.0.0.1:54324 |

Contenedores: `supabase_{db,auth,rest,kong,pg_meta,studio,inbucket}_maestria-starter`.

### Uso
```bash
npx supabase start -x realtime,storage-api,imgproxy,edge-runtime,logflare,vector,supavisor
npx supabase stop          # apaga y conserva los datos
npx supabase stop --no-backup   # apaga y borra la base local
docker image prune -a      # libera imágenes que no se usan (dentro del disco en F:)
```

### Reproducir producción en local
```bash
for f in db/maestria_schema_v2.sql \
         db/maestria_schema_v2_contract_alignment.sql \
         backend/database/migrations/20261105202119_maestria_v1_0_2_hardening.sql; do
  docker exec -i supabase_db_maestria-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
done
# Django contra la base local (la variable tiene prioridad sobre backend/.env):
DEBUG=true DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
  backend/.venv/Scripts/python.exe backend/manage.py verify_public_schema
```

---

## 5. Prueba en local

### Equivalencia local y producción antes de migrar
Se comparó una huella del esquema `public` (columnas, constraints, índices, políticas, triggers, funciones, RLS y comentarios):

| Objeto | Resultado |
|---|---|
| Índices (145) | ✅ Idénticos |
| Políticas (18) | ✅ Idénticas |
| Triggers (26) | ✅ Idénticos |
| RLS | ✅ Igual en las tablas de la app |
| Constraints únicas y FK compuestas que toca la migración | ✅ Idénticas en nombre y columnas |

Todo lo que modifica la migración es igual en las dos bases, así que la prueba local es representativa.

### Resultado de la migración en local
| Comprobación | Resultado |
|---|---|
| Ejecución | ✅ Sin errores, una transacción |
| Índices duplicados restantes | ✅ 0 |
| FK sin índice | ✅ 0 |
| 19 FK compuestas | ✅ Respaldadas por los índices `uq_*` |
| Insertar una evaluación con el curso de otro docente | ✅ La rechaza `fk_assessment_course_owner` |
| `audit_event` con el rol `authenticated` y GRANT temporal | ✅ `SELECT` del registro propio: 1. `DELETE`: 0 filas |
| `manage.py verify_public_schema` | ✅ "Esquema compatible: 20 tablas, 19 FK compuestas, 13 índices únicos, 32 índices operativos y 2 triggers verificados" |

Las pruebas de comportamiento corrieron en una transacción con `ROLLBACK` y no dejaron datos.

---

## 6. Aplicación en producción

1. **Verificación previa (solo lectura):** los 12 índices a borrar y las 9 constraints a renombrar existían. Ninguno de los 8 índices nuevos existía. No había clientes activos ni locks en espera.
2. **Línea base:** `verify_public_schema` contra producción dio **compatible**.
3. **Aplicación:** la conexión MCP no ofrece `apply_migration` y su `execute_sql` corre en modo solo lectura. Postgres respondió `25006: cannot execute DROP INDEX in a read-only transaction`.
4. **Confirmación:** después del error, producción sigue igual. Se mantienen los 9 índices `uq_*` sueltos, las 9 constraints `uniq_*`, la política `audit_event_owner_isolation` y una sola migración en el historial.

5. **Aplicación manual:** para no darle escritura al MCP, el usuario ejecutó la migración desde el SQL Editor del dashboard y registró la versión `20261109140000 maestria_db_cleanup` en `supabase_migrations.schema_migrations`. Respuesta: `Success. No rows returned`.

### Verificación posterior (solo lectura)
| Comprobación | Resultado |
|---|---|
| Constraints `uq_*` (id, owner_id) e (institution_id, user_id) | ✅ 9 de 9 |
| Constraints `uniq_*` que quedaron | ✅ 0 |
| Duplicados comunes (`*_idx`) que quedaron | ✅ 0 |
| Grupos de índices duplicados en `public` | ✅ 0 |
| Índices nuevos para FK | ✅ 8 de 8 |
| Índices inválidos | ✅ 0 |
| FK compuestas respaldadas por `uq_*` | ✅ 19 de 19 |
| Política de `audit_event` | ✅ `audit_event_owner_read` (SELECT) |
| Historial de migraciones | ✅ `20261105202119 maestria_v1_0_2_hardening`, `20261109140000 maestria_db_cleanup` |
| `manage.py verify_public_schema` | ✅ "Esquema compatible: 20 tablas, 19 FK compuestas, 13 índices únicos, 32 índices operativos y 2 triggers verificados" |

### Advisors: antes y después
| Lint | Antes | Después |
|---|---|---|
| `duplicate_index` (WARN) | 12 | ✅ **0** |
| `unindexed_foreign_keys` (INFO) | 8 | ✅ **0** |
| `unused_index` (INFO) | 61 | 69. Esperado: los 8 índices nuevos todavía no se usaron. Con este volumen la estadística no dice nada |
| `rls_enabled_no_policy` (INFO) | 3 | 3. Es intencional (§2) |
| `auth_leaked_password_protection` (WARN) | 1 | 1. Depende del plan (§9) |

---

## 7. Diferencias entre los scripts del repo y producción

Aparecieron al comparar las dos bases. **No afectan la migración de limpieza**, pero significan que una instalación nueva hecha con los scripts del repo **no queda igual a producción**:

| # | Objeto | Producción | Scripts del repo |
|---|---|---|---|
| 1 | `ai_provider_config.timeout_seconds` | CHECK 5–85, default 60 (igual que `models.py`) | Con la migración `hardening` queda en 5–18 y default 18. En producción, `contract_alignment` se corrió después y la pisó |
| 2 | ON DELETE de las FK compuestas | Sin acción: bloquean el borrado, igual que el `PROTECT` de Django | `CASCADE` o `SET NULL (col)` |
| 3 | Largo de `varchar` en `audit_event.actor_role`, `request_id` y `contact_message.category`, `source` | Sin largo máximo | 24, 128, 80 y 80 |
| 4 | Código de `maestria_guard_last_superadmin` y `maestria_contact_message_admin_workflow` | Una versión | Otra versión. Posiblemente se aplicó `optional_harden_last_superadmin_concurrency.sql` (sin verificar) |
| 5 | Comentarios de columnas | 8 | 0 |
| 6 | Constraints hacia `auth.users` | Con nombre explícito (`fk_*`) | Con nombre automático (`*_fkey`) |
| 7 | `django_cache` y `django_migrations` | Solo existe `django_cache` | Solo existe `django_migrations` |

**Recomendación:** generar una migración base desde producción (`supabase db dump --schema public`) y usarla como única fuente para instalaciones nuevas. Además, renombrar las constraints `uniq_*` en `maestria_schema_v2.sql`, porque si no, `contract_alignment` vuelve a crear los duplicados.

---

## 8. Commits en `chore/db-hardening`

| Commit | Contenido |
|---|---|
| `69c95e2` | Migración de limpieza |
| `602d3db` | Supabase CLI como devDependency y `supabase/config.toml` |
| `6caa958` | Auditoría |
| (siguiente) | Auditoría actualizada con la aplicación en producción |

Quedó afuera a propósito: el cambio del usuario en `.gitignore` (`.mcp.json`).

## 9. Pendientes
1. **Protección contra contraseñas filtradas.** Está en **Authentication → Sign In / Providers → Email → "Prevent use of leaked passwords"** (`/dashboard/project/_/auth/providers?provider=Email`), no en Passkeys. Según la [documentación](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), **requiere plan Pro o superior**. En el plan gratuito, en el mismo panel se puede subir el largo mínimo de la contraseña (8 o más) y exigir dígitos, mayúsculas, minúsculas y símbolos.
2. Resolver las diferencias entre los scripts y producción (§7).
3. Mergear `chore/db-hardening` a `main`.
