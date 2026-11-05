# Auditoría técnica — MaestrIA v1.0.1

**Fecha:** 5 de noviembre de 2026  
**Base revisada:** `maestria-starter-v1.0.0.zip`  
**Alcance:** frontend, API, autenticación, permisos, persistencia, configuración, seguridad, concurrencia, ciclo de vida, accesibilidad y CI.

## 1. Resumen ejecutivo

El proyecto es un monolito modular: frontend nativo (HTML/CSS/ES modules), API Django REST Framework y PostgreSQL/Supabase. La base contiene controles razonables de propiedad, transacciones, validación de IA, timeouts, límite de archivos y revisión humana.

La versión `1.0.0` no estaba completamente sana: el adaptador `modules/core/api.js` estaba vacío aunque cinco módulos lo importaban; `events.js` importaba el constructor `courseForm` desde un módulo que no lo exportaba. El verificador estático no comprobaba que los símbolos importados existieran. Ambos defectos quedaron corregidos y el verificador ahora valida los exports nombrados.

También se retiró el permiso implícito de docente cuando faltaba el registro `user_profile`. El esquema ya define un trigger para crear ese perfil al insertar una identidad en `auth.users`, por lo que la ausencia del perfil debe tratarse como un error de provisión, no como una autorización.

La refactorización reorganiza las vistas API por dominio sin cambiar rutas ni contratos. No se migró Django a FastAPI ni se alteró el esquema de Supabase: hacerlo sería una migración de plataforma separada y elevaría el riesgo de esta entrega.

## 2. Cambios implementados

### Frontend

- `modules/core/api.js` ahora inicializa explícitamente `config.js` y `api.js` y expone el cliente como módulo ES.
- Se eliminaron del HTML del espacio docente los scripts clásicos duplicados: el propio grafo de imports garantiza el orden de inicialización.
- `api.js` admite `AbortSignal`, retira el listener al finalizar, aplica `no-referrer` a llamadas a Supabase y finaliza la sesión cuando falla también el intento con token renovado.
- El registro de renderizadores se crea una sola vez y el router dejó de importar renderizadores que no utiliza.
- `courseForm` se importa desde `features/courses.js`, su módulo real, y no desde `features/forms.js`.
- El verificador comprueba referencias HTML, rutas de imports, correspondencia de imports nombrados/exports y sintaxis JS cuando Node está disponible.

### Backend

- `apps/core/views.py` se convirtió en una fachada de compatibilidad de 37 líneas.
- Se separaron las vistas en `api_views/dashboard.py`, `api_views/catalog.py` y `api_views/submissions.py`; los helpers y dependencias compartidas quedaron en `api_views/common.py`.
- La autenticación rechaza perfiles inexistentes o inactivos. `IsWorkspaceUser` ya no concede acceso por ausencia de perfil.
- El principal autenticado conserva rol/estado verificados durante el request; permisos y auditoría reutilizan ese dato para evitar lecturas redundantes de `user_profile` en el flujo normal.
- `/api/me/` también falla cerrado y deja de sintetizar un rol docente.
- Se agregó `Permissions-Policy` y las respuestas de API llevan `Cache-Control: no-store`.
- Se corrigió el nombre de servicio del root API para coincidir con el contrato de su prueba.
- Se agregaron pruebas unitarias para perfiles faltantes, roles docentes y cuentas estudiantiles, además de verificar encabezados de seguridad/cache.

### Persistencia y despliegue

- No se modificó `db/maestria_schema_v2.sql`, `backend/database/test_schema.sql`, constraints, triggers, tablas ni mappings `managed=False`.
- No se agregaron migraciones Django ni dependencias nuevas.
- Se mantiene el despliegue de un único servicio Render con frontend y backend en el mismo origen.

## 3. Evaluación por área

| Área | Estado de la versión | Riesgo residual / medida necesaria |
|---|---|---|
| Arquitectura frontend | Capas `core`, `data`, `features`, `events` y adaptador API explícito. | `events.js` y `forms.js` aún coordinan muchas acciones; dividir por dominio sólo si el costo actual de cambio lo justifica. |
| Arquitectura backend | Vistas API agrupadas por dashboard, catálogo y entregas/correcciones; fachada estable. | No es Clean Architecture estricta: viewsets aún coordinan reglas de aplicación y acceso ORM. Ver `BACKEND-ARCHITECTURE.md`. |
| Tiempos de respuesta | Timeouts explícitos, concurrencia de carga inicial limitada a cuatro, consultas resumidas y eager loading selectivo. | No hay mediciones p50/p95, query count ni pruebas con volumen representativo. No se afirma un SLA. |
| Solicitudes/asincronía | El browser aborta solicitudes por señal o timeout; el cliente renueva sesión con promesa compartida; HTTPX async para proveedores IA. | La API Django sigue siendo WSGI y las operaciones de corrección mantienen la solicitud HTTP abierta. Considerar worker/cola persistente para trabajos largos. |
| Concurrencia | Locks de filas, transacciones, snapshots y lease de reserva; máximo de tres respuestas IA concurrentes por solicitud. | El semáforo no es global entre usuarios/instancias. No ejecutar múltiples correcciones de alto volumen sin cola y límite global. |
| Identidad/permisos | JWT firmado, issuer/audience/exp/sub comprobados; perfil inexistente/inactivo rechazado; `owner_id` se asigna en backend. | Ejecutar matriz BOLA/IDOR con dos usuarios sobre todos los recursos, acciones, relaciones y exportaciones. |
| Privacidad de usuario | No se registran tokens ni cuerpos de respuesta en logs; fingerprints para métricas; no se envían nombres/IDs directos en el contexto de corrección revisado. | El texto de respuestas sí se envía al proveedor cuando el flag externo está aprobado. Requiere información/consentimiento, minimización, revisión de DPA, retención y base legal. |
| Sesión frontend | `sessionStorage`, refresh deduplicado dentro de la pestaña, `credentials: omit`. | XSS puede leer tokens. Para información académica sensible, evaluar BFF/cookies HttpOnly, Secure, SameSite. |
| XSS | `escapeHtml` aplicado en muchos templates y errores. | `innerHTML` sigue siendo un sink. Auditar interpolaciones y contextos de texto, atributos, URL y estilos; CSP estricta requiere primero retirar inline scripts/estilos. |
| CSRF/CORS | Bearer JWT y `credentials: omit`; CORS configurado por allowlist. | Verificar preflight desde orígenes autorizados/no autorizados en staging; no usar wildcard. Si se cambia a cookies, reevaluar CSRF. |
| Throttling | Límites anon/usuario/IA/contacto. | La caché local no comparte contadores entre workers. Incorporar Redis compartido o rate-limit de edge antes de escalar. |
| Archivos | Tamaños acotados; PDF/DOCX y expansión ZIP limitados; extracción en memoria. | No hay escaneo antimalware ni almacenamiento aislado. Validar MIME real y PDFs/DOCX malformados; evaluar sandbox para archivos no confiables. |
| Ciclo de vida | Reserva y recuperación de corrección, timeout de proveedor y liberación ante errores. | Probar timeout, cancelación, caída de worker, lease vencida y reintentos simultáneos con PostgreSQL real. |
| Auditoría | Request ID y eventos de dominio con metadatos mínimos. | Definir retención y borrado de IP/user-agent, control de acceso y procedimiento de exportación/borrado de datos. |
| Accesibilidad | Skip links en páginas públicas, labels, estados live, foco en modales y movimiento reducido en varios flujos. | No se ejecutaron axe/Lighthouse ni pruebas manuales con lectores de pantalla/teclado en este entorno. |
| Configuración | Variables sensibles sólo en backend; sin archivos `.env` reales en el ZIP recibido. | Verificar secretos en el panel de Render y en el historial Git; rotar cualquier credencial que haya sido expuesta fuera del entorno seguro. |
| Base de datos | PostgreSQL/Supabase, SSL y modelos `managed=False`; querysets owner-scoped. | Ejecutar `verify_public_schema` en staging y ensayar backup/restauración antes de producción. |

## 4. Validaciones ejecutadas

| Comprobación | Resultado |
|---|---|
| `python -m compileall -q backend scripts` | Correcto |
| `python scripts/check_static_frontend.py` | Correcto: 16 HTML, 28 JS, referencias/rutas, exports nombrados y sintaxis verificados |
| `python scripts/check_backend_imports.py` | Correcto: 35 módulos Python; imports relativos y símbolos locales verificados |
| Análisis estructural de `views.py` | Correcto: los controladores quedaron agrupados en módulos de dominio y la fachada conserva los imports públicos |
| `python manage.py check` | No ejecutado: Django no estaba instalado y el entorno no permitió descargar dependencias |
| `pytest -q` | No ejecutado por la misma limitación de dependencias |
| PostgreSQL/Supabase real | No ejecutado; no se suministraron credenciales ni conexión |
| Render / flujos end-to-end | No ejecutados |
| Axe/Lighthouse / screen reader | Pendiente |
| Prueba de carga y estrés | Pendiente |

La compilación Python valida sintaxis, no importación/inicialización real de Django. La revisión de módulos backend es estática hasta que CI ejecute `manage.py check` y `pytest` contra PostgreSQL.

## 5. Acciones recomendadas antes de piloto

1. Ejecutar el workflow backend en CI y resolver cualquier error de importación o prueba.
2. Ejecutar `verify_public_schema` en una instancia staging con copia/restauración probada.
3. Confirmar que el trigger `maestria_auth_user_profile_insert` crea perfiles y que usuarios preexistentes quedaron backfilled.
4. Probar expiración/refresh/revocación JWT y una matriz BOLA/IDOR con dos cuentas independientes.
5. Ejecutar dos correcciones simultáneas sobre la misma entrega y sobre entregas diferentes; verificar leases y recuperación.
6. Revisar formalmente tratamiento de contenido académico por Gemini/proveedor activo, incluyendo términos, retención, región, entrenamiento y base legal.
7. Definir estrategia de XSS/token (BFF si el riesgo de datos lo exige), rate limiting compartido, backups y retención de auditoría.
8. Ejecutar pruebas automatizadas y manuales de accesibilidad y una prueba de carga que mida p50/p95, query count, conexiones y costo de IA.

## 6. Decisión

`maestria-v1.0.1` mejora el estado estructural y corrige defectos concretos detectados en la versión entregada. Queda apta para continuar en desarrollo y staging, pero **no debe considerarse certificada ni lista para datos académicos reales** hasta ejecutar pruebas de integración, aislamiento, privacidad, accesibilidad y operación.
