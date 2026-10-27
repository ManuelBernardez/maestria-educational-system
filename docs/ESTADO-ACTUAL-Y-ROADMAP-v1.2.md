# MaestrIA — Estado actual, criterios del proyecto y roadmap

**Versión:** 1.2 · **Fecha:** 23/10/2026 · **Estado:** incremento de desarrollo; validación integral pendiente.

## 1. Producto y objetivo

MaestrIA es una plataforma web destinada a docentes hispanohablantes —con mercado inicial en Argentina y perfiles de nivel secundario, terciario y universitario— para organizar cursos, diseñar evaluaciones, definir rúbricas y utilizar IA para obtener propuestas explicadas de corrección. La IA asiste; el docente revisa, modifica y aprueba el resultado definitivo.

La propuesta de valor no es «corregir sin docentes». Se busca reducir trabajo operativo repetitivo y hacer más consistente, comprensible y accionable la retroalimentación a estudiantes.

## 2. Estado de capacidades

### Base de aplicación presente

- Frontend Next.js App Router + React + TypeScript, sitio público y aplicación docente privada.
- Autenticación frontend con Supabase Auth y validación de tokens desde Django REST Framework.
- Modelos relacionales Django/ORM, migraciones versionadas y PostgreSQL/Supabase como destino recomendado.
- Entidades de cursos, alumnos, matrículas, evaluaciones, preguntas, rúbricas/criterios/niveles, entregas/respuestas, correcciones, resultados por criterio, revisiones, ejecuciones de IA y auditoría.
- Adaptadores de IA configurables (modo mock de demostración y proveedores según `.env`).
- Carga de respuestas en texto y documentos de texto extraíble con límites en servidor.
- Propuestas de corrección con puntuación por criterio, justificación, evidencia literal, feedback y advertencias.
- Aprobación docente persistida, validación de rangos/evidencia, historial de revisión y motivo para cambio de nota.
- Formularios y páginas de sitio público, documentación de API y configuración de seguridad.

### En este incremento (v1.2)

- Ajuste del modelo `CorrectionCriterionResult` solicitado y migración del índice.
- Resultados de IA preservan `strengths` y `improvement_suggestions` en el agregado de corrección.
- Interfaz de revisión separa claramente consigna y respuesta original de la propuesta generada por IA.
- La propuesta expone nivel sugerido, evidencia literal y explicación por criterio; el docente puede editar la justificación/evidencia y la devolución antes de aprobar.
- La aprobación solicita justificación si el puntaje cambia respecto de la propuesta persistida.
- Se añadió la página «Entregas» con búsqueda, filtros y navegación directa al detalle de evaluación/entrega.
- La lista de evaluaciones permite buscar/filtrar y la ficha permite editar título, materia, nivel, objetivos, instrucciones, curso asociado y estado, además de archivar conservando historial.

### No afirmar como completo todavía

- Integración de email/WhatsApp: requiere secretos, configuración válida, pruebas y observabilidad. No debe darse por enviado si el endpoint está deshabilitado o se comporta como simulación.
- Proveedor definitivo y evaluación sistemática de calidad IA.
- Portal/cuenta de estudiante, examen online, OCR de manuscrito, integraciones LMS y analítica institucional avanzada.
- Pruebas de carga y seguridad independientes, auditoría de dependencias y revisión legal de privacidad/consentimiento para estudiantes menores.
- Prueba end-to-end sobre un proyecto Supabase conectado y un navegador real con las dependencias definitivas.

## 3. Criterios de aceptación clave

### Corrección asistida

1. La propuesta generada se guarda como pendiente y se identifica claramente como propuesta, nunca como nota definitiva.
2. Cada criterio mantiene nombre, puntaje propuesto, máximo, nivel si existe en la rúbrica, justificación y evidencia.
3. La evidencia se verifica como fragmento literal de la respuesta cargada; si no coincide, se elimina o rechaza en servidor y el docente es advertido.
4. Ningún puntaje puede ser negativo, no finito ni mayor al máximo. El cliente no puede redefinir el máximo de referencia durante aprobación.
5. La cantidad/identidad/orden de criterios debe corresponder con la propuesta persistida.
6. Una modificación de puntaje exige un motivo mínimo y queda en el historial de revisiones; la identidad del docente se toma del token validado, no del cuerpo del cliente.
7. La acción de aprobación guarda el resultado final, feedback, puntaje total, fecha y desglose de criterios en una transacción.
8. Una propuesta de `mock` queda marcada como demostración y no debe habilitar envío real al estudiante.

### Datos y seguridad

1. Todas las consultas de dominio se filtran por propietario; identificadores enviados por el cliente no otorgan derechos.
2. Las relaciones curso/alumno/matrícula/pregunta/rúbrica/entrega deben validar el mismo propietario y contexto de evaluación.
3. No se registran respuestas completas, correos, tokens ni secretos en eventos técnicos.
4. Los secretos de IA, SMTP y base de datos sólo existen en entorno servidor.
5. Las migraciones se prueban en una base de prueba antes de ejecutarse en una base con datos; no se ejecuta SQL de referencia encima de tablas Django ya existentes.
6. RLS en Supabase, si se activa para acceso directo a tablas, debe quedar coordinada con roles/grants y el modo de acceso de Django; no es sustituto de autorización en el backend.

### UX/UI y accesibilidad

- Mobile-first; revisar 320 px, 375 px, tablet y desktop.
- Foco visible, teclado completo, etiquetas, errores comunicados con `role=alert/status`, contraste suficiente, respeto por `prefers-reduced-motion`.
- Navbar global en páginas públicas y área de trabajo persistente durante la navegación autenticada.
- Todas las tarjetas que aparentan ser interactivas tienen una acción real y un foco visible; estados vacíos y de error ofrecen salida/reintento.
- Una entrega muestra en zonas distintas: consigna, respuesta original, propuesta, criterios/evidencia y feedback editable.
- No usar sólo color para comunicar estados; cada estado incluye texto legible.

### SEO/GEO/semántica/progressive enhancement

- Cada página tiene un `h1` representativo, metadatos únicos y enlaces internos descriptivos.
- Páginas públicas indexables, rutas privadas protegidas y excluidas de sitemap.
- HTML semántico, orden de encabezados coherente y contenido explicativo comprensible para docentes no técnicos.
- No afirmar resultados de ahorro, precisión de IA, testimonios o cumplimiento legal que no se hayan demostrado.

## 4. Modelo de datos y corrección criterio

La clase `CorrectionCriterionResult` se actualizó conforme a la especificación compartida:

- FK `correction` obligatoria y `question` opcional (`SET_NULL`).
- Nombre de criterio, puntaje/máximo decimal, evidencia, justificación, feedback y posición.
- Orden por posición e ID.
- Restricción única por `(correction, position)`.
- Check `0 <= score <= max_score` y `max_score >= 0`.
- Índice `(owner_id, criterion_name)` llamado `corr_crit_owner_name_idx`.

La migración 0004 renombra el índice creado por la migración anterior; no recrea tablas ni borra contenido. Ejecutar `python manage.py makemigrations --check` y `python manage.py migrate` contra copia de prueba antes del entorno compartido.

## 5. Roadmap recomendado

### P0 — Estabilización e integración (próximo incremento)

- Ejecutar `python manage.py check`, `python manage.py makemigrations --check`, suite Django y pruebas del flujo con una base de prueba.
- Instalar dependencias y correr `npm run typecheck`, `npm run lint`, `npm run build`.
- Probar alta/login/recuperación de cuenta, curso, matrícula, evaluación, pregunta, rúbrica, entrega, propuesta, edición, aprobación y carga de `CorrectionCriterionResult`.
- Verificar URLs ancladas de Entregas -> Evaluación/entrega y rutas privadas sin sesión.
- Asegurar el cambio de puntaje contra la propuesta original guardada; probar sin motivo, con motivo insuficiente y con motivo válido.
- Probar aislamiento entre dos cuentas y confirmar que una no puede leer/alterar objetos de la otra.

**Criterio de salida:** flujo principal reproducible de punta a punta en entorno de prueba, sin fallos críticos conocidos.

### P1 — Evaluación de calidad de IA

- Preparar un conjunto de respuestas ficticias/anonimizadas, rúbricas y valoraciones de referencia para varias materias/niveles.
- Evaluar, de forma ciega cuando sea posible, puntuación por criterio, evidencia exacta, utilidad del feedback, tasa de modificación y casos de baja confianza.
- Probar casos adversariales: prompt injection dentro de respuestas, evidencia inventada, criterio omitido/duplicado, nota fuera de rango, idioma mixto y respuesta breve.
- Comparar proveedores por calidad observada, precio por corrección, latencia, política de retención y ubicación/tratamiento de datos.
- Añadir budgets/límites de consumo, timeout, reintentos acotados y métricas sin texto personal.

**Criterio de salida:** decisión de proveedor documentada y reporte reproducible; no prometer precisión genérica de la IA.

### P2 — Entregas y corrección UX

- Añadir estados de procesado/cancelación y reintento idempotente para importación y generación.
- Guardado explícito de borradores de edición sin aprobar; mostrar estado “cambios sin guardar”.
- Agregar soporte visible a `SubmissionAnswer` múltiple en una entrega, con navegación por pregunta, si el dominio actual requiere exámenes con varias respuestas.
- Permitir filtros por curso/evaluación/estado en entregas y accesos de retorno desde correcciones.
- Pruebas de accesibilidad manual con teclado/lector de pantalla, foco, contraste y móvil.

**Criterio de salida:** docente puede revisar lotes de respuestas sin perder contexto ni confundir datos fuente y propuesta.

### P3 — Piloto y documentación académica

- Entrevistar al menos a cinco docentes; registrar problemas recurrentes, utilidad y reparos de privacidad.
- Ejecutar piloto con datos autorizados, ficticios o debidamente anonimizados.
- Comparar tiempo para tareas manuales vs. asistidas con protocolo consistente; informar mediana y rango y documentar limitaciones.
- Completar diagrama ER definitivo, contrato OpenAPI, guía de despliegue, runbook de backups/restauración, política de retención y ADRs.
- Actualizar el documento académico con evidencia real, no estimaciones presentadas como resultados.

**Criterio de salida:** informe de evaluación con resultados, límites, riesgos y backlog post-MVP.

### Fuera de prioridad

OCR manuscrito, examen tomado en línea, portal de estudiante, integración LMS, pagos, proctoring, detector de plagio y analítica institucional. No incorporarlas antes de estabilizar el flujo núcleo.

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación / evidencia requerida |
|---|---|
| Error de calificación o sesgo del modelo | Propuesta no definitiva, rúbrica explícita, evidencia verificable, revisión docente, conjunto de referencia y revisión de resultados. |
| Prompt injection desde la respuesta | Tratar texto del estudiante como dato no confiable; instrucciones de sistema acotadas; salida estructurada y validación en servidor. |
| Exposición de datos personales de estudiantes | Minimización/seudonimización, permisos por propietario, política de retención, contratos/configuración del proveedor IA y cuidado especial para menores. |
| Acción duplicada o generación repetida | Identificador/idempotencia en la próxima etapa, estado de procesamiento, límites de consumo y gestión de errores transitorios. |
| Migraciones que dañen datos existentes | Backup restaurable, ensayo en copia, revisión del plan de migración y no eliminar tablas a mano. |
| Confundir demo con IA real | Indicador visible de mock en UI y API; deshabilitar salida/entrega real de resultados demo. |
| Plazo de ocho semanas | Priorizar P0 y flujo de extremo a extremo; pasar integraciones y OCR al futuro. |

## 7. Decisiones pendientes

- Proveedor de IA y modelo: comparar antes de decidir.
- Canal de devolución y reglas de consentimiento: email/WhatsApp no se considera plenamente implementado hasta prueba con cuentas de prueba.
- Política legal de tratamiento de información académica, especialmente para menores: validar con la institución y asesoramiento pertinente.
- Qué representa una `Submission`: entrega con una respuesta o un examen que contiene varias respuestas. En los modelos existen ambos caminos; la UI actual debe converger explícitamente hacia la entidad `SubmissionAnswer` si se habilitan múltiples preguntas por examen.
- Retención y borrado: definir cuándo eliminar datos personales y cómo conservar trazabilidad sin mantener más información personal de la necesaria.

## 8. Comandos de verificación recomendados

Backend, en `backend/` con el entorno virtual activo:

```powershell
python manage.py check
python manage.py makemigrations --check
python manage.py test
python manage.py migrate --plan
```

Frontend, en `frontend/`:

```powershell
npm run lint
npm run typecheck
npm run build
```

Antes de producción, repetir las pruebas con secretos correctamente configurados en un entorno no productivo, ejecutar un escaneo de dependencias y un test de acceso cruzado entre propietarios.
