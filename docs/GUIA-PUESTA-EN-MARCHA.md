# Guía completa de MaestrIA: configuración, ejecución y uso

Esta guía está pensada para integrantes que recién empiezan a trabajar con el proyecto. Seguí el orden indicado; no hace falta configurar todos los servicios externos para empezar a desarrollar.

## 0. Qué estamos construyendo

- **Frontend:** Next.js + React + TypeScript (`frontend/`).
- **Backend:** Django + Django REST Framework (`backend/`).
- **Identidad:** Supabase Auth; el frontend inicia sesión y la API valida el access token.
- **Base de datos:** PostgreSQL gestionado por Supabase en un entorno compartido; SQLite puede usarse para una prueba local aislada.
- **IA:** adaptador intercambiable (`mock`, `openai` u `ollama`). `mock` es solo demostración.
- **Entrega:** se puede compartir una devolución aprobada desde las aplicaciones locales de correo o WhatsApp, copiar el texto o guardarla como PDF desde la impresión del navegador. No hay envío automático.

> Importante: esta versión es una base de MVP. No uses datos identificables de estudiantes reales hasta completar las pruebas de autorización, privacidad, restauración y despliegue. Las propuestas en modo `mock` nunca son calificaciones reales.

## 1. Instalar herramientas

Instalá:

1. **Git**.
2. **Visual Studio Code**.
3. **Python 3.12** (Python 3.11 también puede servir, pero el equipo debe acordar una versión única).
4. **Node.js 22 LTS** y npm.
5. Una cuenta de Supabase.

Extensiones útiles de VS Code: Python, Pylance, ESLint, Prettier y GitLens. No son necesarias para ejecutar la aplicación, pero ayudan a trabajar en equipo.

Comprobá en una terminal:

```bash
git --version
python --version
node --version
npm --version
```

En Windows, si `python` no funciona, probá `py --version`. En VS Code abrí **Terminal → New Terminal**.

## 2. Abrir el proyecto y preparar variables

1. Descargá y extraé el ZIP o cloná el repositorio del equipo.
2. En VS Code elegí **File → Open Folder** y abrí la carpeta raíz `maestria-starter`.
3. Copiá `frontend/.env.example` a `frontend/.env.local`.
4. Copiá `backend/.env.example` a `backend/.env`.
5. No agregues esos archivos locales a Git. El `.gitignore` debe excluirlos.

Los archivos `.env.example` son plantillas: reemplazá los valores de ejemplo por los tuyos, pero no compartas claves por chat ni las guardes en el repositorio.

## 3. Crear el proyecto de Supabase

### 3.1 Crear el proyecto

1. Ingresá a [Supabase](https://supabase.com/) y creá una organización si todavía no tenés una.
2. Creá un proyecto, por ejemplo `maestria-dev`.
3. Elegí una contraseña fuerte para la base de datos y guardala en un gestor de contraseñas.
4. Elegí la región más conveniente para el equipo y los usuarios. Para docentes en Argentina, compará latencia y disponibilidad regional antes de decidir.
5. Esperá a que el proyecto termine de inicializarse.

### 3.2 Obtener URL y clave pública

En el panel de Supabase, abrí **Project Settings → API** (la ubicación de las etiquetas puede variar según la versión del panel). Copiá:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`.
- Publishable key o la clave pública `anon` heredada → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Pegalas en `frontend/.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=TU_CLAVE_PUBLICA
NEXT_PUBLIC_API_URL=http://127.0.0.1:8000/api
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

La clave pública está diseñada para usarse en el navegador con las políticas adecuadas. **Nunca pongas la `service_role` key, la contraseña de PostgreSQL, `OPENAI_API_KEY` ni el secreto JWT en variables `NEXT_PUBLIC_*`.**

### 3.3 Configurar Auth

1. En Supabase abrí **Authentication → Providers** y comprobá que Email esté habilitado.
2. En **Authentication → URL Configuration**, configurá:
   - Site URL de desarrollo: `http://localhost:3000`.
   - Redirect URL permitida: `http://localhost:3000/**`.
   - Cuando exista el dominio público, agregalo como URL permitida y definí el Site URL de producción.
3. En **Authentication → Settings** revisá la confirmación por correo. Para un prototipo podés mantenerla habilitada; en ese caso el usuario debe confirmar el correo antes de iniciar sesión si así lo exige la configuración.
4. Probá crear una cuenta con un correo propio y una contraseña fuerte.
5. Configurá recuperación de contraseña y plantillas de correo antes de un piloto real.

Este starter ofrece registro e inicio de sesión con email/contraseña. El proyecto incluye pantallas iniciales para solicitar y completar una recuperación (`/recuperar-clave` y `/restablecer-clave`). Configurá ambas URL en Supabase Auth Redirect URLs y probá correo, vencimiento del enlace y cambio de contraseña antes de invitar usuarios externos.

### 3.4 Obtener la conexión PostgreSQL

1. En Supabase abrí **Project Settings → Database** o el panel **Connect**.
2. Copiá la cadena de conexión PostgreSQL. Para una API desplegada, preferí una modalidad compatible con conexiones persistentes (por ejemplo, Session Pooler cuando corresponda). La disponibilidad de conexión directa puede depender de IPv4/IPv6 y del entorno de hosting.
3. Reemplazá los valores de ejemplo y guardá la cadena solo en `backend/.env` como `DATABASE_URL`.

Ejemplo orientativo, no lo copies literalmente:

```dotenv
DATABASE_URL=postgresql://USUARIO:CONTRASENA@HOST:PUERTO/BASE?sslmode=require
```

Si la contraseña contiene caracteres especiales, usá la cadena de conexión que genera Supabase o codificá correctamente esos caracteres. No compartas la URL: contiene credenciales.

**No crees las tablas manualmente en el SQL Editor.** Django las crea y actualiza mediante migraciones. Si usás Supabase como PostgreSQL, Django sigue siendo el dueño de las migraciones de las tablas de la aplicación.

#### Diagnóstico: `password authentication failed for user "postgres"`

Este error significa que PostgreSQL recibió la conexión y rechazó la contraseña del usuario indicado. No lo resuelvas cambiando migraciones ni pegando otra contraseña al azar:

1. En Supabase, abrí **Connect** y copiá la URI de PostgreSQL completa del proyecto correcto. No combines fragmentos de dos URIs; debe existir un solo `postgresql://`, un solo conjunto `usuario:contraseña@host:puerto` y una única ruta `/postgres`.
2. La contraseña es la contraseña de la **base de datos**, no la de tu cuenta de Supabase, la `anon`/publishable key, la `service_role` key ni el secreto JWT. Si no la recordás, restablecela en los ajustes de Database y actualizá `backend/.env`.
3. La conexión directa suele usar el usuario `postgres` y el puerto `5432`. Si elegís un pooler, usá exactamente el nombre de usuario, hostname y puerto que muestra Supabase; el usuario puede incluir la referencia del proyecto.
4. Si la contraseña tiene caracteres reservados (`@`, `:`, `/`, `#`, `%`), copiá la URI generada o aplicá URL encoding a la contraseña. No codifiques dos veces una URI que Supabase ya generó.
5. Guardá una única variable `DATABASE_URL` en `backend/.env`, reiniciá Django y probá `python manage.py check` y luego `python manage.py migrate`.

Ejemplo de estructura (no usar literalmente):

```dotenv
DATABASE_URL=postgresql://postgres:CONTRASENA_CODIFICADA@db.REFERENCIA_DEL_PROYECTO.supabase.co:5432/postgres?sslmode=require
```

No pegues tu `DATABASE_URL` completa en tickets, chats ni repositorios. Si el error persiste tras restablecer la contraseña, verificá que el proyecto y el host coincidan y que no exista una variable de entorno antigua sobrescribiendo el archivo `.env`.


### 3.5 Configurar el backend para validar Supabase Auth

En `backend/.env` definí al menos. Para generar una clave aleatoria localmente podés ejecutar `python -c "import secrets; print(secrets.token_urlsafe(50))"` y copiar el resultado solo en tu archivo `.env` (no lo compartas ni lo subas a Git):

```dotenv
DJANGO_SECRET_KEY=generá-una-clave-aleatoria-larga
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1
DATABASE_URL=TU_URL_POSTGRESQL_DE_SUPABASE
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_JWT_SECRET=
CORS_ALLOWED_ORIGINS=http://localhost:3000
CSRF_TRUSTED_ORIGINS=http://localhost:3000
AI_PROVIDER=mock
```

`SUPABASE_URL` debe coincidir exactamente con la URL del proyecto. El backend valida el token mediante JWKS para claves asimétricas; `SUPABASE_JWT_SECRET` solo corresponde a proyectos/configuraciones que todavía firman tokens con HS256 y debe manejarse como secreto. No copies la clave pública en ese campo.

## 4. Levantar el backend Django

Desde la carpeta raíz:

### Windows PowerShell

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python manage.py check
# Prueba la conexión configurada sin imprimir la URL ni las credenciales:
python manage.py shell -c "from django.db import connection; connection.ensure_connection(); print('Conexión a la base de datos OK')"
python manage.py migrate
python manage.py runserver 127.0.0.1:8000
```

Si PowerShell impide activar el entorno, podés ejecutar los binarios directamente (`.venv\Scripts\python.exe`) o ajustar la política de ejecución solo para tu usuario según las normas de tu equipo.

### macOS / Linux

```bash
cd backend
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python manage.py check
# Prueba la conexión configurada sin imprimir la URL ni las credenciales:
python manage.py shell -c "from django.db import connection; connection.ensure_connection(); print('Conexión a la base de datos OK')"
python manage.py migrate
python manage.py runserver 127.0.0.1:8000
```

La primera ejecución crea las tablas de la aplicación. Con Supabase, verificá que `DATABASE_URL` apunte al proyecto correcto antes de ejecutar migraciones.

Comprobá en el navegador o con curl:

- `http://127.0.0.1:8000/api/health/` → respuesta de salud pública.
- Las rutas privadas requieren un token válido de Supabase; no se deben probar desde el navegador sin iniciar sesión.

En VS Code: `Ctrl+Shift+P` → **Python: Select Interpreter** → elegí `backend/.venv`.

## 5. Levantar el frontend Next.js

Abrí una **segunda terminal** en VS Code. Dejá el backend corriendo en la primera.

```bash
cd frontend
npm install
npm run dev
```

Abrí [http://localhost:3000](http://localhost:3000). Si modificás `.env.local`, reiniciá el servidor de desarrollo para que Next.js recargue las variables.

### Flujo básico para probar

1. Entrá a `/login` y registrá una cuenta.
2. Confirmá el correo si Supabase lo exige.
3. Iniciá sesión.
4. Creá una evaluación con materia, nivel y objetivos.
5. Agregá una pregunta manual o pedí una propuesta de preguntas.
6. Generá una rúbrica sugerida, editá los criterios y guardala.
7. Cargá una respuesta de prueba, preferentemente ficticia.
8. Generá una propuesta de corrección.
9. Revisá puntuaciones, justificaciones, evidencias y devolución.
10. Aprobá la corrección; luego probá copiar, compartir desde correo/WhatsApp o imprimir para guardar PDF. El historial también permite exportar Markdown.
11. Volvé al panel: revisá métricas y actividad reciente.

Con `AI_PROVIDER=mock`, la interfaz muestra datos simulados para probar el flujo. La aplicación debe identificar claramente ese estado y bloquear la aprobación y el uso compartido de resultados simulados.

## 6. Configurar IA

### Opción A: modo demo sin API externa

En `backend/.env`:

```dotenv
AI_PROVIDER=mock
```

Reiniciá Django. Es el modo más seguro para que todos puedan trabajar sin compartir claves ni incurrir en costes. Las salidas son simuladas; no sirven para evaluar estudiantes.

### Opción B: OpenAI API

1. Creá una API key desde la cuenta/proyecto de OpenAI que corresponda.
2. Definí un límite de gasto y revisá las políticas de datos antes de enviar contenido educativo.
3. Agregá en `backend/.env`:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=TU_API_KEY
OPENAI_MODEL=gpt-4o-mini
AI_TIMEOUT_SECONDS=60
```

4. Reiniciá Django y probá con respuestas sintéticas.

No se debe usar la API key del navegador. La llamada sale desde el backend. El nombre del modelo es configurable y debe verificarse con los modelos disponibles en la cuenta al momento de integrar.

### Opción C: Ollama local

1. Instalá Ollama en la máquina que ejecutará el modelo.
2. Descargá un modelo que el hardware pueda ejecutar; el tamaño adecuado se define mediante benchmark.
3. Verificá que el servicio local responda en `http://localhost:11434`.
4. Configurá:

```dotenv
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
AI_TIMEOUT_SECONDS=120
```

`localhost` se refiere a la máquina donde corre Django, no a la computadora del docente si el backend está desplegado. Un backend remoto no puede acceder al Ollama de la PC de un usuario mediante esa URL. Para producción local, hay que diseñar la infraestructura de inferencia y acceso de red explícitamente.

## 7. Compartir y guardar devoluciones

El espacio de corrección permite compartir una devolución **solo después de aprobarla**. No se realiza un envío desde el servidor ni se necesitan credenciales de correo o WhatsApp para estas acciones:

- **Correo:** abre un borrador `mailto:` con asunto y devolución; podés corregir el destinatario y el texto antes de enviarlo.
- **WhatsApp:** abre WhatsApp con el texto preparado; elegís el destinatario y confirmás el envío dentro de la aplicación.
- **Copiar:** lleva el texto de la devolución al portapapeles cuando el navegador lo permite.
- **PDF:** abre la impresión del navegador. Elegí «Guardar como PDF» en el diálogo del sistema.

Estas acciones dependen de que el dispositivo tenga una aplicación compatible y el navegador permita la acción. No se debe mostrar «enviado» porque el usuario haya abierto un borrador. Las variables SMTP del backend, si se configuran, son opcionales y se usan solo para avisos del formulario público de contacto (`CONTACT_NOTIFY_EMAIL`), no para enviar devoluciones a estudiantes.

## 8. Importación CSV de alumnos

La importación admite CSV UTF-8 de hasta 2 MB y 500 filas por operación. La columna `name` es obligatoria; `email`, `phone` y `external_code` son opcionales.

Ejemplo `alumnos.csv`:

```csv
name,email,phone,external_code
Ana Pérez,ana@example.test,5491100000001,A001
Luis Gómez,luis@example.test,5491100000002,A002
```

Los correos y teléfonos del ejemplo son ficticios. Revisá el resumen de filas creadas y omitidas. Antes de una importación grande, hacé una prueba con dos filas y comprobá los duplicados.

## 9. Ejecutar pruebas y comprobar calidad

Backend (con el entorno virtual activo):

```bash
cd backend
python manage.py check
python manage.py test
```

Frontend:

```bash
cd frontend
npm run lint
npm run build
```

Si el script de lint de la versión instalada de Next.js no está disponible, usá `npx tsc --noEmit` y el comando de ESLint compatible con la versión fijada en `package.json`; corregí el script del proyecto en un commit separado para que todos usen el mismo comando.

Pruebas manuales obligatorias antes de mostrarlo:

- Cuenta A no puede ver evaluaciones, alumnos ni correcciones de cuenta B.
- Sin sesión, los endpoints privados responden `401`.
- No se puede aprobar una corrección si el puntaje supera el máximo de un criterio.
- La evidencia que se aprueba debe coincidir literalmente con la respuesta.
- Las propuestas `demo=true` están señaladas y no se pueden enviar.
- Los errores de IA no muestran claves ni texto de respuestas en logs.
- El diseño se usa con teclado y en pantalla angosta.

## 10. Despliegue recomendado

### Frontend en Vercel

1. Subí el repositorio a GitHub.
2. En Vercel importá el repositorio y configurá `frontend` como Root Directory.
3. Agregá las variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL` (URL pública de la API + `/api`) y `NEXT_PUBLIC_SITE_URL`.
4. Desplegá y comprobá la URL de preview.

### Backend en un servicio Python (Render o equivalente)

1. Creá un Web Service desde el mismo repositorio y definí `backend` como directorio raíz o configurá los comandos desde la raíz.
2. Build: `pip install -r requirements.txt`.
3. Start: `gunicorn config.wsgi:application --bind 0.0.0.0:$PORT` (instalá `gunicorn` en requirements si elegís este comando) o usá un comando equivalente soportado por el proveedor.
4. Configurá todas las variables de `backend/.env` como variables secretas del hosting.
5. En `ALLOWED_HOSTS` agregá el hostname exacto del backend.
6. En `CORS_ALLOWED_ORIGINS` agregá el dominio HTTPS del frontend, sin comodines.
7. Configurá `DEBUG=False`, una `DJANGO_SECRET_KEY` fuerte y `DATABASE_URL` de producción.
8. Ejecutá `python manage.py migrate` una sola vez como paso de release/deploy controlado, no en cada worker.
9. Confirmá `/api/health/`, inicio de sesión y creación/lectura de datos.

### Supabase Auth en producción

Agregá el dominio público del frontend a las URL permitidas. Configurá CORS del backend para ese dominio exacto. Nunca despliegues `DEBUG=True`, la clave `service_role` en el navegador ni archivos `.env`.

### Antes de invitar docentes reales

- Probar permisos con dos cuentas distintas.
- Activar backups y ensayar restauración.
- Revisar retención y eliminación de datos.
- Verificar las condiciones del proveedor de IA y el consentimiento.
- Configurar límites de consumo de IA y alertas de gasto.
- Confirmar que las acciones de compartir solo aparecen para correcciones aprobadas y que las propuestas demostrativas no pueden aprobarse ni compartirse.
- Probar el sistema con docentes colaboradores y datos ficticios antes de migrar datos reales.

## 11. Problemas frecuentes

- **`SUPABASE_URL` no configurada:** revisá `backend/.env` y reiniciá Django.
- **401 al usar la API:** cerrá sesión y volvé a ingresar; comprobá que la URL de Supabase del frontend y backend corresponda al mismo proyecto.
- **CORS:** `CORS_ALLOWED_ORIGINS` debe incluir exactamente el origen del frontend (`http://localhost:3000` en local).
- **Error de conexión a PostgreSQL:** revisá host, puerto, contraseña, SSL y si el proveedor permite conexiones desde tu red.
- **La IA falla:** volvé a `AI_PROVIDER=mock`, reiniciá Django y comprobá que el flujo central funciona. Luego revisá clave, modelo, cuotas y timeout.
- **CSV no se importa:** usá UTF-8, encabezado `name` y separador coma; verificá el límite de tamaño/filas.
- **Variables frontend no cambian:** reiniciá `npm run dev` tras modificar `.env.local`.
- **El backend remoto no llega a Ollama:** la URL `localhost` es relativa al servidor donde corre Django; se requiere una arquitectura de inferencia accesible de forma segura.

## 12. Reglas de equipo

- Cada integrante crea una rama por funcionalidad y abre un PR.
- No subir `.env`, tokens, exportaciones de alumnos ni respuestas reales.
- Cada funcionalidad debe incluir criterios de aceptación y pruebas.
- Las migraciones se versionan y se revisan; no modificar una migración ya aplicada en entornos compartidos.
- Antes de cambiar contratos de API, coordinar frontend/backend.
- `mock` sirve para la demo; no debe confundirse con IA real.
- No incorporar RAG, pgvector, OCR manuscrito, colas o microservicios sin una necesidad demostrada y un criterio de aceptación.


## Diagnóstico de registro y rutas locales

### El frontend muestra “Supabase rechazó el registro”

La pantalla de acceso traduce algunos errores de Supabase Auth a instrucciones más específicas y, para los demás, muestra un código de diagnóstico sin exponer secretos. Revisá lo siguiente en este orden:

1. En `frontend/.env.local`, `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` deben pertenecer al mismo proyecto Supabase. No uses la contraseña de PostgreSQL en el frontend ni una `service_role` key. Después de cambiar este archivo, detené y volvé a iniciar Next.js.
2. En el panel de Supabase, abrí Authentication y verificá que el proveedor Email esté habilitado y que el proyecto permita nuevos registros. La interfaz puede cambiar de nombre entre versiones.
3. En Authentication → URL Configuration, configurá Site URL para desarrollo y agregá como Redirect URLs las URLs exactas usadas en el navegador. Por ejemplo, si usás ambos orígenes, agregá `http://localhost:3000/**` y `http://127.0.0.1:3000/**`. No agregues estos orígenes de desarrollo a producción.
4. Si recibís `email_address_not_authorized`, el servicio SMTP compartido puede limitar los destinatarios. Configurá un SMTP propio en los ajustes de correo de Supabase para permitir el envío a usuarios externos.
5. Si se muestra un error HTTP 500 o `unexpected_failure`, consultá Authentication → Logs en Supabase. Un error de base de datos al crear `auth.users` puede estar causado por un trigger o una función personalizada que falla. No desactives RLS ni borres usuarios/tablas como primera medida.
6. Si el alta se acepta, pero no hay sesión, revisá el correo de confirmación y la carpeta de spam. Con la confirmación de email activada, es normal que el usuario tenga que confirmar antes de poder iniciar sesión.

Para investigar desde el navegador, abrí DevTools → Network, intentá registrar una vez y localizá la petición `/auth/v1/signup` al dominio de tu proyecto Supabase. Registrá solo el código HTTP y el `code`/`message` del JSON de respuesta; no compartas headers, cookies, contraseñas ni tokens.

### Abrir `http://127.0.0.1:8000/` muestra información de la API

Django es el backend API, no la web pública Next.js. La raíz devuelve un JSON breve con el estado y las rutas; el sitio web se abre normalmente en `http://localhost:3000`. La comprobación `http://127.0.0.1:8000/api/health/` debe responder con `status: ok`.
