# Registro de decisiones técnicas (ADR resumido)

## DEC-001 — Aplicación modular, no microservicios
**Estado:** aceptada para el MVP.  
**Decisión:** frontend Next.js separado del backend FastAPI, con un único backend modular.  
**Motivo:** equipo pequeño, tres semanas para el prototipo y necesidad de separar presentación, reglas de negocio e integraciones sin sumar operación innecesaria.

## DEC-002 — PostgreSQL gestionado y Supabase Auth
**Estado:** recomendada, validar límites/región/costos.  
**Decisión:** Supabase PostgreSQL y Auth; cada recurso de negocio pertenece a un docente.  
**Control:** autorización por recurso en backend y RLS en la base como defensa adicional.

## DEC-003 — Proveedor de IA intercambiable
**Estado:** aceptada.  
**Decisión:** la lógica educativa no llama directamente a un SDK específico; utiliza un adaptador. El MVP usa un endpoint compatible con Chat Completions configurable por entorno.  
**Motivo:** permitir cambiar de proveedor y evaluar modelo local después.

## DEC-004 — La IA no confirma notas
**Estado:** aceptada.  
**Decisión:** toda salida de IA es una propuesta. La calificación final requiere edición/confirmación explícita del docente y debe conservarse la trazabilidad.

## DEC-005 — Integraciones de entrega por etapas
**Estado:** aceptada.  
**Decisión:** exportación primero; correo y WhatsApp detrás de adaptadores. No se habilita envío real sin credenciales, consentimiento y pruebas.

## DEC-006 — Límites del MVP
**Estado:** aceptada.  
**Incluye:** evaluaciones, preguntas abiertas, rúbricas, respuestas textuales, corrección asistida, revisión docente e historial.  
**Fuera de la primera entrega:** OCR manuscrito, LMS completo, cuentas estudiantiles, analítica institucional avanzada y despliegue de un modelo local productivo.
