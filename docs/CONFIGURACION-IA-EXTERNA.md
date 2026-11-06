# Configuración de IA externa (MVP)

En la versión MVP de MaestrIA, el adaptador de IA no aplica bloqueos sobre el nivel gratuito o pago del proveedor: si `GEMINI_API_KEY` y `GEMINI_MODEL` están configurados, las tres operaciones (corrégir, generar preguntas, generar rúbricas) funcionan con Gemini según el plan vigente del proyecto de Google.

> **Nota para la versión productiva final:** las condiciones de Gemini API distinguen los servicios no pagados (el contenido puede utilizarse para mejorar productos de Google y ser revisado por personas) de los servicios pagados (contenido no usado con ese fin, procesado bajo el Anexo de Tratamiento de Datos). Antes de pasar a la nube con entregas reales de estudiantes, conviene evaluar si este uso refleja las expectativas de privacidad acordadas con la institución. Revisar siempre la versión vigente de las [condiciones adicionales de Gemini API](https://ai.google.dev/gemini-api/terms) y la [guía de facturación](https://ai.google.dev/gemini-api/docs/billing).

## Gemini

1. Copiar `backend/.env.example` a `backend/.env`.
2. Definir `AI_PROVIDER=gemini`, `GEMINI_API_KEY` y `GEMINI_MODEL`.
3. Ajustar `AI_TIMEOUT_SECONDS` y `AI_MAX_CONCURRENT_ANSWERS` si el plan de cuota lo requiere.
4. Reiniciar el backend y probar con el smoke test sintético:
   `backend\.venv\Scripts\python.exe scripts\live_ai_smoke.py`
   o la verificación completa: `python manage.py verify_ai --live`.

El nivel `mock` sigue disponible para probar la interfaz sin red; sus resultados no se pueden aprobar como calificación real.

## OpenAI y ejecución local

Definir `AI_PROVIDER=openai` con `OPENAI_API_KEY` (o `AI_PROVIDER=ollama` con `OLLAMA_BASE_URL` para ejecución 100% local). El adaptador valida la estructura de la respuesta del modelo en los tres casos: puntajes dentro del máximo de la rúbrica, evidencia literal presente en la respuesta del estudiante y cantidad de criterios alineada.
