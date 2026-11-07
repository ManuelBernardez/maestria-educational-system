import { state } from '../../core/state.js';
import { escapeHtml, formatNumber, formatInputNumber, icon } from '../../core/utils.js';
import { workspace, assessmentQuestions, questionTotal, selectedRubric, stepDirty } from './workspace-state.js';
import { stepHeader, saveStatus, actionBar, shortcutsHint, dropzone, scoreStepper, fieldError } from './workspace-markup.js';

const QUESTION_TYPES = [['open', 'Respuesta abierta'], ['short', 'Respuesta breve'], ['case', 'Caso']];

const tool = (action, glyph, label, id, { danger = false, attrs = '' } = {}) => `<button type="button" class="icon-button tool-button${danger ? ' tool-button--danger' : ''}" data-action="${action}" data-id="${escapeHtml(id)}" ${attrs} aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon(glyph)}</button>`;

/** Editor en línea de una consigna (alta o edición). Sólo hay uno abierto a la vez. */
function questionEditor(number) {
  const draft = workspace.questionEditor;
  const errors = draft.errors || {};
  const rubrics = state.data.rubrics;
  const invalid = (name) => errors[name]?.length ? `aria-invalid="true" aria-describedby="ws-q-${name}-error"` : '';
  return `<form id="workspace-question-form" class="question-editor" novalidate aria-label="${draft.id ? `Editar consigna ${number}` : `Nueva consigna ${number}`}">
    <span class="question-number" aria-hidden="true">${number}</span>
    <div class="question-editor-fields">
      ${errors.non_field_errors?.length || errors.detail?.length ? `<p class="notice notice-error" role="alert">${escapeHtml([...(errors.non_field_errors || []), ...(errors.detail || [])].join(' '))}</p>` : ''}
      <div class="form-field full"><label for="ws-q-prompt">Enunciado <span class="required-mark" aria-hidden="true">*</span></label><textarea id="ws-q-prompt" class="lined" rows="3" maxlength="8000" data-qe-field="prompt" required ${invalid('prompt')}>${escapeHtml(draft.prompt)}</textarea>${fieldError(errors, 'prompt', 'ws-q-prompt')}</div>
      <div class="form-grid">
        <div class="form-field"><label for="ws-q-max_score">Puntaje máximo <span class="required-mark" aria-hidden="true">*</span></label>${scoreStepper({ id: 'ws-q-max_score', value: draft.max_score, max: 1000, min: 0.5, attrs: `data-qe-field="max_score" required ${invalid('max_score')}`, label: 'el puntaje máximo' })}${fieldError(errors, 'max_score', 'ws-q-max_score')}</div>
        <div class="form-field"><label for="ws-q-question_type">Tipo</label><select id="ws-q-question_type" data-qe-field="question_type">${QUESTION_TYPES.map(([value, label]) => `<option value="${value}" ${draft.question_type === value ? 'selected' : ''}>${label}</option>`).join('')}</select>${fieldError(errors, 'question_type', 'ws-q-question_type')}</div>
        <div class="form-field full"><label for="ws-q-expected_answer">Respuesta esperada / referencia</label><textarea id="ws-q-expected_answer" rows="2" maxlength="8000" data-qe-field="expected_answer" ${invalid('expected_answer')}>${escapeHtml(draft.expected_answer)}</textarea><small class="field-hint">Opcional: ayuda a la IA a contrastar la respuesta.</small>${fieldError(errors, 'expected_answer', 'ws-q-expected_answer')}</div>
        ${rubrics.length ? `<div class="form-field full"><label for="ws-q-rubric">Rúbrica de la consigna</label><select id="ws-q-rubric" data-qe-field="rubric"><option value="">Sin rúbrica</option>${rubrics.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(draft.rubric || '') ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select>${fieldError(errors, 'rubric', 'ws-q-rubric')}</div>` : ''}
      </div>
      ${draft.confirmCancel ? `<div class="inline-confirm" role="alert"><p>Hay cambios sin guardar en esta consigna. ¿Descartarlos?</p><button type="button" class="btn btn-danger btn-small" data-action="workspace-question-discard">Descartar</button><button type="button" class="text-link" data-action="workspace-question-keep">Seguir editando</button></div>` : ''}
      <div class="editor-actions"><button type="submit" class="btn btn-primary btn-small" ${draft.saving ? 'disabled aria-busy="true"' : ''}>${draft.saving ? 'Guardando…' : 'Guardar'}</button><button type="button" class="text-link" data-action="workspace-question-cancel">Cancelar</button><small class="field-hint">Ctrl/⌘ + Enter guarda · Shift + Enter en puntos guarda y abre otra</small></div>
    </div>
  </form>`;
}

function questionRow(item, index, total) {
  const number = index + 1;
  const id = item.id;
  if (workspace.questionEditor && String(workspace.questionEditor.id) === String(id)) return `<li class="question-row is-editing" id="ws-question-${escapeHtml(id)}">${questionEditor(number)}</li>`;
  if (String(workspace.questionDeleteId) === String(id)) {
    const linked = state.data.submissions.filter(row => String(row.question) === String(id)).length;
    return `<li class="question-row is-confirming" id="ws-question-${escapeHtml(id)}"><div class="inline-confirm inline-confirm--danger" role="group" aria-label="Confirmar eliminación"><p>¿Eliminar la consigna ${number}? Se pierden sus ${escapeHtml(formatNumber(item.max_score))} puntos.${linked ? ` Tiene ${linked} ${linked === 1 ? 'entrega asociada' : 'entregas asociadas'}.` : ''}</p>${workspace.questionDeleteError ? `<p class="field-error" role="alert">${escapeHtml(workspace.questionDeleteError)}</p>` : ''}<button type="button" class="btn btn-danger btn-small" data-action="workspace-question-delete-confirm" data-id="${escapeHtml(id)}">${workspace.questionDeleteError ? 'Reintentar' : 'Eliminar'}</button><button type="button" class="text-link" id="ws-question-delete-cancel" data-action="workspace-question-cancel-delete">Cancelar</button></div></li>`;
  }
  return `<li class="question-row${String(workspace.questionHighlight) === String(id) ? ' is-new' : ''}" id="ws-question-${escapeHtml(id)}">
    <span class="question-number" aria-hidden="true">${number}</span>
    <p class="question-text" title="${escapeHtml(item.prompt)}" data-question-text="${escapeHtml(id)}"><span class="visually-hidden">Consigna ${number}: </span>${escapeHtml(item.prompt)}</p>
    <span class="points-pill">${escapeHtml(formatNumber(item.max_score))} pts</span>
    <div class="row-tools">
      ${tool('workspace-question-edit', 'pencil', `Editar consigna ${number}`, id)}
      ${tool('workspace-question-duplicate', 'copy', `Duplicar consigna ${number}`, id)}
      ${index > 0 ? tool('workspace-question-move', 'up', `Subir consigna ${number}`, id, { attrs: 'data-direction="-1"' }) : ''}
      ${index < total - 1 ? tool('workspace-question-move', 'down', `Bajar consigna ${number}`, id, { attrs: 'data-direction="1"' }) : ''}
      ${tool('workspace-question-delete', 'trash', `Eliminar consigna ${number}`, id, { danger: true })}
    </div>
  </li>`;
}

function questionList() {
  const questions = assessmentQuestions();
  const adding = workspace.questionEditor && !workspace.questionEditor.id;
  const rows = questions.map((item, index) => questionRow(item, index, questions.length)).join('');
  return `<section class="ws-block" aria-labelledby="workspace-questions-title">
    <h3 class="ws-block-title" id="workspace-questions-title">Consignas</h3>
    ${rows || adding ? `<ol class="question-list">${rows}${adding ? `<li class="question-row is-editing" id="ws-question-new">${questionEditor(questions.length + 1)}</li>` : ''}</ol>` : '<p class="muted">Todavía no hay consignas guardadas para esta evaluación.</p>'}
    ${adding ? '' : `<button type="button" class="btn btn-add" id="ws-add-question" data-action="workspace-question-new">${icon('plus')} Añadir consigna</button>`}
    <p class="list-total" role="status" aria-live="polite">${questions.length} ${questions.length === 1 ? 'consigna' : 'consignas'} · total ${escapeHtml(formatNumber(questionTotal(questions)))} pts</p>
  </section>`;
}

function suggestionNote() {
  const busy = workspace.generatingQuestions;
  const open = workspace.suggestOpen || workspace.questionSuggestions.length > 0;
  const cards = workspace.questionSuggestions.map((item, index) => `<article class="suggestion-card${item.selected ? ' is-selected' : ''}">
    <div class="suggestion-head"><label class="check"><input type="checkbox" data-workspace-suggestion="${index}" data-field="selected" ${item.selected ? 'checked' : ''}><span>Incluir sugerencia ${index + 1}</span></label><span class="ai-label">✳ Sugerencia de la IA</span></div>
    <label class="visually-hidden" for="workspace-suggestion-${index}">Enunciado de la sugerencia ${index + 1}</label><textarea id="workspace-suggestion-${index}" rows="3" maxlength="5000" data-workspace-suggestion="${index}" data-field="prompt">${escapeHtml(item.prompt)}</textarea>
    ${item.rationale ? `<p class="suggestion-why">${escapeHtml(item.rationale)}</p>` : ''}
    <div class="suggestion-points"><label for="workspace-suggestion-score-${index}">Puntos</label><input id="workspace-suggestion-score-${index}" type="number" min="0.5" max="1000" step="0.5" data-workspace-suggestion="${index}" data-field="max_score" value="${escapeHtml(item.max_score)}"></div>
  </article>`).join('');
  const selected = workspace.questionSuggestions.filter(item => item.selected).length;
  return `<section class="sticky-note" aria-labelledby="ws-suggest-title">
    <div class="sticky-note-head"><h3 id="ws-suggest-title"><span class="mark" aria-hidden="true">✳</span> Proponer consignas con MaestrIA</h3><button type="button" class="icon-button" data-action="workspace-suggest-toggle" aria-expanded="${open}" aria-controls="ws-suggest-body" aria-label="${open ? 'Ocultar propuestas' : 'Mostrar propuestas'}">${icon(open ? 'minus' : 'plus')}</button></div>
    <div id="ws-suggest-body" ${open ? '' : 'hidden'}>
      <p>Ideas editables a partir del contexto y los apuntes. Nada se agrega sin tu confirmación.</p>
      <form id="workspace-suggest-form" class="suggest-form" novalidate><div class="form-field"><label for="ws-suggest-count">Cantidad</label><input id="ws-suggest-count" type="number" min="1" max="5" step="1" value="${escapeHtml(workspace.suggestCount)}" data-workspace-suggest-count></div><button type="submit" class="btn btn-secondary btn-small" ${busy ? 'disabled aria-busy="true"' : ''}>${busy ? 'Preparando ideas…' : 'Proponer consignas'}</button></form>
      ${workspace.suggestError ? `<p class="field-error" role="alert">${escapeHtml(workspace.suggestError)} <button type="button" class="text-link" data-action="workspace-suggest-retry">Reintentar</button></p>` : ''}
      ${workspace.questionSuggestionDemo ? '<p class="field-hint">Modo demostración: estas consignas son ejemplos editables; no fueron generadas por un modelo real.</p>' : ''}
      ${cards ? `<div class="suggestion-list" aria-label="Consignas propuestas">${cards}</div><div class="editor-actions"><button type="button" class="btn btn-secondary btn-small" data-action="workspace-accept-selected" ${selected ? '' : 'disabled title="Marcá al menos una sugerencia"'}>Agregar seleccionadas${selected ? ` (${selected})` : ''}</button><button type="button" class="text-link" data-action="workspace-discard-suggestions">Descartar</button></div>` : ''}
    </div>
  </section>`;
}

function materials() {
  const material = workspace.referenceMaterial;
  const current = material
    ? workspace.materialConfirmRemove
      ? `<div class="inline-confirm inline-confirm--danger" role="group" aria-label="Confirmar"><p>¿Quitar el material incorporado (${material.length.toLocaleString('es-AR')} caracteres)?</p><button type="button" class="btn btn-danger btn-small" data-action="workspace-material-remove-confirm">Quitar</button><button type="button" class="text-link" data-action="workspace-material-remove-cancel">Cancelar</button></div>`
      : `<div class="material-row"><span class="file-chip-icon" aria-hidden="true">${icon('book')}</span><span class="material-name">Material incorporado</span><span class="file-chip-size">${material.length.toLocaleString('es-AR')} caracteres</span><button type="button" class="text-link" data-action="workspace-material-remove">Quitar</button></div>`
    : '';
  return `<section class="ws-block" aria-labelledby="ws-materials-title">
    <h3 class="ws-block-title" id="ws-materials-title">Apuntes y materiales</h3>
    ${current}
    ${dropzone({ id: 'workspace-material-file', kind: 'material', file: workspace.materialFile, hint: 'PDF con texto seleccionable, DOCX, TXT o MD · máximo 5 MB' })}
    <div class="editor-actions"><button class="btn btn-secondary btn-small" type="button" data-action="workspace-import-reference" ${workspace.materialFile ? '' : 'disabled title="Elegí un archivo para poder incorporarlo"'}>Incorporar material</button></div>
  </section>`;
}

function moreDetails() {
  const rubric = selectedRubric();
  const rubrics = state.data.rubrics;
  const material = workspace.referenceMaterial;
  return `<details class="disclosure" id="ws-more-details"><summary>Más detalles ${icon('chevron')}</summary><div class="disclosure-body">
    ${material ? `<details class="disclosure disclosure--nested" id="ws-material-preview"><summary>Ver material incorporado (${material.length.toLocaleString('es-AR')} caracteres) ${icon('chevron')}</summary><pre class="material-preview">${escapeHtml(material.slice(0, 12000))}${material.length > 12000 ? '\n\n[Vista previa recortada; se conserva el texto completo.]' : ''}</pre></details>` : '<p class="field-hint">Todavía no hay material de referencia incorporado.</p>'}
    <div class="form-field"><label for="workspace-material-mode">Al incorporar el archivo</label><select id="workspace-material-mode" data-workspace-material-mode><option value="append" ${workspace.materialMode === 'append' ? 'selected' : ''}>Agregar al material existente</option><option value="replace" ${workspace.materialMode === 'replace' ? 'selected' : ''}>Reemplazar el material existente</option></select></div>
    ${rubrics.length ? `<div class="form-field"><label for="workspace-rubric">Rúbrica para la corrección</label><select id="workspace-rubric" data-workspace-rubric><option value="">Usar criterios generales de la consigna</option>${rubrics.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(workspace.rubricId) ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select></div>
      ${rubric ? `<div class="rubric-summary"><p><strong>${escapeHtml(rubric.title)}</strong> · ${(rubric.criteria || []).length} criterios</p><ul>${(rubric.criteria || []).map(item => `<li>${escapeHtml(item.name)} <small>${escapeHtml(formatNumber(item.max_score))} pts</small></li>`).join('')}</ul></div>` : ''}` : '<p class="muted">Todavía no hay rúbricas disponibles.</p>'}
    <button class="text-link" type="button" data-action="workspace-manage-rubrics">Editar rúbrica</button>
  </div></details>`;
}

export function contextStep() {
  const dirty = stepDirty(1);
  return `${stepHeader(1, 'Qué evaluar y con qué criterios', 'Definí el contexto: MaestrIA lo usa para proponer cada corrección.', shortcutsHint('ws-shortcuts-1'))}
    <div class="step-grid step-grid--context">
      <form id="workspace-context-form" class="step-col" novalidate>
        <div class="form-field form-field--lead"><label for="workspace-instructions">¿Qué querés evaluar?</label><textarea id="workspace-instructions" class="lined lined--lead" name="instructions" maxlength="8000" data-workspace-field="instructions" placeholder="Describí el tema, la consigna o qué debería resolver el estudiante.">${escapeHtml(workspace.instructions)}</textarea></div>
        <div class="form-field"><label for="workspace-objectives">Objetivos de aprendizaje</label><textarea id="workspace-objectives" class="lined" name="objectives" maxlength="5000" data-workspace-field="objectives" placeholder="Ej. comparar dos teorías y justificar una conclusión con evidencia." title="¿Qué deberían comprender o poder hacer los estudiantes?">${escapeHtml(workspace.objectives)}</textarea></div>
        ${moreDetails()}
      </form>
      <div class="step-col">${questionList()}${suggestionNote()}${materials()}</div>
    </div>
    ${actionBar(saveStatus(1, dirty), `<button class="btn btn-primary" type="submit" form="workspace-context-form" id="ws-save-context">Guardar contexto</button>`)}`;
}

export const emptyQuestionDraft = () => ({ id: '', prompt: '', max_score: '10', expected_answer: '', question_type: 'open', rubric: '', errors: {}, dirty: false, saving: false, confirmCancel: false });

export const questionDraft = (item) => ({ id: item.id, prompt: item.prompt || '', max_score: formatInputNumber(item.max_score ?? 10), expected_answer: item.expected_answer || '', question_type: item.question_type || 'open', rubric: item.rubric ?? '', errors: {}, dirty: false, saving: false, confirmCancel: false });
