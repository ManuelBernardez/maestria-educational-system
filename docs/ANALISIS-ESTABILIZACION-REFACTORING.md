# MaestrIA — Auditoría integral y estabilización técnica

**Fecha:** 6 de noviembre de 2026
**Base recibida:** `HEAD 74fdf7c0dec83159a4ec6db18fad41a9a0b2ab38` (`Cerrar versión 1.0`)
**Commit inmediatamente anterior:** `592d310` (`fix: corregir edición de evaluaciones y consignas, estados de cursos y formato numérico`)
**Estado recibido:** repositorio Git en detached HEAD, con 133 archivos modificados y archivos nuevos sin seguimiento respecto del `HEAD` recibido.
**Alcance:** backend Django + Django REST Framework, Supabase Auth/PostgreSQL, frontend HTML/CSS/JavaScript nativo, configuración Render/Docker, scripts, CI y documentación.

> Este informe reemplaza los diagnósticos anteriores como referencia de estabilización. No se descartó ni sobrescribió el conjunto de cambios locales recibido. El ZIP de entrega conserva el historial Git y las modificaciones; no se creó un commit ni se desplegó el servicio.

## 1. Resumen ejecutivo

El estado recibido ya incluía una parte importante del trabajo del resumen original: cookies seguras, cabeceras de seguridad, formulario de contacto persistido, paginación parcial de DRF, `AI_PROVIDER=mock` como valor de Render, eliminación de un serializador duplicado y optimizaciones de `afterWrite`. Reaplicar literalmente aquel resumen habría duplicado código o introducido configuraciones incorrectas.

Se implementaron las correcciones que seguían faltando o que eran necesarias para que las piezas existentes funcionaran juntas:

1. **CSP estricta y compatible:** se mantuvo `style-src` sin `'unsafe-inline'`; se retiraron estilos/scripts inline y escrituras directas de estilos desde JavaScript, se movieron las reglas de reset de contraseña a `auth.css` y se añadió un chequeo automático a CI.
2. **Paginación de extremo a extremo:** DRF utiliza paginación acotada y el cliente recorre todas las páginas mediante enlaces validados contra el origen y la ruta base de la API. Antes, algunas pantallas podían mostrar solamente la primera página.
3. **Concurrencia de datos:** los bloqueos dirigidos a `auth.users` se sustituyeron por bloqueos de la fila de perfil de aplicación y de los recursos propios, evitando depender de permisos sobre el esquema interno de Supabase Auth.
4. **Leases de corrección:** se recuperan leases vencidos antes de impedir mutaciones de evaluaciones/consignas, evitando que entregas abandonadas en `processing` bloqueen indefinidamente.
5. **Límites de IA coherentes:** el servidor limita una generación de corrección a 120 s; los timeouts del cliente dejan margen. Los errores de configuración devuelven 503 y los de timeout 504.
6. **Configuración OpenAI:** se eliminó el fallback a un identificador de modelo ficticio; ahora el modelo debe configurarse de forma explícita. El adaptador usa `max_completion_tokens`.
7. **Refresco institucional:** las escrituras administrativas ahora refrescan también las instituciones/membresías visibles para `institution_admin` y `department_admin`.
8. **Documentación y CI:** se corrigieron enlaces obsoletos, se marcaron guías históricas y se añadieron pruebas estáticas para impedir regresiones CSP.

La estabilización no equivale a certificación de producción. La ejecución integral de Django y las pruebas contra PostgreSQL/Supabase no pudieron ejecutarse en este contenedor: el ZIP contiene un entorno virtual Windows que no se puede utilizar en Linux y no fue posible instalar las dependencias por falta de conectividad al repositorio de paquetes. Las verificaciones estáticas y las pruebas puras disponibles sí se ejecutaron; los límites se detallan en la sección 8.

## 2. Estado y arquitectura observados

- **Frontend:** sitio público y espacio docente servidos desde el mismo dominio por Django. La SPA docente usa módulos JavaScript nativos, CSS y estado en memoria; no utiliza React, Next.js, Node ni un bundler.
- **Backend:** Django/DRF, vistas organizadas por dashboard, catálogo y entregas/correcciones; el backend sirve HTML y recursos estáticos mediante WhiteNoise.
- **Identidad:** Supabase Auth emite JWT Bearer. `SupabaseJWTAuthentication` verifica firma, emisor, audiencia y rol; luego consulta el perfil de aplicación activo.
- **Persistencia:** PostgreSQL en Supabase. El esquema `public.*` es externo y constituye la fuente de verdad. Los modelos Django están configurados como no gestionados y `MIGRATION_MODULES = {"core": None}`. No se debe ejecutar `migrate` para intentar recrear el esquema productivo.
- **IA:** adaptadores para MOCK, Gemini, OpenAI y Ollama. Las credenciales se mantienen en el backend. Una fila habilitada de `AIProviderConfig` tiene precedencia sobre `AI_PROVIDER` del entorno.
- **Despliegue:** un servicio Render, Gunicorn `gthread`, 2 workers × 4 threads, timeout 150 s. No se encontró Celery/RQ/Redis ni un worker de tareas separado.

## 3. Hallazgos y decisiones

### 3.1 Seguridad y privacidad

| Prioridad | Hallazgo | Estado / decisión | Riesgo residual |
|---|---|---|---|
| Alta | Los JWT de Supabase se almacenan en `sessionStorage`, accesible desde JavaScript. Un XSS exitoso podría extraer el token de acceso/renovación. | Se conservaron el mecanismo Bearer y la sesión por pestaña. Se endureció CSP y se mantuvo el escape de contenido dinámico. | La CSP reduce superficie, pero no vuelve inocuo un XSS. Evolución recomendada: BFF o sesión con cookies `HttpOnly`, `Secure`, `SameSite` y protección CSRF, con rediseño del ciclo de Auth. |
| Alta | Se eliminaron las antiguas compuertas `AI_EXTERNAL_PROCESSING_APPROVED` y `AI_GEMINI_PAID_TIER_CONFIRMED`. | No se reintrodujeron variables que el código ya no reconoce. README y documentos operativos ahora advierten el envío a proveedores externos. | El software no valida por sí mismo base legal, consentimiento/aviso, contrato, región, retención ni plan de facturación. La habilitación debe ser una decisión institucional documentada, especialmente antes de procesar trabajos identificables o datos reales de estudiantes. |
| Alta | Una fila habilitada en `AIProviderConfig` puede sobreescribir el fallback `AI_PROVIDER=mock`. | Se documentó explícitamente el comportamiento. Se valida que una configuración OpenAI habilitada incluya modelo. | `mock` en Render **no garantiza** que la IA externa esté apagada si un administrador habilitó un proveedor en la base. Revisar `admin/ai-providers/` y la tabla antes de aceptar datos reales. |
| Media | Los throttles de DRF usan el caché local por proceso si no se configura un backend compartido. | Se mantienen límites por usuario/IP y límites específicos para IA y contacto. | Con varios workers/instancias, el límite puede multiplicarse por proceso. Para controles globales reales, configurar Redis o un rate limiter en el borde y probarlo en despliegue. |
| Media | El formulario de contacto persiste nombre, correo y mensaje. SMTP es una notificación adicional y no una cola durable. | Se confirmó la validación pública, campos permitidos, honeypot oculto, límites de longitud y throttling. Se corrigió el texto visible del formulario. | El honeypot no sustituye CAPTCHA/controles antiabuso; los límites locales no son globales. Definir política de retención y acceso a mensajes/datos personales. |
| Media | Se auditan dirección IP y User-Agent junto con metadatos de eventos. | La auditoría evita guardar contenido completo de entregas o secretos; conserva ID de solicitud y datos mínimos de actor. | Documentar retención, acceso y borrado de metadatos identificables; evitar ampliar el detalle de auditoría con prompts/respuestas. |
| Media | Algunas acciones de administración verifican la existencia de UUIDs en `auth.users` mediante `SELECT 1` (sin lock). | Se retiraron los bloqueos `FOR UPDATE` sobre Auth; se conserva la lectura de comprobación para asociar perfiles/membresías a identidades que ya existen. | Confirmar en staging que el rol PostgreSQL de la aplicación tenga permiso de lectura mínimo sobre `auth.users`. Si se elimina ese permiso, sustituir la comprobación por un mecanismo servidor-seguro de Auth Admin; nunca exponer `service_role` al navegador. |
| Baja | JWKS de Supabase se cachea con renovación temporal. | Se mantiene `PyJWKClient` con `lifespan=300` y límite de claves. | Durante una rotación podría existir una ventana breve de refresco; monitorear fallos de autenticación y revisar la estrategia si se cambian algoritmos/issuer. |

**Cookies:** `CSRF_COOKIE_HTTPONLY`, `SESSION_COOKIE_HTTPONLY`, `SESSION_COOKIE_SAMESITE` y `CSRF_COOKIE_SAMESITE` ya estaban correctamente configuradas en el código recibido. No se duplicaron.

**Autorización/tenancy:** la autenticación vuelve a comprobar que exista un `UserProfile` activo. Las consultas de recursos propios se filtran por `owner_id`; el `owner_id` proviene del JWT validado y no del cuerpo del cliente. Mantener esta regla en todo endpoint nuevo. La suite tiene pruebas de aislamiento, pero deben ejecutarse contra la base de test y complementarse con pruebas RLS contra staging.

### 3.2 Content Security Policy (CSP) — error informado

La política relevante se envía con las páginas HTML en `backend/config/urls.py`:

```text
default-src 'self';
script-src 'self';
style-src 'self' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data:;
connect-src 'self' https://*.supabase.co https://*.supabase.com;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none'
```

No se agregó `'unsafe-inline'`. La causa del error informado es que el navegador intentaba aplicar un estilo en línea (atributo `style`, bloque `<style>` o escritura dinámica equivalente) mientras la política solo permite hojas de estilo de orígenes autorizados. La ubicación `:8000/api/submissions/9/:1` que muestra DevTools identifica el recurso/documento que el navegador asocia al incidente; no implica que haya que habilitar estilos inline en la API.

**Correcciones realizadas:**

- Se retiraron atributos `style` de HTML y bloques `<style>`/scripts embebidos.
- Los estilos generados desde JS se sustituyeron por clases CSS, estados semánticos o elementos nativos (por ejemplo, `<progress>`).
- Se retiraron asignaciones directas a `element.style` del frontend.
- Las reglas `.auth-shell-reset` y `.auth-card-reset` se movieron desde `workspace.css` a `auth.css`, que es la hoja cargada por el flujo de restablecimiento.
- El arranque de tema y las redirecciones dejaron de depender de scripts inline.
- Se añadió `scripts/check_csp_contract.py` al comando `npm run check:frontend` y a CI.

**Por qué `connect-src` no se agrega a las respuestas JSON:** `connect-src` gobierna las conexiones iniciadas por el documento que contiene el JavaScript; debe estar en la respuesta HTML que ejecuta Supabase Auth. Agregar esa directiva a `/api/submissions/9/` no corrige un bloqueo de `style-src` y mezcla responsabilidades.

**Verificación y despliegue:** los chequeos estáticos encontraron cero atributos `style`, cero scripts/bloques `<style>` inline y cero escrituras directas `element.style` en los módulos revisados. En producción, publicar esta versión y verificar en DevTools → Network → documento HTML → Response Headers que la CSP efectiva sea la esperada. Si el error persiste, buscar una segunda cabecera CSP agregada por proxy/CDN/hosting o una página HTML antigua/caché; no resolverlo habilitando `'unsafe-inline'` de forma global.

### 3.3 Concurrencia, transacciones y asincronía

| Prioridad | Hallazgo | Cambio | Riesgo residual |
|---|---|---|---|
| Alta | `SELECT ... FOR UPDATE` dirigido a `auth.users`, esquema interno administrado por Supabase. | Se retiraron esos bloqueos. Se agregó `lock_owner_profile(owner_id)` sobre `UserProfile` y bloqueos de filas `Course`/`Student` cuando corresponde. | Confirmar en staging que cada Auth user tiene su fila de perfil activa y que los triggers de Supabase mantienen esa invariante. |
| Media | Las verificaciones de cambios durante una corrección en curso podían dejar recursos bloqueados por leases vencidos. | `has_fresh_processing_submission` recorre las entregas en orden estable, conserva leases vigentes y recupera los vencidos antes de permitir la mutación. | La recuperación es cooperativa: si el proceso muere, el estado permanece `processing` hasta que una operación lo detecte o se ejecute el script de mantenimiento. Definir un cron/monitor para leases antiguos. |
| Alta | La generación IA es síncrona desde la perspectiva HTTP y ocupa un thread Gunicorn mientras espera al proveedor. | Se impuso deadline total de 120 s para una generación de corrección; el frontend deja margen (150 s/180 s según flujo) y el worker Gunicorn admite 150 s. | No es una cola. Ocho threads por instancia pueden quedar ocupados en generaciones largas. A futuro, usar cola persistente + worker + endpoint de estado/reintentos idempotentes. |
| Media | `AI_MAX_CONCURRENT_ANSWERS` podría interpretarse como límite global de peticiones. | Se documentó que limita el paralelismo interno de respuestas de una generación, no las solicitudes HTTP simultáneas. | Un máximo interno de 3 × hasta 8 threads puede representar hasta 24 llamadas de proveedor en vuelo en una instancia cuando todas las solicitudes consumen el máximo. Ajustar según cuota y memoria. |
| Media | Dos llamadas simultáneas pueden intentar operar sobre la misma entrega. | Se conservan locks/lease y recuperación de estado para evitar duplicar trabajo vigente. | Validar idempotencia y semántica de reintento con pruebas concurrentes reales en PostgreSQL; no asumir que un timeout del navegador significa que el servidor canceló el trabajo. |
| Baja | Cuatro lecturas administrativas se ejecutan en paralelo. | Se conserva concurrencia acotada de 4 y `Promise.allSettled` para que un recurso con error no oculte el resto. | Adecuado para el MVP; limitar/monitorizar si el número de administradores crece. |

`asyncio.wait_for` establece un deadline de aplicación, pero una cancelación cooperativa no equivale a una cola durable ni asegura cancelar una petición remota que ya llegó al proveedor. Las operaciones largas deben monitorearse por `request_id`, código HTTP y categoría de error, nunca registrando payloads o credenciales.

### 3.4 Paginación, rendimiento y volumen de datos

| Prioridad | Hallazgo | Cambio | Riesgo residual |
|---|---|---|---|
| Alta | DRF ya estaba configurado para paginar, pero el frontend consumía `results` de una sola página en varios recursos. | Se añadió `BoundedPageNumberPagination`, con `API_PAGE_SIZE=20`, `API_MAX_PAGE_SIZE=100`; `api.list()` recorre las páginas y concatena resultados. | El cliente corta en 100 páginas de 100 filas (10.000 registros) y falla explícitamente si supera el límite. Para volúmenes mayores, implementar paginación incremental/filtros del lado servidor. |
| Alta | `afterWrite` podía recargar todas las listas cargadas aunque solo cambiara un recurso. | Se mantiene recarga selectiva por claves (`courses`, `students`, `rubrics`, etc.) y actualización liviana del resumen. | Los recursos derivados deben declararse en cada llamada a `afterWrite`; revisar nuevos comandos/eventos al introducir dominios. |
| Media | Los enlaces `next` de una respuesta paginada no deben reenviar el Bearer token a otro origen. | `paginationPath()` valida que el enlace permanezca en el mismo origen y prefijo de API antes de solicitar otra página. | Mantener la validación si cambia el host, el prefijo de API o se incorpora un gateway. |
| Media | Listados pueden incluir relaciones de varias tablas. | Se conserva `select_related`/`prefetch_related` en recursos donde el serializer recorre relaciones; `CorrectionViewSet` trae de forma anticipada evaluación/curso, estudiante, rúbrica y criterios. | Revisar queries con `EXPLAIN ANALYZE` en staging y medir tiempos con volumen representativo; no inferir eficiencia únicamente por sintaxis. |
| Baja | Assets JS/CSS sin hash pueden quedar obsoletos por caché. | WhiteNoise y el servidor HTML fuerzan revalidación/no-cache para los assets sin nombre versionado; documento HTML es `no-store`. | Confirmar en producción headers del CDN/hosting y versionar assets cuando el bundle crezca. |
| Baja | Cargas CSV y archivos de entrega pueden consumir memoria. | Se conservan límites de 2 MB para CSV, 5 MB para upload/request y validaciones de cantidad/tipo/tamaño de documentos. | Probar archivos malformados y carga concurrente; revisar límites equivalentes en proxy/hosting. |

### 3.5 Lógica de negocio, frontend y consistencia

- **Refresco institucional roto:** `refreshInstitutionScope()` existía, pero no se invocaba desde `afterWrite`. Las altas/ediciones/suspensiones hechas por administradores institucionales podían dejar sus tablas visibles desactualizadas. Ahora se llama para `institution_admin` y `department_admin`; globales siguen usando `refreshAdmin()`.
- **Carrera al matricular en recursos inactivos:** la validación del serializer ocurría antes de adquirir los locks de `Course` y `Student`; si se archivaba el curso o desactivaba al estudiante entre ambas fases, la matrícula podía activarse con una relación inactiva. Ahora archivado y matriculación comparten el lock de perfil y curso, y la creación/reactivación vuelve a validar `course.active` y `student.active` después de bloquear las filas.
- **Rúbricas:** la acción que normaliza ponderaciones ahora invalida/recarga `rubrics`, evitando que la interfaz conserve una lista anterior después de guardar.
- **Timeouts IA:** corrección de entrega usa 150 s y el workspace, generación de preguntas y rúbricas, 180 s; la generación de corrección queda acotada a 120 s en el backend. Se conserva margen cliente-servidor.
- **Edición de evaluaciones/consignas:** los cambios del commit `592d310` se preservan. La carga del editor de evaluación conserva material de referencia y la edición de consigna no reenvía su relación inmutable.
- **Cursos:** el alta crea cursos activos; archivar/reactivar es una acción posterior. Se conserva la regla también en el backend.
- **Contacto:** el formulario de `nosotros.html` ya tenía integración POST a `/api/contact/` y persistencia. Se corrigió la leyenda incorrecta de apertura de correo y se incorporó el honeypot que acepta el serializer.
- **Reset de contraseña:** una refactorización había dejado estilos de reset en una hoja que la página no carga. Se movieron a `auth.css`.
- **Paginación de pruebas:** las pruebas que asumían que una lista DRF era directamente un array se adaptaron al envelope paginado `results`; se agregó un caso que comprueba `count`, `results` y `next`.

### 3.6 IA y compatibilidad de proveedores

- Render mantiene `AI_PROVIDER=mock` como fallback seguro y explícitamente demostrativo. Una corrección MOCK no debe aprobarse como calificación real.
- OpenAI ya no usa fallback a un nombre de modelo ficticio ni una rama especial de payload no sustentada. `OPENAI_MODEL` es obligatorio cuando el proveedor es OpenAI; su ausencia se clasifica como error de configuración `503`.
- Se usa `max_completion_tokens` en la solicitud Chat Completions. OpenAI documenta `max_tokens` como obsoleto para el endpoint y recomienda `max_completion_tokens`; comprobar compatibilidad del modelo elegido en la documentación actual: [Chat Completions API](https://developers.openai.com/api/reference/go/resources/chat/subresources/completions/methods/create).
- Las respuestas del proveedor siguen pasando por validaciones pedagógicas: puntajes dentro de máximos, criterios alineados con rúbrica, evidencia literal de la entrega y normalización del JSON.
- Los errores se clasifican sin exponer el cuerpo crudo de proveedor ni secretos. Configuración incompleta → 503; timeout de proveedor → 504; fallo remoto/contrato → 502.
- No se afirmó que el smoke test contra un proveedor real haya pasado: requiere credenciales válidas, cuota, modelo correcto y una decisión previa de privacidad.

### 3.7 Despliegue, configuración y mantenibilidad

- `render.yaml` mantiene Python 3.12.8, 2 workers × 4 threads, Gunicorn 150 s y proveedor `mock` predeterminado. Las credenciales/modelo OpenAI quedan como configuración manual y privada.
- Se agregaron `API_PAGE_SIZE` y `API_MAX_PAGE_SIZE` a `.env.example` con valores 20 y 100.
- Se eliminó el nombre de modelo inventado del comentario de Render; ahora se exige un identificador vigente compatible.
- `README.md` enlazaba a `docs/CONFIGURAR-IA.md`, que no existe. Se corrigió al documento real `docs/CONFIGURACION-IA-EXTERNA.md` y se actualizó la indicación de despliegue.
- `docs/DEPLOYMENT-v0.2.0.md`, `docs/AI-VERIFICATION-v1.0.7.md`, `docs/AI-EVALUATION-v0.2.0.md` y `docs/AUDITORIA-TECNICA-v1.0.2.md` contenían valores/decisiones superados. Se marcaron como históricos para que no se copien sus variables de aprobación ni sus timeouts en producción.
- Se creó `.dockerignore` para evitar copiar secretos locales, entornos virtuales, cachés, `node_modules` y `staticfiles` a la imagen.
- El chequeo de imports del backend excluye entornos virtuales/cachés y no confunde módulos instalados con código propio.

## 4. Aplicación del Summary of Changes original

| Punto pedido | Estado real al recibir el ZIP | Acción final |
|---|---|---|
| `settings.py`: flags cookie y paginación | Los flags de cookies ya estaban; DRF ya paginaba con el paginator stock, pero `MAX_PAGE_SIZE` no era efectivo. | Se mantuvieron flags y se sustituyó por `BoundedPageNumberPagination` configurable y acotada. |
| `urls.py`: CSP/CORP | CORP y cabeceras de seguridad ya estaban; HTML CSP tenía `script-src 'unsafe-inline'` y faltaba política completa estricta. | CSP de documento HTML estricta sin `unsafe-inline`, con `connect-src` para Supabase; CORP se conserva. |
| `middleware.py`: CSP para JSON API | No había CSP en middleware. | No se agregó. La política de conexiones Supabase pertenece al documento HTML, no a las respuestas JSON; se conserva middleware para request ID/Server-Timing/no-store. |
| Eliminar serializador de contacto duplicado | `ContactMessageSerializer` duplicado ya no estaba; `PublicContactMessageSerializer` está en `admin_api.py`. | No se duplicó ni se volvió a mover. Se revisó honeypot/validación y se ajustó formulario. |
| Reemplazar locks `auth.users` | Todavía había locks externos en varias escrituras. | Se retiraron y reemplazaron por `UserProfile`/filas propias con orden de lock consistente. |
| `CorrectionViewSet.select_related` | Ya estaba optimizado con `select_related` y `prefetch_related`. | Se conservó. |
| `.env.example` | Algunos límites/comentarios ya existían; configuración de paginación ausente. | Se agregaron variables de tamaño de página y se conservó documentación de `AI_MAX_CONCURRENT_ANSWERS`. |
| `render.yaml` | Ya usaba `AI_PROVIDER=mock`; no tenía variables Gemini explícitas. | Se mantuvo el fallback y se corrigió el comentario de modelo ficticio; no se eliminaron adaptadores Gemini/Ollama soportados. |
| Frontend `afterWrite`/timeouts | La recarga selectiva ya estaba parcialmente; faltaba recorrer todas las páginas y refrescar ámbito institucional. | Se completó refresco institucional; se mantiene selección por claves y se corrigió invalidación de rúbricas. |
| `nosotros.html` | Formulario ya enviaba a `/api/contact/` y persistía. | Se corrigió el texto, se agregó honeypot y se mantuvo el endpoint/flujo existente. |

## 5. Archivos y áreas modificados por esta estabilización

Los cambios de esta entrega se integran al árbol recibido, que ya tenía numerosos parches. Entre los archivos nuevos o ajustados directamente durante esta estabilización se encuentran:

- `backend/apps/core/pagination.py` — paginación DRF acotada.
- `backend/apps/core/api_views/common.py` y `catalog.py` — locks propios, leases vencidos y manejo común de errores IA.
- `backend/apps/core/api_views/submissions.py` — deadline total de generación.
- `backend/apps/core/ai.py` y `admin_api.py` — modelo OpenAI explícito y validación de configuración.
- `backend/config/settings.py`, `backend/config/urls.py`, `backend/apps/core/tests.py` — configuración, CSP y pruebas de contrato.
- `frontend/js/api.js` — recorrido de páginas con validación de origen.
- `frontend/js/modules/data/repository.js` y `resources.js` — refresco selectivo, refresco de ámbito institucional y carga bajo demanda.
- `frontend/js/modules/events.js` — invalidación de rúbricas al normalizar ponderaciones.
- `frontend/css/auth.css`, `frontend/css/public-enhancements.css`, `frontend/css/workspace.css`, páginas HTML y módulos JS — eliminación de estilos/scripts inline y reemplazos compatibles con CSP.
- `scripts/check_csp_contract.py`, `scripts/check_static_frontend.py`, `scripts/check_backend_imports.py` y `.github/workflows/frontend.yml` — chequeos estáticos/CI.
- `.dockerignore`, `.env.example`, `render.yaml`, `README.md` y documentos históricos en `docs/`.

## 6. Riesgos residuales y acciones antes de producción

| Riesgo | Nivel | Acción recomendada antes de producción |
|---|---|---|
| Proveedor IA externo con contenido real de estudiantes | **Crítico / decisión institucional** | Mantener MOCK hasta aprobar finalidad, base legal, avisos, contrato, condiciones del proveedor, región, retención y minimización. Revisar todas las filas `AIProviderConfig` habilitadas, no solo `AI_PROVIDER`. |
| XSS/token theft por tokens JS-accessibles | Alto | Mantener CSP/escape y revisar todos los `innerHTML`; diseñar BFF o cookies HttpOnly y protección CSRF antes de uso sensible a escala. |
| Throttling local por proceso | Alto | Configurar Redis o limitación en gateway/CDN; probar límites con múltiples workers e instancias. |
| Generación IA síncrona en threads | Alto | Para producción con concurrencia significativa, migrar a cola persistente + worker, estado de tarea, idempotencia, reintento controlado y recuperación. |
| Esquema PostgreSQL real puede divergir del esquema de pruebas | Alto | Ejecutar `python manage.py verify_public_schema` con credenciales read-only/staging y revisar RLS, constraints, índices, triggers y permisos. No ejecutar migraciones Django sobre `public.*`. |
| Leases `processing` huérfanos | Medio | Programar/monitorizar `scripts/reclaim_processing_leases.py` o incorporar un worker periódico. Alertar por estados antiguos. |
| Máximo cliente 10.000 registros por lista | Medio | Incorporar filtros y paginación incremental por vista cuando el volumen lo requiera. |
| Salud del servicio | Medio | `/api/health/` es liveness; agregar chequeos de DB/cache/proveedor con endpoints separados y sin exponer detalles sensibles. |
| Datos de contacto y auditoría | Medio | Definir retención, acceso de administradores, exportación/borrado y medidas antiabuso para contacto. |
| Despliegue y assets | Medio | Confirmar cabeceras de caché/CSP reales, login/recuperación, cookies, CORS si se separa el frontend y rollback documentado en staging. |
| Cobertura E2E | Alto | Incorporar pruebas browser (Playwright u otra herramienta) de los flujos críticos: alta de curso, estudiantes, evaluación/consignas, entrega, generación, edición, aprobación, compartir, administración institucional y recuperación de contraseña. |

### Secuencia recomendada de habilitación

1. Publicar primero a staging con `AI_PROVIDER=mock` y sin filas `AIProviderConfig` externas habilitadas.
2. Ejecutar la suite backend contra PostgreSQL de prueba y `verify_public_schema` contra staging Supabase con un usuario de solo lectura.
3. Probar aislamiento entre dos tenants, roles globales/institucionales, RLS, transacciones concurrentes y recuperación de leases.
4. Ejecutar E2E en navegador y revisar la CSP efectiva, la consola y cabeceras de cache.
5. Aprobar institucionalmente el procesamiento externo antes de habilitar OpenAI/Gemini. Usar datos sintéticos para el smoke test; nunca usar entregas reales para probar configuración.
6. Medir latencia, tasa de 429/5xx, threads ocupados, DB connections, timeouts y tamaño de respuesta. Definir alertas y rollback.

## 7. Verificaciones realizadas

| Verificación | Resultado |
|---|---|
| HTML/JS estático | `npm run check:frontend` pasó: 16 HTML y 31 módulos JS inspeccionados, chequeo CSP, contrato de flujos y formatos numéricos. |
| CSP | El scanner reportó cero atributos `style`, cero `<style>`/scripts inline y cero escrituras directas de estilos en JavaScript. |
| Contrato de workspace | El chequeo estático de flujos del workspace pasó. |
| Formatos numéricos | Las pruebas de formato y entradas numéricas pasaron. |
| Importaciones Python del proyecto | `python scripts/check_backend_imports.py` pasó: 38 módulos locales. |
| Sintaxis Python | `python -m compileall -q backend/apps backend/config backend/manage.py` pasó. |
| Adaptador IA aislado | `python scripts/test_ai_adapter.py` pasó: 6 pruebas. |
| Django `manage.py check` / suite PostgreSQL | **No ejecutado satisfactoriamente en este entorno.** La virtualenv recibida es Windows y no corre en Linux; la instalación alternativa de requirements falló por falta de conectividad de red. |
| Supabase staging/producción, Render, proveedor IA real y pruebas browser E2E | **No ejecutados.** Requieren credenciales, servicios externos y navegador/entorno de integración. |

La CI configurada conserva su job PostgreSQL para ejecutar pruebas en un entorno compatible. La existencia del workflow no se considera evidencia de que el job se haya ejecutado en esta revisión.

## 8. Comandos sugeridos para validar en el entorno local Windows

Desde la raíz del repositorio, con Python 3.12 y la virtualenv del proyecto ya instalada:

```powershell
npm run check:frontend

cd backend
.\.venv\Scripts\python.exe -m compileall -q apps config manage.py
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py test apps.core
.\.venv\Scripts\python.exe manage.py verify_public_schema
```

`manage.py test apps.core` requiere PostgreSQL de test y el esquema auxiliar definido por el proyecto; no apuntar esa suite a la base productiva. `verify_public_schema` debe ejecutarse contra staging o con un usuario de lectura y no modifica el esquema.

## 9. Conclusión

El código quedó más consistente en sus contratos de paginación, refresco de datos, bloqueos, leases, timeouts y CSP. Se eliminaron referencias operativas obsoletas y se añadió una barrera de CI para los patrones inline incompatibles con la política de estilos/scripts.

Los principales límites que quedan no se resuelven con más parches locales: son decisiones de arquitectura/operación —cola durable para IA, rate limiting compartido, estrategia de sesión resistente a XSS, validación real del esquema/RLS y aprobación institucional del procesamiento externo—. Deben tratarse como condiciones de salida a producción y no darse por resueltos por el hecho de que el frontend compile o el backend pase pruebas unitarias aisladas.


## Hotfix posterior: edición de entregas y entorno Windows

### PATCH `/api/submissions/:id/`

El formulario del espacio docente reenviaba `assessment`, `question` y `student` al editar una entrega existente. Esos vínculos son inmutables por regla de negocio; si el selector se vaciaba o su estado local difería del registro, DRF rechazaba la solicitud con `student: No se puede reasignar una entrega a otro estudiante.`

La edición ahora envía únicamente `answer_text` en el `PATCH`; la creación continúa enviando los datos de identidad y relaciones. En la interfaz se bloquean los selectores de estudiante y consigna al editar una entrega, se explica que la identidad original se conserva y se evita interpretar un archivo nuevo como una segunda entrega accidental. El backend conserva la validación que impide reasignaciones reales.

Se agregaron pruebas de regresión para comprobar que un PATCH parcial actualiza la respuesta y conserva el estudiante asociado, y que un intento explícito de reasignación sigue devolviendo `400`.

### `ModuleNotFoundError` al ejecutar `runserver` en PowerShell

El traceback recibido termina inmediatamente después de `ModuleNotFoundError:` y no incluye el nombre del módulo, por lo que no permite identificar el paquete faltante de forma concluyente. Sí muestra que Django se está importando desde la instalación global de Python 3.13 (`Program Files` / `AppData\Roaming`) y no desde `backend\.venv`. La configuración `INSTALLED_APPS` requiere, entre otras, `corsheaders` y `rest_framework`, ambas dependencias declaradas en `requirements-prod.txt`.

La ejecución recomendada es instalar y ejecutar con el mismo intérprete del entorno virtual:

```powershell
cd backend
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

Si ya existe `backend\.venv`, no hace falta recrearlo: ejecutar los últimos cuatro comandos con `backend\.venv\Scripts\python.exe` es suficiente. Si vuelve a aparecer el error, conservar la línea final completa (`No module named '...'`) para identificar el paquete exacto.
