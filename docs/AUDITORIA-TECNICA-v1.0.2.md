> **Auditoría histórica:** sus conclusiones de autorización de IA y algunos detalles de implementación quedaron superados por cambios posteriores. Usá el informe raíz `ANALISIS-ESTABILIZACION-REFACTORING.md` como auditoría vigente.

# MaestrIA v1.0.2 — auditoría de rendimiento, guía, estadísticas, IA y Supabase

Fecha de auditoría: 5 de noviembre de 2026.

## 1. Resumen ejecutivo

La lentitud percibida no estaba explicada por el peso individual de los recursos ni por una consulta SQL lenta claramente identificable. El espacio docente descargaba seis hojas de estilo independientes y no mostraba el panel hasta terminar siete cargas adicionales, aunque ya tenía un endpoint compacto (`dashboard/overview/`) con los datos esenciales. La ruta de corrección de una entrega también abría un cliente HTTP nuevo por respuesta, lo que repetía conexiones TLS hacia el proveedor de IA.

La solución elegida conserva HTML/CSS/ES modules nativos, Django/DRF y el esquema físico existente. No se añade React, un bundler, Redis, Celery, una CDN ni una caché distribuida: su coste operativo no está justificado por el tamaño actual del sistema ni por las métricas de PostgreSQL revisadas.

## 2. Estrategias consideradas

| Estrategia | Beneficio | Coste/riesgo | Decisión |
|---|---|---|---|
| Unificar CSS y precargar el módulo principal | Menos solicitudes y menos rondas de red en la carga inicial | Muy bajo; requiere respetar el orden de cascada | **Aplicada** |
| Pintar el resumen antes de listas secundarias | Mejora el tiempo hasta el primer contenido útil | Bajo; separar datos esenciales de secundarios | **Aplicada** |
| Compilar/minificar todo el frontend con Vite/Rollup | Reduce el número total de recursos y permite tree-shaking | Añade build, dependencias, sourcemaps y mantenimiento | No aplicada todavía |
| Mover assets a CDN/servicio estático independiente | Puede mejorar distribución global y descarga | Configuración extra, CORS/orígenes y despliegue separado | No justificada para un único dominio |
| Ajustar SQL e índices de forma general | Puede ayudar con volumen alto | Riesgo de índices innecesarios o regresiones | No aplicado: las consultas de la aplicación observadas son rápidas |
| Añadir Redis/Celery para IA | Desacopla trabajos largos de la petición web | Requiere broker, worker, estados, reintentos y supervisión | No aplicado al MVP; reconsiderar con uso y carga reales |
| Reutilizar conexiones HTTP de IA | Evita repetir handshake/conexión por cada respuesta | Bajo; un cliente por operación con cierre garantizado | **Aplicada** |

## 3. Cambios implementados

### Frontend y carga inicial

- Se creó `frontend/assets/css/workspace.css`, concatenando los seis estilos del espacio docente en el orden original. No se alteró la cascada intencional.
- `espacio-docente/index.html` ahora carga un único CSS versionado (`?v=1.0.2`) y precarga el módulo raíz del espacio docente. WhiteNoise sigue comprimiendo/serviendo los estáticos.
- El resumen `dashboard/overview/` se solicita separadamente de las listas de uso secundario. Cuando llega, se representa inmediatamente; los demás recursos se siguen cargando con concurrencia acotada.
- Cursos, evaluaciones y contadores del panel aprovechan el payload compacto del overview, y las listas completas se reconcilian al terminar.
- No se cambió el diseño visual ni se migró el frontend a un framework.

### Guía de inicio

- Se agregó delegación de eventos para `close`, `previous`, `next` y `go` en el listener global del documento.
- `X`, Escape y “Lo veo después” descartan la guía sin marcarla como completada. El descarte evita que se reabra en cada render dentro de la misma pestaña; el botón de ayuda permite abrirla nuevamente.
- La finalización explícita se conserva como preferencia de sesión y se restaura el foco al control que abrió el diálogo cuando sigue disponible.

### Backend y concurrencia

- Render y Docker usan Gunicorn `gthread`, 2 workers y 4 threads por worker. Esto permite atender varias solicitudes WSGI durante esperas de red sin cambiar el servidor Django.
- Las correcciones múltiples conservan el semáforo acotado por solicitud y comparten un único `httpx.AsyncClient` con keep-alive entre las llamadas al proveedor.
- Se alinea el timeout del proveedor, el formulario administrativo, el ORM y la configuración del deploy a un máximo de 18 segundos por llamada. Con hasta 10 respuestas y concurrencia de 3, el tiempo de espera externo máximo teórico por lotes baja de aproximadamente 140 s (35 s × 4 lotes) a 72 s (18 s × 4 lotes), más validaciones y persistencia. Es un límite operativo, no una garantía de latencia del modelo.
- `ai_generation.error_code` ahora registra categorías estables, por ejemplo `HTTP_429`, `PROVIDER_TIMEOUT`, `MISSING_GEMINI_API_KEY` y `GEMINI_PAID_TIER_NOT_CONFIRMED`. No guarda cuerpos de respuesta, claves, prompts ni datos de estudiantes.

## 4. Estadísticas y comportamiento del dashboard

El endpoint `GET /api/dashboard/overview/` calcula los contadores en el servidor y filtra por el propietario autenticado:

- Cursos: activos.
- Evaluaciones: excluye archivadas.
- Estudiantes: activos.
- Entregas: total del propietario.
- Por revisar: correcciones en estado `pending_review`.
- Revisadas: correcciones en estado `approved`.
- Actividad reciente: últimos ocho eventos del propietario.

El panel presenta esos agregados sin esperar la descarga de las listas. Para el detalle de la cola, usa después `corrections/?summary=1` (payload compacto, sin JSON de propuesta ni respuestas completas). La estimación de tiempo ahorrado se mantiene marcada como orientativa: es `8 minutos × devoluciones aprobadas`, no tiempo medido.

La suite ya contiene pruebas de integración para el aislamiento por propietario y los totales del resumen (`backend/apps/core/test_workspace.py`). Se agregó cobertura para las nuevas categorías de error de IA. Estas pruebas no se ejecutaron en este contenedor porque no están instaladas las dependencias Django/DRF; se validaron sintaxis e imports estáticos.

## 5. Auditoría de Supabase y compatibilidad ORM

### Compatibilidad del esquema

Se inspeccionaron las tablas y columnas de `public` y se cotejaron con `backend/apps/core/models.py` y `verify_public_schema.py`. Las tablas de dominio esperadas existen y no se detectó una diferencia crítica de columnas/tipos que justificara reconstruirlas. Los modelos Django siguen siendo `managed = False`: Supabase es la fuente de verdad del esquema.

La única modificación de contrato incluida en esta versión es `ai_provider_config.timeout_seconds`: default 18 y rango permitido 5–18, alineados con el backend. La columna sigue siendo `smallint NOT NULL`.

### Migración aplicada

Supabase registró correctamente la migración `20261105202119 / maestria_v1_0_2_hardening`.

- Cambió el default y el CHECK del timeout de proveedores.
- Fijó el `search_path` en las ocho funciones de trigger que no lo tenían fijado.
- Revocó ejecución directa de `maestria_sync_auth_user_profile()` a `PUBLIC`, `anon` y `authenticated`. La función conserva `search_path = ''` y referencias calificadas; se utiliza como trigger de `auth.users`, no como RPC.
- No borró tablas, filas ni índices y no modificó datos académicos.

Verificación posterior: el default de `timeout_seconds` es `18`, el CHECK permite `5..18`, las funciones indicadas tienen `search_path` configurado y `has_function_privilege` devuelve falso para `anon`/`authenticated` sobre la función trigger. El linter de salud devolvió cero hallazgos.

### Advertencias pendientes

- `ai_provider_config` y `contact_message` tienen RLS activo sin políticas. Se mantienen así intencionalmente: ambas son tablas internas y el acceso directo mediante la API pública debe seguir denegado. No se deben agregar políticas amplias `SELECT`/`ALL`.
- Supabase sigue avisando que la protección contra contraseñas filtradas está deshabilitada. Activarla desde la configuración de Auth del proyecto.
- El advisor informa ocho FK sin índice hacia `auth.users` sobre columnas de auditoría/administración (`updated_by`, `created_by`, `invited_by`, etc.). Las tablas son pequeñas y el uso esperado de esas referencias es escaso; indexarlas todas ahora añade mantenimiento sin beneficio demostrado. Revaluar si aumentan los usuarios o las operaciones de borrado de identidades.
- Siguen apareciendo índices duplicados y no utilizados. No se eliminaron automáticamente porque las estadísticas de uso son recientes y algunos índices respaldan constraints o integridad. Hacer limpieza sólo con inventario exacto de constraints, índices y una ventana representativa de uso.

## 6. PostgreSQL: lectura de métricas

En `pg_stat_statements`, las consultas atribuibles a modelos del panel observadas tuvieron medias aproximadas de 0,1–0,75 ms y máximos inferiores a 5,4 ms en la muestra consultada. Los acumulados más altos correspondían principalmente a introspección del catálogo PostgreSQL/Supabase (metadatos, extensiones, esquemas y políticas), no a una consulta de negocio del panel.

Conclusión: no había evidencia suficiente para agregar índices, caché o reescribir consultas del dashboard. Repetir medición con datos representativos y tráfico real luego del redeploy.

## 7. IA: configuración y privacidad

- El modelo configurado `gemini-3.5-flash-lite` existe y Google lo documenta como modelo estable de baja latencia/coste; también figura compatible con structured outputs. Referencias: <https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite> y <https://ai.google.dev/gemini-api/docs/structured-output>.
- El adaptador usa la API REST `generateContent`, `responseMimeType: application/json`, valida JSON y vuelve a validar la propuesta contra la rúbrica y la evidencia literal del texto. La API key sólo se lee desde el backend.
- La tabla `ai_provider_config` estaba vacía; por ello la aplicación cae al proveedor/modelo del entorno (`AI_PROVIDER`, `GEMINI_MODEL`). Las credenciales no se pueden verificar desde la base de datos.
- `ai_generation` mostraba dos intentos fallidos con Gemini y ningún éxito: uno terminó en error HTTP y otro en RuntimeError. El registro antiguo sólo guardaba el tipo genérico de excepción, de modo que no permite saber si el HTTP fue 400, 403, 404 o 429. A partir de esta versión se guarda sólo la categoría/código HTTP, sin exponer datos sensibles.
- El código mantiene el cierre de privacidad: `AI_EXTERNAL_PROCESSING_APPROVED` debe confirmarse explícitamente y Gemini exige además confirmar el nivel/contrato apropiado antes de procesar respuestas reales. No se cambió esa protección y no se activó desde esta migración.

Para habilitar IA real, comprobar en el entorno privado de Render que `GEMINI_API_KEY` está vigente, el modelo coincide, se conoce el nivel de servicio y se aprobó expresamente el tratamiento de contenido. Luego probar sólo con datos sintéticos; verificar `ai_generation.status = succeeded` y que `error_code` quede vacío. No usar tareas con datos personales reales para diagnosticar credenciales o permisos.

## 8. Verificación ejecutada y limitaciones

Ejecutado correctamente desde la raíz del proyecto:

```bash
python scripts/check_static_frontend.py
python scripts/check_backend_imports.py
python -m compileall -q backend/apps backend/config
```

El primer chequeo valida las 16 páginas HTML, los 28 scripts JavaScript, rutas, exports nombrados y sintaxis Node. El chequeo Python estático valida imports relativos y símbolos entre módulos. `compileall` valida sintaxis Python.

No se ejecutaron `python manage.py check`, `pytest` ni llamadas autenticadas del backend: el contenedor de trabajo no tiene Django/DRF ni credenciales de la base configuradas. Tampoco se pudo obtener una medición HTTP del dominio de Render desde este entorno por una restricción de resolución de DNS. Por eso esta entrega incluye cambios de código y la migración Supabase aplicada, pero **no acredita un deploy ni una medición posterior en producción**.

## 9. Pasos de publicación

1. Revisar el diff y subir los cambios de `maestria-v1.0.2` al repositorio conectado a Render.
2. Desplegar el servicio usando el `render.yaml` actualizado (o sincronizar manualmente el Start Command con `gthread`, 2 workers y 4 threads).
3. En DevTools verificar que el espacio docente descarga `workspace.css` en lugar de seis CSS; revisar tiempos de `dashboard/overview/`, `courses/`, `assessments/` y `corrections/?summary=1`.
4. Comprobar todos los controles de la guía con mouse y teclado, incluyendo Escape y reapertura desde Ayuda.
5. Validar los contadores con un usuario de prueba que tenga cursos, entregas pendientes y aprobadas.
6. Ejecutar las pruebas backend en un entorno de prueba PostgreSQL, nunca apuntadas a producción.
7. Probar IA con contenido sintético y revisar `ai_generation.error_code` ante cualquier error.
8. Medir cold start y p50/p95 de API después del deploy. Si el TTFB del documento sigue alto, investigar plan/arranque de Render y latencia de red antes de añadir caché o mover servicios.
