# Feature: flujo principal del MVP

## Requisito

El docente define una evaluación, organiza preguntas y rúbrica, carga una respuesta, solicita una propuesta de corrección, revisa/edita y aprueba el resultado final.

## Criterios de aceptación

- [ ] El docente autenticado puede crear y consultar sus evaluaciones.
- [ ] No puede consultar ni modificar datos de otra cuenta.
- [ ] Una propuesta de IA incluye puntuación por criterio, justificación, evidencia y feedback.
- [ ] Una propuesta simulada se identifica claramente como demo.
- [ ] La salida de IA se valida y los puntajes se limitan al máximo del criterio.
- [ ] Ninguna propuesta pasa a estado definitivo sin acción explícita del docente.
- [ ] La exportación indica si la corrección está aprobada o pendiente.
- [ ] Los errores del proveedor no exponen secretos ni el contenido completo de la respuesta.

## Fuera de alcance inicial

OCR manuscrito, LMS, cuentas de alumnos, analítica institucional, RAG y calificación automática sin revisión humana.
