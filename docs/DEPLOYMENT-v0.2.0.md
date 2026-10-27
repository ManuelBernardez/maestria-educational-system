# Despliegue recomendado — MaestrIA v0.2.0

## Servicios

- **Vercel:** frontend Next.js, `Root Directory: frontend`.
- **Render:** API Django, `Root Directory: backend`, Blueprint en `render.yaml`.
- **Supabase:** Auth + PostgreSQL. Usar el mismo proyecto en frontend y backend.
- **Gemini:** habilitar solo después de revisar privacidad y nivel de cuenta; nunca poner la API key en Vercel ni en una variable `NEXT_PUBLIC_*`.

## 1. Preparar Supabase

1. Crear proyecto nuevo para staging/MVP.
2. Copiar la URL del proyecto y una clave pública/anon de Supabase para el cliente.
3. Copiar la URI de PostgreSQL desde **Connect** y guardarla como secreto en Render. En contraseña con `@`, `:`, `/`, `#` o `%`, usar URL encoding; no compartir la URI completa.
4. Crear primero la base de datos vacía del proyecto. Las migraciones crean tablas `core_*` y las referencias a `auth.users`.
5. No pegar `database/schema.sql` como bootstrap. Las migraciones son la fuente ejecutable de verdad.

## 2. Desplegar API en Render

1. Subir el repositorio a GitHub.
2. En Render elegir **New → Blueprint** y seleccionar el repositorio que contiene `render.yaml`.
3. La plantilla usa un servicio Starter porque `preDeployCommand` ejecuta `python manage.py migrate --noinput`; Render documenta pre-deploy para migraciones y lo ofrece en servicios pagos. Si se cambia el plan, respetar esta limitación.
4. Cargar los secretos marcados como `sync: false`: `DATABASE_URL`, `SUPABASE_URL`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS` y `CSRF_TRUSTED_ORIGINS`. De ser necesario para JWTs HS256 antiguos, configurar `SUPABASE_JWT_SECRET` de forma privada.
5. La API arranca con `AI_PROVIDER=mock`. Verificar `https://maestria-api.onrender.com/api/health/` y revisar logs sin pegar secretos.
6. CORS debe contener el origen exacto de producción, por ejemplo `https://maestria.vercel.app` (o el dominio elegido). No poner `*`.
7. Luego de migrar, ejecutar `database/diagnostico-pendientes-v0.2.0.sql` desde Supabase SQL Editor y comprobar constraints.

## 3. Desplegar frontend en Vercel

1. Importar el repositorio desde Vercel y seleccionar `frontend/` como directorio raíz.
2. Configurar las variables:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable-or-anon-key>
   NEXT_PUBLIC_API_URL=https://maestria-api.onrender.com/api
   NEXT_PUBLIC_SITE_URL=https://<dominio-produccion>
   ```

3. No subir ni colocar aquí `DATABASE_URL`, `DJANGO_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ni `GEMINI_API_KEY`.
4. En Supabase Auth configurar Site URL y Redirect URLs para el dominio de Vercel y `http://localhost:3000/**` para desarrollo. Agregar dominios de preview solo si se decide probarlos.
5. Ajustar `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS` y `CSRF_TRUSTED_ORIGINS` en Render al dominio final. Después redeploy de API.

## 4. Habilitar Gemini

1. Mantener `AI_PROVIDER=mock` mientras se valida login y aislamiento de cuentas.
2. Generar una key de Gemini y guardarla solo en el entorno del backend.
3. Primero correr la evaluación sintética siguiendo `docs/AI-EVALUATION-v0.2.0.md`.
4. Para contenido docente/estudiantil real, verificar que el proyecto usa nivel pago y revisar términos/retención; luego configurar `AI_EXTERNAL_PROCESSING_APPROVED=True` y `AI_GEMINI_PAID_TIER_CONFIRMED=True`. No usar el nivel gratuito con respuestas reales: Google señala que en el nivel gratuito el contenido puede usarse para mejorar productos.
5. Definir límites de gasto/cuota en la cuenta de Google y revisar tiempos, fallos y costos antes de ampliar uso.

## 5. Lista de humo antes de abrir al público

- [ ] La API responde `/api/health/` y reporta la configuración sin revelar variables sensibles.
- [ ] Una cuenta docente se registra, inicia sesión y recupera acceso.
- [ ] Dos cuentas separadas no pueden leer/editar/exportar datos entre sí.
- [ ] Crear curso, evaluación, pregunta, rúbrica y entrega de prueba.
- [ ] Con `mock`, la propuesta se etiqueta como demostrativa y no se puede presentar como corrección real.
- [ ] Con Gemini y casos sintéticos, el benchmark guarda un JSON y no registra la API key.
- [ ] Aprobar una propuesta, corregir un puntaje y comprobar que se registra la revisión.
- [ ] Revisar exportación y probar fallos de los canales de envío.
- [ ] Confirmar backups, restauración, política de baja de cuenta y privacidad antes de usar estudiantes reales.

## Documentación oficial

- Next.js deployment: https://nextjs.org/docs/app/getting-started/deploying
- Vercel / Next.js: https://vercel.com/frameworks/nextjs
- Render Django: https://render.com/docs/deploy-django
- Render pre-deploy command: https://render.com/docs/deploys
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
