# Adaptación de Django al esquema PostgreSQL/Supabase — MaestrIA

**Fecha:** 4 de noviembre de 2026  
**Alcance:** backend Django REST Framework y su contrato con el esquema post-migración de `public`.

## 1. Resultado y criterio de diseño

El esquema SQL existente de Supabase queda como **fuente de verdad y propietario de la estructura física**. Django funciona como consumidor del esquema: los 20 modelos tienen `db_table` explícito y `managed = False`. No se crean tablas paralelas `core_*`, no se altera el esquema por medio de migraciones Django y no se ejecutó SQL contra una instancia real.

La conexión PostgreSQL fija `search_path=public`; los modelos usan el nombre físico sin prefijo (`course`, `student`, etc.) y PostgreSQL los resuelve en `public`. Las referencias a Supabase Auth usan UUID y SQL calificado `auth.users`; no se introduce `django.contrib.auth.User` ni una segunda identidad.

## 2. Auditoría de incompatibilidades

Se encontraron estas causas en el repositorio original:

- Los modelos no declaraban `db_table`, de modo que Django derivaba nombres como `core_course`.
- La migración `0007_tenant_consistency_constraints.py` intentaba crear restricciones sobre las tablas antiguas `core_*`, incompatibles con el contrato `public.*`.
- El historial conserva dos archivos `0006` distintos y una migración `0009` que presupone una unicidad de nombre de curso que no figura en el SQL canónico.
- El ORM no representaba todas las entidades administrativas y los campos completos de contacto/auditoría.
- El backend validaba JWT de Supabase, pero no verificaba el estado `user_profile.status` en cada autenticación.

No se eliminaron ni editaron migraciones históricas. Tampoco se hizo `migrate --fake`.

## 3. Modelos y relaciones

Se mapearon estas 20 tablas: `course`, `student`, `rubric`, `rubric_criterion`, `rubric_level`, `assessment`, `question`, `enrollment`, `submission`, `submission_answer`, `correction`, `correction_criterion_result`, `correction_revision`, `ai_generation`, `audit_event`, `contact_message`, `user_profile`, `institution`, `institution_membership` y `ai_provider_config`.

Se conservaron los tipos centrales del esquema: ID `BIGINT`/`BigAutoField`, propietario y referencias a Auth UUID, `JSONB`/`JSONField`, `numeric`/`DecimalField`, `inet`/`GenericIPAddressField`, timestamps y booleanos.

Para las relaciones del dominio docente, los campos navegables del ORM usan `ForeignKey(db_constraint=False)`. Esto **no elimina ni reemplaza** las 19 FK compuestas que ya están en PostgreSQL: evita que Django intente declarar una FK simple adicional. Las restricciones reales siguen garantizando `(foreign_id, owner_id) -> (id, owner_id)`. Los serializers y servicios continúan comprobando que los registros relacionados pertenezcan al propietario autenticado.

## 4. Propiedad, autenticación y roles

- `SupabaseJWTAuthentication` valida firma, algoritmo permitido, emisor, audiencia, `role=authenticated` y UUID `sub`.
- `owner_id` se toma exclusivamente de `request.user.id` derivado del JWT. Los campos de propietario enviados por el cliente siguen siendo de solo lectura/ignorados.
- Si existe un `user_profile` suspendido o eliminado, el JWT se rechaza. Si una cuenta preexistente todavía no tiene perfil, conserva el comportamiento de compatibilidad de docente; se recomienda completar el aprovisionamiento de perfiles.
- El rol global sale de `user_profile`: `teacher`, `student`, `admin`, `superadmin`.
- El rol institucional sale de `institution_membership`: `teacher`, `department_admin`, `institution_admin`. Una membresía institucional nunca concede permisos globales.
- Los administradores institucionales se limitan a su institución. Los administradores de departamento y docentes sólo ven su propia membresía porque el esquema no contiene `department_id` con el que ampliar ese alcance de forma segura.
- Los recursos docentes continúan filtrándose por `owner_id`; los endpoints administrativos no convierten a un administrador global en propietario de los cursos o entregas ajenos.

## 5. Endpoints administrativos y contacto

Se agregaron estas rutas bajo `/api/`:

| Endpoint | Acceso | Función |
|---|---|---|
| `POST /contact/` | Público y autenticado | Persistir mensaje. Rate limit de 5 por hora por IP/cuenta, honeypot y whitelist de campos. |
| `GET /admin/contact-messages/` | Admin/superadmin | Listar y filtrar por `status`, `category` y `q` (nombre, email o asunto). |
| `GET /admin/contact-messages/{id}/` | Admin/superadmin | Consultar detalle. |
| `PATCH /admin/contact-messages/{id}/` | Admin/superadmin | Cambiar estado, asignar responsable y editar notas internas. |
| `GET /admin/users/` | Admin/superadmin | Listar perfiles, filtrar por rol/estado/búsqueda. |
| `POST /admin/users/` | Admin/superadmin, con límites por rol | Crear perfil para una identidad que ya exista en `auth.users`. |
| `PATCH /admin/users/{id}/` | Admin/superadmin, con límites por rol | Editar perfil, cambiar rol o suspender según jerarquía. |
| `/admin/institutions/` | Admin global e institución/departamento dentro de su alcance | Consultar y gestionar instituciones. Baja lógica mediante `archived`. |
| `/admin/institution-memberships/` | Admin global e institución-admin dentro de su alcance | Consultar/gestionar membresías. No permite transferir identidades ni conceder `institution_admin` desde una cuenta institucional. |
| `/admin/ai-providers/` | Admin/superadmin | Gestionar proveedor, modelo, habilitación, prioridad, timeout y costos. |
| `GET /admin/audit-events/` | Admin/superadmin | Consultar auditoría global con filtros y límite de 500 resultados. |

El formulario público sólo acepta `name`, `email`, `subject`, `message`, `category` y el campo honeypot `website`. El backend determina `source=public_web`, `status=new` y, si hay JWT válido, `user_id` desde la identidad autenticada. Rechaza campos privilegiados como `status`, `assigned_to`, `internal_notes`, `handled_at`, `metadata` y `user_id` proporcionado por el cliente.

Las notas internas sólo aparecen en la respuesta administrativa. El trigger de PostgreSQL conserva el control final de `assigned_at`, `handled_at`, `updated_at` y la condición de responsable administrador global activo. Después de editar el mensaje, el ORM refresca la fila para devolver los timestamps calculados por el trigger.

Los perfiles de usuario no se eliminan físicamente desde la API; usan estado `deleted`. La baja de membresías es lógica (`suspended`). El guard del último superadministrador se comprueba en la API bajo bloqueo advisory y permanece respaldado por el trigger de PostgreSQL.

## 6. Auditoría y proveedores IA

Los eventos generados por el backend registran actor, rol, evento, recurso, fecha, request ID, IP y user-agent cuando están disponibles. Los detalles se limitan a metadatos operativos: no se agregan respuestas de estudiantes, contenido del formulario, contraseñas, JWT ni claves.

`ai_provider_config` controla proveedor/modelo/habilitación/prioridad/timeout/precios. **Las API keys no se guardan en esa tabla ni se devuelven en respuestas**: siguen siendo secretos de entorno del backend. Las autorizaciones de procesamiento externo y la confirmación de tier pago también continúan en variables de entorno, por ser controles de privacidad/credenciales ajenos al esquema actual.

## 7. Esquema y migraciones

Se desactivó el grafo histórico de `core` mediante `MIGRATION_MODULES = {"core": None}` y se retiró el pre-deploy `migrate` de Render. No se generaron migraciones nuevas ni se ejecutaron migraciones antiguas. El SQL/Supabase administra el esquema físico.

Se agregó `python manage.py verify_public_schema`, un comando **de sólo lectura** que comprueba:

- Las 20 tablas y sus columnas requeridas.
- Tipos críticos PostgreSQL, UUID, JSONB, numeric, inet, bool, smallint e identidad bigint.
- `auth.users` y el `search_path`.
- Las 19 definiciones de FK a través de `pg_get_constraintdef()`.
- Índices únicos y operativos nombrados por el esquema de referencia.
- Los triggers de último superadministrador y flujo de contacto.
- Tablas `core_*` y filas de migraciones históricas como advertencias (no elimina ni reconcilia automáticamente nada).

## 8. Pruebas agregadas y ejecución

Se incorporaron pruebas para mapeo de modelos, FK compuesta real, rechazo de asociaciones cross-owner, contacto anónimo/autenticado y whitelist, gestión de mensajes, filtrado, asignación a administrador activo, auditoría, roles globales, alcance institucional, restricciones de `PUT`, último superadministrador y configuración IA. Las pruebas existentes de cursos, dashboard, estudiantes, evaluaciones, rúbricas, entregas y correcciones se adaptaron para crear identidades sintéticas en `auth.users`.

`backend/database/test_schema.sql` reproduce el contrato necesario en una **base PostgreSQL desechable**; `backend/conftest.py` lo instala en la base de test de pytest-django. Nunca debe ejecutarse en Supabase de producción. El workflow de GitHub Actions se configuró con un servicio PostgreSQL 16.

### Comandos locales (PowerShell)

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
$env:DEBUG = "True"
$env:DJANGO_SECRET_KEY = "clave-local-de-desarrollo-larga-y-no-reutilizada"
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/maestria_test?sslmode=disable"
python -m compileall -q config apps manage.py
python manage.py check
pytest -q
```

La base `maestria_test` debe ser PostgreSQL local **desechable**; pytest crea su base de test y carga allí `database/test_schema.sql`. Para inspeccionar la instancia Supabase real, configurar la URI de esa instancia en un entorno seguro y ejecutar por separado:

```powershell
python manage.py verify_public_schema
```

Ese comando no escribe en la base. No ejecutar `migrate`, `makemigrations`, `--fake`, ni `database/test_schema.sql` contra producción.

## 9. Estado real de validación de esta entrega

- `python -m compileall -q backend`: **correcto**.
- Contrato estático de modelos: **20/20 tablas**, todas `managed=False`, `db_table` esperado: **correcto**.
- Conteo del esquema de pruebas: 20 tablas de dominio + `auth.users`, 19 FK compuestas y funciones/triggers de contrato: **revisado estáticamente**.
- `python manage.py check`: **no ejecutable en este entorno**, porque no están instalados Django y sus dependencias.
- `pytest`: **no ejecutable en este entorno**, por la misma ausencia de dependencias.
- Introspección de Supabase (`pg_get_constraintdef`, `pg_indexes`, `search_path`) y pruebas de integración reales: **pendientes**; el ZIP no contiene credenciales ni conexión configurada.
- No se modificó ninguna base real y no se ejecutó una migración.

El workflow CI queda preparado para ejecutar la suite en PostgreSQL 16 cuando se publique el commit. Su resultado todavía no se conoce y no se declara como exitoso.

## 10. Riesgos y pendientes conocidos

1. **Tablas legacy y datos:** si la instancia conserva `core_*` o datos históricos, no se eliminan ni se copian automáticamente. Hace falta backup, inventario de registros y una migración de datos explícita si esos datos todavía tienen valor.
2. **Identidades Supabase:** el endpoint de usuarios crea/edita `user_profile` sólo para UUID que ya existen en `auth.users`. Crear/invitar usuarios, resetear credenciales o borrar Auth accounts requiere un flujo separado con Supabase Auth Admin y una credencial service-role protegida; no se incorporó una clave privilegiada al backend.
3. **Ámbito institucional:** el SQL no relaciona cursos/estudiantes/evaluaciones con una institución ni define `department_id`. Por eso la autorización institucional se limita a institución/membresías y no inventa acceso a recursos docentes que el esquema no puede delimitar.
4. **Último superadministrador y SQL externo:** la API serializa sus cambios con un advisory lock. La función trigger del SQL de referencia no toma ese lock en escrituras externas concurrentes. Se adjunta `backend/database/optional_harden_last_superadmin_concurrency.sql`: agrega un bloqueo `BEFORE STATEMENT` para mantener el orden de locks y reemplaza el cuerpo de la función de fila. Así se serializan también cambios directos concurrentes fuera de Django. No se ejecutó; debe revisarse y aplicarse manualmente, con backup y ventana de mantenimiento.
5. **Unicidades no declaradas:** el SQL de referencia no define un índice único case-insensitive para `course.name`, `student.external_code` ni una unicidad de matrícula activa. El backend valida esas reglas para escrituras de API y usa bloqueos de fila Auth cuando corresponde, pero escrituras SQL externas pueden omitirlas. No se inventaron constraints para no divergir del esquema acordado.
6. **Auditoría anónima:** `audit_event.owner_id` es obligatorio y referencia `auth.users`; por ese diseño no hay un propietario válido para registrar como fila de auditoría una consulta de contacto anónima. El mensaje sí queda persistido, pero no se crea un `audit_event` anónimo.
7. **Claves y política IA:** `ai_provider_config` no dispone de columnas para secretos o autorización de tratamiento. Las keys y flags de privacidad deben seguir en el entorno seguro del servidor.
8. **Frontend administrativo:** las pantallas de administración del ZIP de frontend previo no se conectaron en esta tarea a estos nuevos endpoints; el backend queda preparado, pero el wiring visual/API es una etapa frontend separada.

