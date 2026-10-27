# Integración y evaluación de IA — MaestrIA v0.2.0

## Decisión

Gemini API se incluye como primer proveedor externo, sin añadir un SDK específico: el backend usa `httpx` para hacer la llamada HTTPS al endpoint oficial `generateContent` con respuesta JSON. Esto evita otra dependencia y mantiene la clave fuera del navegador. El proveedor continúa siendo intercambiable (`mock`, `gemini`, `openai`, `ollama`).

Modelo inicial: `gemini-3.8-flash`, configurable con `GEMINI_MODEL`. Está orientado a tareas rápidas, pero no se declara “corrector pedagógico validado” hasta evaluar resultados en ejemplos reales y con docentes. La API puede cambiar; verificar el catálogo oficial antes de actualizar: https://ai.google.dev/gemini-api/docs/models

## Seguridad y privacidad antes de usar datos reales

- `AI_PROVIDER=mock` sigue siendo la configuración por defecto.
- Todas las llamadas externas requieren `AI_EXTERNAL_PROCESSING_APPROVED=True`.
- Para flujos normales con Gemini, también hay que confirmar revisión del nivel pago con `AI_GEMINI_PAID_TIER_CONFIRMED=True`.
- El nivel gratuito de Gemini indica que el contenido enviado puede usarse para mejorar productos de Google; el nivel pago indica que no se usa para mejorar productos. **No uses respuestas reales de estudiantes con el nivel gratuito.** Confirmá las condiciones actuales y las obligaciones locales antes de habilitar contenido educativo real: https://ai.google.dev/gemini-api/docs/pricing
- La única excepción al bloqueo por nivel pago es el comando de evaluación, que admite el nivel gratuito solo si `AI_GEMINI_FREE_TIER_SYNTHETIC_EVAL=True` y utiliza exclusivamente `backend/apps/core/fixtures/ai_eval_cases.json`. El permiso lo usa únicamente el comando; la app web no lo hereda para correcciones normales.
- La bandera `AI_GEMINI_PAID_TIER_CONFIRMED` es una afirmación operativa, no una verificación automática de Google Billing. La persona administradora debe comprobar la consola/cuenta real.
- Nunca definir `GEMINI_API_KEY` como `NEXT_PUBLIC_*`, guardarla en el frontend, registrarla en logs o incluirla en Git.
- Evitar enviar nombre, email, teléfono, documento, escuela u otra información identificable. Una respuesta escrita puede contener datos personales incluso sin nombre; la minimización y la revisión del docente siguen siendo necesarias.

## Configuración local

1. Crear una API key en Google AI Studio/Google AI for Developers y guardarla solo en `backend/.env`.
2. Para evaluación de ejemplos sintéticos con nivel gratuito, configurar:

   ```dotenv
   AI_PROVIDER=gemini
   AI_EXTERNAL_PROCESSING_APPROVED=True
   AI_GEMINI_PAID_TIER_CONFIRMED=False
   AI_GEMINI_FREE_TIER_SYNTHETIC_EVAL=True
   GEMINI_API_KEY=... # solo local; nunca publicar
   GEMINI_MODEL=gemini-3.8-flash
   ```

3. Ejecutar el backend y **solo el comando sintético**:

   ```powershell
   cd backend
   python manage.py evaluate_ai --output ai-evaluation.json
   ```

4. Para habilitar propuestas normales (consignas, rúbricas y corrección de contenido docente), cambiar solo después de revisar términos y nivel de cuenta:

   ```dotenv
   AI_GEMINI_PAID_TIER_CONFIRMED=True
   AI_GEMINI_FREE_TIER_SYNTHETIC_EVAL=False
   ```

No copies la API key en solicitudes de soporte ni la compartas con la persona desarrolladora. Si alguna vez se expone, revocala y crea otra.

## Qué hace la integración

- Usa system instructions y recibe el contexto como JSON, separando reglas de sistema de los datos del alumno.
- Solicita `application/json`, usa una temperatura baja para corrección y limita tokens de salida y timeout.
- Comprueba que haya contenido y JSON válido antes de procesarlo.
- Valida scores contra máximos establecidos por el docente, alinea los criterios con la rúbrica y descarta citas de evidencia que no aparezcan literalmente en la respuesta.
- Limita concurrencia de correcciones por lote, tamaño de respuestas y frecuencia de los endpoints de IA.
- Ante fallo del proveedor no crea una corrección vacía y mantiene la trazabilidad técnica sin almacenar el texto en la telemetría.
- Cada corrección continúa en estado pendiente de revisión; solo la persona docente puede editar/aprobar.

Esto reduce errores estructurales, pero no certifica que una calificación sea pedagógicamente correcta, justa ni libre de sesgos.

## Evaluación automatizada incluida

Casos sintéticos en español cubren:

1. Respuesta de alta calidad sobre fotosíntesis.
2. Respuesta parcial.
3. Error conceptual claro.
4. Argumentación histórica sobre las causas de la Revolución de Mayo.
5. Procedimiento algebraico correcto.
6. Intento de alterar las instrucciones dentro de la respuesta del estudiante (*prompt injection*).

El comando guarda un JSON con resultado, puntuación, latencia, alineación con rúbrica, evidencia literal y una pregunta para la revisión pedagógica humana. Los rangos de puntaje de los fixtures son **bandas orientativas**, no etiquetas de verdad universal. Una tasa alta de validaciones técnicas no garantiza calidad educativa.

### Criterios de aceptación iniciales

- 100% de propuestas con número de criterios alineado con la rúbrica o normalizado con advertencia.
- 100% de puntajes entre cero y máximo.
- 100% de evidencia no vacía idéntica a un fragmento de la respuesta.
- Cero calificaciones finales automáticas: el estado solo pasa a aprobado mediante acción docente explícita.
- Revisar manualmente todos los desacuerdos de puntaje, retroalimentación genérica, alucinaciones, sesgos de registro/variedad lingüística y tratamiento de respuestas en blanco o fuera de tema.
- Medir por caso: latencia, tasa de error, coste/token, tasa de ajuste docente de puntaje y comentarios, y acuerdo entre docentes.

## Evaluación humana sugerida

Dos docentes evalúan de forma independiente una muestra sintética y luego anonimizada/autorizada de diferentes asignaturas y niveles. Comparar la propuesta del modelo con la pauta consensuada, no solo con una nota global. Incluir diversidad de extensión, ortografía, respuestas correctas alternativas, errores parciales, lenguaje regional, discapacidad/ajustes razonables, respuestas en blanco y contenidos adversariales. Resolver discrepancias de la rúbrica antes de atribuirlas al modelo.

No considerar el MVP listo para un piloto real hasta terminar revisión de privacidad, acceso, retención y términos del proveedor.
