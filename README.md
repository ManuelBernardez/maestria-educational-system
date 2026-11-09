# MaestrIA v1.1.2

Plataforma educativa para asistir a docentes en la preparación de evaluaciones, revisión de entregas y elaboración de devoluciones pedagógicas. El frontend se entrega como **HTML5, CSS y JavaScript nativos**; Django REST Framework sirve también el frontend y consume PostgreSQL/Supabase; producción utiliza un único dominio.

## Configuración de IA

Consultar [`docs/CONFIGURACION-IA-EXTERNA.md`](docs/CONFIGURACION-IA-EXTERNA.md) para configurar OpenAI, Gemini u Ollama. La configuración externa puede enviar contenido de entregas a un tercero: revisar el informe de estabilización y las condiciones institucionales antes de habilitarla.

## Arquitectura

- `frontend/`: sitio público y espacio docente HTML5 estáticos. Django los sirve en producción; no utiliza Next.js, React, Node ni un proceso de compilación.
- `frontend/js/api.js`: cliente HTTP/Auth, sesión Supabase por pestaña, renovación controlada, cancelación y llamadas autenticadas a Django.
- `frontend/js/workspace.js`: punto de entrada ES module del espacio docente; `modules/core/api.js` inicializa y expone el cliente como dependencia modular. El espacio docente usa `assets/css/workspace.css`, un bundle CSS nativo que conserva el orden de cascada de sus seis hojas originales y se sirve comprimido por WhiteNoise.
- `frontend/js/modules/`: capas `core`, `data`, `features` y `events`; cada dominio mantiene sus vistas y operaciones. El shell docente sigue siendo una SPA nativa con módulos por dominio, navegación enlazable mediante `?view=...` y soporte de Atrás/Adelante; no requiere React, Next.js ni un bundler.
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
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Usá siempre `backend\.venv\Scripts\python.exe` para instalar dependencias, ejecutar chequeos y levantar Django. Así evitás mezclar el Django instalado globalmente con paquetes de otro intérprete (por ejemplo, `corsheaders` o `rest_framework`). Si el proyecto se ejecuta con Python 3.13, creá el entorno con `py -3.13 -m venv .venv`; el archivo `requirements.txt` instala las dependencias runtime y de desarrollo en ese mismo entorno.

Completá `backend/.env` con `DJANGO_SECRET_KEY`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET` si corresponde y la configuración del proveedor IA (ver `docs/CONFIGURACION-IA-EXTERNA.md`). `backend/.env` está excluido de Git. En modo integrado, Django sirve el sitio y la API desde `http://127.0.0.1:8000`.

Validá e iniciá la aplicación integrada con el mismo intérprete del entorno virtual:

```powershell
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

La API queda en `http://127.0.0.1:8000/api`. `GET /api/client-config/` entrega únicamente `SUPABASE_URL` y la clave pública anon. Las claves de Gemini/OpenAI y todos los secretos permanecen en el backend.

### 2. Frontend HTML5

El frontend nativo no necesita instalar paquetes ni compilarse. Se recomienda ejecutarlo a través del servidor integrado de Django, que es el único que respeta los alias de `STATICFILES_DIRS` y sirve tanto las páginas HTML (`frontend/html/`) como los recursos estáticos (`/assets/css/`, `/assets/js/`, `/assets/images/`):

```powershell
cd backend
.\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

Abrí:

- Sitio público: `http://127.0.0.1:8000/`
- Acceso: `http://127.0.0.1:8000/acceso.html`
- Cómo funciona: `http://127.0.0.1:8000/como-funciona.html`
- Nosotros y contacto: `http://127.0.0.1:8000/nosotros.html`
- Espacio docente: `http://127.0.0.1:8000/espacio-docente/`

En modo integrado, Django sirve el sitio y la API desde `http://127.0.0.1:8000`. `config.js` apunta al backend local `127.0.0.1:8000`. En producción, detecta el mismo origen y usa `/api`; no hay que configurar una URL interna.

> **Nota:** el comando `py -m http.server --directory frontend` del preview estático no funciona con esta estructura: las páginas HTML viven en `frontend/html/` y los recursos estáticos se resuelven mediante los alias de `STATICFILES_DIRS` (por ejemplo, `/assets/css/styles.css` se sirve desde `frontend/css/styles.css`). Usá siempre `manage.py runserver` para el preview local fiel a producción.

Para probar localmente el comportamiento de producción (Gunicorn + WhiteNoise + archivos recopilados), ejecutá `collectstatic` y levantá el sitio con `DEBUG=False`:

```powershell
cd backend
.\.venv\Scripts\python.exe manage.py collectstatic --noinput
$env:DEBUG="False"
.\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

Luego verificá que `http://127.0.0.1:8000/assets/css/styles.css` devuelve `200` con `Content-Type: text/css`.

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

La IA propone; el docente decide. El proveedor `mock` produce propuestas de demostración no aprobables como calificaciones. La configuración de despliegue usa `mock` por defecto; para activar OpenAI hay que configurar explícitamente `OPENAI_API_KEY` y `OPENAI_MODEL` con un modelo habilitado en el proyecto. Las credenciales se guardan exclusivamente en el backend. La activación de procesamiento externo requiere una decisión institucional y una revisión de las condiciones vigentes de tratamiento y retención del proveedor. Si hay una fila activa en `public.ai_provider_config`, ésta prevalece sobre el proveedor del entorno; por eso `AI_PROVIDER=mock` no deshabilita una configuración externa activa en base de datos. Consultá `docs/CONFIGURACION-IA-EXTERNA.md` y `ANALISIS-ESTABILIZACION-REFACTORING.md` antes de activar un proveedor.

Los datos de práctica se crean mediante `POST /api/demo/seed/` bajo confirmación explícita y se identifican como ficticios. No son datos de producción ni una autenticación simulada del frontend.

## Esquema de datos y migraciones

El esquema físico existente `public.*` de PostgreSQL/Supabase es la fuente de verdad. Django mapea los modelos con `db_table` y `managed = False`; el dominio `core` no debe reconstruirse mediante migraciones Django. No ejecutar `migrate`, `makemigrations` ni `--fake` para reconstruir tablas de negocio. Para Shared Pooler en modo transacción, settings desactiva el auto-prepare de psycopg.

Verificación de sólo lectura:

```powershell
cd backend
python manage.py verify_public_schema
```

La herramienta contrasta tablas, columnas, tipos, identidades, FK compuestas, índices y triggers con el esquema esperado. No cambia la base.

Instalación limpia: ejecutar `db/maestria_schema_v2.sql` y luego `db/maestria_schema_v2_contract_alignment.sql` (idempotente). Sin el segundo script, la verificación falla y el backend devuelve errores en contacto, auditoría y administración. El mismo script alinea `ai_provider_config.timeout_seconds` al rango 5–85 s que acepta el backend; en una base existente, aplicarlo sólo tras revisar `verify_public_schema` y con backup. Para pruebas locales con Docker, ver `docs/PRUEBAS-LOCALES.md`.

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

El `render.yaml` despliega un único Web Service Python: Django sirve el frontend y la API desde el mismo origen. No hay servicio estático separado ni build de Node. Configurá `DATABASE_URL` con Shared Pooler IPv4 de Supabase cuando Render no tenga IPv6; para este backend persistente, preferí session mode (puerto 5432) y copiá la URI exacta desde Supabase > Connect. Configurá Supabase URL/anon key/JWT secret y la clave del proveedor IA sólo en el backend. En este MVP el adaptador no valida automáticamente el nivel gratuito o pago del proveedor: si se configura Gemini y hay credenciales válidas, las correcciones pueden enviar contenido al proveedor. Antes de procesar datos reales, un responsable debe revisar finalidad, base legal, información a docentes y términos/retención del proveedor (releé `docs/CONFIGURACION-IA-EXTERNA.md`). Una fila habilitada en `public.ai_provider_config` puede sobreescribir `AI_PROVIDER=mock`. Guardá los cambios en el entorno del backend y reiniciá/reimplementá el servicio. No existe un interruptor equivalente para docentes en el navegador. Confirmá Site URL y Redirect URLs de Supabase Auth para el dominio de producción y el origen local `http://localhost:5500`.

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
- `docs/CONFIGURACION-IA-EXTERNA.md`: referencia para configurar proveedores externos y revisar el tratamiento de datos antes de habilitarlos.
- `docs/PRUEBAS-LOCALES.md`: entorno local con PostgreSQL en Docker, sin tocar Supabase de producción.

## Cambios v1.1.2

- **Panel docente:** los indicadores (Por revisar, Revisadas, Tiempo ahorrado) son botones que abren el historial de correcciones filtrado por ese estado.
- **Desplegables exclusivos:** en todo el sitio sólo queda abierto un desplegable por grupo; al abrir otro, el anterior se pliega (`frontend/js/modules/core/disclosure.js`; en el sitio público, `<details name>`).
- **Curso:** cuatro desplegables (Estudiantes, Evaluaciones, Entregas, Correcciones); se quitó «Resumen del curso» y la descripción del curso pasó debajo del título. Cada paso del recorrido muestra en su círculo la cantidad de elementos de su desplegable, abre ese desplegable al hacer clic y comparte su color.
- **Correcciones:** un desplegable por curso (acordeón); dentro, chips para filtrar por evaluación cuando el curso tiene más de una. Cada fila se titula con el nombre del estudiante.
- **Espacio de trabajo más limpio:** sin rótulos «Paso N ·» repetidos, marca de agua ni nota al pie; la portada sólo muestra estado y curso. Paso 1: «Apuntes y materiales» forma parte del formulario de contexto (debajo de los objetivos, arriba de la rúbrica); la rúbrica queda a la vista y agregar/reemplazar material sólo aparece al elegir un archivo. Paso 2: privacidad en una línea (sin desplegable), sin barra de progreso ni contador duplicados; con un archivo adjunto el cuadro de texto se bloquea; renglones más tenues en la respuesta del estudiante. La lista de entregas muestra nombre y legajo (sin avatar), arranca filtrada por «Pendientes» y el filtro es un selector (Pendientes / Aprobadas / Todas). Al editar una entrega, «Nueva entrega» la deselecciona y deja el formulario listo para cargar otra. Paso 3: «Criterios» primero, sin índice de secciones, «Expandir todo», selector de entrega duplicado ni «Sugerido por la IA» en cada criterio; la columna izquierda muestra la respuesta y, plegada, la consigna.
- **Archivos e IA:** los archivos se procesan en memoria y sólo se guarda el texto extraído (más nombre y tipo). Ahora el DOCX incluye el texto de las tablas; los TXT en Windows‑1252 se leen bien; se eliminan bytes NUL que PostgreSQL rechazaba (error 500); un PDF con contraseña da un mensaje claro. Con Gemini, el contexto de la corrección se cortaba en 8.000 caracteres y la IA perdía el material de referencia (y a veces la consigna): ahora la consigna va primero y el tope es 42.000. La «respuesta esperada» de cada consigna se guardaba pero nunca llegaba a la IA: ahora forma parte del contexto de la corrección. La interfaz avisa que la IA lee los primeros 12.000 caracteres del material. Si la corrección fallaba después de subir un archivo, el reintento quedaba bloqueado: corregido.
- **Menú lateral:** sin scroll horizontal; textos y botones se ajustan al ancho (también contraído y en móvil).
- **Valores por defecto:** «Mis materias» se muestra como lista compacta y el tema inicial es el claro (el oscuro queda sólo si se elige).
- **Guía de uso:** se abre sola la primera vez que la persona entra o mientras no tenga cursos creados (una vez por sesión). Sin íconos decorativos.
- **Revisión pedagógica (`?view=correction`):** no muestra el proveedor de IA; cada criterio es un plegable (acordeón, el primero abierto). Un campo inválido dentro de un plegable cerrado se abre al enviar, e «Imprimir» despliega todo antes de imprimir.
- **Portadas:** se quitaron las etiquetas superiores (`view-kicker`) de los encabezados de sección.

## Cambios v1.1.0 – v1.1.1

- **Identidad visual y espacio de trabajo (v1.1.0):** rediseño "Cuaderno de cátedra" del espacio docente y del panel de administración.
- **Caché de despliegue (v1.1.1):** JS, CSS y CSV se revalidan siempre (`no-cache`) y el primer HTML de cada versión envía `Clear-Site-Data` para que el navegador no mezcle módulos viejos y nuevos. La versión de assets vive en `FRONTEND_ASSETS_VERSION` (`backend/config/settings.py`) y debe coincidir con `package.json`.
- **Validación integral:** "Guardar contexto" también guarda la consigna en edición; `/api/*` inexistente responde 404 JSON; la importación de estudiantes por CSV acepta encabezados en español; `conftest.py` impide correr las pruebas contra Supabase.
- **Revisión por consigna:** en entregas con varias consignas, "Revisar y aprobar" muestra cada respuesta por separado, indica a qué consigna pertenece cada criterio y resalta la cita en la respuesta que la IA corrigió.
- **Mensajes de error:** los errores de validación del backend que llegaban como lista (`["…"]`) o anidados se muestran con su texto en lugar de "HTTP 400".
- **Base de datos:** `db/maestria_schema_v2_contract_alignment.sql` alinea instalaciones nuevas con lo que espera el backend. En producción ya se aplicó el rango de timeout 5–85 s (2026-11-07).

## Cambios v1.0.9

- **Espacio de trabajo docente:** se incorpora en JavaScript nativo el flujo de tres etapas Contexto → Entrega → Revisar, incluyendo objetivos, instrucciones, consignas, propuestas de consignas, material de referencia, selección de estudiante y rúbrica, importación de archivos, cola filtrable, revisión de criterios, aprobación, exportación y opciones de compartir.
- **Contrato de backend:** se reutilizan las rutas y payloads ya existentes (`correction-workspace/`, `assessments/`, `questions/`, `submissions/`, `corrections/`). No se agrega una API paralela ni se cambia el backend para simular funciones.
- **Rendimiento y asincronía:** la primera carga consulta el resumen liviano del espacio; los detalles completos de entrega/corrección se obtienen al seleccionarlos. Las lecturas cancelables evitan que respuestas fuera de orden sobrescriban la selección actual y un bloqueo síncrono evita duplicar operaciones de IA/importación.
- **Navegación:** se mantiene una SPA HTML/CSS/JS por módulos, ahora con vistas enlazables (`?view=...`) y soporte de historial del navegador. El estado compartido del flujo de revisión permanece dentro de una misma vista sin fragmentarse entre páginas.
- **Accesibilidad y seguridad:** formularios nativos etiquetados, estados `aria-live`, foco visible, controles semánticos, mensajes de error y validación en cliente; la aprobación real y los controles de autorización siguen siendo responsabilidad del backend.
- **Mantenimiento:** se retiran copias estáticas antiguas que no forman parte del frontend servido por Django, se conserva el directorio de imágenes, se versiona el CSS para invalidar caché y se agregan verificaciones del contrato del workspace.
- **Base recibida:** el ZIP `maestria-starter.zip` declara la versión `1.0.8`, no `1.0.7`. Para no degradar ni sobrescribir cambios posteriores, esta entrega se construye sobre esa base y se publica como `1.0.9`.

## Despliegue

La configuración lista para Render está en `render.yaml`: un solo Web Service sirve frontend + backend. Usá `render.yaml`, `backend/.env.example`, `docs/CONFIGURACION-IA-EXTERNA.md` y el informe vigente `ANALISIS-ESTABILIZACION-REFACTORING.md` para completar las variables privadas y habilitar un proveedor. `docs/DEPLOYMENT-v0.2.0.md` es histórico y no debe usarse como receta operativa. No cargar `backend/.env` en Git.



## Cambios v1.0.7

- **IA y privacidad:** se conserva el bloqueo *fail-closed* para Gemini/OpenAI. El error ahora explica qué revisión debe realizar el responsable antes de habilitar el procesamiento externo. Nunca se activa el permiso automáticamente ni desde la interfaz docente.
- **Estados HTTP de IA:** correcciones, rúbricas y consignas devuelven `503` cuando falta una aprobación o una configuración local; los errores reales del proveedor continúan devolviendo `502`.
- **Puntajes y decimales:** la presentación limita la visualización a dos decimales significativos (por ejemplo, `10`, `8,5` o `8,25`) y oculta la escala de almacenamiento de PostgreSQL. Los valores persistidos no se redondean ni modifican.
- **Identidad visual del espacio docente:** sidebar verde bosque, fondo cuadriculado tipo papel, superficies cálidas en modo claro y paneles profundos en modo oscuro, manteniendo el selector de tema y el diseño responsive.
- **Caché:** versión de assets actualizada a `1.0.7` para evitar que se reutilice el CSS anterior.
- **Verificación:** comprobaciones estáticas de frontend, sintaxis JS/Python e inspección de las rutas de error/configuración. La generación IA real requiere configurar claves y autorizaciones en el entorno desplegado; no puede darse por probada sin esas credenciales.

## Cambios v1.0.6

- Cursos: el alta siempre crea el curso activo; se quitó el selector de estado del formulario. Archivar/reactivar continúa disponible después de crear el curso. El backend también fuerza `active=True` en altas por API.
- Evaluaciones: el editor recibe y conserva `reference_material`, evitando que una edición descarte material de referencia importado.
- Consignas: al editar una consigna ya no se reenvía la relación `assessment`, que es inmutable; la relación se envía solamente al crearla.
- Números: se normalizan puntajes, máximos, ponderaciones y valores de formularios para eliminar ceros decimales redundantes, sin agregar decimales que el usuario no ingresó.
- Generación de consignas: los errores de configuración/política de IA (incluido Gemini sin nivel pago confirmado) devuelven `503` y un mensaje accionable; los errores reales del proveedor siguen devolviendo `502`. No se desactiva la protección que impide enviar trabajos docentes/estudiantiles a Gemini Free.
- Verificación: `npm run check:frontend`, compilación Python (`compileall`), verificación de imports y pruebas unitarias de formato numérico. No se ejecutó una prueba E2E contra Render/Supabase; el entorno de revisión no tiene Django instalado ni conexión a la base desplegada.

## Frontend v1.0.5

El frontend se organiza en cuatro carpetas: `frontend/html`, `frontend/css`, `frontend/js` y `frontend/assets`. Django sirve las páginas HTML desde `html/`; WhiteNoise publica CSS/JS bajo `/assets/css/` y `/assets/js/`, y las imágenes bajo `/assets/`.

Validaciones: `npm run check:frontend` ejecuta los chequeos de referencias, módulos y contrato del flujo docente.

## Cambios v1.0.5
Auditoría estática del tramo «generar corrección → editar → aprobar → compartir» (sin Django ni red en el entorno de revisión: los cambios están verificados por sintaxis y pruebas puras, no por una corrida E2E).
- IA/Gemini: tope de espera por llamada de 18 s → 85 s (por defecto 60 s, `AI_TIMEOUT_SECONDS`); antes una corrección con varios criterios daba 502 por timeout.
- IA/Gemini: `maxOutputTokens` 1800 → 8192 en correcciones (4096 en consignas/rúbricas). Los modelos con razonamiento consumen esos tokens y la salida JSON llegaba truncada.
- IA: un reintento ante 429/5xx/error de conexión; se tolera JSON envuelto en ```; el error indica si fue truncado por tokens.
- Evidencia literal: la validación tolera espacios, saltos de línea, comillas y guiones tipográficos, y guarda el texto exacto de la fuente. Antes se descartaba evidencia válida y la aprobación fallaba con «debe coincidir literalmente» si la entrega tenía `\r\n`.
- Mensajes de error accionables para 429 (cuota), 401/403 (clave), 400/404 (modelo), 5xx y timeout.
- Aprobar: se eliminó una lectura redundante; la entrega queda en estado «review» en pantalla tras generar.
- Compartir: el correo (`mailto:`) recorta cuerpos largos y copia el texto completo al portapapeles; «Copiar» tiene alternativa si no hay API de portapapeles.
- Imprimir/PDF: nueva hoja `@media print` (antes se imprimía el menú y los botones).
- Caché: la ruta de respaldo de Django también envía `no-cache` para JS/CSS/CSV.
- Despliegue: gunicorn `--timeout 150` (render.yaml y Dockerfile) y `AI_TIMEOUT_SECONDS=60`.
- Tests puros nuevos: `backend/apps/core/test_ai_evidence.py`.

### Segunda tanda v1.0.5
- **Ponderaciones (crítico):** la nota final ahora aplica los pesos: cada criterio aporta logro relativo × peso/Σpesos, expresado sobre la suma de máximos (igual a la suma simple si pesos y máximos son iguales). Se aplica al generar y al aprobar, por consigna. Los criterios de la propuesta guardan su `weight`. La pantalla de rúbrica muestra la suma de pesos (debería ser 100%) con botón «Normalizar a 100%»; un criterio nuevo propone el porcentaje restante. Las correcciones ya aprobadas conservan su nota.
- **Gemini / error 400:** el 400 que llegaba a `api.js` se mostraba sin causa. Ahora se ve el mensaje de Google (estado y texto, sin claves) y se guarda en `ai_generation.error_code` (p. ej. `HTTP_400_INVALID_ARGUMENT`); `api.js` además muestra errores de validación por campo. Causas típicas de 400 de Google: clave inválida, región o facturación no habilitada.
- **Tiempos de carga:** compresión GZip de la API; el resumen se pide en paralelo con `/me/`; pintado inmediato desde caché de sesión (10 min, se limpia al cerrar sesión) mientras se actualiza; esqueleto de carga.
- **Registro de devoluciones:** `GET/POST corrections/{id}/deliveries/` deja constancia (canal, destinatario, fecha) en la auditoría, sin cambios de esquema; la pantalla de una devolución aprobada muestra «Envíos registrados». No hay envío automático ni confirmación de recepción.

Pendiente de despliegue (v1.0.9): la migración de timeout ya se aplicó en producción el 2026-11-07; queda configurar la clave del proveedor y la aprobación operativa correspondiente, y ejecutar `verify_ai --live` más pruebas E2E en el entorno real. Las pruebas de adaptadores usan HTTP simulado y no sustituyen una prueba con credenciales de producción.

## Cambios v1.0.4
- Corregido STATICFILES_DIRS (tuplas prefijo/directorio invertidas): rompía collectstatic y el servido de CSS/JS.
- Corregido ReferenceError (escapeHtml sin importar) al elegir evaluación en «Registrar entrega».
- Corregido 500 al eliminar una consigna (select_for_update con LEFT JOIN).
- Límites: user 900/min, IA 120/hora (configurables por THROTTLE_*); importar archivos ya no cuenta como IA. Antes se obtenía 429 tras ~10 acciones.
- JS/CSS con Cache-Control: no-cache (evita que queden scripts viejos en el navegador tras un deploy).
- Los bloques del curso se mantienen abiertos tras guardar.
- Botones «Volver» de entrega/devolución corregidos; nueva entrada «Rúbricas» en el menú.
- Plantilla CSV de estudiantes (antes 404); el CSV acepta «;» y muestra filas omitidas.
- Tests: perfil docente en el helper de Auth (de 43 a 11 fallas; restantes: tests desactualizados).
