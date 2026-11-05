# MaestrIA v1.0.3

Plataforma educativa para asistir a docentes en la preparación de evaluaciones, revisión de entregas y elaboración de devoluciones pedagógicas. El frontend se entrega como **HTML5, CSS y JavaScript nativos**; Django REST Framework sirve también el frontend y consume PostgreSQL/Supabase; producción utiliza un único dominio.

## Arquitectura

- `frontend/`: sitio público y espacio docente HTML5 estáticos. Django los sirve en producción; no utiliza Next.js, React, Node ni un proceso de compilación.
- `frontend/js/api.js`: cliente HTTP/Auth, sesión Supabase por pestaña, renovación controlada, cancelación y llamadas autenticadas a Django.
- `frontend/js/workspace.js`: punto de entrada ES module del espacio docente; `modules/core/api.js` inicializa y expone el cliente como dependencia modular. El espacio docente usa `assets/css/workspace.css`, un bundle CSS nativo que conserva el orden de cascada de sus seis hojas originales y se sirve comprimido por WhiteNoise.
- `frontend/js/modules/`: capas `core`, `data`, `features` y `events`; cada dominio mantiene sus vistas y operaciones.
- `backend/`: Django REST Framework, autenticación JWT Supabase, permisos, reglas de negocio, integración IA y servicio del frontend con WhiteNoise. Las vistas API están agrupadas en `apps/core/api_views/` por dashboard, catálogo y entregas/correcciones; `apps/core/views.py` conserva el punto de importación compatible.
- `docs/`: contratos y decisiones técnicas.

## Requisitos

- Python 3.12 (backend).
- PostgreSQL/Supabase con el esquema `public` existente.
- Cuenta/proyecto Supabase Auth.
- Proveedor IA configurado en servidor para generación real. Por defecto, `mock` es sólo demostrativo.
- Para producción, un único Render Web Service sirve frontend y backend. Para preview local separado, Python 3 puede servir el frontend estático.

No se necesita `npm install`, `npm run build` ni `node_modules` para ejecutar el frontend.

## Ejecución local

### 1. Backend

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Completá `backend/.env` con `DJANGO_SECRET_KEY`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` si corresponde y la configuración Gemini. `backend/.env` está excluido de Git. En modo integrado, Django sirve el sitio y la API desde `http://127.0.0.1:8000`.

Iniciá la aplicación integrada:

```powershell
python manage.py runserver 127.0.0.1:8000
```

La API queda en `http://127.0.0.1:8000/api`. `GET /api/client-config/` entrega únicamente `SUPABASE_URL` y la clave pública anon. La API key Gemini y todos los secretos permanecen en el backend.

### 2. Frontend HTML5

El frontend nativo no necesita instalar paquetes ni compilarse. En otra terminal, desde la raíz del repositorio:

```powershell
py -m http.server 5500 --directory frontend
```

Abrí:

- Sitio público: `http://localhost:5500/`
- Acceso: `http://localhost:5500/acceso.html`
- Cómo funciona: `http://localhost:5500/como-funciona.html`
- Nosotros y contacto: `http://localhost:5500/nosotros.html`
- Espacio docente: `http://localhost:5500/espacio-docente/`

Para un preview estático en `localhost:5500`, `config.js` apunta al backend local `127.0.0.1:8000`. En producción, detecta el mismo origen y usa `/api`; no hay que configurar una URL interna.

## Funcionalidades conectadas

### Sitio público

- Portada, presentación, preguntas frecuentes y demostración visual.
- Registro e inicio de sesión por Supabase Auth.
- Confirmación de correo y recuperación/restablecimiento de contraseña.
- Formulario de contacto público persistido en `public.contact_message`; el backend determina `user_id`, `source` y estado, y no acepta notas ni campos administrativos del cliente.

### Espacio docente

- Resumen y actividad de cuenta.
- Cursos: alta, edición, archivado/reactivación y detalle.
- Estudiantes: alta, edición, activación, importación CSV y matrículas.
- Evaluaciones: creación, edición, consignas, material de referencia y propuestas de consignas asistidas por IA.
- Rúbricas: CRUD de rúbricas, criterios, niveles y generación asistida.
- Entregas: texto/archivo, vinculación de estudiante, respuestas por consigna y detalle.
- Correcciones: generar propuesta, revisar y editar criterios/evidencias, ajustar puntajes con motivo, aprobar con trazabilidad y exportar/compartir devolución.
- Perfil de identidad y cierre de sesión.

### Administración

- Administradores globales: perfiles asociados a identidades Supabase existentes, instituciones, membresías, mensajes de contacto, proveedores IA y auditoría.
- Administradores institucionales: consulta acotada de sus instituciones, gestión de sus miembros y edición limitada de nombre/contacto.
- Administradores de departamento: consulta acotada a la membresía propia porque el esquema actual no contiene un `department_id` que permita aislar grupos departamentales.
- No se crean usuarios Auth desde la interfaz: para invitar identidades nuevas hace falta una acción segura del lado servidor con Supabase Auth Admin.

## Comportamiento IA y revisión humana

La IA propone; el docente decide. El proveedor `mock` produce propuestas de demostración no aprobables como calificaciones. La configuración de despliegue selecciona Gemini (`gemini-3.5-flash-lite`), limita cada llamada a un máximo de 18 segundos y guarda `GEMINI_API_KEY` exclusivamente en el backend. Activar el procesamiento externo sólo después de revisar condiciones, informar a usuarios y confirmar el nivel pago del proyecto. Si hay una fila activa en `public.ai_provider_config`, ésta prevalece sobre el proveedor del entorno. No utilizar respuestas reales de estudiantes con tiers que permitan entrenamiento del proveedor.

Los datos de práctica se crean mediante `POST /api/demo/seed/` bajo confirmación explícita y se identifican como ficticios. No son datos de producción ni una autenticación simulada del frontend.

## Esquema de datos y migraciones

El esquema físico existente `public.*` de PostgreSQL/Supabase es la fuente de verdad. Django mapea los modelos con `db_table` y `managed = False`; el dominio `core` no debe reconstruirse mediante migraciones Django. No ejecutar `migrate`, `makemigrations` ni `--fake` para reconstruir tablas de negocio. Para Shared Pooler en modo transacción, settings desactiva el auto-prepare de psycopg.

Verificación de sólo lectura:

```powershell
cd backend
python manage.py verify_public_schema
```

La herramienta contrasta tablas, columnas, tipos, identidades, FK compuestas, índices y triggers con el esquema esperado. No cambia la base.

## Pruebas y chequeos

Chequeo frontend estático (no requiere npm ni dependencias de frontend). Valida referencias HTML, rutas de imports, correspondencia entre imports nombrados/exports y sintaxis JavaScript si Node.js está instalado:

```powershell
python scripts/check_static_frontend.py
```

El chequeo valida referencias locales, imports ES modules, exports nombrados y sintaxis JavaScript si Node.js está instalado.

Verificador estructural de imports relativos y símbolos locales del backend (no requiere instalar Django):

```powershell
python scripts/check_backend_imports.py
```

Chequeos backend, en un entorno Python con las dependencias instaladas y PostgreSQL de prueba (la suite no debe apuntar a Supabase de producción):

```powershell
cd backend
python -m compileall -q config apps manage.py
python ../scripts/check_backend_imports.py
python manage.py check
pytest -q
```

La suite backend usa PostgreSQL y un esquema de prueba separado. No apunta a Supabase de producción. Las pruebas contra la instancia real requieren una conexión configurada y una ventana controlada.

## Despliegue en Render

El `render.yaml` despliega un único Web Service Python: Django sirve el frontend y la API desde el mismo origen. No hay servicio estático separado ni build de Node. Configurá `DATABASE_URL` con Shared Pooler IPv4 de Supabase cuando Render no tenga IPv6; para este backend persistente, preferí session mode (puerto 5432) y copiá la URI exacta desde Supabase > Connect. Configurá Supabase URL/anon key/JWT secret y `GEMINI_API_KEY` sólo en el backend. `AI_EXTERNAL_PROCESSING_APPROVED` y `AI_GEMINI_PAID_TIER_CONFIRMED` quedan sin valor por defecto: activalos únicamente después de aprobar el tratamiento externo y confirmar que el proyecto usa un nivel compatible con datos estudiantiles. Confirmá Site URL y Redirect URLs de Supabase Auth para el dominio de producción y el origen local `http://localhost:5500`.

No habilites despliegue final hasta comprobar login, logout, recuperación de contraseña, contacto, CRUD docente, aislamiento de dos propietarios, permisos administrativos y generación IA real con una configuración de privacidad aprobada.

## Límites conocidos

- No se implementa portal de estudiantes ni rendición de exámenes en línea.
- No hay invitación/creación de Auth users en la API actual.
- Los administradores de departamento sólo pueden acceder a su membresía; falta modelar departamentos para ampliar esa gestión de forma segura.
- La edición de datos personales del perfil se mantiene de sólo lectura porque no existe una ruta API específica.
- OCR manuscrito, detección de plagio, pagos y analítica institucional avanzada quedan fuera del MVP.
- Las páginas de privacidad y términos son referencias informativas del MVP y requieren revisión legal antes de su publicación como documentos vinculantes.

## Documentos

- `docs/API.md`: contrato de API.
- `docs/FRONTEND-ARCHITECTURE.md`: organización modular del frontend.
- `docs/BACKEND-ARCHITECTURE.md`: límites de módulos, dependencias y persistencia del backend.
- `docs/AUDITORIA-TECNICA-v1.0.1.md`: evaluación, cambios y riesgos de la versión anterior.
- `docs/AUDITORIA-TECNICA-v1.0.2.md`: diagnóstico y mejoras de carga inicial, concurrencia, guía, estadísticas, IA y Supabase aplicadas en esta versión.
- `backend/database/migrations/20261105202119_maestria_v1_0_2_hardening.sql`: registro de la migración aplicada en Supabase.
- `docs/AUDITORIA-TECNICA-2026-11-05.md`: hallazgos, cambios y riesgos pendientes.
- `docs/ADAPTACION-DJANGO-POSTGRESQL-SUPABASE-2026-11-04.md`: adaptación del ORM, permisos, migraciones y administración.
- `docs/AI-EVALUATION-v0.2.0.md`: evaluación IA con datos sintéticos.

## Despliegue

La configuración lista para Render está en `render.yaml`: un solo Web Service sirve frontend + backend. Seguí `docs/DEPLOYMENT-v0.2.0.md` para completar las variables privadas y la configuración de Supabase/Gemini. No cargar `backend/.env` en Git.


## Frontend v1.0.3

El frontend se organiza en cuatro carpetas: `frontend/html`, `frontend/css`, `frontend/js` y `frontend/assets`. Django sirve las páginas HTML desde `html/`; WhiteNoise publica CSS/JS bajo `/assets/css/` y `/assets/js/`, y las imágenes bajo `/assets/`.

Validaciones: `npm run check:frontend` ejecuta los chequeos de referencias, módulos y contrato del flujo docente.
