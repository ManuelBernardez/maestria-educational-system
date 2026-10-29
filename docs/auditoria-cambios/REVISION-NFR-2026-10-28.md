# Informe de refactorización y validación — 28 de octubre de 2026

## Alcance

Esta revisión priorizó cambios de bajo riesgo que refuerzan invariantes del negocio, limitan lecturas y operaciones costosas, y mejoran el ciclo de vida de las solicitudes. Se conservaron los contratos principales de la API y la estructura de `frontend/` y `backend/`. El directorio adicional `maestria-starter/` se conserva porque forma parte del ZIP recibido; no se asumió que fuera seguro eliminarlo.

## Cambios realizados

### Backend (Django REST Framework)

- Las listas de entregas devuelven un resumen con una vista previa acotada del texto en vez de incluir el contenido completo de todas las respuestas. El detalle y el espacio de corrección mantienen el acceso al contenido completo para sus funciones.
- Se agregó una respuesta de correcciones `?summary=1` con metadatos mínimos para pantallas que solo necesitan estado y proveedor, sin descargar propuestas ni resultados completos.
- La consulta del espacio de corrección es de solo lectura; la limpieza de datos de demostración se mantiene en la acción explícita de preparación del ejemplo y no ocurre al abrir una pantalla.
- Se agregaron comprobaciones de pertenencia y de identidad inmutable para preguntas, entregas, respuestas y matrículas, evitando que un PATCH cambie silenciosamente el historial vinculado a otra evaluación, estudiante o entrega.
- Los cambios de consigna, evaluación, material de referencia o respuesta se coordinan con bloqueos transaccionales y se rechazan mientras una entrega relacionada está en procesamiento.
- La posición de nuevas consignas se calcula en el servidor bajo bloqueo. La creación de matrículas traduce los conflictos de unicidad en un error de validación legible.
- La generación de correcciones reserva la entrega con estado `processing` dentro de una transacción antes de invocar el proveedor de IA, limita la concurrencia y el tamaño del lote, vuelve a verificar el snapshot antes de guardar y protege contra workers viejos que regresan después de vencer/reemplazarse una reserva.
- La aprobación conserva el historial, rechaza propuestas demostrativas, impide que haya más de una corrección aprobada por entrega y valida que las preguntas referenciadas pertenezcan a la evaluación correspondiente.
- La autenticación JWT limita el tamaño del token y el tiempo de espera/cache de claves JWKS. El timeout de SMTP también queda acotado.
- Se agregaron pruebas de regresión para endpoints owner-scoped, carga de resumen, GET de solo lectura, propuestas demo, identidad inmutable y solicitudes de corrección duplicadas.

### Frontend (Next.js / TypeScript)

- Se centralizó el control de solicitudes en `src/lib/api.ts`: URLs limitadas al origen/prefijo configurado, HTTPS obligatorio para la API en producción, bearer JWT en cabecera, sin cookies cross-origin, cache `no-store`, errores normalizados y límite de tiempo que cubre la sesión y la lectura completa del cuerpo.
- Se normalizó la descarga de archivos y el saneamiento del nombre propuesto por el servidor. Las cargas `FormData` no fuerzan un `Content-Type` manual.
- Las pantallas principales cancelan lecturas obsoletas, evitan que una respuesta anterior sobreescriba el estado de una selección posterior y capturan fallos de solicitudes asíncronas.
- Se agregaron bloqueos síncronos de acciones en pantallas críticas para evitar dobles envíos antes de que React refleje `busy`, especialmente en generación de IA, carga de archivos, guardado/aprobación y acciones que crean registros.
- Los formularios cambiaron la anotación `FormEvent` a `SubmitEvent` para alinearse con los tipos de React de la versión objetivo, y se mejoraron estados de carga, errores accesibles y ciclo de vida de autenticación.
- Se eliminaron solicitudes redundantes en la pantalla de entregas; se consume el resumen de correcciones para vistas que no necesitan la rúbrica/JSON de propuesta completos.
- Se reforzó el cambio de cuenta en la misma pestaña para no dejar montado el estado cliente de una cuenta anterior.

## Base de datos y migraciones

**No se agregó una migración.** Los modelos y la migración existente ya admiten `Submission.status = processing` y su constraint, por lo que la reserva temporal de generación se puede implementar sin un cambio de esquema. Los nuevos controles usan transacciones y las restricciones existentes. La integridad debe validarse contra PostgreSQL/Supabase real antes de producción; SQLite no demuestra el comportamiento de bloqueos de fila de PostgreSQL.

## Validación realizada en este entorno

- `python -m compileall -q backend`: correcto (sintaxis/compilación de Python).
- `npm install --package-lock-only ...`: no pudo completarse porque el entorno no logró resolver el registro npm (`EAI_AGAIN`).
- `npm ci --offline`: no pudo completarse porque no existe en caché `eslint-config-next`.
- `python manage.py check` y la suite de Django no pudieron ejecutarse: Django no está instalado en este entorno de ejecución (`ModuleNotFoundError: django`).
- Por esas limitaciones no se afirma que las pruebas de integración, lint, typecheck o build hayan pasado. Se recomienda ejecutar el procedimiento de validación final más abajo en una máquina con acceso a npm y las dependencias de Python disponibles.

## Bloqueo de dependencias conocido

`frontend/package.json` declara la versión `0.2.5` y `eslint-config-next`/`@next/eslint-plugin-next` de Next 16, mientras `frontend/package-lock.json` todavía contiene metadatos `0.1.0` y rangos de ESLint de Next 14. No se fabricó un lockfile ni se cambiaron hashes a mano porque npm no tuvo conectividad para resolver las versiones.

En un entorno con red, desde `frontend/`:

```powershell
npm install --package-lock-only --no-audit --no-fund
npm ci
npm run lint
npm run typecheck
npm run build
```

Si `npm ci` falla, resolver la discrepancia de versiones y regenerar el lockfile antes de cambiar el workflow de CI a `npm ci`. El workflow actual usa `npm install`; se dejó así para no romper CI con un lockfile que todavía no se pudo reconciliar.

## Lista recomendada antes de producción

1. Ejecutar los tests Django y `makemigrations --check --dry-run` contra la configuración prevista; probar migraciones en una copia de PostgreSQL/Supabase.
2. Regenerar y validar el lockfile; ejecutar lint, typecheck, build y el workflow de CI.
3. Ejecutar tests de aislamiento con al menos dos docentes para todos los endpoints que listan, modifican, importan, exportan y aprueban recursos.
4. Probar concurrencia real en PostgreSQL: dos generaciones simultáneas de la misma entrega, aprobación concurrente, edición de evaluación durante generación y recuperación de una reserva `processing` antigua.
5. Revisar rate limits, retención y tamaño de archivos, políticas de backup y mensajes/logs para asegurar que no se registren respuestas de estudiantes, JWT ni secretos.
6. Hacer pruebas manuales de teclado/lector de pantalla y viewport móvil, además de pruebas de flujos de registro, recuperación de cuenta y cambio de usuario.
7. Validar con docentes las salidas de IA antes de usar datos reales. Los bloqueos del backend no sustituyen una revisión de privacidad y evaluación pedagógica.

## Nota de seguridad

El frontend es un control de experiencia, no un límite de autorización. Los controles de propietario y las validaciones del backend continúan siendo la barrera de seguridad. Las claves de proveedor, secretos Django/JWT y URIs PostgreSQL deben mantenerse solo en variables de entorno privadas; las variables `NEXT_PUBLIC_*` nunca deben contener secretos.
