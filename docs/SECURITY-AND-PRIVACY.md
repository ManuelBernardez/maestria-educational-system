# Seguridad y privacidad — lista previa a piloto real

- [ ] No usar datos de alumnos reales en pruebas iniciales; usar datos ficticios/anonimizados.
- [ ] Informar claramente cuándo se usa IA externa y qué datos se envían.
- [ ] No enviar nombres, emails ni otros identificadores a la IA salvo necesidad justificada.
- [ ] Verificar condiciones, retención y tratamiento de datos del proveedor/modelo seleccionado.
- [ ] Establecer base jurídica, consentimiento cuando corresponda, privacidad, retención y eliminación.
- [ ] Definir copias de seguridad y probar restauración.
- [ ] Probar aislamiento de datos entre cuentas y endpoints anidados.
- [ ] Limitar tipos/tamaño de archivos antes de habilitar uploads.
- [ ] Añadir rate limits específicos para endpoints de IA y límites de coste.
- [ ] Evitar registrar respuestas completas, tokens o datos personales.
- [ ] Activar HTTPS, CORS estricto, `DEBUG=False` y secretos rotables.
- [ ] Definir quién accede a los datos y cómo se responde a incidentes.

Este checklist no reemplaza una revisión legal ni una auditoría de seguridad.


## Controles añadidos en esta revisión

- La configuración distingue SQLite de desarrollo y PostgreSQL de producción; producción no debe arrancar sin `DATABASE_URL`.
- Se detectan marcadores comunes de ejemplo en `DATABASE_URL` para evitar errores de autenticación confusos. El backend no puede confirmar la contraseña correcta sin conectarse: ante `password authentication failed`, verificá/restablecé la contraseña en Supabase.
- Las conexiones PostgreSQL en producción y los hosts Supabase fuerzan SSL; se habilitan comprobaciones de conexión persistente y timeout de conexión.
- Se agregó `XFrameOptionsMiddleware`, límites de tamaño de solicitud y límites diferenciados para endpoints de IA y el formulario público de contacto. El producto ya no ofrece envío de devoluciones desde el backend: compartir por correo/WhatsApp se inicia en el navegador y requiere confirmación del docente.
- Django/WhiteNoise sirve el frontend HTML5 desde el mismo origen; se configuran cabeceras de seguridad y no se publica una API key de IA en el navegador. Las páginas de privacidad y términos siguen necesitando los datos de la entidad responsable y revisión legal.
- Se incorporaron enlace de salto al contenido, focos visibles, respeto por movimiento reducido, estados de error/carga y recuperación de contraseña.

## Pendiente antes de producción

Ejecutar pruebas con al menos dos usuarios distintos para comprobar aislamiento en todos los endpoints; validar recuperación de cuenta; configurar SPF/DKIM/SMTP únicamente si se habilitan notificaciones por correo del formulario público o se configura el correo de autenticación; restringir CORS a dominios públicos exactos; comprobar políticas de retención y borrado; establecer backups/restauración; revisar la salida de IA y los acuerdos del proveedor; desplegar solo con HTTPS; completar los datos reales de contacto/privacidad/términos; y realizar pruebas automatizadas de accesibilidad y seguridad. No subir `.env`, dumps de estudiantes ni claves a Git.


## Notas operativas de la revisión 2026-11-05

- El frontend guarda access/refresh tokens de Supabase en `sessionStorage`. Esto limita la persistencia a la pestaña, pero los tokens siguen siendo accesibles a JavaScript: una vulnerabilidad XSS podría extraerlos. Mantener escape contextual, evitar HTML dinámico no confiable y evaluar un BFF con cookies `HttpOnly`, `Secure` y `SameSite` si el nivel de riesgo lo exige.
- Los límites DRF usan el caché local predeterminado. No son límites globales ni un mecanismo anti-DDoS: con varios workers/instancias cada proceso puede contabilizar por separado. Antes de escalar, usar Redis compartido y/o rate limiting en el edge.
- El límite de concurrencia de generación IA (máximo 3 respuestas) es por solicitud, no global entre workers. Para volúmenes mayores, mover la generación a una cola de tareas con estados persistentes y workers limitados.
- El perfil devuelto por `/api/me/` y el rol del servidor son autoritativos. No inferir ni fabricar roles en el cliente ante fallas de red/servidor.
- La auditoría almacena IP y user-agent en algunos eventos administrativos. Definir retención, acceso, borrado y finalidad antes de un piloto con personas reales.
- El Shared Pooler transaccional debe probarse con las versiones reales de psycopg/Django y el plan Supabase. `prepare_threshold=None` evita el auto-prepare de psycopg en ese host; verificar en staging que no aparezcan errores de prepared statements.
- El health check `/api/health/` es de vida (liveness), no prueba la disponibilidad de PostgreSQL ni Gemini. La disponibilidad de dependencias debe observarse por separado.


## Nota (MVP actual, v1.0.9+)

Las compuertas `AI_EXTERNAL_PROCESSING_APPROVED` y `AI_GEMINI_PAID_TIER_CONFIRMED` fueron eliminadas para el MVP: el backend envía el contenido directo al proveedor configurado sin validar el nivel gratuito/pago. El resto de validaciones pedagógicas de la IA (puntajes dentro de la rúbrica, evidencia literal, revisión y aprobación docente) siguen intactas. Este artículo describe el diseño de la versión 1.0.7 y conserva utilidad si más adelante se restaura ese `fail-closed`.

<details><summary>Historial: habilitación consciente de IA externa (v1.0.7)</summary>

Gemini y OpenAI permanecían bloqueados en el backend mientras `AI_EXTERNAL_PROCESSING_APPROVED` no fuese explícitamente verdadero. La variable no debía cambiarse para ocultar el error: antes, el responsable del tratamiento debía revisar la finalidad, la base jurídica aplicable, los avisos a docentes/estudiantes, los términos y la retención del proveedor, la ubicación/procesamiento de datos y la minimización o anonimización del contenido.

Para Gemini se exigía además `AI_GEMINI_PAID_TIER_CONFIRMED=True`; no debían enviarse entregas reales usando el nivel gratuito. Ambas variables se configuraban exclusivamente en el entorno del backend y el servicio debía reiniciarse después del cambio. Si no había aprobaciones, se mantenían ambas en `False` y se usaba un proveedor local como Ollama únicamente si se instaló, protegió y probó en la infraestructura propia.

</details>
