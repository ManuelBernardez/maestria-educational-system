# Auditoría — Integración IA sin compuertas free/pago (2026-11-06)

## Objetivo

Hacer funcionar la IA **YA** en el MVP: eliminar toda restricción sobre el uso gratuito/pago del proveedor, verificar que la cadena completa (frontend → API Django → adaptador de IA → Gemini) quedó consistentemente integrada y validar con llamadas reales.

## Alcance de lo desarrollado

La integración de IA ya contaba con casi todos sus módulos (trabajo previo no commiteado en el repo). Esta sesión la **revisó de punta a punta, quitó las compuertas** y la verificó en vivo:

| Componente | Estado |
|---|---|
| `frontend/js/api.js` (cliente HTTP) | Existente, sin cambios. Soporta timeouts de 180 s para operaciones IA. |
| Frontend features (`workspace.js`, `forms.js`, `submissions.js`, `assessments.js`, `rubrics.js`) | Ya llamaban a `generate-questions/`, `generate-correction/`, `rubrics/generate/`, `import-reference/`. Sin cambios. |
| Endpoints Django (`api_views/submissions.py`, `urls.py`) | Ya implementados (rate limit IA, locks de concurrencia, aprueba/exporta). Sin cambios. |
| Adaptador `backend/apps/core/ai.py` | Reescrito el mecanismo de autorización: **removidas** `_assert_external_ai_approved` y las variables `AI_EXTERNAL_PROCESSING_APPROVED`, `AI_GEMINI_PAID_TIER_CONFIRMED`, `AI_GEMINI_FREE_TIER_SYNTHETIC_EVAL`. Los parámetros dead (`allow_free_tier_synthetic`) se eliminaron de la cadena de llamadas. |
| Mapeo de errores (`ai_error_code`, `common.py`) | Se quitaron las categorías de compuerta (`EXTERNAL_PROCESSING_NOT_APPROVED`, `GEMINI_PAID_TIER_NOT_CONFIRMED`) y sus prefijos seguros. |
| Comandos de verificación (`verify_ai.py`, `evaluate_ai.py`) | Depurados de la lógica de nivel pago. |
| Tests (`tests.py`, `scripts/test_ai_adapter.py`) | Removidos los tests de compuerta; 5/5 tests de contrato OK, 24/24 tests unitarios de IA OK. |
| Config (`backend/.env`, `.env.example`, `render.yaml`, workflow CI, README, docs de seguridad) | Actualizados para reflejar el nuevo comportamiento. |

## Verificación en vivo (EXITOSA)

`scripts/live_ai_smoke.py` (nuevo: smoke test sin Django ni base de datos) contra Gemini real con la clave del `.env`, usando SOLO datos sintéticos:

- ✅ **Corrección**: 2 criterios cambiados, puntajes 5.0/5.0 y 5.0/5.0, total 10.0, evidencia literal y localizada en la respuesta.
- ✅ **Generación de consignas**: 2 preguntas en español coherentes con el tema.
- ✅ **Generación de rúbrica**: 2 criterios editables.
- Las tres devolvieron `demo=False` (proviene de modelo real, no mock).

La compuerta era lo único que bloqueaba su uso en la app; el resto de la cadena ya estaba.

## Problemas encontrados

1. **Bug latente en `verify_ai.py`**: importaba `ai_http_status` desde `apps.core.ai`, pero el símbolo real es `ai_error_http_status` en `api_views/common.py` → rompía el handler de errores de la prueba en vivo. Corregido.
2. **`check_backend_imports.py` falla siempre en dev** porque recorre `backend/.venv` (en CI no existe `.venv` dentro del árbol, de ahí que el workflow pase). Confirmado: los errores son 100% de paquetes instalados, no de código de app. Se recomienda excluir `.venv` del `rglob` en una próxima iteración.
3. **Documentación desalineada**: varios docs históricos (`DEPLOYMENT-v0.2.0.md`, `AI-VERIFICATION-v1.0.7.md`, `AI-EVALUATION-v0.2.0.md`, `CHANGELOG-v1.0.6.md`, `AUDITORIA-TECNICA-v1.0.2.md`, workflows) aún describen las compuertas. Se actualizaron README, `SECURITY-AND-PRIVACY.md` (nota MVP) y `CONFIGURACION-IA-EXTERNA.md`; los restantes quedan como docs históricos a marcar si molestan.
4. **La clave de Gemini del `.env` NO es formato `AIza...` clásico** pero funciona contra `generativelanguage.googleapis.com` (verificado en vivo). Igual conviene rotarla antes de producción porque ya quedó expuesta en texto plano y probablemente en el historial de git.
5. El frontend nunca pide el proveedor ni el modelo al usuario: todo el enrutamiento queda en el backend según `.env`/`ai_provider_config`, lo que es correcto para este MVP.

## Validaciones de IA que NO se tocaron (por decisión de diseño)

Constraint the model's output? No — per previous discussion — mantener intacto como guardia de calidad pedagógica independiente al nivel del proveedor:

- Puntajes acotados al máximo de la rúbrica del docente.
- Evidencia literal contenida en la respuesta del estudiante.
- Alineación 1:1 de criterios con la rúbrica.
- `approve` con validaciones de tipo/numérico y trail de revisiones.
- Límites de tamaño de entrada, cantidades y rate limits por usuario.
- Propuestas `mock`/`demo` no aprobables como calificación real.

## Corrección posterior: guardias de «processing» con lease indefinido (reporte del docente)

**Síntoma:** al pulsar «Proponer consignas» el PATCH `assessment/2/` devolvía 400 «No se puede editar la evaluación mientras se procesa una corrección», aunque no hubiera corrección en curso.

**Causa raíz:** los guardias de edición del contexto (`AssessmentViewSet.perform_update`, `import_reference`, `QuestionViewSet.create/update/destroy` y edición/aprobación de entregas y respuestas) bloqueaban sobre **cualquier** `Submission.status="processing"` sin expiración. El worker de corrección sí tiene un lease de 15 minutos, pero nunca lo liberó el reconcile: dos entregas quedaron atascadas hace 12 y 13 horas (se ignoraba la fecha en su actualización) y bloqueaban la evaluación para siempre.

**Arreglo (lease de 15 minutos compartido con el worker):**

- `common.py`: constantes `PROCESSING_LEASE_MINUTES` y helpers `processing_lease_cutoff`, `processing_is_fresh`, `claim_expired_processing_lease` y `fresh_processing_submission_exists`.
- `catalog.py` (5 guardias de contexto), `submissions.py` (edición/eliminación de entregas y respuestas): solo bloquean si el lease está vigente; si venció, se reclama devolviendo la entrega a `pending`.
- `serializers.py`: misma ventana en la validación de respuestas.
- `scripts/reclaim_processing_leases.py` (nuevo, ops): reclama los leases vencidos ya persistidos; las dos filas atascadas (submissions 2 y 3 de la evaluación «Ejemplo MaestrIA · Fotosíntesis») quedaron en `pending` sin la devolución inconsistente de la interfaz.

**Verificación:** 65/65 tests del workspace+núcleo OK. «Proponer consignas» vuelve a operar: el PATCH de contexto y la generación de consignas ya no chocan con guardias de leases vencidos.

## Corrección posterior 2: secuestro del submit del modal por el handler del workspace (botones de IA sin efecto)

**Síntoma:** el formulario modal de IA (p. ej. «Proponer consignas» → form `id="workspace-modal-form"` con botón «Generar propuesta») al enviarse **no emitía ninguna request ni error**: el clic se absorbía silenciosamente.

**Causa raíz:** en `frontend/js/modules/events.js`, el despachador global de `submit` evaluaba primero `form.id?.startsWith('workspace-')`. Como el id del modal es `workspace-modal-form`, el submit caía en `handleWorkspaceSubmit`, que no matchea ese id (`workspace-context-form`, `workspace-submission-form`, `workspace-approve-form`), ejecutaba el `return` final en silencio y daba `true` — el `event.preventDefault()` ya había corrido, así que el navegador tampoco enviaba nada. Afectaba a todos los formularios modales de IA: `generate-questions`, `import-reference`, `generate-rubric` (modal), y por extenso a todo flujo modal que comparta el prefijo.

**Arreglo:** en `events.js` (listener `document.addEventListener('submit')`), el caso exacto `form.id === 'workspace-modal-form'` → `handleModalSubmit` se evalúa **antes** del `startsWith('workspace-')` → `handleWorkspaceSubmit`. Comentario inline agregado para evitar regresiones.

**Auditoría de rutas de IA asociadas (sin necesitar más cambios):**
- Cadena del modal completa y correcta: `generateQuestionsForm`/`importReferenceForm`/`generateRubric` (en `forms/teacher.js`) fijan `state.modalKind` + `modal.dataset.recordId` → submit → `handleModalSubmit` despacha por `modalKind` → `POST assessments/{id}/generate-questions/`, `import-reference/`, `generate-rubric/` → pantallas de propuesta → `proposal-questions-form`/`save-rubric-proposal` con sus handlers.
- `handleWorkspaceAction` cubre **todas** las acciones `data-action="workspace-*"` presentes en el markup: `workspace-step`/`go-step`/`back-step`, `workspace-retry`, `workspace-open-evaluations`, `workspace-manage-rubrics`, `workspace-open-corrections`, `workspace-suggest-questions`, `workspace-import-reference`, `workspace-accept-question`, `workspace-discard-question`, `workspace-select-submission`, `workspace-share`, `workspace-export`, `workspace-copy`, `workspace-remove-answer-file`.
- `handleWorkspaceSubmit` cubre los tres formularios del workspace (`workspace-context-form`, `workspace-submission-form`, `workspace-approve-form`).
- Rama legacy `form.id === 'generate-rubric-form'` en `events.js` es código muerto (ningún markup usa ese id; las rúbricas pasan por el modal) — inofensiva, se deja documentada.
- El listener `modal.addEventListener('change')` que rellena consignas/estudiantes del modal termina en `form.id === 'workspace-modal-form'`; es de tipo `change`, no un segundo despachador de submit.

**Verificación:** `node --check` OK en `events.js`, `workspace.js` y `forms.js`; `scripts/check_static_frontend.py` OK (16 HTML, 30 JS, exports y sintaxis). 

## Corrección posterior 3: el guard de contexto bloqueaba al docente con leases frescos atascados (evaluación «Ecosistemas»)

**Síntoma:** en `?course=1&view=workspace&assessment=1`, «Guardar contexto» y el PATCH previo de «Guardar y proponer corrección» devolvían 400 «No se puede editar la evaluación mientras se procesa una corrección» (entrega 6 en `processing` con lease vigente de 6 min).

**Causa raíz (dos capas):**
1. El guard de contexto docente (`AssessmentViewSet.perform_update`, `import_reference`, CRUD de preguntas) también bloqueaba sobre el **lease vigente**, no solo el vencido. La entrega quedó en `processing` porque la request de `generate-correction` **murió a mitad de camino** (el autoreloader del servidor de desarrollo reinicia el proceso al detectar cambios de archivos; mató la request después de adquirir la reserva pero antes de la llamada al modelo) — sin registro de IA, sin corrección, sin release del lease.
2. La ventana del lease era de 15 minutos: un proceso muerto dejaba al docente bloqueado ese tiempo completo.

**Arreglo (decisión pedagógica: el docente SÍ puede editar el examen en curso):**
- `catalog.py`: se **eliminaron los 5 guards** de edición de contexto docente. La consistencia ya está protegida por los chequeos `updated_at` del endpoint de corrección (preflight + commit), que fallan rápido con «... cambió mientras se preparaba la corrección. Recargá e intentá nuevamente.».
- `models.py`: constante única `PROCESSING_LEASE_MINUTES = 5` (fuente compartida, antes 15 duplicado en 3 lugares). Un worker muerto se auto-recupera en 5 min, no en 15.5.
- `api_views/common.py`: helpers conservados (`processing_lease_cutoff`, `processing_is_fresh`, `claim_expired_processing_lease`); helper `fresh_processing_submission_exists` eliminado por quedar sin uso.
- `serializers.py` y `submissions.py`: mismos 5 minutos vía la constante compartida.
- `scripts/reclaim_processing_leases.py`: alineado a la constante (antes hardcodeaba 15).
- La entrega 6 (Ecosistemas) quedó reclamada a `pending`.

**Nota sobre el guard sobreviviente:** `submissions.py` mantiene el bloqueo de generación duplicada («Esta entrega ya se está procesando») sobre lease vigente: es lo que evita gastar cuota del proveedor dos veces por el mismo clic/petición; el commit de la propuesta verificará igualmente que quien escribe sea el dueño de la reserva exacta. No es un candado de edición docente.

**Verificación:** compila; 65/65 tests workspace+núcleo OK; `test_ai_adapter.py` 5/5 OK. Con la entrega 6 en `pending`, el docente puede volver a probar «Guardar y proponer corrección» sin enfrentarse al PATCH bloqueado.

## Próximos pasos recomendados

1. **Rotar `GEMINI_API_KEY`** ya que quedó persistida en un archivo de configuración versionado.
2. Añadir stepper visual en el workspace docente que muestre los `warnings` individuales generados por la IA (hoy se agregan al total pero el usuario no termina de percibirlos durante la revisión).
3. Excluir `.venv` de `scripts/check_backend_imports.py` para que la verificación estática sea usable en entornos Windows de desarrollo.
4. Colocar tests de la app que simulen submission → generate-correction → approve con `AI_PROVIDER=mock` (hoy sólo hay vista unitaria del adaptador).
5. Cuando se pase de MVP: decidir si el contenido de Gemini gratuito atiende las expectativas de los usuarios finales; si no, restaurar el mecanismo `fail-closed` removido (`git` lo muestra claramente en el diff de esta sesión).
