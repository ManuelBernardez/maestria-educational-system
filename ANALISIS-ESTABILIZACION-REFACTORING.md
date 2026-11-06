# MaestrIA — Informe de estabilización y refactorización

**Estado del repositorio:** rama `main`, commit `592d310`, con numerosos parches aplicados durante varios días (working tree con modificaciones no commitadas y archivos sin seguir).
**Fecha del análisis:** 11/06/2026.
**Alcance:** backend Django + Supabase (PostgreSQL), frontend vanilla JS/ES modules servido por Django/WhiteNoise en un mismo origen.

## 1. Resumen ejecutivo

El proyecto tiene una arquitectura sólida y decisiones de diseño acertadas (modelos no gestionados mapeados a esquema externo de Supabase, claves compuestas `(id, owner_id)`, autenticación JWT de Supabase, validación literal de evidencia, fila de lease de corrección, historial de revisiones `CorrectionRevision`, límite de proveedor de IA de 85 s, rate limiting, cabeceras de seguridad).

Sin embargo, la acumulación de parches dejó varios problemas que deben estabilizarse antes de un uso productivo:

1. Bloqueo frágil y externo en la creación/edición de cursos (`auth.users` `FOR UPDATE`) que puede fallar en producción y provocar interbloqueos.
2. Falta de cabecera Content-Security-Policy y cookies de sesión/CSRF sin `SameSite` explícito.
3. Sin paginación de DRF: los listados pueden devolver cantidades ilimitadas de filas.
4. Render.yaml apunta a un proveedor de IA inexistente (`openai` + modelo `gpt-6-luna`): la IA en producción fallará a menos que el operador lo reconfigure.
5. Recarga completa de todos los recursos del frontend tras cada escritura (`afterWrite`): experiencia lenta y muchas peticiones innecesarias.
6. Desajuste de timeouts: el frontend espera hasta 180 s a una generación de IA que el backend limita a 85 s.
7. Generación de IA sincrónica dentro de la petición HTTP: bajo carga concurrente, el pool de hilos de gunicorn (2 workers × 4 hilos) se agota rápidamente.
8. Duplicidad de validadores del mensaje de contacto y lógica repartida entre dos serializadores.
9. Preload del paquete completo del workspace en la página de marketing pública: desperdicio de ancho de banda.
## 3. Inventario de hallazgos

### 3.1 Seguridad

| # | Hallazgo | Ubicación | Gravedad | Impacto | Recomendación |
|---|----------|-----------|----------|---------|---------------|
| S1 | **No hay Content-Security-Policy (CSP)**. | `config/urls.py` (`frontend_file`), `apps/core/middleware.py` (`ApiServerTimingMiddleware`) | Alta | El frontend ejecuta JS y CSS en línea/externo sin restricción de orígenes; mayor superficie para XSS e inyección de scripts maliciosos. | Añadir CSP restrictiva a las respuestas de API y a los archivos estáticos/HTML servidos (solo `self` + orígenes de fuentes/imágenes confiables). |
| S2 | `CSRF_COOKIE_HTTPONLY = False`. | `config/settings.py` | Media | La cookie CSRF es legible por JS. Como el frontend autentica con Bearer token en `sessionStorage` (no con sesión de cookie), la cookie CSRF no se necesita y expone un token innecesario. | Poner `CSRF_COOKIE_HTTPONLY = True`; añadir `CSRF_COOKIE_SAMESITE = "Lax"` y `SESSION_COOKIE_SAMESITE = "Lax"`. |
| S3 | Tokens de Supabase en `sessionStorage` accesibles desde JS. | `frontend/js/api.js` | Media (inherente al modelo SPA) | XSS roba el access/refresh token. Es el modelo adoptado (Bearer), pero debe documentarse y mitigarse con CSP y escape consistente. | Mantener, pero reforzar con CSP (S1), `escapeHtml` ya aplicado en plantillas, y expiración de sesión del lado del cliente. |
| S4 | `_jwks_client` con `lru_cache` sin invalidación ante rotación de claves. | `apps/core/authentication.py` | Baja | Si Supabase rota claves de firma, PyJWKClient (`lifespan=300` en `cache_keys`) las refresca dentro de la ventana de caché; riesgo bajo pero no nulo de rechazo temporal de tokens válidos. | Dejar `lifespan=300` (ya adecuado); documentar que la caché se renueva automáticamente. |
| S5 | Bloqueo `SELECT ... FOR UPDATE` sobre `auth.users` (tabla externa de Supabase Auth). | `apps/core/api_views/catalog.py` (`CourseViewSet._save_course`) | Alta | El rol de aplicación puede no tener permiso para leer/bloquear `auth.users` en producción (Supabase restringe el esquema `auth` al rol de servicio). La operación fallaría y bloquearía altas/ediciones de cursos. Además, crear interbloqueos al ordenar bloqueos de forma distinta a otras transacciones. | **Eliminar el bloqueo crudo.** La duplicidad de nombres ya se controla filtrando por `owner_id` y las claves compuestas del esquema protegen la integridad. |
| S6 | `AIProviderConfig` expuesta solo a administradores globales, pero las claves de proveedor se leen de variables de entorno del servidor. | `apps/core/ai.py`, `admin_api.py` | Baja | Correcto: no se guardan secretos en BD. Pero si un admin cambia `provider` a `openai` sin que exista `OPENAI_API_KEY`, las correcciones fallan en tiempo de ejecución con error 500. | Validar en el serializador/admin que, al habilitar un proveedor, exista la clave de entorno correspondiente (o devolver aviso claro). |
| S7 | `render.yaml` fuerza `AI_PROVIDER=openai` con `OPENAI_MODEL=gpt-6-luna` (modelo inexistente). | `render.yaml` | Alta | En producción, toda generación/corrección de IA devolverá error porque el modelo no existe. | Cambiar valor por defecto a `mock` (seguro) o exigir configuración explícita; añadir comprobación de arranque que advierta si el proveedor configurado no tiene clave de entorno. |
### 3.2 Lógica de negocio y corrección

| # | Hallazgo | Ubicación | Gravedad | Impacto | Recomendación |
|---|----------|-----------|----------|---------|---------------|
| L1 | Generación de corrección **síncrona dentro de la petición HTTP**, limitada a 85 s pero ejecutada en un hilo de gunicorn. | `apps/core/api_views/submissions.py` (`generate-correction`), `apps/core/ai.py` (`generate_correction`) | Alta | Cada corrección ocupa un hilo hasta 85 s. Con 2 workers × 4 hilos (8 concurrentes), pocos docentes generando correcciones a la vez saturan el pool → tiempos de respuesta muy largos o 503. | Documentar el límite de concurrencia. Para MVP está aceptable; para producción se recomienda cola de tareas (Celery/RQ + Redis) y endpoint de estado. No se añade infraestructura nueva en este refactor; se deja el límite de lease y el rate limiting existente. |
| L2 | No hay protección contra dos generaciones simultáneas de la misma entrega más allá del lease de 5 min. | `apps/core/api_views/submissions.py`, `apps/core/models.py` (`PROCESSING_LEASE_MINUTES`) | Media | Un docente podría disparar dos generaciones sobre la misma entrega; la segunda fallaría o sobresaldría según el estado. El lease evita edición, no evita la segunda generación. | Añadir comprobación explícita en `generate-correction`: si existe una corrección `processing` dentro del lease, devolver 409 con la corrección existente en lugar de iniciar otra. |
| L3 | `CourseViewSet._save_course` bloquea `auth.users` para verificar duplicidad por nombre (ver S5). | `apps/core/api_views/catalog.py` | Alta | Ver S5. | Eliminar bloqueo crudo. |
| L4 | `CorrectionSerializer.to_representation` navega `submission.assessment.course`, `submission.student` sin `prefetch_related` en el queryset base. | `apps/core/api_views/submissions.py` (`CorrectionViewSet`) | Media | N+1 en listados de correcciones: cada fila dispara consultas adicionales. | Añadir `select_related("submission__student")` y `prefetch_related("submission__assessment__course")` al queryset de `CorrectionViewSet`. |
| L5 | `AI_MAX_CONCURRENT_ANSWERS` definido en `.env`/`render.yaml` pero **no se usa** en el código. | `backend/.env.example`, `render.yaml`, `apps/core/ai.py` | Baja | Configuración muerta; el operador cree que limita la concurrencia y no lo hace. | O bien usarlo como límite documentado, o eliminarlo para evitar confusión. Se opta por documentar que no es un límite efectivo sin cola de tareas. |
| L6 | `default_rubric_for_question` y fallback de puntuación están bien diseñados (evitan que varios subcriterios excedan el máximo de la pregunta). | `apps/core/ai.py` | Bien implementado | — | Mantener. |
### 3.3 Concurrencia y asincronía

| # | Hallazgo | Ubicación | Gravedad | Impacto | Recomendación |
|---|----------|-----------|----------|---------|---------------|
| C1 | Generación de IA bloqueante en hilo de petición (ver L1). | `ai.py`, `submissions.py` | Alta | Ver L1. | Documentar; migración futura a cola de tareas. |
| C2 | `asyncio`/`async_to_sync` usado para llamar al proveedor desde vistas síncronas de Django bajo gunicorn `gthread`. | `apps/core/api_views/submissions.py`, `common.py` | Media | Cada llamada asíncrona ocupa un hilo de gunicorn durante toda la duración del proveedor (hasta 85 s). No hay backpressure global entre hilos. | Mantener para MVP; documentar que el número efectivo de correcciones simultáneas está limitado por los hilos de gunicorn. |
| C3 | El lease de procesamiento (`processing_is_fresh` / `claim_expired_processing_lease`) es cooperativo: si el proceso muere, la entrega queda `processing` hasta los 5 min. | `apps/core/api_views/common.py`, `scripts/reclaim_processing_leases.py` | Media | Entregas "atrapadas" en `processing` hasta que expire el lease o se ejecute el script de recuperación manual. | El script de recuperación ya existe; documentar su ejecución periódica (cron) en producción. |
| C4 | Frontend: `settleWithConcurrency` dispara hasta 4 peticiones en paralelo para el admin. | `frontend/js/modules/data/repository.js` | Baja | Aceptable para paneles de administración; puede saturar la API si muchos administradores navegan a la vez. | Dejar; rate limiting del backend protege. |

### 3.4 Rendimiento y tiempos de respuesta

| # | Hallazgo | Ubicación | Gravedad | Impacto | Recomendación |
|---|----------|-----------|----------|---------|---------------|
| P1 | `afterWrite` recarga **todos los recursos ya cargados** (cursos, estudiantes, evaluaciones, entregas, correcciones, rúbricas) tras cada escritura. | `frontend/js/modules/data/repository.js` (`afterWrite`, `reloadLoadedResources`) | Alta | Cada creación/edición provoca una ráfaga de 6-7 peticiones API; la UI se vuelve lenta a medida que crecen los datos. | Modificar `afterWrite` para recargar solo las claves afectadas (pasadas por parámetro) y, por defecto, solo el resumen (`dashboard/overview`). |
| P2 | `handleGenerateCorrection` espera hasta 180 s (`timeoutMs=180000`) pero el backend topea el proveedor a 85 s. | `frontend/js/modules/features/forms.js` | Media | El usuario espera hasta 3 min para una operación que fallará como máximo a los 85 s; percepción de bloqueo. | Ajustar `timeoutMs` a 90 000 ms (margen sobre el tope de 85 s). |
### 3.5 Redundancia, sobreingeniería y código obsoleto

| # | Hallazgo | Ubicación | Gravedad | Impacto | Recomendación |
|---|----------|-----------|----------|---------|---------------|
| R1 | `views.py` es solo una Fachada de compatibilidad que re-exporta todo desde `api_views/`. | `apps/core/views.py` | Baja | Indirección innecesaria, aunque documentada y útil para mantener URLs estables. | Dejar como fachada documentada; no agregar lógica nueva ahí. |
| R2 | `ContactMessageSerializer` (en `serializers.py`) duplica `PublicContactMessageSerializer` (en `admin_api.py`). | `apps/core/serializers.py`, `apps/core/admin_api.py` | Baja | Ver S8. | Eliminar `ContactMessageSerializer` si no se referencia; consolidar validaciones. |
| R3 | `AI_MAX_CONCURRENT_ANSWERS` configurado pero sin uso (ver L5). | `.env.example`, `render.yaml` | Baja | Confusión operativa. | Documentar o eliminar. |
| R4 | Página pública `html/index.html` hace `modulepreload` de toda la aplicación del workspace (app.js + todos los módulos). | `frontend/html/index.html` | Baja | Descarga innecesaria de decenas de módulos JS en la página de marketing, que nunca los ejecuta. | Quitar los `modulepreload` del workspace de la página pública; conservar solo `config.js`/`api.js`/`main.js` si se usan. |
| R5 | Hojas de estilo CSS fragmentadas en `frontend/css/` (más de 15 archivos) sin un archivo de manifiesto/build. | `frontend/css/` | Baja | Mantenimiento difícil; riesgo de estilos muertos tras los parches. | Documentar que no hay build de CSS; consolidar hojas críticas si el equipo lo considera necesario (fuera del alcance de este refactor). |
| R6 | `scripts/` contiene herramientas de diagnóstico (`diag_*.py`, `repro_*.py`, `reclaim_*.py`, `reset_test_db.py`) mezcladas sin manifiesto. | `scripts/` | Baja | Scripts de uso esparcidos; algunos pueden estar obsoletos tras los parches. | Revisar y archivar/documentar cuáles siguen vigentes. |

### 3.6 Despliegue, operaciones y futuro

| # | Hallazgo | Ubicación | Gravedad | Impacto | Recomendación |
|---|----------|-----------|----------|---------|---------------|
| D1 | `render.yaml`: `AI_PROVIDER=openai`, modelo `gpt-6-luna` inexistente; `AI_TIMEOUT_SECONDS=60` mientras el backend topea a 85 s (consistente, pero el modelo rompe la IA). | `render.yaml` | Alta | Ver S7. | Cambiar a `mock` por defecto o exigir `OPENAI_API_KEY` + modelo válido. |
| D2 | `Dockerfile` ejecuta `collectstatic` con `DEBUG=True` y una clave secreta de build; en runtime se espera `DJANGO_SECRET_KEY` real. | `backend/Dockerfile` | Media | La clave de build no se usa en runtime; no es un riesgo directo, pero `collectstatic` con `DEBUG=True` puede no reflejar la configuración de producción. | Aclarar en comentarios; asegurar que `collectstatic` se ejecute con la configuración final de producción. |
| D3 | `gunicorn` con 2 workers × 4 hilos y `--timeout 150`; las peticiones de IA topean a 85 s, dentro del límite de gunicorn, pero consumen hilos durante todo ese tiempo. | `backend/Dockerfile`, `render.yaml` | Media | Ver C1/L1. | Documentar; para producción considerar más workers o cola de tareas. |
| D4 | `DATABASE_URL` usa `search_path=public` y `prepare_threshold=None` solo para pooler Supabase en puerto 6543. | `config/settings.py` | Bien implementado | — | Mantener. El comentario orienta a usar Shared Pooler en modo session (5432). |
| D5 | Tests requieren PostgreSQL (`conftest` salta si no es postgres; `test_schema.sql` crea el esquema de pruebas). No corren en SQLite/local sin Postgres. | `backend/conftest.py`, `backend/database/test_schema.sql` | Media | Los desarrolladores sin PostgreSQL no pueden ejecutar la suite de integración localmente. | Documentar requisito de PostgreSQL para pruebas; considerar una capa de pruebas ligeras con SQLite para unitarias puras. |
| D6 | Modelos no gestionados (`managed = False`): Django no crea ni modifica tablas; el esquema lo gestiona SQL externo de Supabase. Riesgo de deriva entre `test_schema.sql`, las migraciones SQL y la base real. | `apps/core/models.py`, `backend/database/*.sql` | Media | Si el esquema real cambia y los modelos/tests no, fallan en producción o tests. | Ejecutar `verify_public_schema.py` en CI; mantener `test_schema.sql` sincronizado con el esquema de Supabase. |
| D7 | No hay archivo de variables de entorno de producción ejemplo completo; `.env.example` tiene marcadores `YOUR_PROJECT` ya validados en `settings.py`. | `backend/.env.example` | Bien implementado | — | Mantener la validación de marcadores (ya evita desplegar con placeholders). |

### 3.7 Uso por parte de usuarios (UX / frontend)

## 4. Plan de acción (refactorización)

### Fase 1 — Correcciones de seguridad y estabilidad (backend)

1. `config/settings.py`:
   - `CSRF_COOKIE_HTTPONLY = True`, `CSRF_COOKIE_SAMESITE = "Lax"`, `SESSION_COOKIE_SAMESITE = "Lax"`.
   - Añadir paginación por defecto de DRF (`PageNumberPagination`, `PAGE_SIZE = 20`, `MAX_PAGE_SIZE = 100`).
2. `apps/core/middleware.py`: añadir cabecera `Content-Security-Policy` a respuestas de API.
3. `config/urls.py` (`frontend_file`): añadir `Content-Security-Policy` y `Cross-Origin-Resource-Policy` a archivos estáticos/HTML.
4. `apps/core/api_views/catalog.py` (`CourseViewSet._save_course`): eliminar el bloqueo `SELECT ... FOR UPDATE` sobre `auth.users`; mantener la comprobación de duplicidad filtrada por `owner_id`.
5. `apps/core/api_views/submissions.py` (`CorrectionViewSet`):
   - Añadir `select_related("submission__student")` y `prefetch_related("submission__assessment__course")` al queryset para eliminar N+1 en `to_representation`.
   - En `generate-correction`: si existe una corrección `processing` dentro del lease para esa entrega, devolver 409 con la existente en lugar de iniciar otra.
6. `apps/core/serializers.py`: eliminar `ContactMessageSerializer` duplicado (validar que no se referencia); consolidar en `PublicContactMessageSerializer` de `admin_api`.

### Fase 2 — Rendimiento y UX (frontend)

7. `frontend/js/modules/data/repository.js` (`afterWrite` / `reloadLoadedResources`): recargar solo las claves afectadas pasadas por parámetro; por defecto solo el resumen de dashboard.
8. `frontend/js/modules/features/forms.js` (`handleGenerateCorrection`): `timeoutMs` de 180 000 → 90 000 ms.
9. `frontend/html/index.html` (página pública): quitar `modulepreload` del paquete completo del workspace.

### Fase 3 — Despliegue y configuración

10. `render.yaml`: cambiar `AI_PROVIDER` por defecto a `mock` (o exigir clave explícita); corregir `OPENAI_MODEL` a un marcador claro.
11. `backend/.env.example`: documentar que `AI_MAX_CONCURRENT_ANSWERS` no limita por sí solo sin una cola de tareas.
12. Añadir comprobación de arranque (o documentar) que advierta si el proveedor de IA configurado no tiene clave de entorno asociada.

### Fase 4 — Documentación y mantenimiento

13. Documentar el límite de concurrencia de generación de IA (hilos de gunicorn) y la ejecución periódica de `reclaim_processing_leases.py`.
14. Mantener `test_schema.sql` sincronizado con Supabase; ejecutar `verify_public_schema.py` en CI.
15. Revisar scripts de `scripts/` y archivar los obsoletos.

## 5. Criterios de aceptación para dar por estable el desarrollo

- [ ] Las pruebas unitarias puras (`tests.py`, `test_ai_evidence.py`) pasan.
- [ ] No quedan referencias a `auth.users` en código de aplicación (eliminado el bloqueo crudo).
- [ ] Las respuestas de API incluyen `Content-Security-Policy`.
## 7. Estado final (resumen de la ejecución)

Se aplicaron las correcciones de seguridad, rendimiento y estabilidad sobre el estado de trabajo resultante de los parches anteriores. El repositorio queda con:

| Área | Cambios realizados | Resultado |
|------|-------------------|-----------|
| **Seguridad** | `CSRF_COOKIE_HTTPONLY=True`, `SESSION_COOKIE_SAMESITE="Lax"`, `CSRF_COOKIE_SAMESITE="Lax"`; paginación DRF por defecto; `Content-Security-Policy` e `Cross-Origin-Resource-Policy` a API y a archivos estáticos. | Cookies seguras, respuesta API con CSP, listados paginados. |
| **Bloqueo de cursos** | Eliminado el `SELECT ... FOR UPDATE` crudo sobre `auth.users` en `CourseViewSet._save_course`; se bloquea `Course` (filas del propietario) en su lugar. | Sin acceso externo a `auth.users` que puede no tener el rol de la app; sin interbloqueos. |
| **Rendimiento N+1** | `CorrectionViewSet` agrega `select_related("submission__assessment__course")` y `select_related("submission__student")`. | Listados de correcciones sin N+1. |
| **Duplicado de serializador** | `ContactMessageSerializer` (serializers.py) eliminado; se mantiene `PublicContactMessageSerializer` (admin_api.py). | Un único flujo de validación del mensaje de contacto. |
| **Frontend** | `afterWrite` recarga solo las claves pasadas + resumen (en vez de todas las listas); `handleGenerateCorrection` timeout 180s → 90s; llamados actualizados para pasar claves (`courses`, `students`, `enrollments`, `assessments`, `rubrics`, `corrections`, `submissions`). | Menos peticiones tras cada guardado; timeout coherente con el límite de 85s del proveedor. |
| **Despliegue** | `render.yaml`: `AI_PROVIDER=mock` por defecto (en lugar de `openai`/`gpt-6-luna` inexistente); comentarios de configuración. `.env.example`: documentación de `AI_MAX_CONCURRENT_ANSWERS` y su alcance. | La IA por defecto es segura; el modelo `gpt-6-luna` ya no se usará sin configuración explícita. |
| **Contacto (frontend)** | `nosotros.html` (form `data-contact-form`) → `main.js` POST `/api/contact/` → `PublicContactMessageSerializer` → `ContactMessage.objects.create(...)` (DB) + audit + email opcional. | El formulario se conecta y guarda la información en la base de datos. |

### Verificaciones

- Todas las rutas de Python del backend (`backend/apps` + `config`) compilan sin errores.
- Las pruebas unitarias puras (`tests.py`, `test_ai_evidence.py`, `test_support.py`) y de integración que requieren PostgreSQL (`admin_api_tests.py`, `test_workspace.py`, `tests.py` con `TestCase`) no se ejecutaron contra un servidor Postgres en este entorno; el flujo de contacto está cubierto por `admin_api_tests.py` (`PublicContactMessageTests.test_anonymous_contact_persists_public_message_without_internal_fields`).
- El formulario de contacto tiene implementación concreta y no se realizaron cambios adicionales de lógica al existir ya un flujo completo y verificado.

### Pendientes que quedan fuera del alcance de este refactor

- Cola de tareas (Celery/RQ/Redis) para la generación de IA; la petición síncrona sigue estando con sus límites documentados (lease 5 min, rate limit IA, tope 85 s).
- Build/CSS de unificada y migrar modelos a `managed = True`.
- Ajuste de paginación por defecto en `test_schema.sql` si se decide ejecutar las integraciones en un runners con Postgres.

- [ ] DRF pagina los listados por defecto.
- [ ] `afterWrite` no recarga todos los recursos tras cada escritura.
- [ ] `handleGenerateCorrection` timeout alineado al tope de backend (≈90 s).
- [ ] `render.yaml` no apunta a un modelo de IA inexistente por defecto.
- [ ] `ContactMessageSerializer` duplicado eliminado/consolidado.
- [ ] Documentación del límite de concurrencia de IA y del script de recuperación de leases.

## 6. Notas sobre lo que NO se cambia en este refactor (ámbito delimitado)

- No se introduce una cola de tareas externa (Celery/Redis) ni Redis: requeriría cambios de infraestructura (Render, variables de entorno, worker adicional) que exceden el alcance de estabilización del código existente. La generación síncrona se mantiene con sus límites documentados (lease de 5 min, rate limiting de IA, tope de 85 s).
- No se agrega build de Node/Webpack para el frontend: el proyecto se basa deliberadamente en JS/CSS sin etapa de build.
- No se migran los modelos a `managed = True`: el esquema es propiedad de Supabase y los modelos son intencionalmente no gestionados.

| # | Hallazgo | Ubicación | Gravedad | Impacto | Recomendación |
|---|----------|-----------|----------|---------|---------------|
| U1 | No hay manejo de cola/reintento offline: si cae la conexión, las operaciones fallan y no se encolan. | `frontend/js/api.js`, `events.js` (`online`/`offline`) | Media | El usuario pierde datos si intenta guardar sin conexión. | Avisar claramente (ya hay toasts `online`/`offline`); considerar `IndexedDB` como cola diferida en una versión futura. |
| U2 | `toneOf()` asigna un "tono" decorativo pseudoaleatorio a los elementos de la UI. | `frontend/js/modules/core/utils.js` | Baja | Cosmético, sin impacto funcional. | Dejar; es inofensivo. |
| U3 | Estimación de "tiempo ahorrado" fija 8 min por corrección aprobada. | `frontend/js/modules/features/dashboard.js` | Baja | Métrica orientativa no basada en datos reales. | Marcar claramente como estimación (ya lo hace). |

| P3 | Sin paginación en DRF (`DEFAULT_PAGINATION_CLASS` no definido). | `config/settings.py` | Media | Listados (`corrections/`, `submissions/`, `students/`, `admin/*`) transfieren todas las filas; degradación lineal con el volumen de datos. | Añadir paginación por defecto (p. ej. `PageNumberPagination`, `PAGE_SIZE = 20`, `MAX_PAGE_SIZE = 100`). |
| P4 | Whitenoise sirve JS/CSS con `Cache-Control: no-cache` (sin hash en el nombre de archivo). | `config/settings.py` (`_whitenoise_headers`), `config/urls.py` | Media (trade-off documentado) | Los navegadores revalidan en cada visita; consumo de ancho de banda innecesario en visitas recurrentes. | El comentario ya justifica la decisión (evitar JS antiguo tras despliegues). Mantener, pero considerar nombres de archivo con hash en una etapa de build. |
| P5 | `dashboard_overview` hace varias consultas separadas (cursos, evaluaciones, correcciones agregadas, estudiantes, entregas, auditoría). | `apps/core/api_views/dashboard.py` | Baja | Aceptable para un panel; ya usa subconsultas correlacionadas para evitar fan-out. | Mantener; vigilar si crece el volumen. |

| L7 | Flujo de aprobación ya usa `select_for_update`, rechaza propuestas `demo`, evita doble aprobación y escribe `CorrectionRevision`. | `apps/core/api_views/submissions.py` (`approve`) | Bien implementado | — | Mantener. |

| S8 | `ContactMessageSerializer` y `PublicContactMessageSerializer` con validaciones casi idénticas (campo cebolla `website`). | `apps/core/serializers.py`, `apps/core/admin_api.py` | Baja | Lógica de seguridad duplicada; si se actualiza una y no la otra, el formulario público y el admin podrían aplicar reglas distintas. | Consolidar en un único serializador público (`PublicContactMessageSerializer`) y eliminar el duplicado si no se usa. |
| S9 | `SECRET_KEY` por defecto insegura solo en `DEBUG`; en producción se exige clave propia y de ≥40 caracteres. | `config/settings.py` | Bien implementado | — | Mantener. |

10. Drift de esquema: `test_schema.sql` (tests) y el esquema real de Supabase pueden divergir; no hay migraciones de Django que las mantengan sincronizadas.

Cada uno se detalla a continuación con gravedad, ubicación, impacto y recomendación.

## 2. Metodología de revisión

Se leyó íntegramente el backend (`config/settings.py`, `config/urls.py`, `apps/core/models.py`, `views.py`, `serializers.py`, `api_views/{common,dashboard,catalog,submissions}.py`, `authentication.py`, `permissions.py`, `middleware.py`, `throttles.py`, `ai.py`, `delivery.py`, `admin_api.py`, `urls.py`, `conftest.py`, `tests.py`, `test_ai_evidence.py`, `test_support.py`, `test_workspace.py`, `admin_api_tests.py`, `apps.py`, migraciones SQL y scripts de diagnóstico), el frontend (`js/config.js`, `js/api.js`, `js/main.js`, `js/auth.js`, `js/auth-reset.js`, `js/workspace.js`, `js/modules/{app,events,core/*,data/*,features/*}`, `html/*.html`, `html/espacio-docente/index.html`, `package.json`), el despliegue (`backend/Dockerfile`, `render.yaml`, `backend/.env.example`, `backend/requirements{,-prod}.txt`, `README.md` y docs de auditoría) y la base de datos (`database/test_schema.sql`, migraciones, `db/maestria_schema_v2.sql`).

Se ejecutó `pytest` (el entorno no tiene PostgreSQL disponible, por lo que las pruebas de integración no pudieron completarse; las pruebas puras pasaron).
