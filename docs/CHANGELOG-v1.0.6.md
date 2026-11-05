# MaestrIA v1.0.6

## Cambios

- **Cursos:** el formulario de alta ya no presenta un selector de estado. Todo curso nuevo nace activo y puede archivarse/reactivarse desde la ficha del curso. El backend aplica la misma regla para altas realizadas directamente por API.
- **Evaluaciones:** el serializer usado por el editor ahora incluye `reference_material`, de modo que el material importado se conserva al modificar otros campos de la evaluación.
- **Consignas:** la edición ya no incluye el identificador de evaluación en el `PATCH`; ese vínculo se establece al crear la consigna y no se intenta modificar después. La recarga del editor conserva el contexto de evaluación.
- **Formato numérico:** se normalizan los números de puntajes, máximos, ponderaciones y campos de edición. Se eliminan ceros decimales finales (`10.000000` → `10`, `10.500000` → `10,5`) y no se muestran decimales para valores enteros.
- **Generación de consignas:** errores de configuración o de política del proveedor se clasifican como `503 Service Unavailable`; fallos del proveedor siguen como `502 Bad Gateway`.

## Configuración de IA y privacidad

Con Gemini, `AI_GEMINI_PAID_TIER_CONFIRMED=False` impide enviar contenido real de docentes o estudiantes. Esto es intencional: no se debe habilitar el uso ordinario de Gemini Free con información educativa privada. La opción `AI_GEMINI_FREE_TIER_SYNTHETIC_EVAL` se reserva exclusivamente para evaluaciones offline con ejemplos sintéticos, no para solicitudes de la aplicación. Para desarrollo se puede configurar `AI_PROVIDER=mock` (salida demostrativa, no válida para aprobar calificaciones) o utilizar un modelo local mediante Ollama.

## Validaciones realizadas

- `npm run check:frontend`.
- `python -m compileall -q backend scripts`.
- `python scripts/check_backend_imports.py`.
- Pruebas de `formatInputNumber` y `formatNumber` con enteros, decimales y cadenas con ceros redundantes.

No se realizó una ejecución E2E de Django ni una prueba contra Render/Supabase. Django no está instalado en el entorno de revisión y no se utilizó la base desplegada. Por eso, aunque el `PATCH` evita reenviar una FK inmutable y el editor conserva material importado, la causa exacta del `400` solo puede darse por confirmada al revisar el cuerpo JSON de respuesta del servidor.
