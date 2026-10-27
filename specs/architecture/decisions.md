# Registro de decisiones — MaestrIA

## ADR-001 — Backend Django REST Framework

**Estado:** aceptada para la primera versión.

**Contexto:** aplicación educativa con usuarios, evaluaciones, preguntas, rúbricas, alumnos, entregas y correcciones. El equipo necesita llegar a un prototipo integrado rápido y mantenerlo luego.

**Decisión:** Django + Django REST Framework. Se priorizan ORM, migraciones, validación y convenciones maduras. No se combinan Django y FastAPI en el MVP.

**Consecuencias:** se requiere validar el token Supabase en el backend y definir un flujo claro de migraciones. Psycopg directo se reserva para necesidades concretas, no como segunda capa de persistencia.

## ADR-002 — Supabase Auth y aislamiento por propietario

**Estado:** propuesta implementada en starter.

Los usuarios se autentican con Supabase Auth. La API valida JWT y utiliza `sub` como `owner_id`. El cliente nunca decide el propietario. Todas las consultas filtran por el propietario autenticado. Antes de producción se requieren pruebas de aislamiento y evaluación de RLS/roles de base de datos.

## ADR-003 — Proveedor de IA intercambiable

**Estado:** implementada interfaz inicial en v0.2.0.

`AI_PROVIDER=mock|gemini|openai|ollama`. Mock sirve únicamente para demostrar el flujo; se identifica como demostración y no puede aprobarse como calificación real. Gemini es la primera opción externa; las claves permanecen en el backend y el envío externo está bloqueado hasta revisar privacidad y habilitar la configuración explícita. Los proveedores reales se adaptan al mismo contrato y el docente debe revisar y aprobar cada corrección.

## ADR-004 — Una sola aplicación de backend

No se introducen microservicios, Redis, colas, vector DB ni RAG en esta etapa. Se agregarán únicamente si las mediciones o los requisitos lo justifican.
