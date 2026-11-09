# Auditoría técnica integral — MaestrIA

| Campo | Valor |
|---|---|
| Fecha | 2026-11-09 |
| Versión auditada | `main` @ `0c4cace` (MaestrIA v1.1.3, `FRONTEND_ASSETS_VERSION = "1.1.3"`) |
| Alcance | Repositorio completo (backend Django/DRF, frontend HTML5/ES modules, SQL, CI, despliegue) + esquema real de Supabase (solo metadatos) + cabeceras HTTP públicas de producción |
| Modalidad | Auditoría de solo lectura. No se modificó código, configuración, base de datos ni despliegue. La única escritura es este documento. |
| Datos personales | No se consultaron filas con datos de docentes o estudiantes. Se usaron catálogos (`pg_catalog`, `information_schema`, `pg_policies`), conteos estimados y advisors de Supabase. |

---

## 0. Estado de resolución (actualizado 2026-11-09)

| ID | Estado | Cambio | Pruebas |
|---|---|---|---|
| AUD-001 | **Mitigado** | `apps/core/ai_guard.py`: cupo de IA por proceso (`AI_MAX_CONCURRENT_REQUESTS=2`, 503 con `Retry-After` si no hay cupo), deadline total de 100 s para consignas y rúbricas; Gunicorn pasa a 6 hilos por worker (`render.yaml`, `Dockerfile`). La cola asíncrona (Etapa 4) sigue pendiente. | `AICapacityGuardTests` |
| AUD-002 | **Resuelto** | `POST /api/assessments/{id}/reorder-questions/` atómico (`api_views/catalog.py`); el frontend lo usa en `moveQuestion`. | `QuestionReorderTests` |
| AUD-003 | **Resuelto** | `apps/core/exceptions.py` (`EXCEPTION_HANDLER`): `IntegrityError`/`ProtectedError` → 409, `DataError` → 400; rematricular reactiva la matrícula existente; filtro `?course=` validado. | `IntegrityErrorTranslationTests` |
| AUD-004 | **Resuelto** | `conftest.py` instala el snapshot de producción + migraciones pendientes; se eliminó `backend/database/test_schema.sql`; `verify_public_schema` exige los índices de negocio y corre en la suite. | `SchemaContractTests`, test de nombre de curso corregido |
| AUD-005 | **Resuelto** | IP de cliente desde `True-Client-IP`/`CF-Connecting-IP` (no `X-Forwarded-For`) para throttles y auditoría; límites de IA y contacto en caché compartida (`django_cache`); cuota diaria persistente de IA (`AI_DAILY_LIMIT_PER_USER`). | `ClientIPTests`, `AICapacityGuardTests` |
| AUD-012 | **Resuelto** | Habilitar un proveedor externo exige superadmin + `confirm_external_processing`, registrado en `audit_event`. | `AIProviderGateTests` |
| AUD-006 | **Preparado, falta aplicarlo** | Verificado: Django se conecta como `postgres` (`BYPASSRLS`). Migración `20261109180000_maestria_app_least_privilege_role.sql` (rol `maestria_app`, traza de sólo inserción, función `maestria_auth_user_exists`); el código ya no lee `auth.users`. Hay que cambiar `DATABASE_URL` en Render. | `LeastPrivilegeRoleTests`, `TenantIsolationSweepTests` |
| AUD-008 | **Parcial** | Migración `20261109170000`: `audit_event` sobrevive al borrado de la identidad (`ON DELETE SET NULL`). La política de retención requiere una decisión institucional. | — |
| AUD-015 / AUD-027 / AUD-028 | **Resuelto** | Longitudes de `AuditEvent`/`AIGeneration` alineadas; `django_cache` en uso; índice `uniq_pending_correction_per_submission`. | `SchemaContractTests` |
| AUD-007 | **Pendiente** | Requiere rediseñar la capa de datos del frontend (Etapa 4) con pruebas en navegador. | — |

---

## 1. Resumen ejecutivo

MaestrIA está en un estado **técnicamente más maduro de lo habitual para su tamaño**: el aislamiento entre docentes está bien resuelto en tres capas (filtros por `owner_id` en cada vista, claves foráneas compuestas `(foreign_id, owner_id)` en PostgreSQL y RLS habilitado sin privilegios para `anon`/`authenticated`), la autenticación JWT es estricta, la IA nunca aprueba calificaciones por sí sola y el flujo de corrección tiene un mecanismo de *lease* con bloqueos de fila pensado para la concurrencia.

**No se encontraron vulnerabilidades críticas (P0)** ni caminos verificables de acceso a datos de otro docente (IDOR/BOLA).

Los riesgos principales están en otro lugar:

1. **Disponibilidad bajo carga real (P1).** Las llamadas a IA se ejecutan de forma síncrona dentro de los 8 hilos totales de Gunicorn (2 workers × 4 threads). Ocho correcciones simultáneas —un solo curso numeroso corrigiendo a la vez— bloquean **todo** el servicio: API, HTML y health check.
2. **Errores 500 en flujos de uso normal por restricciones únicas de la base que el código no contempla (P1).** El más visible: **reordenar consignas** genera una violación de `uniq_question_position_per_assessment`. También reactivar una matrícula y habilitar un segundo proveedor de IA.
3. **El esquema de pruebas no coincide con producción (P1).** `backend/database/test_schema.sql` omite casi todos los índices únicos reales, por eso la suite (108 tests) no detecta el punto anterior. Hay incluso un test que afirma que *no* existe un índice que sí existe en producción.
4. **Rate limiting poco efectivo (P2).** Caché en memoria por proceso y uso de `X-Forwarded-For` sin `NUM_PROXIES`: los límites se duplican por worker, se reinician en cada deploy y el límite anónimo (formulario de contacto) se puede evadir.
5. **El backend no se beneficia de RLS (P2).** La conexión de Django consulta `auth.users`, lo que indica un rol privilegiado; la seguridad multi-tenant depende exclusivamente del código Django (que hoy es correcto, pero no tiene red de contención).
6. **Escalabilidad del frontend (P2).** El cliente descarga colecciones completas (hasta 10.000 filas por recurso, siguiendo la paginación) y vuelve a pedir las listas afectadas tras cada escritura.
7. **Privacidad y retención (P2).** No hay política de retención; borrar una identidad en Supabase Auth elimina en cascada todo su historial académico **y su auditoría**; la antigua compuerta técnica para habilitar IA externa se eliminó y hoy basta con una fila en `ai_provider_config`.

**Recomendación:** comenzar por la **Etapa 1** (manejo global de errores de integridad, arreglo del reordenamiento, rate limiting con caché compartida, límite de concurrencia de IA) y, en paralelo, alinear el esquema de pruebas con producción (Etapa 2), porque es lo que permite corregir todo lo demás con seguridad.

---

## 2. Estado general del proyecto

| Dimensión | Evaluación | Comentario |
|---|---|---|
| Seguridad multi-tenant | **Buena** | Filtros por propietario consistentes + FK compuestas + RLS sin GRANTs públicos. |
| Autenticación | **Buena** | JWKS/HS256 con `aud`, `iss`, `exp`, `sub`; rechaza `anon`/`service_role`; perfil activo obligatorio. |
| Integridad de datos | **Media** | Restricciones fuertes en DB, pero la API no traduce sus violaciones (500). |
| Concurrencia | **Media-buena** | Locks y lease bien diseñados; deuda en operaciones multi-request (reordenar). |
| Rendimiento/escala | **Media-baja** | IA síncrona en pocos hilos; frontend que descarga todo. |
| Mantenibilidad | **Media** | Módulos grandes (`submissions.py`, `workspace-feature.js`), reexports masivos, docs dispersos. |
| Pruebas | **Media** | 108 tests backend con PostgreSQL real en CI, pero esquema divergente y sin tests de frontend/E2E. |
| Observabilidad | **Baja** | Sin `LOGGING`, sin tracking de errores, tokens/costos de IA no registrados. |
| Documentación | **Media** | Abundante pero con versiones históricas que contradicen el código vigente. |

Volumen actual en producción (estimado por `pg_stat_user_tables`): decenas de filas por tabla (p. ej. 12 entregas, 8 correcciones, 12 perfiles). Todo el análisis de rendimiento es, por lo tanto, **proyectivo**.

---

## 3. Tecnologías y arquitectura identificadas

| Capa | Tecnología | Evidencia |
|---|---|---|
| Frontend | HTML5 + CSS + JavaScript ES modules nativos, sin build | `frontend/html`, `frontend/js/modules/**` |
| Backend | Python 3.12, Django 5.1–5.2, DRF 3.15–3.16 | `backend/requirements-prod.txt` |
| Servidor | Gunicorn `gthread`, 2 workers × 4 threads, timeout 150 s | `render.yaml`, `backend/Dockerfile` |
| Estáticos | WhiteNoise (compresión brotli), `no-cache` para JS/CSS | `config/settings.py:129-152`, `config/static_files.py` |
| Base de datos | PostgreSQL de Supabase, esquema `public` gestionado por SQL (`managed=False`) | `apps/core/models.py`, `backend/database/migrations/*.sql` |
| Identidad | Supabase Auth (JWT), sin `django.contrib.auth` | `apps/core/authentication.py` |
| IA | Adaptador propio vía `httpx` para Gemini, OpenAI, Ollama y `mock` | `apps/core/ai.py` |
| Archivos | `pypdf`, `python-docx`; extracción en memoria, sin almacenamiento del binario | `api_views/common.py:340-400` |
| Hosting | Render (plan *starter*) detrás de Cloudflare | `render.yaml`, cabeceras `Server: cloudflare`, `x-render-origin-server: gunicorn` |
| CI | GitHub Actions: compile, `manage.py check`, pytest con Postgres 16, chequeos estáticos de frontend | `.github/workflows/*.yml` |

## 4. Componentes y relaciones

```
                Navegador (docente / admin)
   ┌───────────────────────────────────────────────────────┐
   │ HTML estático + ES modules                             │
   │  api.js  ── sesión Supabase en sessionStorage ──┐      │
   │  modules/core|data|features|events              │      │
   └───────────┬──────────────────────────────┬──────┘      │
               │ fetch /api/* (Bearer JWT)    │ Auth REST    │
               ▼                              ▼              │
   ┌──────────────────────────────┐   ┌─────────────────────┐
   │ Render: Gunicorn + Django    │   │ Supabase Auth       │
   │  WhiteNoise (estáticos)      │   │ (signup, login,     │
   │  frontend_file (HTML + CSP)  │   │  refresh, recover)  │
   │  DRF: auth JWT → permisos    │   └─────────┬───────────┘
   │  api_views/{catalog,         │             │ trigger
   │   submissions,dashboard}     │             ▼ maestria_sync_auth_user_profile
   │  admin_api                   │   ┌─────────────────────┐
   │  ai.py ──httpx──► Gemini /   │──►│ PostgreSQL (public) │
   │          OpenAI / Ollama     │SQL│  RLS + FK compuestas│
   └──────────────────────────────┘   │  triggers de valid. │
                                      └─────────────────────┘
```

Flujos críticos identificados:

1. **Alta de contenido**: curso → estudiantes (CSV o manual, con matrícula atómica) → evaluación → consignas → rúbrica.
2. **Ingesta de entregas**: texto o archivo (`submissions/import-file/`) → `submission` (+ `submission_answer` por consigna).
3. **Corrección asistida**: `submissions/{id}/generate-correction/` → *lease* `processing` → IA por respuesta (concurrencia ≤ 3) → `correction` `pending_review` → `corrections/{id}/approve/` con revisión inmutable (`correction_revision`) y resultados por criterio.
4. **Devolución**: exportación Markdown, registro de envíos en `audit_event` (`corrections/{id}/deliveries/`).
5. **Administración**: perfiles, instituciones, membresías, mensajes de contacto, proveedor de IA, auditoría.

---

## 5. Hallazgos por área

> Convención: líneas aproximadas al commit `0c4cace`. "Verificado" = comprobado en código y/o en el esquema real. "Inferido" = deducido por análisis estático sin reproducirlo en ejecución.

### 5.A Arquitectura y organización

---

**AUD-010 · Arquitectura · Orquestación de corrección concentrada en una sola vista**
- **Gravedad:** Media · **Prioridad:** P2 · **Esfuerzo:** Medio · **Probabilidad:** Alta (afecta cada cambio futuro)
- **Evidencia:** `backend/apps/core/api_views/submissions.py:186-462` (`SubmissionViewSet.generate_correction_action`, ~280 líneas); `approve` en `submissions.py:578-696` (~120 líneas).
- **Descripción:** una única acción mezcla validación de entrada, reglas de negocio, armado de rúbricas, reserva con locks, orquestación asíncrona de IA, agregación, persistencia, auditoría y telemetría. No existe capa de servicios.
- **Impacto:** difícil de testear por partes; cualquier cambio (cola de trabajos, otro proveedor, reapertura de correcciones) requiere tocar el bloque completo; alta probabilidad de regresiones en la lógica de lease.
- **Solución:** extraer `services/correction_service.py` con funciones puras (`build_items`, `reserve`, `generate`, `commit_proposal`, `release`) y `services/approval_service.py`. Las vistas quedan como adaptadores HTTP. Es prerrequisito de AUD-001.
- **Dependencias:** ninguna; facilita AUD-001 y AUD-020.

**AUD-021 · Arquitectura · Módulo `common.py` como "barril" de reexportaciones**
- **Gravedad:** Baja · **Prioridad:** P3 · **Esfuerzo:** Bajo
- **Evidencia:** `api_views/catalog.py:4-58`, `submissions.py:4-59`, `dashboard.py:1-55` importan desde `.common` símbolos de terceros (`Decimal`, `os`, `time`, `asyncio`, `status`, `transaction`, serializers, modelos…). `views.py` reexporta de nuevo.
- **Impacto:** acoplamiento implícito, imports circulares potenciales, linters sin poder detectar símbolos sin uso.
- **Solución:** imports directos en cada módulo; `common.py` sólo con helpers de dominio.

**AUD-022 · Frontend/Arquitectura · Módulos de interfaz demasiado extensos**
- **Gravedad:** Media · **Prioridad:** P2 · **Esfuerzo:** Medio
- **Evidencia:** `frontend/js/modules/features/workspace-feature.js` (1.150 líneas), `modules/events.js` (442 líneas, `switch` central de acciones con lógica de negocio inline, p. ej. `events.js:158`, `events.js:211`), `features/forms.js` (271 líneas que mezclan formularios de varios dominios).
- **Impacto:** cambios de UX con alto riesgo de efectos colaterales; difícil incorporar desarrolladores.
- **Solución:** un *handler* por dominio registrado en un mapa (`actions/courses.js`, `actions/corrections.js`…); separar en `workspace-feature.js` la lógica de cola, consignas y revisión (ya existe la carpeta `features/workspace/`, completar la migración).

**AUD-016 · Mantenibilidad · Código muerto y documentación contradictoria**
- **Gravedad:** Baja · **Prioridad:** P3 · **Esfuerzo:** Bajo
- **Evidencia:** `backend/apps/core/delivery.py` (envío por email/WhatsApp) no es importado por ningún módulo. `README.md` menciona `modules/core/api.js` (el archivo real es `core/api-client.js`). `docs/DEPLOYMENT-v0.2.0.md`, `docs/AI-VERIFICATION-v1.0.7.md` y `docs/AUDITORIA-TECNICA-v1.0.2.md` describen `AI_EXTERNAL_PROCESSING_APPROVED` como obligatoria, pero la variable ya no existe en el código. Hay 5 documentos de auditoría previos más `AUDITORIA-SUPABASE-2026-11-09.md` en la raíz.
- **Impacto:** un operador que siga un documento viejo puede creer que existe una protección de privacidad que fue eliminada (ver AUD-012).
- **Solución:** mover documentos históricos a `docs/historico/` con una advertencia; eliminar o integrar `delivery.py`; un único `docs/ARQUITECTURA.md` vigente.

**Evaluación de la arquitectura.** El monolito modular (Django sirviendo API y frontend en un solo origen) es **adecuado** para el tamaño y los objetivos de MaestrIA: simplifica CORS/CSP, despliegue y costos. No se recomienda pasar a microservicios ni a un framework de frontend con build. Lo que falta es una **capa de servicios** en el backend y un **trabajador asíncrono** para IA.

### 5.B Backend y API REST

---

**AUD-002 · Backend/Integridad · Reordenar consignas viola un índice único y devuelve 500**
- **Gravedad:** Alta · **Prioridad:** P1 · **Esfuerzo:** Bajo · **Probabilidad:** Muy alta (inferido; ocurre en cada intercambio de posiciones)
- **Evidencia:**
  - Frontend: `frontend/js/modules/features/workspace-feature.js:335-347` (`moveQuestion`) envía un `PATCH questions/{id}/ { position }` **por fila** con `Promise.all`.
  - Backend: `api_views/catalog.py:499-512` (`QuestionViewSet.perform_update`) guarda cada fila en su propia transacción.
  - Producción: índice `uniq_question_position_per_assessment (assessment_id, position)`, no diferible.
- **Descripción:** al intercambiar A(1)↔B(2), la primera actualización que se confirma asigna una posición todavía ocupada por la otra fila. PostgreSQL rechaza con `IntegrityError` y, como no hay manejador global (AUD-003), el usuario recibe HTTP 500. La otra petición puede tener éxito, dejando el orden a medio aplicar en el cliente.
- **Impacto:** funcionalidad visible rota; estado inconsistente entre UI y servidor.
- **Solución:** endpoint atómico `POST /api/assessments/{id}/reorder-questions/` que reciba la lista ordenada de IDs y, dentro de una transacción con el `Assessment` bloqueado, haga una actualización en dos fases (posiciones temporales negativas o `position + 10000`, luego definitivas). Alternativa en DB: reemplazar el índice por `UNIQUE (...) DEFERRABLE INITIALLY DEFERRED` (requiere constraint, no índice). Lo mismo aplica a `rubric_criterion` (`uniq_criterion_position_per_rubric`) y `rubric_level` (`uniq_rubric_level_position`) si se exponen reordenamientos.
- **Dependencias:** AUD-003 (manejador de errores), AUD-004 (para poder testearlo).

**AUD-003 · Backend · Sin traducción de errores de integridad: varios flujos válidos terminan en 500**
- **Gravedad:** Alta · **Prioridad:** P1 · **Esfuerzo:** Bajo-medio · **Probabilidad:** Alta
- **Evidencia:** `config/settings.py:160-178` no define `EXCEPTION_HANDLER`; `IntegrityError` se importa en `api_views/common.py:19` pero no se usa en ninguna vista. Casos concretos:
  1. **Rematricular** a un estudiante que tuvo una matrícula desactivada en el mismo curso: `frontend/js/modules/features/forms.js:73` hace `POST enrollments/`; `catalog.py:120-136` sólo verifica duplicados **activos**; producción tiene `uniq_enrollment_course_student (course_id, student_id)` **sin predicado** → `IntegrityError` → 500.
  2. **Habilitar un segundo proveedor de IA** desde administración: índice parcial `uniq_enabled_ai_provider` → 500 (`admin_api.py:510-523`).
  3. **`DELETE` de rúbricas, criterios, evaluaciones o estudiantes con dependencias**: `ModelViewSet.destroy` por defecto + FKs `on_delete=PROTECT` en `models.py` → `ProtectedError` → 500. Sin dependencias, en cambio, el borrado es **físico** (inconsistente con el archivado de cursos e instituciones). La UI actual no expone estos borrados, pero la API sí.
  4. Filtro `GET /api/enrollments/?course=abc` → `ValueError` al construir la consulta (`catalog.py:156-161`) → 500 (otras vistas sí validan el entero).
- **Impacto:** errores opacos para el docente, ruido en logs, potencial estado intermedio en el cliente.
- **Solución:** `REST_FRAMEWORK["EXCEPTION_HANDLER"]` propio que mapee `IntegrityError` → 409 con mensaje genérico (sin filtrar el nombre del índice) y `ProtectedError` → 409; reactivar la matrícula existente en vez de crear otra; definir explícitamente `destroy` (archivar o 409) en todos los ViewSets; validar enteros en filtros de query.
- **Dependencias:** AUD-004.

**AUD-011 · Backend · `approve` persiste claves arbitrarias del cliente en `final_result`**
- **Gravedad:** Media · **Prioridad:** P2 · **Esfuerzo:** Bajo
- **Evidencia:** `api_views/submissions.py:599-658`: `final_result = {**final_result, "criteria": validated_criteria, "demo": ...}`. Sólo `criteria` se valida; `summary`, `feedback`, `strengths`, `improvement_suggestions`, `warnings` o cualquier clave adicional se guardan tal cual (hasta `DATA_UPLOAD_MAX_MEMORY_SIZE = 5 MB`).
- **Impacto:** JSONB inflado, campos con tipos inesperados que luego consume el frontend y la exportación (`export_markdown`), resultado "aprobado" que no refleja lo que la IA propuso ni lo que el docente vio.
- **Solución:** lista blanca de claves con tipos y límites (igual que `_validate_proposal` en `ai.py`).

**AUD-023 · Backend · Validaciones de existencia con querysets globales (oráculo de IDs)**
- **Gravedad:** Baja · **Prioridad:** P3 · **Esfuerzo:** Bajo
- **Evidencia:** `serializers.py:12-15` (`fields = "__all__"`) genera `PrimaryKeyRelatedField` con `Model.objects.all()`. La pertenencia se valida después en `validate()` (p. ej. `serializers.py:128-156`, `229-244`).
- **Descripción:** un ID inexistente devuelve "objeto no existe"; un ID de otro docente devuelve "Curso no disponible". Con IDs `bigint` secuenciales se puede inferir el volumen de datos de la plataforma. No hay fuga de contenido (verificado).
- **Solución:** acotar los querysets de los campos relacionados por `owner_id` en `__init__` del serializer y unificar el mensaje.

**AUD-024 · Backend · N+1 acotados en aprobación y preparación de corrección**
- **Gravedad:** Baja · **Prioridad:** P3 · **Esfuerzo:** Bajo
- **Evidencia:** `submissions.py:673-691` hace un `Question.objects...get()` y un `INSERT` por criterio (hasta 10 respuestas × 20 criterios = 200 consultas); `submissions.py:269-306` reconsulta la misma rúbrica para cada respuesta cuando no se envía `rubric_id`.
- **Solución:** precargar preguntas en un diccionario; `bulk_create` de `CorrectionCriterionResult`; cachear rúbricas por ID dentro de la petición.

**Aspectos positivos verificados (backend):** paginación por defecto acotada (`pagination.py`), `owner_id` siempre asignado por el servidor (`OwnerViewSet.perform_create`), inmutabilidad de relaciones en actualizaciones (`serializers.py:371-379`), orden de locks consistente *Assessment → Submission*, `release_reservation` que no libera un lease ajeno (`submissions.py:248-265`), endpoints de corrección que impiden POST/PUT/PATCH/DELETE directos (`submissions.py:566-576`), `api_not_found` JSON para rutas inexistentes.

### 5.C Frontend y experiencia de usuario

---

**AUD-007 · Frontend/Rendimiento · El cliente descarga colecciones completas y las vuelve a pedir tras escribir**
- **Gravedad:** Media · **Prioridad:** P2 · **Esfuerzo:** Medio-alto · **Probabilidad:** Alta al crecer el volumen
- **Evidencia:** `frontend/js/api.js:217-233` (`list`) sigue `next` hasta 100 páginas de 100 elementos; `modules/data/resources.js:61-88` define que vistas como `submissions`, `corrections`, `course` cargan 7 colecciones completas (`REVIEW`, `COURSE_WORK`). Tras cada escritura, `afterWrite` (`repository.js:186-208`) vuelve a pedir el resumen y **las listas completas afectadas**; `refreshCore` (`repository.js:41-48`, usado al iniciar, al cargar el ejemplo, al borrar una consigna y en "Actualizar") recarga todas las ya cargadas. El propio `settings.py:167` documenta que el throttle se subió a 900/min por este patrón. *(Corrección posterior: la primera versión de este informe decía que cada escritura recargaba todo; la recarga está acotada a las listas afectadas, pero cada una se descarga completa.)*
- **Descripción:** la paginación del servidor queda anulada; filtros, búsquedas y conteos se hacen en el navegador. `dashboard/overview/` y `correction-workspace/` además devuelven listas **sin paginar** (`api_views/dashboard.py:57-105`, `287-463`).
- **Impacto:** con un docente de 10 cursos × 40 estudiantes × 10 evaluaciones (~4.000 entregas) cada navegación puede transferir varios MB y decenas de peticiones; mayor consumo de conexiones Supabase y CPU de Render; latencia percibida.
- **Solución:** endpoints específicos por vista con filtros del lado servidor (`?course=`, `?status=`, `?assessment=`), paginación visible o *infinite scroll*, invalidación selectiva por recurso tras cada escritura, y contadores agregados en el servidor (ya existe el patrón en `courses_with_dashboard_counts`).

**AUD-025 · Frontend · Renderizado por reemplazo completo con `innerHTML`**
- **Gravedad:** Baja · **Prioridad:** P3 · **Esfuerzo:** Medio
- **Evidencia:** `modules/app.js:86` (`content.innerHTML = renderer()`), ~20 sumideros `innerHTML` en total. El escapado es consistente (`core/utils.js:3`, `escapeHtml`); se revisaron interpolaciones sospechosas (`assessments.js:38`, `students.js:12`, `share.js:35`, `workspace-feature.js:329`) y todas están en contextos de texto o se escapan después. **No se encontró XSS.** El texto del estudiante en la revisión se arma con nodos DOM (`workspace-feature.js:746`).
- **Impacto:** pérdida de foco/scroll y de estado de formularios al re-renderizar; cada nueva vista es un punto donde olvidar `escapeHtml` produce XSS (mitigado por la CSP `script-src 'self'`).
- **Solución:** mantener el enfoque sin build, pero introducir una función de plantillas etiquetadas que escape por defecto (`html\`...\``) y renderizado parcial por región.

**AUD-026 · Frontend · Timeouts de cliente desalineados con el backend**
- **Gravedad:** Baja · **Prioridad:** P3 · **Esfuerzo:** Bajo
- **Evidencia:** `features/forms.js:226` (150 s para corrección; backend 120 s + transacciones), `workspace-feature.js:373` y `forms.js:104` (180 s para generación de consignas/rúbricas, que en backend no tienen deadline global, ver AUD-009), POST por defecto 90 s (`api.js:145`) usado en `import-file`.
- **Impacto:** el cliente puede abortar mientras el servidor sigue trabajando; el usuario reintenta y recibe "ya se está procesando". El lease evita duplicados, pero la experiencia es confusa.
- **Solución:** con AUD-001, pasar a 202 + *polling*; mientras tanto, documentar y alinear los tiempos en un único lugar.

**Aspectos positivos verificados (frontend):** CSP estricta sin `unsafe-inline` (verificada en producción), sesión en `sessionStorage` por pestaña con refresh deduplicado (`api.js:76-91`), validación de rutas y enlaces de paginación (`api.js:9-15`, `208-215`), limpieza del fragmento con tokens tras recuperación (`auth.js:96`, `auth-reset.js:15`), guardas contra doble envío en modales (`state.modalBusy`, `forms.js:19-23`), `aria-live`/`aria-busy` en estados de carga, preferencia de color inicializada antes del primer pintado (`theme-init.js`).

### 5.D Base de datos y Supabase

Ver evaluación completa en la sección 9. Hallazgos:

**AUD-004 · Calidad/DB · El esquema de pruebas diverge de producción**
- **Gravedad:** Alta · **Prioridad:** P1 · **Esfuerzo:** Medio · **Probabilidad:** Ya ocurre
- **Evidencia:** `backend/database/test_schema.sql:169-197` sólo define los índices `uq_*_id_owner`, `uq_user_profile_email_ci`, `uq_institution_membership_user` y los `UNIQUE` en línea. Faltan respecto de producción: `uniq_course_owner_name_ci`, `uniq_enrollment_course_student`, `uniq_question_position_per_assessment`, `uniq_criterion_position_per_rubric`, `uniq_rubric_level_position`, `uniq_submission_question_answer`, `uniq_student_external_code_per_owner`, `uniq_approved_correction_per_submission`, `uniq_criterion_result_position`, `uniq_correction_revision_number`, `uniq_enabled_ai_provider`. Además `backend/apps/core/tests.py:225` (`test_reference_schema_does_not_claim_a_database_unique_course_name_index`) afirma que el índice único de nombre de curso **no** debe existir, pero existe en producción.
- **Impacto:** la suite es verde mientras flujos reales fallan (AUD-002, AUD-003). El comando `manage.py verify_public_schema` existe pero no se ejecuta en CI contra el esquema de pruebas.
- **Solución:** generar `test_schema.sql` desde la base local reproducida (`supabase db dump --schema-only` del snapshot local en F:) y agregar un job de CI que ejecute `verify_public_schema` contra la base de pruebas; corregir el test contradictorio.

**AUD-015 · DB · Diferencias de longitud entre modelos y columnas reales**
- **Gravedad:** Baja · **Prioridad:** P3 · **Esfuerzo:** Bajo
- **Evidencia:** `audit_event.event_type` y `object_type` son `varchar(80)` en producción vs `max_length=120` en `models.py:268-269`; `audit_event.object_id` `varchar(80)` vs 160 (`models.py:270`); `ai_generation.task` `varchar(40)` vs 80 (`models.py:245`). `AdminAuditEventViewSet` trunca filtros a 120 (`admin_api.py:546-549`).
- **Impacto:** hoy los valores son cortos y literales; un evento futuro con nombre largo produce `DataError` → 500 dentro de una transacción de negocio (p. ej. aprobación), revirtiéndola.
- **Solución:** alinear `max_length` con la base y agregar ese chequeo a `verify_public_schema`.

**AUD-027 · DB · Tabla `django_cache` huérfana**
- **Gravedad:** Baja · **Prioridad:** P3 · **Esfuerzo:** Bajo
- **Evidencia:** existe `public.django_cache` (RLS sin políticas, 0 filas) pero `settings.py` no define `CACHES`.
- **Solución:** usarla para AUD-005 (`DatabaseCache`) o eliminarla mediante migración.

**AUD-028 · DB · Falta unicidad en base de datos para propuestas pendientes**
- **Gravedad:** Baja · **Prioridad:** P3 · **Esfuerzo:** Bajo
- **Evidencia:** sólo existe `uniq_approved_correction_per_submission`; la regla "una sola `pending_review` por entrega" se garantiza únicamente por locks en `submissions.py:368-371` y `437-440`.
- **Solución:** `CREATE UNIQUE INDEX ... ON correction(submission_id) WHERE status = 'pending_review'` (defensa en profundidad ante escrituras fuera de la API).

### 5.E Seguridad y privacidad

**AUD-005 · Seguridad · Rate limiting inefectivo: caché por proceso y IP de cliente falsificable**
- **Gravedad:** Media · **Prioridad:** P1 · **Esfuerzo:** Bajo · **Probabilidad:** Media
- **Evidencia:** `settings.py:160-178` usa throttles de DRF sin `CACHES` → `LocMemCache` por proceso (2 workers, se vacía en cada deploy/reinicio). DRF identifica anónimos con `X-Forwarded-For` completo cuando `NUM_PROXIES` no está definido; producción está detrás de Cloudflare + proxy de Render (cabeceras verificadas), y el cliente puede enviar su propio `X-Forwarded-For`.
- **Impacto:** el límite de contacto (`5/hour`) y el anónimo (`60/min`) se pueden evadir variando la cabecera (spam en `contact_message`, notificaciones SMTP); el límite de IA (`120/hour` por usuario) es en la práctica ~240/h y se reinicia con cada deploy (costo de proveedor). Además `audit_event.ip_address` registra la IP del proxy (`common.py:135`, `admin_api.py:26`), lo que vuelve inútil ese dato para investigación.
- **Solución:** `CACHES` compartida (`DatabaseCache` sobre `django_cache` o Redis de Render); `NUM_PROXIES` correcto o identificación por `CF-Connecting-IP` validando que la petición venga de Cloudflare; cuota diaria de IA por docente basada en `ai_generation` (persistente); `forwarded_allow_ips` en Gunicorn.

**AUD-006 · Seguridad/DB · El backend opera con un rol que no está sujeto a RLS**
- **Gravedad:** Media · **Prioridad:** P2 · **Esfuerzo:** Medio · **Probabilidad:** Baja (requiere un bug de filtrado)
- **Evidencia:** `admin_api.py:184-188` y `392-395` ejecutan `SELECT 1 FROM auth.users`, accesible sólo para roles privilegiados (`postgres`/`service_role` tienen `BYPASSRLS`, verificado en `pg_roles`). La URI concreta de `DATABASE_URL` **no se pudo verificar** (secreto en Render).
- **Descripción:** las políticas RLS (`<tabla>_owner_isolation`, verificadas) protegen frente a PostgREST con la clave anon, pero **no** frente a la API Django. El aislamiento entre docentes depende sólo de que cada consulta incluya `owner_id=request.user.id`. Hoy eso se cumple en todas las vistas revisadas, y las FK compuestas impiden *referenciar* filas ajenas, pero un `get_queryset` olvidado en una vista nueva expondría datos de todos los docentes.
- **Solución (gradual):** (1) rol dedicado `maestria_app` sin `BYPASSRLS`, sin DDL, con `GRANT` mínimos por tabla y una función `SECURITY DEFINER` `public.auth_user_exists(uuid)` en lugar de leer `auth.users`; (2) opcionalmente, fijar `SET LOCAL request.jwt.claims` por transacción para que RLS actúe también sobre la API; (3) test de "regresión de tenant" que recorra todos los endpoints del router con dos docentes.

**AUD-012 · Privacidad · Envío de entregas a proveedores externos sin compuerta técnica**
- **Gravedad:** Media · **Prioridad:** P1 · **Esfuerzo:** Bajo-medio
- **Evidencia:** `active_ai_provider_config()` (`common.py:143-152`) hace que una fila `enabled=true` en `ai_provider_config` prevalezca sobre `AI_PROVIDER=mock` del entorno; un `admin` global puede activarla desde `admin_api.py:510-523`. La variable `AI_EXTERNAL_PROCESSING_APPROVED` fue eliminada (sólo queda en `conftest.py:22` y en documentos históricos). El contexto enviado incluye respuestas completas, consignas y material del docente (`submissions.py:61-80`).
- **Impacto:** respuestas de estudiantes (que pueden contener datos identificatorios) pueden salir hacia Google/OpenAI por una decisión de un único administrador, sin registro de la base legal ni aviso al docente en el momento de corregir.
- **Solución:** exigir en el servidor una confirmación explícita y auditada (p. ej. columna `external_processing_approved_at/by` en `ai_provider_config` o variable de entorno sólo modificable en Render), mostrar al docente qué proveedor procesará la entrega antes de generar, y opción de seudonimizar (`student_name` no se envía hoy: mantenerlo así y documentarlo).

**AUD-008 · Privacidad/Integridad · Borrado en cascada desde `auth.users` y sin política de retención**
- **Gravedad:** Media · **Prioridad:** P2 · **Esfuerzo:** Medio
- **Evidencia:** todas las FK `core_*_owner_auth_user_fk` son `ON DELETE CASCADE` hacia `auth.users` (verificado en `pg_constraint`), incluidas `audit_event`, `correction_revision` y `correction_criterion_result`. No hay tareas de purga para `audit_event` (guarda IP y user-agent), `ai_generation`, `contact_message` (nombre, correo, mensaje) ni entregas.
- **Impacto:** eliminar un usuario desde el panel de Supabase destruye irreversiblemente calificaciones aprobadas **y la traza de auditoría** que justificaría esas calificaciones; a la inversa, los datos personales se conservan indefinidamente si nadie borra la cuenta.
- **Solución:** política de retención documentada (por ciclo lectivo); baja lógica de cuentas (el estado `deleted` ya existe en `user_profile`); `audit_event` con `ON DELETE SET NULL` + anonimización; tarea programada de purga; exportación de datos del docente antes de la baja.

**AUD-029 · Seguridad · Protección de contraseñas filtradas deshabilitada en Supabase Auth**
- **Gravedad:** Baja · **Prioridad:** P2 · **Esfuerzo:** Bajo
- **Evidencia:** advisor de seguridad `auth_leaked_password_protection` (WARN). El frontend ya traduce el error `pwned` (`api.js:259`), pero la verificación está apagada.
- **Solución:** habilitarla en Authentication → Passwords (según plan de Supabase).

**AUD-014 · Seguridad · Token de acceso accesible desde JavaScript**
- **Gravedad:** Baja · **Prioridad:** P3 · **Esfuerzo:** Alto (cambio de modelo de sesión)
- **Evidencia:** `api.js:37-56` guarda `access_token` y `refresh_token` en `sessionStorage`.
- **Descripción:** es una decisión razonable para una SPA sin cookies y está bien mitigada (CSP `script-src 'self'`, sin dependencias de terceros en runtime, escapado consistente). Se deja asentado como riesgo residual: cualquier XSS futuro permitiría robar sesiones.
- **Solución:** mantener; si en el futuro se agregan scripts de terceros, migrar a cookie `HttpOnly` con BFF.

**AUD-018 · Seguridad/Rendimiento · Procesamiento de documentos no confiables dentro del request**
- **Gravedad:** Media · **Prioridad:** P2 · **Esfuerzo:** Medio
- **Evidencia:** `common.py:340-400` (`_read_document`). Hay límites razonables (5 MB, ZIP ≤ 20 MB descomprimidos y ≤ 1.000 miembros para DOCX, texto ≤ 50.000), pero en PDF el límite de 50 páginas se verifica **después** de construir `PdfReader` y la extracción de texto de todas las páginas corre sin límite de tiempo en un hilo de Gunicorn. La validación de tipo es por extensión, no por contenido.
- **Impacto:** un PDF malicioso o patológico (flujos comprimidos enormes, objetos recursivos) puede consumir CPU/memoria de una instancia *starter* y bloquear uno de los 8 hilos.
- **Solución:** ejecutar la extracción en un subproceso con límite de tiempo y memoria (o en el worker de AUD-001); validar *magic bytes*; mantener `pypdf` actualizado (ver AUD-017).

**Aspectos positivos verificados (seguridad):**
- `anon` y `authenticated` **no tienen ningún privilegio** sobre las tablas de `public` (verificado con `has_table_privilege`): la clave anon expuesta en `/api/client-config/` no da acceso a datos vía PostgREST.
- RLS habilitado en las 21 tablas; las 3 sin políticas (`ai_provider_config`, `contact_message`, `django_cache`) quedan cerradas por defecto.
- Funciones de trigger con `search_path` fijo; la única `SECURITY DEFINER` (`maestria_sync_auth_user_profile`) usa `search_path=""` y no es ejecutable por `anon`/`authenticated`.
- JWT: algoritmos restringidos, audiencia e issuer verificados, `role=authenticated` obligatorio, tamaño máximo de token (`authentication.py:385-425`).
- Cabeceras en producción: HSTS con preload, `X-Frame-Options: DENY`, CSP estricta para HTML y `default-src 'none'` para la API, `nosniff`, `Cache-Control: no-store` en la API.
- Errores de IA saneados (`_safe_ai_error_detail`); la telemetría guarda sólo un hash del contexto, no el texto.
- Prompt de sistema con instrucción explícita de tratar la respuesta del estudiante como contenido no confiable y verificación literal de evidencias (`ai.locate_evidence`).
- Secretos fuera del repositorio (`.env` ignorado, `render.yaml` con `sync: false`); `SECRET_KEY` validada en arranque.

**Permisos de las herramientas usadas en la auditoría.** El servidor MCP de Supabase se conectó como `supabase_read_only_user` (sin superusuario, **con `BYPASSRLS`**). Es adecuado para lectura de metadatos, pero ese rol puede leer todas las filas con datos personales; se recomienda restringir su uso a catálogos o crear un rol de auditoría sin acceso a tablas de negocio. No se ejecutó ninguna operación de escritura.

### 5.F Rendimiento y escalabilidad

**AUD-001 · Rendimiento/Disponibilidad · IA síncrona dentro de un pool de 8 hilos**
- **Gravedad:** Alta · **Prioridad:** P1 · **Esfuerzo:** Alto (definitivo) / Bajo (mitigación) · **Probabilidad:** Alta en uso real (cierre de trimestre, curso numeroso)
- **Evidencia:** `render.yaml` (`--workers 2 --threads 4 --timeout 150`); `submissions.py:385-390` (`async_to_sync(generate_with_deadline)()`, deadline 120 s en `common.py:51`); `catalog.py:259` y `catalog.py:463` (consignas y rúbricas, **sin deadline global**); `ai.py:9` (`MAX_PROVIDER_TIMEOUT = 85`) y `_post_json` (un reintento ante 429/5xx/ConnectError con espera de 1–1,5 s).
- **Descripción:** cada generación ocupa un hilo de Gunicorn durante toda la llamada al proveedor (típicamente 10–60 s; peor caso ~120 s en correcciones y ~171 s en consignas/rúbricas). Con 8 hilos totales, 8 generaciones simultáneas dejan sin capacidad a todo el sitio: HTML, API, estáticos servidos por WhiteNoise y `/api/health/` (Render puede reiniciar la instancia por health check fallido, cortando también las generaciones en curso). El throttle de IA es por usuario y no limita la concurrencia global.
- **Impacto:** caída percibida del servicio para todos los docentes en horas pico; costos de IA desperdiciados por reintentos del usuario.
- **Solución:**
  - *Inmediata (bajo esfuerzo):* semáforo global de concurrencia de IA por proceso (p. ej. 2 por worker) que responda 429/503 "cola llena, reintentá en N s"; deadline global también para consignas y rúbricas; subir `--threads` (las llamadas son I/O-bound) y vigilar memoria.
  - *Definitiva:* tabla `ai_job` + worker separado (Render Background Worker) o cola sobre PostgreSQL (`SELECT ... FOR UPDATE SKIP LOCKED`); el endpoint devuelve 202 con el ID del trabajo y el frontend hace *polling*. El lease actual (`processing` + `PROCESSING_LEASE_MINUTES`) se reutiliza casi sin cambios.
- **Dependencias:** AUD-010 facilita la extracción.

**AUD-009 · Integraciones · Política de timeouts y reintentos de IA no acotada globalmente**
- **Gravedad:** Media · **Prioridad:** P2 · **Esfuerzo:** Bajo
- **Evidencia:** `ai.py` (`_post_json`): timeout por intento hasta 85 s y reintento inmediato ante 429 (que suele requerir *backoff* mayor); `catalog.py:246-272` y `441-469` sin `asyncio.wait_for`.
- **Solución:** deadline total por operación, *backoff* con *jitter* y respeto de `Retry-After`, no reintentar 429 de cuota diaria; *circuit breaker* simple (si el proveedor falla N veces seguidas, responder 503 sin llamar).

**AUD-030 · Rendimiento · Endpoints agregados sin límite de tamaño**
- **Gravedad:** Media · **Prioridad:** P2 · **Esfuerzo:** Medio
- **Evidencia:** `dashboard.py:57-105` (`dashboard_overview` serializa **todas** las evaluaciones), `dashboard.py:287-463` (`correction_workspace` modo completo: todos los estudiantes del curso con matrículas, todas las rúbricas con criterios y niveles, todas las entregas con respuestas completas y todas las correcciones con JSON de propuesta).
- **Solución:** que el modo completo sólo devuelva el ítem seleccionado; listas paginadas o con tope; mantener el modo `summary=1` como único modo de lista.

**Otros puntos de rendimiento evaluados (sin hallazgo):** consultas de conteo con subconsultas correlacionadas (`courses_with_dashboard_counts`) correctas; `select_related`/`only()` bien usados en listados; `conn_max_age=60` con health checks adecuado para el *session pooler*; WhiteNoise con compresión; los índices de las FK existen (los 69 avisos "unused index" del advisor se explican por el volumen mínimo actual: **no** se recomienda eliminarlos). El `SELECT` del perfil en cada request autenticado es un costo aceptable a cambio de poder suspender cuentas al instante.

**Proyección con muchos usuarios.** El primer límite será la concurrencia de IA (AUD-001), luego el volumen transferido por el frontend (AUD-007/AUD-030) y, después, las conexiones a Supabase (2 workers × 4 hilos = hasta 8 conexiones persistentes por instancia; escalar horizontalmente a N instancias multiplica esa cifra contra el límite del pooler del plan).

### 5.G Integraciones y servicios externos

- **Consistencia ante fallos parciales:** bien resuelta en corrección (reserva → IA fuera de transacción → confirmación con relectura y comparación de `updated_at`; liberación segura). La telemetría de éxito se graba en la misma transacción que la propuesta. ✔
- **Correo de contacto:** fuera de la transacción, `fail_silently=True`, `EMAIL_TIMEOUT` acotado (`settings.py:212-216`). ✔ Sin reintentos ni cola: un mensaje puede quedar sin notificación (aceptable; está persistido).
- **Supabase Auth desde el navegador:** timeouts de 15–20 s, deduplicación de refresh. ✔
- **AUD-019 (ver 5.H)**: tokens y costos de IA nunca se registran (`record_ai_generation` en `common.py:154-170` no recibe `input_tokens`/`output_tokens`/`estimated_cost_usd`, aunque las columnas existen y `ai_provider_config` tiene precios por 1k tokens).
- **Entornos:** `.env.example` completo; `conftest.py` aborta si `DATABASE_URL` apunta a Supabase y fuerza `mock` en tests. ✔ La configuración de producción depende de variables `sync: false` que no se pudieron verificar.

### 5.H Calidad, pruebas y mantenibilidad

**AUD-020 · Pruebas · Funcionalidades críticas sin cobertura**
- **Gravedad:** Media · **Prioridad:** P2 · **Esfuerzo:** Medio
- **Evidencia:** 108 tests en `backend/apps/core/` (`tests.py` 45, `test_workspace.py` 34, `admin_api_tests.py` 18, `test_documents.py` 6, `test_ai_evidence.py` 5). Sin cobertura por HTTP de:
  - Aprobación exitosa con cambio de puntaje, creación de `correction_revision` y `correction_criterion_result` (sólo hay casos negativos en `test_workspace.py:267-327`).
  - Reordenamiento de consignas (AUD-002), rematriculación (AUD-003).
  - `submissions/import-file/`, `assessments/{id}/import-reference/`, `corrections/{id}/deliveries/`, `corrections/{id}/export/`.
  - `generate-questions` y `rubrics/generate` a nivel endpoint; throttling.
  - Un test genérico de aislamiento que recorra **todos** los endpoints del router con dos docentes.
  - Ningún test de frontend (unitario ni E2E); los chequeos de `scripts/check_*.py` son estáticos.
- **Solución:** priorizar tests de integración de los flujos 1–4 de la sección 4; Playwright con el *stack* local de Supabase (ya disponible en F:) para un recorrido E2E mínimo.

**AUD-017 · Dependencias · Builds no reproducibles y sin escaneo de vulnerabilidades**
- **Gravedad:** Media · **Prioridad:** P2 · **Esfuerzo:** Bajo
- **Evidencia:** `requirements-prod.txt` usa rangos (`Django>=5.1,<5.3`, `pypdf>=5.0,<7`…) sin archivo de bloqueo ni hashes; Render ejecuta `pip install` en cada build. No hay Dependabot, `pip-audit` ni `npm audit` en CI.
- **Impacto:** un deploy puede incorporar una versión nueva no probada (o comprometida) de una dependencia; vulnerabilidades conocidas pasan desapercibidas (relevante para `pypdf`, que procesa archivos no confiables).
- **Solución:** `pip-compile --generate-hashes` → `requirements.lock`; Dependabot semanal; job `pip-audit` en CI.

**AUD-019 · Observabilidad · Sin configuración de logging ni trazas de errores**
- **Gravedad:** Media · **Prioridad:** P2 · **Esfuerzo:** Bajo
- **Evidencia:** `settings.py` no define `LOGGING`; los `logger.warning` de `common.py`/`catalog.py`/`submissions.py` dependen de la configuración por defecto; no hay Sentry ni equivalente; el `X-Request-ID` (`middleware.py`) no se incluye en los logs.
- **Solución:** `LOGGING` JSON a stdout con `request_id`, usuario (UUID) y duración; Sentry (con *scrubbing* de cuerpos de petición); registrar tokens/costos de IA; panel mínimo de métricas (tasa de error de IA, latencia p95, entregas en `processing`).

**AUD-031 · CI · Los workflows sólo corren en cambios de ciertas rutas y no verifican el esquema**
- **Gravedad:** Baja · **Prioridad:** P3 · **Esfuerzo:** Bajo
- **Evidencia:** `.github/workflows/backend.yml` y `frontend.yml` filtran por `paths`; un cambio en `db/` o `render.yaml` no ejecuta pruebas. No hay *lint* (`ruff` está instalado pero no se ejecuta).
- **Solución:** agregar `db/**`, `render.yaml`, `requirements*.txt` a los filtros; ejecutar `ruff check`; job de verificación de esquema (AUD-004).

---

## 6. Tabla consolidada

| ID | Área | Título | Gravedad | Prioridad | Esfuerzo |
|---|---|---|---|---|---|
| AUD-001 | Rendimiento | IA síncrona en pool de 8 hilos bloquea todo el servicio | Alta | P1 | Bajo (mitigación) / Alto |
| AUD-002 | Backend/Integridad | Reordenar consignas viola índice único → 500 | Alta | P1 | Bajo |
| AUD-003 | Backend | Errores de integridad/protección sin traducir → 500 (rematrícula, proveedor IA, DELETE) | Alta | P1 | Bajo-medio |
| AUD-004 | Calidad/DB | Esquema de pruebas divergente de producción | Alta | P1 | Medio |
| AUD-005 | Seguridad | Rate limiting por proceso y evadible vía `X-Forwarded-For` | Media | P1 | Bajo |
| AUD-012 | Privacidad | IA externa habilitable sin compuerta técnica ni aviso | Media | P1 | Bajo-medio |
| AUD-006 | Seguridad/DB | Backend con rol que no está sujeto a RLS | Media | P2 | Medio |
| AUD-007 | Frontend/Rend. | Descarga de colecciones completas y recarga total | Media | P2 | Medio-alto |
| AUD-008 | Privacidad | Cascada desde `auth.users` y sin retención | Media | P2 | Medio |
| AUD-009 | Integraciones | Timeouts/reintentos de IA sin deadline global | Media | P2 | Bajo |
| AUD-010 | Arquitectura | Orquestación de corrección en una sola vista | Media | P2 | Medio |
| AUD-011 | Backend | `approve` guarda claves arbitrarias del cliente | Media | P2 | Bajo |
| AUD-017 | Dependencias | Sin lockfile ni escaneo de vulnerabilidades | Media | P2 | Bajo |
| AUD-018 | Seguridad/Rend. | Parsing de documentos no confiables en el request | Media | P2 | Medio |
| AUD-019 | Observabilidad | Sin `LOGGING`, sin tracking de errores, sin tokens/costos | Media | P2 | Bajo |
| AUD-020 | Pruebas | Flujos críticos sin cobertura; sin tests de frontend | Media | P2 | Medio |
| AUD-022 | Frontend/Arq. | Módulos de UI demasiado extensos | Media | P2 | Medio |
| AUD-029 | Seguridad | Protección de contraseñas filtradas deshabilitada | Baja | P2 | Bajo |
| AUD-030 | Rendimiento | Endpoints agregados sin límite de tamaño | Media | P2 | Medio |
| AUD-014 | Seguridad | Tokens accesibles desde JS (riesgo residual) | Baja | P3 | Alto |
| AUD-015 | DB | Longitudes de columnas ≠ modelos | Baja | P3 | Bajo |
| AUD-016 | Mantenibilidad | Código muerto y docs contradictorios | Baja | P3 | Bajo |
| AUD-021 | Arquitectura | `common.py` como barril de reexportaciones | Baja | P3 | Bajo |
| AUD-023 | Backend | Oráculo de existencia de IDs | Baja | P3 | Bajo |
| AUD-024 | Backend | N+1 acotados en aprobación | Baja | P3 | Bajo |
| AUD-025 | Frontend | Re-render completo con `innerHTML` | Baja | P3 | Medio |
| AUD-026 | Frontend | Timeouts de cliente desalineados | Baja | P3 | Bajo |
| AUD-027 | DB | Tabla `django_cache` huérfana | Baja | P3 | Bajo |
| AUD-028 | DB | Sin unicidad DB para `pending_review` | Baja | P3 | Bajo |
| AUD-031 | CI | Filtros de rutas y sin lint/verificación de esquema | Baja | P3 | Bajo |

Totales: **30 hallazgos** — **0 críticos**, **4 altos**, **14 medios** (2 de ellos P1), **12 bajos**.

---

## 7. Análisis detallado de los problemas más importantes

### 7.1 AUD-001 — Concurrencia de IA y capacidad del servicio

Escenario: una docente con 35 entregas abre la cola y genera correcciones una tras otra en dos pestañas, mientras otros dos docentes hacen lo mismo. Con latencias de proveedor de 30–60 s, en pocos segundos los 8 hilos quedan ocupados. A partir de ese momento cualquier petición —incluso la página de inicio— espera en la cola del socket de Gunicorn. Si el health check de Render supera su tiempo, la plataforma reinicia la instancia y las 8 generaciones en curso se pierden (quedan en `processing` hasta que vence el lease de 5 minutos, momento en que el docente puede reintentar).

La arquitectura actual ya tiene la mitad del camino hecho: el *lease* sobre `submission.status = 'processing'` es exactamente el estado que necesita una cola. Propuesta:

1. `ai_job(id, owner_id, kind, submission_id, assessment_id, payload jsonb, status, attempts, available_at, locked_until, result jsonb, error_code, created_at)` con RLS igual al resto.
2. `POST generate-correction` valida, reserva y encola en una transacción → `202 {job_id}`.
3. Worker (proceso separado en Render) toma trabajos con `FOR UPDATE SKIP LOCKED`, con concurrencia configurable y respeto de cuotas del proveedor.
4. `GET /api/ai-jobs/{id}/` para *polling* (o SSE más adelante).

Mientras tanto, un semáforo global por proceso y un deadline también para consignas/rúbricas reducen el riesgo con un cambio de pocas líneas.

### 7.2 AUD-002/AUD-003/AUD-004 — Restricciones de la base que el código y los tests desconocen

El diseño "la base es la fuente de verdad" es correcto y está bien ejecutado en producción (índices únicos, FK compuestas, triggers de validación). El problema es que el contrato **no llega** ni a la capa HTTP (que no traduce las violaciones) ni a las pruebas (que usan un esquema sin esas restricciones). Consecuencia directa: funcionalidades que pasan CI fallan en producción. Corregir AUD-004 primero convierte los otros dos hallazgos en tests rojos reproducibles y evita regresiones futuras del mismo tipo.

### 7.3 AUD-005/AUD-012 — Abuso y costo de IA, y privacidad

El límite de IA es la principal barrera de costo. Hoy es por proceso, volátil y por usuario; no hay cuota diaria ni concurrencia global. Combinado con AUD-012 (cualquier administrador puede habilitar un proveedor externo con una fila de la base), una cuenta comprometida o un error de configuración pueden generar costos y transferencias de datos de estudiantes a terceros sin una barrera técnica adicional ni trazabilidad específica de esa decisión (sólo un `audit_event` genérico `ai_provider_config.updated`).

### 7.4 AUD-006 — RLS como red de contención

El código actual filtra correctamente: se revisaron todos los `get_queryset`, las acciones personalizadas y los endpoints de función (`dashboard_overview`, `correction_workspace`, `audit_events`, `seed_demo_dataset`, `current_user_profile`), y todas restringen por `owner_id` o por rol. Las FK compuestas impiden además que un docente vincule su entrega a la evaluación de otro aunque adivine el ID. Sin embargo, la única barrera frente a una omisión futura es la revisión de código; el rol privilegiado del backend hace que RLS no actúe. Dado que MaestrIA guarda calificaciones y respuestas de estudiantes, conviene sumar al menos un test automático de aislamiento (barato) y planificar el rol de mínimo privilegio (medio).

---

## 8. Evaluación de seguridad y privacidad

| Control | Estado | Referencia |
|---|---|---|
| Autenticación JWT | ✔ Sólido | `authentication.py` |
| Autorización por rol (docente/admin/superadmin) | ✔ Fail-closed | `permissions.py` |
| Aislamiento entre docentes (API) | ✔ Correcto hoy, sin red de contención | AUD-006 |
| Aislamiento entre docentes (DB) | ✔ FK compuestas + RLS | Sección 9 |
| Roles institucionales | ✔ Acotados; `department_admin` sólo ve su membresía | `admin_api.py:410-478` |
| Protección del último superadmin | ✔ Advisory lock + trigger | `admin_api.py:259-300`, trigger `trg_user_profile_guard_last_superadmin` |
| IDOR/BOLA | ✔ No se encontraron; oráculo menor de IDs | AUD-023 |
| SQL Injection | ✔ ORM y parámetros en los dos SQL crudos | `admin_api.py:185`, `393` |
| XSS | ✔ Escapado consistente + CSP estricta | AUD-025, AUD-014 |
| CSRF | ✔ No aplica (Bearer, `credentials: 'omit'`) | `settings.py:194-198` |
| CORS | ✔ Mismo origen; listas vacías en producción | `render.yaml` |
| Subida de archivos | ⚠ Límites correctos, procesamiento en el request | AUD-018 |
| Rate limiting | ⚠ Inefectivo | AUD-005 |
| Secretos | ✔ Fuera del repo; validación de `SECRET_KEY` | `settings.py:13-21` |
| Logs | ⚠ Sin configuración; sin payloads (bien) | AUD-019 |
| Dependencias | ⚠ Sin lock ni escaneo | AUD-017 |
| Retención y borrado | ⚠ Sin política; cascada destructiva | AUD-008 |
| IA externa | ⚠ Sin compuerta técnica | AUD-012 |
| Contraseñas | ✔ Política fuerte; ⚠ HIBP apagado | AUD-029 |

Datos sensibles identificados: nombre, correo, teléfono y código externo de estudiantes (`student`), textos de respuestas (`submission.answer_text`, `submission_answer.answer_text`), calificaciones y devoluciones (`correction*`), IP y user-agent (`audit_event`), mensajes de contacto. Todos están protegidos de la clave anon; ninguno se envía al navegador de otro docente; ninguno se registra en logs.

## 9. Evaluación de Supabase y del modelo de datos

**Inventario (verificado):** 21 tablas en `public`, 3 migraciones aplicadas (`20261105202119_maestria_v1_0_2_hardening`, `20261109140000_maestria_db_cleanup`, `20261109160000_maestria_align_prod_with_contract`) coincidentes con `backend/database/migrations/`.

**Modelo.** Normalizado y coherente con el dominio: `course` ← `enrollment` → `student`; `assessment` → `question` → `submission_answer` ← `submission`; `rubric` → `rubric_criterion` → `rubric_level`; `submission` → `correction` → `correction_criterion_result`/`correction_revision`. Redundancias deliberadas y justificadas: `submission.student_name` (entregas sin estudiante vinculado), `correction.proposal`/`final_result` en JSONB como *snapshot* inmutable de lo que vio el docente, `owner_id` en cada tabla (habilita FK compuestas y RLS simple).

**Integridad (fortalezas).**
- FK compuestas `(x_id, owner_id)` en todas las relaciones de negocio → imposible referenciar filas de otro docente incluso escribiendo SQL directo.
- `CHECK` de estados, rangos de puntajes, posiciones no negativas, longitud de mensajes.
- Triggers de validación cruzada: `maestria_validate_submission_question`, `..._submission_answer_question`, `..._correction_result_question`, `..._rubric_level_score`, `..._criterion_max_score`.
- `updated_at` mantenido por trigger con `clock_timestamp()` (el código lo relee para el lease: `submissions.py:376-382`).

**RLS y permisos (verificado).** Las 21 tablas tienen RLS; 18 políticas `owner_isolation`/`self_read` para `authenticated` con `(select auth.uid())` (forma optimizada). Ninguna tabla otorga privilegios a `anon` ni `authenticated`, de modo que las políticas son hoy **defensa latente** (útiles si en el futuro se habilita acceso directo desde el cliente). `force_rls` está desactivado en todas: el dueño de las tablas las saltea.

**Debilidades.** AUD-004 (esquema de pruebas), AUD-006 (rol del backend), AUD-008 (cascadas), AUD-015 (longitudes), AUD-027 (`django_cache`), AUD-028 (unicidad `pending_review`), y la ausencia de una restricción que impida `status='approved'` sin `approved_at` (sólo la valida el código).

**Concurrencia.** Estrategia pesimista bien aplicada: `select_for_update` con orden estable (Assessment → Submission → filas en orden de PK), mutex por docente sobre `user_profile` (`lock_owner_profile`) para chequeos de duplicados, advisory lock para superadmins. Riesgo residual: el mutex por docente serializa **todas** las escrituras de catálogo de un mismo docente (aceptable a esta escala) y la importación CSV de 500 filas lo mantiene durante ~1.000 `INSERT` individuales (usar `bulk_create`).

**Índices.** Cobertura completa de FK y de los patrones de consulta principales; los avisos de "índice no usado" se deben al volumen ínfimo y a que `stats_reset` es del 2026-10-02. No eliminar índices hasta tener tráfico real.

## 10. Rendimiento y concurrencia (resumen)

| Cuello de botella | Umbral aproximado | Hallazgo |
|---|---|---|
| Hilos de Gunicorn ocupados por IA | 8 generaciones simultáneas | AUD-001 |
| Transferencia de listas completas | Miles de entregas por docente | AUD-007, AUD-030 |
| Parsing de PDF/DOCX | PDFs grandes o patológicos | AUD-018 |
| Conexiones a Supabase | 8 por instancia × instancias | Sección 5.F |
| Locks por docente | Importaciones masivas concurrentes del mismo docente | Sección 9 |
| Condiciones de carrera | Reordenamiento multi-request | AUD-002 |

## 11. Deuda técnica y malas prácticas

- Lógica de negocio en vistas, sin capa de servicios (AUD-010).
- Módulos de frontend de más de 1.000 líneas y despachador central de eventos (AUD-022).
- Reexportación masiva de símbolos (AUD-021).
- Esquema de pruebas mantenido a mano (AUD-004).
- Código muerto (`delivery.py`) y 20+ documentos con versiones históricas mezcladas con las vigentes (AUD-016).
- Dependencias sin bloquear (AUD-017).
- Uso de `str(...)[:N]` para truncar silenciosamente entradas en vez de rechazarlas con 400 (p. ej. `catalog.py:443-451`, `submissions.py:600`): el docente no se entera de que su texto fue cortado.
- `ai_generation` sin tokens/costos pese a tener columnas y precios configurables (AUD-019).

## 12. Soluciones y refactorizaciones recomendadas

1. **Manejador global de excepciones** (`apps/core/exceptions.py`) para `IntegrityError`, `ProtectedError`, `DataError` y `ValueError` de filtros → 409/400 con mensajes en español; incluir `request_id` en la respuesta.
2. **Endpoints atómicos para operaciones de conjunto**: `reorder-questions`, `reorder-criteria`; reactivación de matrículas.
3. **Capa de servicios** para corrección, aprobación, importación y generación con IA.
4. **Cola de trabajos de IA** sobre PostgreSQL + worker de Render; 202 + *polling* en el frontend.
5. **Caché compartida** (`DatabaseCache`) para throttling, `NUM_PROXIES`/IP real y cuotas diarias de IA persistentes.
6. **Rol de base de datos de mínimo privilegio** y función `auth_user_exists`.
7. **Esquema de pruebas generado** desde la base real + verificación automática en CI.
8. **Endpoints de lectura por vista** con filtros y paginación del servidor; invalidación selectiva en el frontend.
9. **Política de datos**: retención, baja lógica, auditoría no destruible, compuerta auditada para IA externa.
10. **Observabilidad**: `LOGGING` estructurado, Sentry, métricas de IA.

## 13. Plan de acción priorizado (hoja de ruta)

### Etapa 1 — Seguridad y estabilidad críticas

- **Objetivos:** que ningún flujo normal devuelva 500; que el servicio no se caiga por IA; que los límites de abuso funcionen.
- **Resuelve:** AUD-002, AUD-003, AUD-005, AUD-001 (mitigación), AUD-009, AUD-029.
- **Archivos/módulos:** `config/settings.py` (`EXCEPTION_HANDLER`, `CACHES`, `NUM_PROXIES`), nuevo `apps/core/exceptions.py`, `api_views/catalog.py` (Enrollment, Question, destroy explícitos), `admin_api.py` (proveedor IA), `api_views/submissions.py` y `catalog.py` (semáforo y deadlines), `ai.py` (`_post_json`), `frontend/js/modules/features/workspace-feature.js` (`moveQuestion`), `render.yaml` (`--threads`, `forwarded_allow_ips`), panel de Supabase Auth (HIBP).
- **Dependencias:** ninguna externa; idealmente en paralelo con AUD-004 para escribir los tests.
- **Riesgos:** cambiar códigos de estado puede afectar mensajes del frontend (revisar `errorMessage` en `api.js`); `DatabaseCache` agrega escrituras a la base por cada request limitado (aceptable a esta escala).
- **Esfuerzo:** bajo-medio (≈ 3–5 días).
- **Terminado cuando:** reordenar, rematricular y habilitar proveedores responden 2xx/409 controlados en un entorno con el esquema real; 10 generaciones simultáneas no impiden cargar `/` ni `/api/health/`; el throttle de contacto no se evade con `X-Forwarded-For` y persiste entre workers.

### Etapa 2 — Integridad de datos y corrección funcional

- **Objetivos:** que las pruebas reflejen producción; cerrar huecos de integridad y privacidad.
- **Resuelve:** AUD-004, AUD-011, AUD-012, AUD-015, AUD-028, AUD-008 (decisión de política + primeras medidas), AUD-027.
- **Archivos/módulos:** `backend/database/test_schema.sql` (regenerado), `apps/core/tests.py:225`, `management/commands/verify_public_schema.py`, `.github/workflows/backend.yml`, `models.py`, `submissions.py` (`approve`), `admin_api.py` (compuerta IA externa), nueva migración SQL (índice `pending_review`, FK de `audit_event`, columnas de aprobación de procesamiento externo).
- **Dependencias:** reproducción local de Supabase (ya disponible en F:); decisión institucional sobre retención.
- **Riesgos:** cambios de FK en producción requieren ventana y verificación previa en el entorno local; no ejecutar sin respaldo.
- **Esfuerzo:** medio (≈ 1–2 semanas).
- **Terminado cuando:** CI falla si el esquema de pruebas difiere del contrato; los tests de AUD-002/003 existen y pasan; existe un documento de retención aprobado y la baja de una cuenta no destruye la auditoría.

### Etapa 3 — Refactorización y modularización

- **Objetivos:** reducir el costo de cambio en los módulos críticos.
- **Resuelve:** AUD-010, AUD-021, AUD-022, AUD-016, AUD-023, AUD-024, AUD-025.
- **Archivos/módulos:** nuevo `apps/core/services/`, `api_views/*`, `serializers.py`, `frontend/js/modules/events.js`, `features/workspace-feature.js`, `features/forms.js`, `docs/`.
- **Dependencias:** Etapa 2 (cobertura de tests sobre el esquema real como red de seguridad).
- **Riesgos:** regresiones silenciosas en el flujo de lease; mitigación: tests de concurrencia existentes (`test_concurrent_correction_request_does_not_call_provider_twice`) + nuevos.
- **Esfuerzo:** medio-alto (≈ 2–3 semanas).
- **Terminado cuando:** ninguna función de vista supera ~60 líneas; `workspace-feature.js` y `events.js` divididos por dominio; `delivery.py` resuelto; documentos históricos separados.

### Etapa 4 — Rendimiento y escalabilidad

- **Objetivos:** soportar decenas de docentes corrigiendo simultáneamente y cursos de cientos de entregas.
- **Resuelve:** AUD-001 (definitivo), AUD-007, AUD-030, AUD-018, AUD-006.
- **Archivos/módulos:** nueva tabla `ai_job` + worker (`render.yaml` con servicio *worker*), `api_views/submissions.py`, `catalog.py`, `dashboard.py`, `frontend/js/api.js`, `modules/data/resources.js`, `repository.js`, rol de base de datos.
- **Dependencias:** Etapa 3 (servicios extraídos).
- **Riesgos:** costo adicional de Render (worker); cambio de UX a procesamiento asíncrono; migración de rol de DB sin interrupción.
- **Esfuerzo:** alto (≈ 3–4 semanas).
- **Terminado cuando:** las generaciones de IA no ocupan hilos web; ninguna vista descarga colecciones completas; prueba de carga en entorno no productivo (p. ej. 20 docentes, 50 generaciones concurrentes con proveedor simulado) con p95 de la API < 1 s y 0 errores 5xx.

### Etapa 5 — Pruebas, documentación y observabilidad

- **Objetivos:** detectar problemas antes que los usuarios y facilitar la incorporación de desarrolladores.
- **Resuelve:** AUD-017, AUD-019, AUD-020, AUD-031, AUD-026.
- **Archivos/módulos:** `requirements*.txt` → lockfile, `.github/workflows/*`, `settings.py` (`LOGGING`), integración Sentry, suite Playwright, `docs/ARQUITECTURA.md`, `docs/OPERACION.md`.
- **Dependencias:** puede comenzar en paralelo desde la Etapa 1 (lockfile y logging son independientes).
- **Riesgos:** bajo; cuidar que Sentry no capture cuerpos con respuestas de estudiantes.
- **Esfuerzo:** medio (≈ 1–2 semanas, distribuible).
- **Terminado cuando:** builds reproducibles con hashes; `pip-audit` y Dependabot activos; errores 5xx visibles con `request_id`; E2E del flujo "crear evaluación → cargar entrega → generar (mock) → aprobar → exportar" en CI; documentación vigente única.

## 14. Aspectos que no pudieron verificarse

- **Rol y URI de `DATABASE_URL` en Render** (secreto): se infiere un rol privilegiado por el acceso a `auth.users`, pero no se confirmó (AUD-006).
- **Variables de entorno reales de producción** (proveedor IA activo, claves, `SUPABASE_JWT_SECRET`, SMTP). Sólo se observó que existe 1 fila en `ai_provider_config` (no se leyó su contenido).
- **Comportamiento en ejecución** de AUD-002 y AUD-003: deducidos de código + esquema real; no se reprodujeron para no escribir en producción. Son reproducibles en el *stack* local de Supabase.
- **Evasión del throttle vía `X-Forwarded-For` en producción**: no se probó (sería una prueba de abuso). Depende de cómo Cloudflare/Render reescriban la cabecera.
- **Límites exactos** del plan de Supabase (conexiones del pooler) y del health check de Render.
- **Configuración de Supabase Auth** más allá del advisor (expiración de JWT, confirmación de correo, URLs de redirección permitidas).
- **Accesibilidad** con lectores de pantalla y rendimiento real de renderizado: sólo se revisó estáticamente (atributos ARIA, foco en modales y guía).
- **Vulnerabilidades conocidas** de las versiones instaladas: no se ejecutó `pip-audit` (implicaría instalar herramientas).
- **Contenido de datos**: por restricción explícita, no se revisó ninguna fila con datos personales.

## 15. Conclusiones

MaestrIA tiene una base sólida en lo que más importa para una plataforma educativa: **los datos de cada docente están bien aislados**, la identidad se valida correctamente y la IA queda subordinada a la decisión del profesor con trazabilidad de cambios. No hace falta una reescritura.

Los problemas reales son de **madurez operativa**: la plataforma todavía no está preparada para el uso simultáneo que generará la IA, algunas restricciones de la base que protegen la integridad se manifiestan como errores 500 en flujos cotidianos, y las pruebas no reflejan el esquema que corre en producción. A eso se suman decisiones de privacidad (procesamiento externo, retención, borrado) que hoy dependen sólo de la configuración y de la buena práctica de los administradores.

**Por dónde empezar:** Etapa 1, con una tarea en paralelo de la Etapa 2 (regenerar `test_schema.sql` desde el esquema real). Son cambios de bajo esfuerzo que eliminan los fallos visibles, protegen la disponibilidad ante la primera carga real de correcciones y dejan una red de pruebas confiable para todo lo que sigue.
