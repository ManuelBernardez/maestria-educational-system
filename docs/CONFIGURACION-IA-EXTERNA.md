# Configuración de IA externa (MVP)

En la versión MVP de MaestrIA, el adaptador de IA no aplica bloqueos automáticos por nivel gratuito o pago del proveedor. Si `AI_PROVIDER=gemini` (o una fila Gemini habilitada en `public.ai_provider_config`) y las credenciales/modelo están configurados, las tres operaciones —corregir, generar preguntas y generar rúbricas— pueden enviar el contenido al proveedor según las condiciones de esa cuenta.

> **Privacidad:** no asumas que el modo gratuito/pago, la retención, la región ni el uso de datos son iguales entre proveedores o planes. Antes de enviar trabajos reales, consultá los términos vigentes del proveedor y obtené la aprobación institucional correspondiente.

> **Importante para despliegue:** `AI_PROVIDER=mock` es el fallback del entorno, no un interruptor absoluto. Si existe una fila habilitada en `public.ai_provider_config`, `active_ai_provider_config()` la selecciona con prioridad sobre la variable de entorno. Antes de procesar trabajos reales, revisar las configuraciones habilitadas en el panel de administración y documentar la aprobación institucional del proveedor/datos. El backend no verifica automáticamente plan, facturación, residencia ni condiciones contractuales.

## Gemini

1. Copiar `backend/.env.example` a `backend/.env`.
2. Definir `AI_PROVIDER=gemini`, `GEMINI_API_KEY` y `GEMINI_MODEL`.
3. Ajustar `AI_TIMEOUT_SECONDS` y `AI_MAX_CONCURRENT_ANSWERS` si el plan de cuota lo requiere.
4. Reiniciar el backend y probar con el smoke test sintético:
   `backend\.venv\Scripts\python.exe scripts\live_ai_smoke.py`
   o la verificación completa: `python manage.py verify_ai --live`.

El nivel `mock` sigue disponible para probar la interfaz sin red; sus resultados no se pueden aprobar como calificación real.

## OpenAI y ejecución local

Definir `AI_PROVIDER=openai`, `OPENAI_API_KEY` y `OPENAI_MODEL` con un identificador de modelo habilitado para el proyecto y compatible con Chat Completions + JSON mode (o `AI_PROVIDER=ollama` con `OLLAMA_BASE_URL` para ejecución 100% local). La aplicación no asume un modelo OpenAI por defecto: si falta `OPENAI_MODEL`, devuelve un error de configuración `503` antes de llamar al proveedor. El adaptador valida la estructura de la respuesta del modelo en los tres casos: puntajes dentro del máximo de la rúbrica, evidencia literal presente en la respuesta del estudiante y cantidad de criterios alineada.
