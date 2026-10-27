# MaestrIA

**Asistente docente para crear evaluaciones y rúbricas, revisar respuestas con IA y preparar devoluciones educativas editables bajo aprobación del docente.**

MaestrIA ayuda a organizar el proceso de evaluación: desde definir qué se quiere evaluar, redactar consignas y establecer criterios, hasta cargar respuestas, revisar sugerencias de IA y preparar una devolución. La IA no decide la nota definitiva: el docente revisa, edita y aprueba cada corrección.


## Qué ofrece el MVP

- Inicio de sesión y recuperación de acceso con Supabase Auth. El registro pide nombre y apellido; las cuentas antiguas sin nombre completan el perfil al entrar.
- Cursos, estudiantes y matrículas privadas por docente.
- Evaluaciones, objetivos, materiales de referencia, consignas y rúbricas editables.
- Carga de respuestas como texto o archivos PDF, DOCX, TXT y Markdown compatibles (no incluye OCR de manuscritos o escaneos).
- Propuestas de preguntas, rúbricas y correcciones asistidas por IA.
- Puntajes por criterio, justificación, evidencia literal, fortalezas y próximos pasos sugeridos.
- Revisión y aprobación docente, historial de cambios de puntaje, exportación Markdown y compartir devoluciones desde el navegador (correo, WhatsApp, portapapeles o impresión/PDF, con confirmación manual).
- Sitio público responsive: las funciones están integradas en Inicio y la demostración visual está dentro de Cómo funciona.
- Botón **Probar con ejemplo**: prepara una vez por docente un curso de práctica con estudiantes y respuestas ficticios, una evaluación y una rúbrica. La corrección requiere un proveedor de IA real configurado; el modo `mock` está bloqueado para este conjunto y no puede generar una puntuación simulada presentada como real.

## Arquitectura

```text
Navegador
  ├─ Sitio y panel docente: Next.js + React + TypeScript (Vercel)
  ├─ Inicio de sesión: Supabase Auth (JWT)
  └─ API REST autenticada: Django REST Framework (Render)
          ├─ Validaciones, permisos, reglas del negocio y auditoría mínima
          ├─ Adaptador IA de servidor: Gemini / OpenAI / Ollama / mock
          └─ PostgreSQL en Supabase
```

| Parte | Tecnología | Responsabilidad |
|---|---|---|
| Frontend | Next.js App Router, React, TypeScript | Interfaz, páginas públicas, rutas, UX responsive y llamadas a la API. |
| Backend | Python, Django REST Framework | Autenticación JWT, autorización por propietario, lógica de negocio, archivos, IA y exportaciones. |
| Identidad | Supabase Auth | Registro, inicio de sesión, recuperación y emisión de JWT. No existe una cuenta paralela de Django. |
| Datos | PostgreSQL/Supabase | Datos académicos, rúbricas, entregas, correcciones y trazabilidad mínima. |
| IA | Gemini API (primera opción externa) | Propuestas JSON desde el servidor; nunca asigna ni publica una nota definitiva por sí misma. |
| Despliegue sugerido | Vercel + Render + Supabase | Frontend, API y datos/autenticación desplegados por separado. |

> **Estado:** v0.2.5 — navegación más simple, espacio de corrección reorganizado en tres áreas y campos secundarios bajo demanda; publicación en staging pendiente. Proyecto en desarrollo/MVP; no se debe considerar listo para producción hasta completar CI, pruebas de aislamiento con dos cuentas y evaluación pedagógica con docentes.

## Puesta en marcha local

Requisitos: Python 3.11+, Node.js 22 recomendado, npm y Git. Supabase se necesita para probar Auth; SQLite sirve para desarrollo aislado del backend, pero las restricciones tenant específicas de PostgreSQL se validan en Supabase/PostgreSQL.

### 1. Backend

PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python manage.py check
python manage.py migrate
python manage.py runserver 127.0.0.1:8000
```

En desarrollo local sin Supabase, dejá `DATABASE_URL` comentada para SQLite. Para probar las migraciones `0006` y `0007`, usá un proyecto Supabase/PostgreSQL de prueba, ya que estas se conectan con `auth.users`.

### 2. Frontend

En otra terminal:

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

Configurá en `frontend/.env.local` las variables `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL` y `NEXT_PUBLIC_SITE_URL` con el mismo proyecto y API configurados en el backend. No pongas secretos en esas variables públicas.

- Web: `http://localhost:3000`
- Login: `http://localhost:3000/login`
- API: `http://127.0.0.1:8000`
- Salud API: `http://127.0.0.1:8000/api/health/`

## Probar el flujo de corrección

1. Registrate con tu nombre o ingresá con tu cuenta. Si una cuenta existente no tiene nombre de perfil, MaestrIA lo pedirá antes de abrir el panel.
2. En el resumen, elegí **Probar con ejemplo**. El ejemplo se guarda en tu propia cuenta y es idempotente: volver a pulsar el botón no duplica el conjunto.
3. En el espacio de corrección, seleccioná una de las tres entregas ficticias y elegí **Guardar entrega y proponer corrección**.
4. El botón consulta el proveedor configurado y no abre el flujo de práctica si está en `mock`. Con Gemini/OpenAI/Ollama, elegí una entrega y generá la propuesta. Si falta una clave o aprobación, la app muestra un error de configuración; no reemplaza la respuesta por una puntuación simulada.

El ejemplo usa nombres inventados con el sufijo “Ejemplo”, correos y teléfonos vacíos y respuestas sintéticas. No cargues datos reales hasta haber revisado las condiciones de privacidad y el proveedor de IA.

## Evaluar la calidad de IA

El comando incluido usa exclusivamente respuestas inventadas (no datos reales):

```powershell
cd backend
# En .env: AI_PROVIDER=gemini, AI_EXTERNAL_PROCESSING_APPROVED=True,
# AI_GEMINI_FREE_TIER_SYNTHETIC_EVAL=True, GEMINI_API_KEY=...
python manage.py evaluate_ai --output ai-evaluation.json
```

El nivel gratuito queda habilitado solo para este comando de ejemplos sintéticos; el flujo normal de la app seguirá bloqueado hasta confirmar el nivel pago. El reporte mide estructura JSON, alineación de criterios, puntajes dentro de límites, evidencia literal, feedback, rangos orientativos de nota y latencia. Los rangos son una guía para revisar, no una verdad universal. La calidad pedagógica requiere revisión humana.

## Base de datos desde cero

En un proyecto Supabase nuevo, las migraciones Django son la vía ejecutable. En `backend/`, ejecutar `python manage.py migrate` crea el dominio y las restricciones de propiedad. **No pegar `database/schema.sql` como un bootstrap**: se mantiene como esquema de referencia y no registra el historial de migraciones.

- [`database/SCHEMA-DISENO-v0.2.0.md`](database/SCHEMA-DISENO-v0.2.0.md): entidades, relaciones y decisiones de qué guardar.
- [`database/README.md`](database/README.md): orden de inicialización y reglas de identidad/propiedad.
- [`database/diagnostico-pendientes-v0.2.0.sql`](database/diagnostico-pendientes-v0.2.0.sql): diagnósticos SQL de solo lectura para revisar migraciones, relaciones, RLS y permisos.
- [`database/supabase-rls.sql`](database/supabase-rls.sql): defensa en profundidad opcional; aplicar solo después de migraciones y revisión.

Antes de migrar una base usada, hacer backup y correr primero el diagnóstico. Si las restricciones encuentran datos huérfanos o relaciones de otra cuenta, arreglarlos en una copia; no usar `--fake` ni borrar filas a ciegas.

## Pruebas y CI

```powershell
cd backend
python -m compileall -q config apps manage.py
python manage.py check
python manage.py makemigrations --check --dry-run
python manage.py test
```

```powershell
cd frontend
npm run lint
npm run typecheck
npm run build
```

GitHub Actions ejecuta los chequeos de backend y frontend en cada push/PR relevante. El `package-lock.json` recibido no coincidía con `package.json`: bloqueaba `eslint-config-next` y `@next/eslint-plugin-next` en la versión 14.2.35 mientras la app declara Next 16. Se quitó ese lockfile inconsistente y CI usa `npm install` de manera temporal. Antes de publicar, generá y validá un lockfile nuevo en un entorno con acceso al registro npm, versionalo y cambiá CI a `npm ci`.

## Seguridad y propiedad de los datos

- Supabase Auth es la única fuente de identidad; `owner_id` viene del `sub` de un JWT validado por Django, no del cuerpo enviado por el navegador.
- Cada lista/operación de datos se filtra por el docente. Las migraciones `0006` y `0007` agregan referencia a `auth.users` y restricciones relacionales compuestas para impedir asociaciones entre cuentas distintas.
- El navegador solo usa la URL y la clave pública/anon de Supabase Auth y llama a Django. `DATABASE_URL`, `DJANGO_SECRET_KEY`, credenciales de IA y cualquier clave administrativa son secretos de servidor.
- Los documentos de referencia se procesan en memoria y se guarda el texto extraído, no el archivo binario original.
- La telemetría de IA no guarda las respuestas; registra tarea, proveedor/modelo, estado, duración, código de error y una huella del contexto.
- No uses datos de estudiantes reales durante la evaluación inicial. Configurá retención, eliminación, privacidad, backups y restauración antes de un piloto.

## IA: modo de demostración y Gemini

La configuración por defecto es `AI_PROVIDER=mock` para desarrollo y pruebas de interfaz. El modo `mock` es solo demostrativo y no puede generar correcciones para el conjunto «Probar con ejemplo». Para probar ese recorrido, configurá un proveedor real y sus autorizaciones en el servidor.

La integración Gemini está implementada en el backend con respuesta JSON y validación de puntajes, criterios y evidencia. Para habilitarla:

1. Copiá `backend/.env.example` a `backend/.env` y guardá `GEMINI_API_KEY` solo allí.
2. Revisá las condiciones de tratamiento de datos y configurá `AI_EXTERNAL_PROCESSING_APPROVED=True` solo tras aprobar el envío externo.
3. Para el uso normal con contenido docente/estudiantil, confirmá el nivel pago con `AI_GEMINI_PAID_TIER_CONFIRMED=True`. El nivel gratuito de Gemini indica que el contenido puede usarse para mejorar productos, por lo que no debe usarse con respuestas reales de estudiantes.
4. Antes de habilitar el flujo normal, corré el benchmark con los seis casos ficticios de la sección siguiente.

Ver instrucciones completas en [`docs/AI-EVALUATION-v0.2.0.md`](docs/AI-EVALUATION-v0.2.0.md). La clave API nunca se coloca en `NEXT_PUBLIC_*`.

## Alcance que queda fuera del MVP

OCR de manuscritos/escaneos, portal de estudiantes, realización de exámenes dentro de MaestrIA, LMS completo, pagos, detección de plagio y analítica institucional avanzada. No añadir colas distribuidas/microservicios hasta que el uso medido las necesite.