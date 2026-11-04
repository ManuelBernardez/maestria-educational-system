# Despliegue — MaestrIA en un único servicio

Esta versión publica el sitio HTML5, el espacio docente y la API Django bajo **un mismo dominio**. Django sirve las páginas; WhiteNoise sirve los recursos de `frontend/assets`; `/api/` atiende la API. No se despliega un Static Site separado ni se necesita `API_INTERNAL_URL`.

## Arquitectura

- **Render Web Service:** frontend HTML5 + Django REST Framework en un solo servicio.
- **Supabase:** Auth + PostgreSQL. El esquema `public.*` existente sigue siendo la fuente de verdad.
- **Gemini:** invocado exclusivamente desde el backend; la API key no llega al navegador.

La decisión de unificar simplifica el MVP y elimina CORS en producción. Render recomienda separar servicios para mayor aislamiento y escalabilidad; si el tráfico crece, se puede separar el frontend sin modificar el modelo de datos ni exponer secretos. Ver [Render: Django](https://render.com/docs/deploy-django) y [Render: Web Services](https://render.com/docs/web-services).

## 1. Configurar Supabase

1. Confirmar que el proyecto contiene el esquema MaestrIA esperado y ejecutar `python manage.py verify_public_schema` desde un entorno con acceso a PostgreSQL.
2. Copiar la URI PostgreSQL de Supabase a `DATABASE_URL`. Preferir el pooler de Supabase si la conectividad directa no está disponible desde el hosting. Codificar caracteres reservados de la contraseña en formato URL.
3. Configurar Supabase Auth → URL Configuration:
   - Site URL: `https://<dominio-final>`.
   - Redirect URLs: `https://<dominio-final>/*` y `http://localhost:5500/*` para desarrollo.
4. `SUPABASE_URL` y `SUPABASE_ANON_KEY` son valores públicos de cliente. No usar nunca la clave `service_role` en el navegador. Mantener RLS y políticas correctas.

## 2. Desplegar en Render (un solo servicio)

1. Subir el repositorio completo a un repositorio privado de Git. El `.gitignore` excluye `backend/.env` y otros archivos `.env`.
2. En Render, crear **New → Blueprint** y seleccionar el repositorio con `render.yaml`, o crear un Web Service manualmente.
3. Si se configura manualmente:
   - Runtime: Python.
   - Root Directory: vacío (raíz del repositorio).
   - Build Command: `pip install -r backend/requirements-prod.txt && cd backend && python manage.py collectstatic --noinput`.
   - Start Command: `cd backend && gunicorn config.wsgi:application --bind 0.0.0.0:$PORT --workers 2 --timeout 90 --access-logfile - --error-logfile -`.
   - Health Check Path: `/api/health/`.
4. En Environment, completar las variables privadas de la sección siguiente. `DJANGO_SECRET_KEY` puede generarse desde Render.
5. Deploy. La página principal será `/`, el acceso `/acceso.html` y el espacio docente `/espacio-docente/`. La API estará bajo `/api/`.
6. En Supabase Auth, actualizar Site URL y Redirect URLs con el dominio real asignado por Render.

El nombre del servicio puede variar si `maestria` ya está ocupado. En ese caso, el dominio final también cambia; usar el hostname real de Render en `SITE_URL` y Supabase Auth. Render proporciona `RENDER_EXTERNAL_HOSTNAME`, que Django incorpora automáticamente a `ALLOWED_HOSTS`.

## 3. Variables de entorno de producción

Cargarlas en Render → servicio → Environment. No agregarlas al repositorio.

| Variable | Valor / procedencia |
|---|---|
| `DEBUG` | `False` |
| `DJANGO_SECRET_KEY` | Generada por Render; privada y larga |
| `ALLOWED_HOSTS` | Dominio Render, sin `https://`; el hostname Render también se detecta automáticamente |
| `SITE_URL` | `https://<dominio-final>` |
| `FRONTEND_URL` | Igual a `SITE_URL` por compatibilidad |
| `DATABASE_URL` | URI PostgreSQL Supabase, privada |
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_ANON_KEY` | Clave pública anon/publishable |
| `SUPABASE_JWT_SECRET` | Secreto privado, sólo si el método JWT actual lo requiere |
| `AI_PROVIDER` | `gemini` |
| `GEMINI_API_KEY` | API key privada de Google AI Studio / Gemini |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
| `AI_TIMEOUT_SECONDS` | `35` |
| `AI_EXTERNAL_PROCESSING_APPROVED` | `True` sólo después de aprobar y documentar el procesamiento externo |
| `AI_GEMINI_PAID_TIER_CONFIRMED` | `True` únicamente si se verificó el nivel pago del proyecto Gemini |
| `AI_GEMINI_FREE_TIER_SYNTHETIC_EVAL` | `False` |
| `AI_MAX_CONCURRENT_ANSWERS` | `3` |

En este despliegue de mismo origen, no hace falta definir `API_INTERNAL_URL`, `MAESTRIA_API_URL`, `CORS_ALLOWED_ORIGINS` ni `CSRF_TRUSTED_ORIGINS` para producción. El navegador utiliza automáticamente `https://<dominio-final>/api`. Los valores CORS locales del `.env.example` son para el preview estático independiente.

## 4. Configurar Gemini y privacidad

1. Crear una API key de Gemini y guardarla sólo en `GEMINI_API_KEY` dentro del entorno del servicio Render o en `backend/.env` local.
2. Configurar `AI_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.5-flash-lite` y `AI_TIMEOUT_SECONDS=35`.
3. `AI_EXTERNAL_PROCESSING_APPROVED=True` es una confirmación operativa: antes de activarla, informar a docentes/usuarios qué datos se envían a Google, con qué finalidad y bajo qué condiciones.
4. `AI_GEMINI_PAID_TIER_CONFIRMED=True` no cambia el plan de Google: sólo debe reflejar que el proyecto realmente está en un nivel pago. El nivel gratuito no debe usarse con contenido identificable o respuestas reales de estudiantes.
5. Minimizar datos enviados al modelo: no incluir nombres, correos, documentos de identidad ni otros identificadores en consignas/respuestas. Aplicar retención limitada y controles de acceso.
6. Si existe una fila habilitada en `public.ai_provider_config`, esa configuración de base de datos tiene prioridad sobre `AI_PROVIDER` y puede sobrescribir proveedor/modelo/timeout. Revisar el panel de administración de proveedores IA y seleccionar Gemini o deshabilitar la fila para usar los valores del entorno.
7. La IA genera propuestas; el docente debe revisar y aprobar el resultado. No tratar la salida como calificación automática.

La clave de Gemini nunca se incluye en `GET /api/client-config/`. Ese endpoint sólo devuelve la URL de Supabase y su clave pública anon.

## 5. Desarrollo local

### Opción A — igual que producción (recomendada)

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
# Completar backend/.env y arrancar desde backend/
python manage.py runserver 127.0.0.1:8000
```

Abrir `http://127.0.0.1:8000/`. El backend sirve el frontend y la API bajo el mismo origen.

### Opción B — preview estático independiente

Desde la raíz del repositorio, ejecutar `py -m http.server 5500 --directory frontend` y abrir `http://localhost:5500/`. En ese caso `config.js` usa automáticamente `http://127.0.0.1:8000/api` y CORS local queda habilitado.

## 6. Esquema y persistencia

- No ejecutar `migrate`, `makemigrations` ni `--fake` para reconstruir tablas de dominio: Supabase administra el esquema `public.*`.
- El sistema de archivos de Render no debe usarse para guardar entregas permanentes. Los datos deben persistir en Supabase; el frontend y sus assets son parte del despliegue.
- Ejecutar `python manage.py verify_public_schema` antes de producción y después de cambios de esquema acordados.

## 7. Checklist previo a producción

- [ ] `backend/.env` local está ignorado por Git; ningún secreto fue subido al repositorio.
- [ ] `DEBUG=False`, `DJANGO_SECRET_KEY` robusta y `DATABASE_URL` real.
- [ ] Supabase Auth Site URL / Redirect URLs apuntan al dominio final.
- [ ] `verify_public_schema` confirma tablas, columnas y restricciones.
- [ ] RLS y políticas Supabase verificadas; nunca se usa `service_role` en frontend.
- [ ] Se confirmó el nivel pago de Gemini antes de habilitar `AI_GEMINI_PAID_TIER_CONFIRMED=True`.
- [ ] Aviso de privacidad informa procesamiento externo por Gemini; se minimizan los datos enviados.
- [ ] No hay una fila `mock` habilitada en `ai_provider_config` si se espera usar Gemini.
- [ ] Login, recuperación, roles y aislamiento entre usuarios probados con cuentas separadas.
- [ ] Correcciones IA se revisan antes de aprobarlas.
- [ ] Backups y procedimiento de restauración de Supabase comprobados.
