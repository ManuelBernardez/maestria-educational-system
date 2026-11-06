# MaestrIA v1.0.7

## Cambios

- **Privacidad de IA:** se conserva el bloqueo por defecto para Gemini y OpenAI. El mensaje explica el control institucional que debe revisarse antes de habilitar envíos externos. No se activa el permiso desde el frontend ni se cambia el entorno desplegado automáticamente.
- **Errores coherentes:** los flujos de generación de consignas, rúbricas y correcciones clasifican bloqueos de política/configuración como `503 Service Unavailable`; las fallas reales del proveedor siguen como `502 Bad Gateway`.
- **Configuración operativa:** nueva guía `CONFIGURACION-IA-EXTERNA.md` con revisión de privacidad, variables, Render, reversión y alternativas locales.
- **Números:** la interfaz muestra hasta dos decimales significativos y usa coma decimal en español argentino. Se mantienen sin cambios los valores persistidos y la normalización exacta de los campos de entrada.
- **Diseño:** actualización visual del espacio docente tomando las referencias adjuntas: sidebar verde bosque, cuadrícula de fondo, tarjetas cálidas en tema claro y superficies verdes profundas en tema oscuro, acentos pastel, encabezados destacados y ajustes responsive.
- **Caché:** stylesheet versionado como `1.0.7`.

## Validaciones

- `npm run check:frontend` (páginas, módulos, contrato de flujo docente y casos de formato numérico).
- `python -m compileall -q backend`.
- `python scripts/check_backend_imports.py`.
- Parseo de `render.yaml` y `frontend/css/workspace.css`.

No se pudo ejecutar la suite Django ni pruebas E2E contra Render/Supabase porque este entorno no incluye Django/DRF ni credenciales de despliegue. El uso real de IA requiere completar la aprobación de privacidad y la configuración del proveedor en el entorno backend; esta entrega no cambia esas variables.
