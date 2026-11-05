# Auditoría técnica de MaestrIA — 2026-11-05

> **Nota de vigencia:** esta auditoría corresponde a la revisión anterior a `v1.0.1`. Para el estado actual, hallazgos corregidos y validaciones recientes, consultar `AUDITORIA-TECNICA-v1.0.1.md`.

## Alcance y método

Se revisó el ZIP `maestria-starter` entregado para esta iteración: HTML/CSS/JS, configuración Django, modelos, autenticación, permisos, vistas, proveedor IA, SQL de pruebas, workflows, `render.yaml`, `.env.example` y los archivos `.env` incluidos. También se integró como referencia la refactorización frontend previa.

La revisión es estática. No se dispuso de credenciales para consultar Supabase/Render ni se ejecutaron pruebas de integración contra una base real. No equivale a una auditoría de penetración ni a una revisión legal.

## Resumen ejecutivo

La base tiene decisiones técnicas razonables para un MVP: frontend nativo servido por Django en un único origen, JWT de Supabase verificado en backend, ORM unmanaged sobre el esquema Supabase, filtros por propietario, transacciones para operaciones sensibles, límites de tamaño, throttling de endpoints costosos, validación de propuestas IA y aprobación humana.

La refactorización mejora la mantenibilidad y corrige un defecto funcional de autenticación del cliente. Aun así, no se debe interpretar que el sistema ya está listo para datos académicos reales sin completar los controles pendientes de privacidad, aislamiento, operación y pruebas.

## Cambios aplicados en esta entrega

### Frontend

- Se reemplazó el monolito de `frontend/assets/js/workspace.js` (aprox. 161 KB y 1.567 líneas en el ZIP base) por un entrypoint ES module y módulos separados.
- Se integró la estructura `modules/core`, `modules/data`, `modules/features` y `modules/events`.
- Se separaron los constructores de formularios docentes y administrativos en `features/forms/teacher.js` y `features/forms/admin.js`; el módulo `forms.js` conserva el despacho de operaciones.
- Se eliminó el fallback que inventaba un perfil `teacher` cuando `/api/me/` fallaba. El backend es la fuente de verdad para identidad, rol y estado.
- Se añadió `ApiError` con `status` y payload para distinguir 401, 403 y 5xx.
- La inicialización detiene el acceso si no se puede verificar el perfil y ofrece reintento.
- La carga inicial de recursos y la de administración se limita a cuatro solicitudes concurrentes por navegador.
- Se mejoró el comportamiento de los avisos accesibles y el ciclo de foco de los modales (atrapar foco, Escape y restaurar foco).
- Se escaparon etiquetas de los helpers de botones.
- Se mantiene JavaScript nativo: no se incorporó framework ni bundler.

### Configuración y seguridad

- Se agregó compatibilidad con Supabase Shared Pooler. Render es un backend persistente y suele convenir session mode (puerto 5432); si se usa transaction mode (6543), se desactiva el auto-prepare de psycopg (`prepare_threshold=None`) porque ese modo no admite prepared statements.
- Los ejemplos de entorno ahora fallan de forma segura: el procesamiento externo de IA y la confirmación del nivel pago Gemini no se habilitan por defecto.
- `render.yaml` requiere que esas dos confirmaciones se configuren explícitamente en Render.
- Se retiraron los `.env` reales y el ejemplo frontend obsoleto del paquete entregable. Los `.env` reales no estaban versionados según el índice Git incluido, pero sí viajaban dentro del ZIP compartido.
- Se añadió `scripts/check_static_frontend.py` y se actualizaron workflows de CI. El workflow backend usa PostgreSQL de prueba y no ejecuta migraciones Django sobre el esquema gestionado por Supabase.
- Se actualizaron README y documentación operativa.

## Hallazgos y riesgos pendientes

| Área | Estado observado | Riesgo / acción necesaria |
|---|---|---|
| Autenticación | Supabase JWT se valida en backend; JWKS se cachea. `/api/me/` entrega perfil/rol. | Mantener rotación de claves y probar expiración, refresh, revocación y suspensión de perfiles. |
| Roles por defecto | Si no existe `user_profile`, `/api/me/` devuelve `teacher` y `IsWorkspaceUser` permite acceso docente por compatibilidad. | Migrar/provisionar perfiles y luego eliminar el fallback permisivo; aplicar mínimo privilegio. |
| Aislamiento multiusuario | `OwnerViewSet` filtra `owner_id`; varias operaciones anidadas comprueban pertenencia y bloquean filas. | Ejecutar matriz BOLA/IDOR con dos usuarios en todos los endpoints, acciones personalizadas, exportaciones y objetos relacionados. |
| Tokens frontend | Access y refresh tokens se guardan en `sessionStorage`. | XSS puede leerlos. Mantener escape contextual; evaluar BFF con cookies HttpOnly/Secure/SameSite para un entorno de mayor riesgo. |
| XSS | Hay `escapeHtml` y muchos templates escapan datos; se mejoraron helpers de botones. | `innerHTML` sigue siendo un sink. Auditar cada interpolación y no confiar en que escapar texto también protege URLs/atributos/estilos. |
| CSRF/CORS | API autenticada con Bearer y `credentials: omit`; CORS está restringido por lista. | Probar preflight desde orígenes permitidos/no permitidos; evitar agregar wildcard. Si se migra a cookies, revisar CSRF de nuevo. |
| Throttling | DRF limita anon/user y endpoints IA/contacto. | El caché local no comparte contadores entre workers/instancias y DRF throttling no es protección DDoS estricta. Incorporar Redis compartido o rate limit en edge al escalar. |
| Concurrencia IA | Máximo 3 respuestas concurrentes dentro de una solicitud; lease y locks evitan duplicar correcciones de una misma entrega. | El semáforo es por solicitud, no global. Para más usuarios, usar cola de trabajos y workers con límite global; observar cuotas/costos. |
| Ciclo de vida IA | La solicitud reserva la entrega, llama al proveedor, revalida snapshots y libera la reserva ante errores. Hay lease de recuperación de 15 minutos. | Probar timeout, cancelación, caída del worker, lease vencida y reintento concurrente. Una cola persistente sería mejor para trabajos largos. |
| Privacidad IA | Gemini recibe consigna, contexto, rúbrica y respuesta; hay flags de aprobación y validación de plan pago. | La aprobación en variables de entorno es una declaración operativa, no una verificación automática. Minimizar/anonomizar datos, informar a docentes, revisar términos/retención/DPA y base legal. No enviar identificadores directos. |
| Secretos | `.env` no figura versionado en el índice Git, pero el ZIP incluía secretos reales. | Rotar `GEMINI_API_KEY`, contraseña DB y `DJANGO_SECRET_KEY` por precaución. Nunca enviar `service_role` ni JWT signing secret al frontend. |
| Base de datos | PostgreSQL/Supabase es fuente de verdad; modelos Django `managed=False`; SSL y timeout configurados. | No ejecutar `migrate`/`makemigrations`/`--fake` para reconstruir tablas. Mantener cambios SQL versionados y verificar con `verify_public_schema`. |
| Pooler | El `.env` del ZIP todavía usaba host directo `db.*.supabase.co:5432`. | Alinear el entorno local con Shared Pooler si la red local también carece de IPv6. Verificar usuario/puerto/modo exactos en Supabase. |
| Conexiones | `CONN_MAX_AGE=60`, health checks y dos workers Gunicorn. | Medir conexiones concurrentes y comportamiento real del pooler. Ajustar workers a RAM/conexiones disponibles; no aumentar workers sin medición. |
| Solicitudes frontend | Fetch centralizado con timeout, abort, refresh deduplicado dentro de la pestaña y `cache: no-store`. | La sesión de pestaña no sincroniza automáticamente entre tabs. Probar doble submit, refresh simultáneo y pérdida de red durante escrituras. |
| Rendimiento | Se usan `select_related`, `prefetch_related`, subqueries, list serializers y previews. | Medir query count, latencia p50/p95, payloads y crecimiento de tablas con datos realistas. Añadir paginación para listas grandes si no está ya aplicada en cada recurso. |
| Archivos | Hay límites de tamaño y validación de formatos en backend; extracción en memoria. | No hay antivirus/escaneo de malware ni almacenamiento aislado. Validar MIME real, límites descomprimidos y PDFs/DOCX malformados. |
| Auditoría | Se registra request ID, actor, IP/user-agent y eventos de dominio. | Definir retención, acceso, anonimización y borrado de IP/user-agent; no registrar tokens ni contenido de respuestas. |
| Observabilidad | Middleware agrega `X-Request-ID` y `Server-Timing`; logs de fallas IA no deberían incluir contenido. | Agregar métricas de DB/pooler, proveedor IA, errores por endpoint, latencia y alertas; propagar request ID en frontend. |
| Health check | `/api/health/` responde liveness sin consultar DB. | No demuestra que PostgreSQL o Gemini estén disponibles. Mantenerlo como liveness y monitorear dependencias por separado. |
| Accesibilidad | Hay labels, landmarks, estados live, navegación por teclado y movimiento reducido en varios flujos. | Ejecutar axe/Lighthouse y pruebas manuales de teclado/lector de pantalla; revisar menús, quickstart, tablas y contraste en ambos temas. |
| Dependencias | Rangos amplios en `requirements-prod.txt`. | Generar lock reproducible y revisar dependencias/avisos periódicamente antes de cada deploy. |
| Backups | No se verifica desde el código. | Configurar PITR/backups de Supabase y ensayar restauración. |

## Configuración de Supabase Shared Pooler

Para Render en IPv4, configurar `DATABASE_URL` usando la URI exacta que muestra Supabase para Shared Pooler. Como Render es persistente, preferir session mode (normalmente puerto 5432). Transaction mode usa puerto 6543 y está orientado a conexiones de corta duración. El usuario de Shared Pooler incluye el project ref; no copiar valores de ejemplo.

La configuración agrega `prepare_threshold=None` sólo si detecta `*.pooler.supabase.com` en el puerto 6543 (transaction mode). Para session mode, normalmente puerto 5432, mantiene prepared statements. Transaction mode tampoco conserva estado de sesión entre transacciones; como settings establece `search_path=public`, no usarlo sin probar esa configuración. La contraseña debe codificarse para URL si contiene caracteres reservados.

El archivo local `.env` incluido en el ZIP seguía usando el endpoint directo IPv6. No se copió al paquete final. Para desarrollo local, completar `backend/.env` desde `.env.example` con la misma modalidad de conexión compatible con la red local.

## Variables sensibles

- `DJANGO_SECRET_KEY`: privada, única por entorno y rotatoria.
- `DATABASE_URL`: privada; contiene usuario y contraseña.
- `GEMINI_API_KEY`: privada y exclusiva del backend.
- `SUPABASE_JWT_SECRET`: secreto de firma legacy HS256 si la configuración del proyecto lo requiere; no compartir.
- `SUPABASE_ANON_KEY`: pública por diseño, pero siempre acompañada de RLS/policies correctas.
- Nunca exponer `service_role` en HTML/JS, repositorio, logs o documentación.

Los valores reales detectados en el ZIP fueron eliminados del entregable. Por precaución, rotarlos antes de continuar.

## Verificaciones ejecutadas en esta entrega

| Comprobación | Resultado |
|---|---|
| Sintaxis de los 28 archivos JavaScript con Node 22 | OK |
| Imports ES modules locales | OK |
| Referencias locales desde 16 páginas HTML | OK |
| Script `scripts/check_static_frontend.py` | OK |
| Compilación sintáctica de archivos Python (`compile`) | OK |
| `manage.py check` | No ejecutado: Django no está instalado en el entorno de análisis |
| Suite pytest/PostgreSQL | No ejecutada: requiere instalar dependencias y ejecutar contra PostgreSQL de prueba |
| Integración real con Render/Supabase | No ejecutada: requiere entorno desplegado y credenciales privadas |
| Pruebas de accesibilidad automatizadas | Pendientes |
| Prueba de carga/concurrencia | Pendiente |

## Plan recomendado antes de piloto

1. Rotar los secretos compartidos y verificar `DATABASE_URL` de Render con Shared Pooler.
2. Ejecutar `verify_public_schema` en un entorno con acceso a Supabase y revisar los resultados.
3. Ejecutar pytest con el PostgreSQL de prueba local/CI.
4. Probar con dos cuentas: cada una debe ser incapaz de listar, leer, editar, exportar o corregir objetos de la otra.
5. Probar login, refresh, expiración, logout, recuperación de contraseña y perfiles suspendidos.
6. Probar dos solicitudes simultáneas de corrección para la misma entrega y para entregas diferentes.
7. Verificar las condiciones de privacidad del proveedor IA, minimización de datos y consentimiento/información a usuarios.
8. Medir latencia y conexiones de PostgreSQL con un conjunto representativo; ajustar Gunicorn y el pooler con evidencia.
9. Ejecutar Lighthouse/axe y pruebas manuales de teclado.
10. Definir backups, restauración, retención y respuesta a incidentes.

## Decisión

La refactorización se considera una mejora estructural apta para continuar el desarrollo y pruebas de staging. No se declara lista para producción con datos personales/académicos reales hasta cerrar los puntos críticos de secretos, privacidad de IA, aislamiento multiusuario y pruebas operativas.
