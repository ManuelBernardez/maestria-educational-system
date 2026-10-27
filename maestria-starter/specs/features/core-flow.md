# Feature: flujo central de evaluación y corrección

## Objetivo
Permitir que un docente diseñe una evaluación, defina criterios, cargue una respuesta y reciba una propuesta explicada que pueda revisar y aprobar.

## Criterios de aceptación
- El docente autenticado solo puede operar sobre sus propios recursos.
- La evaluación admite título, materia/nivel y objetivos.
- Las preguntas y la rúbrica son editables antes de corregir.
- La corrección devuelve puntuación por criterio, justificación, evidencia textual cuando exista y feedback.
- La salida se valida contra un esquema; una salida inválida no se guarda como resultado definitivo.
- La UI distingue claramente propuesta de IA y resultado aprobado por el docente.
- Se registra el estado de la corrección y el resultado final sin sobrescribir silenciosamente la propuesta original.
- Los fallos del proveedor se muestran como errores recuperables y no como notas.

## Casos negativos obligatorios
- Token ausente, inválido o vencido.
- Recurso de otro docente.
- Respuesta vacía o demasiado extensa.
- Rúbrica inválida o sin criterios.
- Timeout del proveedor o respuesta que no cumple el esquema.
