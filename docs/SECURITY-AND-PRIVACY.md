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
- Next.js emite cabeceras de seguridad, no expone `X-Powered-By` e incluye rutas informativas para privacidad y términos, cuyo texto sigue necesitando los datos de la entidad responsable y revisión legal.
- Se incorporaron enlace de salto al contenido, focos visibles, respeto por movimiento reducido, estados de error/carga y recuperación de contraseña.

## Pendiente antes de producción

Ejecutar pruebas con al menos dos usuarios distintos para comprobar aislamiento en todos los endpoints; validar recuperación de cuenta; configurar SPF/DKIM/SMTP únicamente si se habilitan notificaciones por correo del formulario público o se configura el correo de autenticación; restringir CORS a dominios públicos exactos; comprobar políticas de retención y borrado; establecer backups/restauración; revisar la salida de IA y los acuerdos del proveedor; desplegar solo con HTTPS; completar los datos reales de contacto/privacidad/términos; y realizar pruebas automatizadas de accesibilidad y seguridad. No subir `.env`, dumps de estudiantes ni claves a Git.
