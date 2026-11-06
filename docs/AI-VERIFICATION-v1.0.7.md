# IA en MaestrIA v1.0.7: configuración y verificación

## Qué queda cubierto

La integración centraliza generación de correcciones, propuestas de consignas y rúbricas para Gemini, OpenAI y Ollama. Cada proveedor recibe JSON estructurado, tiene timeout acotado y reintentos ante fallos transitorios de conexión/HTTP; un timeout individual no se reintenta para no duplicar la espera. La corrección de múltiples respuestas tiene un límite global `AI_REQUEST_TIMEOUT_SECONDS` (120 s por defecto), inferior al timeout del proceso web. Las correcciones se normalizan contra la rúbrica del docente y las citas se verifican contra el texto original. El modo `mock` queda limitado a demostraciones: la API de corrección devuelve `503` cuando ese modo es el proveedor efectivo, para impedir que se aprueben puntajes simulados.

## Prioridad de configuración

Si existe un registro habilitado en `public.ai_provider_config`, éste tiene prioridad sobre `AI_PROVIDER`, el nombre del modelo y el timeout del entorno. Si no existe registro activo, se usan las variables de entorno. El endpoint autenticado `GET /api/ai/status/` (sólo administración global) informa el proveedor efectivo, el origen, el modelo, el timeout y controles no sensibles. Nunca devuelve claves.

## Gemini y el nivel gratuito

Configuración base: `AI_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.5-flash-lite`, `GEMINI_THINKING_LEVEL=minimal`, `AI_TIMEOUT_SECONDS=60`. El adaptador usa `generateContent`, `responseMimeType=application/json` y `thinkingConfig.thinkingLevel`; deja los parámetros de muestreo en sus valores predeterminados (sin enviar `temperature`) para Gemini 3.x.

La configuración segura para datos reales requiere una clave nueva, autorización institucional del procesamiento externo y facturación activa confirmada para el proyecto de Google: `AI_EXTERNAL_PROCESSING_APPROVED=True` y `AI_GEMINI_PAID_TIER_CONFIRMED=True`. No establezcas el segundo valor si el proyecto no tiene facturación activa. No se intenta sortear la política del proveedor.

Cuando no hay facturación activa, las correcciones normales con Gemini quedan bloqueadas. Para probar conectividad y los tres flujos de IA exclusivamente con ejemplos sintéticos, puede habilitarse temporalmente `AI_GEMINI_FREE_TIER_SYNTHETIC_EVAL=True`, siempre que también se haya aprobado el envío de esos ejemplos. La excepción sólo existe en el comando de verificación; las rutas normales de la aplicación continúan bloqueadas. El contenido de la prueba es ficticio y no debe reemplazarse por datos de estudiantes.

## Comandos de verificación

Desde `backend/` y con el entorno virtual activado:

```powershell
python manage.py verify_ai
```

Comprueba la configuración efectiva y no realiza llamadas externas. Para enviar ejemplos sintéticos al proveedor activo:

```powershell
python manage.py verify_ai --live
```

Sólo para el escenario Gemini gratuito y sólo con `AI_GEMINI_FREE_TIER_SYNTHETIC_EVAL=True`:

```powershell
python manage.py verify_ai --live --allow-free-synthetic
```

La prueba en vivo ejecuta las tres operaciones: `generate_correction`, `generate_questions` y `generate_rubric`. No registra el contenido de los ejemplos ni imprime credenciales. También se puede consultar el diagnóstico desde Administración → Servicios e IA.

## Ollama local

Para probar sin enviar texto a un proveedor externo, ejecutá Ollama en el mismo equipo que el backend y configurá `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://localhost:11434` y `OLLAMA_MODEL` con un modelo instalado. En Render, `localhost` apunta al contenedor de Render, no a la computadora del desarrollador; por eso la URL local sólo funciona si el backend también corre localmente.

## Límites de la verificación de esta entrega

Las rutas de los tres flujos se probaron con `httpx.MockTransport`: se verificaron las solicitudes REST, la salida JSON y la normalización de resultados sin usar una API key real. Se probaron sintaxis Python y chequeos estáticos del frontend/contrato. No se realizó una llamada a Google/OpenAI ni una prueba E2E contra Render/Supabase: no se usan secretos previamente expuestos y el entorno de revisión no dispone de Django ni de acceso a la base desplegada. La prueba en vivo debe ejecutarse con una clave nueva desde el backend desplegado o local.
