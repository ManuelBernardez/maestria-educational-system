import { escapeHtml, formatNumber, formatInputNumber, statusPill, icon, initials } from '../../core/utils.js';
import { workspace, assessmentQuestions, assessmentSubmissions, selectedAssessment, criteria, originalCriteria, criterionModified, isApproved, canReview, queueStatus, stepDirty } from './workspace-state.js';
import { stepHeader, saveStatus, scoreStepper, shortcutsHint } from './workspace-markup.js';

const PREVIEW_ITEMS = 3;
const EVIDENCE_CLAMP_CHARS = 220;

/* ---------- Utilidades de datos ---------- */

/** Nota final mínima: la misma regla que `MIN_FINAL_GRADE` en backend/apps/core/ai.py. */
const MIN_FINAL_GRADE = 1;

const finiteOr = (value, fallback) => (value == null || !Number.isFinite(Number(value)) ? fallback : Number(value));

/** Espejo de `weighted_total` (backend): logro relativo × peso/Σpesos, en la escala Σmáximos. */
function weightedTotal(items) {
  if (!items.length) return 0;
  let weights = items.map(item => Math.max(0, finiteOr(item.weight, 1)));
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  if (weightSum <= 0) weights = items.map(() => 1);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  const totalMax = items.reduce((sum, item) => sum + Math.max(0, finiteOr(item.max_score, 0)), 0);
  const share = items.reduce((sum, item, index) => {
    const maximum = Math.max(0, finiteOr(item.max_score, 0));
    return maximum > 0 ? sum + weights[index] * Math.min(1, Math.max(0, finiteOr(item.score, 0) / maximum)) : sum;
  }, 0);
  return share / totalWeight * totalMax;
}

/**
 * Nota que se va a guardar: suma por consigna de la nota ponderada (`final_grade` en el
 * backend), con piso MIN_FINAL_GRADE. Antes se sumaban los puntajes sin ponderar y la nota
 * de esta pantalla podía no coincidir con la que quedaba guardada al aprobar.
 */
/** Nota calculada por criterios, máximo y mínimo admitido. La usan ambas vistas de revisión. */
export function gradeFor(list) {
  const max = list.reduce((sum, item) => sum + Math.max(0, finiteOr(item.max_score, 0)), 0);
  const groups = new Map();
  list.forEach(item => {
    const key = item.question_id == null ? '' : String(item.question_id);
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  let computed = Math.round([...groups.values()].reduce((sum, group) => sum + weightedTotal(group), 0) * 100) / 100;
  if (max >= MIN_FINAL_GRADE) computed = Math.max(MIN_FINAL_GRADE, computed);
  return { computed, max, minimum: max >= MIN_FINAL_GRADE ? MIN_FINAL_GRADE : 0 };
}

export const totals = () => {
  const { computed, max, minimum } = gradeFor(criteria());
  // Aprobada: manda la nota guardada (puede haberla fijado el docente). En revisión: la
  // nota fijada a mano si es válida; si no, la calculada por criterios.
  if (isApproved() && workspace.correction?.total_score != null) return { score: Number(workspace.correction.total_score), computed, max, minimum, overridden: Boolean(workspace.proposal?.final_score_overridden) };
  const manual = workspace.finalScore === '' ? NaN : Number(workspace.finalScore);
  const valid = Number.isFinite(manual) && manual >= minimum && manual <= max;
  const overridden = valid && Math.abs(manual - computed) >= 0.005;
  return { score: overridden ? Math.round(manual * 100) / 100 : computed, computed, max, minimum, overridden };
};

/** Nota final editable: arranca en la calculada y el docente puede fijar otra (con motivo). */
/** ¿Hay que justificar? Sólo si cambió algún puntaje o la nota final. */
export const needsReason = () => totals().overridden || criteria().some((item, index) => Number(item.score) !== Number(originalCriteria()[index]?.score));

/** Cierre de la revisión, junto al botón «Aprobar»: nota final y, si hace falta, el motivo. */
function closingFields() {
  if (isApproved() || workspace.proposal?.demo) return '';
  const { computed, max, minimum, overridden } = totals();
  const value = workspace.finalScore === '' ? formatInputNumber(computed) : workspace.finalScore;
  return `<div class="form-field reason-row" data-reason-field ${needsReason() ? '' : 'hidden'}><label for="workspace-change-reason">Motivo del cambio <small class="ws-block-optional">obligatorio</small></label><input id="workspace-change-reason" type="text" maxlength="250" data-workspace-change-reason value="${escapeHtml(workspace.changeReason)}" placeholder="Por qué cambiaste el puntaje o la nota"></div>
    <div class="final-score-row"><label for="workspace-final-score">Nota final</label>${scoreStepper({ id: 'workspace-final-score', value, max, min: minimum, attrs: 'data-workspace-final-score', label: 'la nota final' })}<span class="muted">/ ${escapeHtml(formatNumber(max))}</span><span class="field-hint" data-final-score-hint>${finalScoreHint(computed, overridden)}</span></div>`;
}

/** Si la nota fue fijada a mano, muestra la calculada y cómo volver a ella. */
export function finalScoreHint(computed, overridden) {
  return overridden ? `Calculada: ${escapeHtml(formatNumber(computed))} · <button type="button" class="text-link" data-action="workspace-final-score-reset">Usar la calculada</button>` : '';
}

export const reviewedCount = () => criteria().filter((_, index) => workspace.review.reviewed.has(index)).length;

/**
 * Busca un fragmento literal en la respuesta comparando con espacios normalizados.
 * Devuelve [inicio, fin) sobre el texto original o null.
 */
export function findFragment(text, fragment) {
  const needle = String(fragment || '').replace(/^[\s"“”'«»…]+|[\s"“”'«»…]+$/g, '').replace(/\s+/g, ' ').toLocaleLowerCase('es-AR');
  if (needle.length < 4) return null;
  const map = [];
  let normalized = '';
  let lastSpace = false;
  for (let index = 0; index < text.length; index += 1) {
    const isSpace = /\s/.test(text[index]);
    if (isSpace && lastSpace) continue;
    normalized += isSpace ? ' ' : text[index].toLocaleLowerCase('es-AR');
    map.push(index);
    lastSpace = isSpace;
  }
  const at = normalized.indexOf(needle);
  if (at < 0) return null;
  return [map[at], map[at + needle.length - 1] + 1];
}

/** Respuestas por consigna con texto; null si la entrega sólo tiene la respuesta general. */
export function submissionAnswers(submission) {
  const answers = Array.isArray(submission?.answers) ? submission.answers.filter(answer => String(answer.answer_text || '').trim()) : [];
  return answers.length ? answers : null;
}

const answerNodeId = answer => (answer ? `ws-answer-text-${answer.id}` : 'ws-answer-text');

/**
 * Texto que la IA corrigió para un criterio. En entregas con varias consignas cada
 * criterio trae `answer_id`/`question_id`; las citas salen de esa respuesta, no de la general.
 */
export function criterionAnswer(submission, item) {
  const answers = submissionAnswers(submission);
  if (!answers) return { text: submission?.answer_text || '', nodeId: answerNodeId(null), position: null };
  const match = answers.find(answer => item?.answer_id != null && String(answer.id) === String(item.answer_id))
    || answers.find(answer => item?.question_id != null && String(answer.question) === String(item.question_id))
    || answers.find(answer => findFragment(answer.answer_text, item?.evidence))
    || answers[0];
  return { text: match.answer_text, nodeId: answerNodeId(match), position: answers.indexOf(match) + 1 };
}

/** Texto completo para copiar: todas las respuestas por consigna o la respuesta general. */
export function fullAnswerText(submission) {
  const answers = submissionAnswers(submission);
  if (!answers) return submission?.answer_text || '';
  return answers.map((answer, position) => `Consigna ${position + 1}${answer.question_prompt ? `: ${answer.question_prompt}` : ''}\n${answer.answer_text}`).join('\n\n');
}

const wordCount = text => (String(text || '').trim() ? String(text).trim().split(/\s+/).length : 0);

function navigationList() {
  const list = assessmentSubmissions();
  return workspace.review.onlyPending ? list.filter(item => queueStatus(item) === 'review' || String(item.id) === String(workspace.activeSubmission?.id)) : list;
}

export function navigationTarget(delta) {
  const list = navigationList();
  const index = list.findIndex(item => String(item.id) === String(workspace.activeSubmission?.id));
  return list[index + delta] || null;
}

/* ---------- Marcado ---------- */

/**
 * Marca de estado del criterio. Todo parte de la propuesta de la IA, así que sólo se
 * marca lo que cambió: revisado o modificado por el docente.
 */
export function criterionMark(index) {
  if (workspace.review.reviewed.has(index)) return '<span class="origin-mark origin-mark--reviewed">✓ Revisado</span>';
  if (criterionModified(index)) return `<span class="origin-mark origin-mark--edited">${icon('pencil')} Modificado</span>`;
  return '';
}

function evidenceBlock(item, index, submission) {
  const evidence = item.evidence || '';
  if (!evidence) return '<p class="muted">Sin evidencia literal: revisalo en la respuesta.</p>';
  const found = findFragment(criterionAnswer(submission, item).text, evidence);
  const long = evidence.length > EVIDENCE_CLAMP_CHARS;
  return `<span class="read-label">Evidencia</span><blockquote class="evidence${long ? ' is-clamped' : ''}" id="ws-evidence-${index}">${escapeHtml(evidence)}</blockquote>
    <p class="evidence-links">${long ? `<button type="button" class="text-link" data-action="workspace-evidence-expand" data-index="${index}" aria-controls="ws-evidence-${index}" aria-expanded="false">Ver completa</button>` : ''}${found ? `<button type="button" class="text-link" data-action="workspace-show-evidence" data-index="${index}">Ver en la respuesta</button>` : '<span class="muted">No se encontró en la respuesta</span>'}</p>`;
}

function criterionCard(item, index, submission) {
  const readonly = isApproved() || Boolean(workspace.proposal?.demo);
  const open = workspace.review.open.has(index);
  const reviewed = workspace.review.reviewed.has(index);
  const name = item.criterion || `Criterio ${index + 1}`;
  const max = Number(item.max_score || 0);
  const hidden = workspace.review.onlyUnreviewed && reviewed;
  // El nivel sólo aparece si la rúbrica lo define; «sin nivel» no le aporta nada al docente.
  const level = item.level ? statusPill('review', item.level) : '';
  // Qué se pregunta en esta consigna: el número y el máximo ya están en la cabecera.
  const prompt = item.question_prompt ? `<p class="criterion-prompt">${escapeHtml(item.question_prompt)}</p>` : '';
  const editable = readonly
    ? `${level ? `<p class="criterion-score-line">${level}</p>` : ''}
       ${evidenceBlock(item, index, submission)}
       <p class="criterion-justification">${escapeHtml(item.justification || '—')}</p>`
    : `<div class="criterion-score-line"><label for="workspace-score-${index}">Puntaje</label>${scoreStepper({ id: `workspace-score-${index}`, value: formatInputNumber(item.score), max, attrs: `data-workspace-criterion="${index}" data-field="score" aria-describedby="workspace-score-${index}-error"`, label: name })}<span class="muted">/ ${escapeHtml(formatNumber(max))}</span>${level}</div>
      <p class="field-error" id="workspace-score-${index}-error" role="alert" data-score-error="${index}"></p>
      ${evidenceBlock(item, index, submission)}
      <div class="form-field"><label for="workspace-justification-${index}">Justificación</label><textarea id="workspace-justification-${index}" class="autogrow" rows="2" data-workspace-criterion="${index}" data-field="justification">${escapeHtml(item.justification || '')}</textarea></div>
      <div class="criterion-foot"><label class="check"><input type="checkbox" data-workspace-reviewed="${index}" ${reviewed ? 'checked' : ''}><span>Revisado</span></label><button type="button" class="text-link" data-action="workspace-restore-criterion" data-index="${index}" ${criterionModified(index) ? '' : 'hidden'}>Volver a la sugerencia de la IA</button></div>`;
  return `<article class="criterion" id="ws-criterion-${index}" data-criterion="${index}" ${hidden ? 'hidden' : ''}>
    <h4 class="criterion-heading"><button type="button" class="criterion-toggle" data-action="workspace-criterion-toggle" data-index="${index}" aria-expanded="${open}" aria-controls="ws-criterion-body-${index}">
      <span class="step-number" aria-hidden="true">${index + 1}</span>
      <span class="criterion-name">${escapeHtml(name)}</span>
      <span class="mini-meter"><span class="mini-meter-text" data-criterion-score="${index}">${escapeHtml(formatNumber(item.score))} / ${escapeHtml(formatNumber(max))}</span><progress class="meter meter--mini" max="${Math.max(max, 0.01)}" value="${Math.max(0, Number(item.score) || 0)}" data-criterion-meter="${index}" aria-hidden="true"></progress></span>
      <span class="criterion-mark" data-criterion-mark="${index}">${criterionMark(index)}</span>
      ${icon('chevron')}
    </button></h4>
    <div class="criterion-body" id="ws-criterion-body-${index}" ${open ? '' : 'hidden'}>
      ${prompt}
      ${editable}
    </div>
  </article>`;
}

function listCard(title, items, tone, key) {
  if (!items?.length) return '';
  const expanded = workspace.review.expandedLists?.has(key);
  const shown = expanded ? items : items.slice(0, PREVIEW_ITEMS);
  return `<section class="insight-card insight-card--${tone}"><h4>${escapeHtml(title)} (${items.length})</h4><ul>${shown.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>${items.length > PREVIEW_ITEMS ? `<button type="button" class="text-link" data-action="workspace-toggle-list" data-list="${key}">${expanded ? 'Ver menos' : `Ver ${items.length - PREVIEW_ITEMS} más`}</button>` : ''}</section>`;
}

/** Sección plegable de la revisión. Funcionan como acordeón: por defecto sólo «Criterios» está abierta. */
function section(id, title, summary, body, open = false) {
  return `<details class="review-section" id="${id}" ${open ? 'open' : ''}><summary><span class="fold-copy"><strong>${escapeHtml(title)}</strong><small data-section-summary="${id}">${escapeHtml(summary)}</small></span>${icon('chevron')}</summary><div class="review-section-body">${body}</div></details>`;
}

/** Línea de estado de la sección «Criterios» (se reutiliza al actualizar en vivo). */
export const criteriaSummary = () => {
  const total = criteria().length;
  return isApproved() ? `${total} criterios` : `${total - reviewedCount()} de ${total} sin revisar`;
};

function summaryBar(submission) {
  const list = navigationList();
  const position = list.findIndex(item => String(item.id) === String(submission.id)) + 1;
  const previous = navigationTarget(-1);
  const next = navigationTarget(1);
  const { score, max } = totals();
  const name = submission.student_display_name || submission.student_name || 'Estudiante sin identificar';
  // Quién, cuánto y en qué estado. La evaluación ya está en la portada; para saltar a
  // otra entrega están las flechas y la lista del paso 2.
  return `<div class="review-bar">
    <div class="review-bar-who"><span class="avatar avatar-tone" aria-hidden="true">${escapeHtml(initials(name))}</span><div><strong>${escapeHtml(name)}</strong></div><button type="button" class="btn btn-secondary btn-small" data-action="workspace-new-submission">${icon('plus')} Nueva entrega</button></div>
    <div class="review-bar-nav">
      <button type="button" class="icon-button" data-action="workspace-nav" data-id="${escapeHtml(previous?.id || '')}" aria-label="Entrega anterior" ${previous ? '' : 'disabled'}>${icon('arrowLeft')}</button>
      <span class="mono-meta">${position || 1} de ${list.length || 1}</span>
      <button type="button" class="icon-button" data-action="workspace-nav" data-id="${escapeHtml(next?.id || '')}" aria-label="Entrega siguiente" ${next ? '' : 'disabled'}>${icon('arrowRight')}</button>
      <button type="button" class="chip" id="ws-only-pending" data-action="workspace-only-pending" aria-pressed="${workspace.review.onlyPending}">Sólo pendientes</button>
    </div>
    <div class="review-bar-score"><p class="total"><strong data-review-total>${escapeHtml(formatNumber(score))}</strong> <span>/ ${escapeHtml(formatNumber(max))}</span></p><progress class="meter" max="${Math.max(max, 0.01)}" value="${score}" data-review-meter aria-label="Puntaje total"></progress><p class="mono-meta" aria-live="polite" data-review-progress>${reviewedCount()} de ${criteria().length} criterios revisados</p></div>
    <div class="review-bar-status">${isApproved() ? '<span class="stamp">Aprobada</span>' : statusPill('pending_review', 'Pendiente de revisión')}</div>
  </div>`;
}

/**
 * Columna de lectura: la respuesta del estudiante (lo que hay que contrastar con cada cita)
 * y, plegada, la consigna. Objetivos y rúbrica se definen en el paso 1 y los criterios
 * ya están en la columna principal: no se repiten acá.
 */
function sourceColumn(submission) {
  const assessment = selectedAssessment();
  const questions = assessmentQuestions();
  // Sin consigna puntual, la entrega abarca todas las consignas de la evaluación.
  const question = submission.question
    ? questions.find(item => String(item.id) === String(submission.question))
    : (questions.length === 1 ? questions[0] : null);
  const allQuestions = !question && questions.length > 1;
  const promptLabel = allQuestions ? 'Ver consignas' : 'Ver consigna';
  const promptBody = allQuestions
    ? `<ol class="source-prompts">${questions.map(item => `<li>${escapeHtml(item.prompt)}</li>`).join('')}</ol>`
    : `<p>${escapeHtml(question?.prompt || assessment?.instructions || 'No hay una consigna específica guardada.')}</p>`;
  const answer = submission.answer_text || '';
  const answers = submissionAnswers(submission);
  const fullText = answers ? answers.map(item => item.answer_text).join(' ') : answer;
  const fileNote = submission.source_filename ? ` · ${escapeHtml(submission.source_filename)}` : '';
  const tools = `<p class="answer-tools"><span class="mono-meta">${wordCount(fullText)} palabras${fileNote}</span><button type="button" class="text-link" data-action="workspace-copy-answer">Copiar</button></p>`;
  // Con varias consignas, cada criterio se corrigió contra su propia respuesta: se muestran
  // por separado (acordeón) para que el docente vea el texto del que salen las citas.
  const body = answers
    ? `${answers.map((item, position) => `<details class="source-block" id="ws-source-answer-${escapeHtml(item.id)}" ${position === 0 ? 'open' : ''}><summary>Consigna ${position + 1} ${icon('chevron')}</summary>${item.question_prompt ? `<p class="field-hint">${escapeHtml(item.question_prompt)}</p>` : ''}<div class="answer-text" id="ws-answer-text-${escapeHtml(item.id)}">${escapeHtml(item.answer_text)}</div></details>`).join('')}${tools}`
    : `<div class="answer-text" id="ws-answer-text">${escapeHtml(answer || 'No hay texto disponible.')}</div>${tools}<details class="source-block" id="ws-source-prompt"><summary>${promptLabel} ${icon('chevron')}</summary>${promptBody}</details>`;
  // En escritorio la columna no se pliega (el summary se oculta): el título va en el cuerpo.
  return `<details class="review-source" id="ws-source" open><summary>Respuesta del estudiante ${icon('chevron')}</summary><div class="review-source-body"><p class="source-title">Respuesta del estudiante</p>${body}</div></details>`;
}

function feedbackSection() {
  const readonly = isApproved() || Boolean(workspace.proposal?.demo);
  const text = workspace.feedback || workspace.proposal?.feedback || '';
  // Texto plano: el cuadro editable ya muestra cómo queda. Aprobada, se lee sin edición.
  const body = readonly
    ? `<div class="feedback-preview">${escapeHtml(text || 'Todavía no hay devolución.')}</div>`
    : `<label class="visually-hidden" for="workspace-feedback">Devolución para el estudiante</label><textarea id="workspace-feedback" class="lined autogrow" rows="6" data-workspace-feedback>${escapeHtml(text)}</textarea>`;
  return `${body}<p class="evidence-links">${readonly ? '' : '<button type="button" class="text-link" data-action="workspace-feedback-restore">Volver a la propuesta</button>'}<button type="button" class="text-link" data-action="workspace-copy-feedback">Copiar</button></p>`;
}

function actionFooter() {
  const approved = isApproved();
  const demo = Boolean(workspace.proposal?.demo);
  const status = approved ? '<span class="save-status" role="status">✓ Resultado final guardado</span>' : saveStatus(3, stepDirty(3), 'Sin cambios');
  const primary = approved
    ? '<button class="btn btn-primary" type="button" data-action="workspace-share">Compartir o guardar devolución</button>'
    : `<button class="btn btn-primary" type="submit" id="ws-approve" ${workspace.approving || demo ? 'disabled' : ''} ${demo ? 'title="Las propuestas de demostración no pueden aprobarse"' : ''} ${workspace.approving ? 'aria-busy="true"' : ''}>${workspace.approving ? 'Guardando…' : 'Aprobar devolución'}</button>`;
  const items = [['workspace-copy', approved ? 'Copiar texto' : 'Copiar borrador'], ...(approved ? [['workspace-export', 'Exportar Markdown']] : []), ['workspace-print', 'Imprimir / PDF'], ...(approved ? [['workspace-share', 'Compartir…']] : [])];
  const menu = `<div class="split-menu"><button type="button" class="btn btn-secondary" id="ws-more-trigger" data-action="workspace-more-menu" aria-haspopup="menu" aria-expanded="${workspace.review.menuOpen}" aria-controls="ws-more-menu">Más ${icon('chevron')}</button><div class="menu" role="menu" id="ws-more-menu" aria-labelledby="ws-more-trigger" ${workspace.review.menuOpen ? '' : 'hidden'}>${items.map(([action, label]) => `<button type="button" role="menuitem" data-action="${action}">${label}</button>`).join('')}</div></div>`;
  const warning = workspace.review.approveWarning
    ? `<div class="inline-confirm" role="alert"><p>Quedan ${criteria().length - reviewedCount()} criterios sin marcar como revisados. ¿Aprobar igual?</p><button type="button" class="btn btn-primary btn-small" data-action="workspace-approve-anyway">Aprobar igual</button><button type="button" class="btn btn-secondary btn-small" data-action="workspace-review-unreviewed">Revisar ahora</button></div>`
    : '';
  return `${warning}<div class="step-actions step-actions--review">${closingFields()}${status}<div class="step-actions-buttons">${menu}${primary}</div></div>`;
}

export function lockedReview() {
  return `${stepHeader(3, 'Revisar y aprobar', 'La IA sugiere. Vos decidís.')}
    <div class="empty-state"><div class="empty-icon" aria-hidden="true">✳</div><h3>Cargá una entrega para poder revisar</h3><p>Elegí una entrega de la lista o cargá una nueva para generar su propuesta.</p><button class="text-link" type="button" data-action="workspace-step" data-step="2">Ir a la entrega del estudiante</button></div>`;
}

export function reviewStep() {
  if (!canReview()) return lockedReview();
  const submission = workspace.activeSubmission;
  const proposal = workspace.proposal;
  const list = criteria();
  const insights = `${listCard('Lo que logró', proposal.strengths, 'success', 'strengths')}${listCard('Ideas para seguir mejorando', proposal.improvement_suggestions, 'note', 'improvements')}`;
  const synthesis = `${proposal.summary ? `<p class="reading">${escapeHtml(proposal.summary)}</p>` : ''}${insights ? `<div class="insight-grid">${insights}</div>` : ''}`;
  // Con muchos criterios conviene poder ocultar los ya revisados.
  const onlyToggle = list.length > 4 && !isApproved()
    ? `<p class="review-tools"><button type="button" class="chip" id="ws-only-unreviewed" data-action="workspace-only-unreviewed" aria-pressed="${workspace.review.onlyUnreviewed}">Sólo sin revisar</button></p>`
    : '';
  return `${stepHeader(3, isApproved() ? 'Resultado aprobado' : 'Revisión docente', 'La IA sugiere. Vos decidís.', shortcutsHint('ws-shortcuts-3'))}
    ${proposal.demo ? '<div class="notice notice-warning" role="note"><strong>Propuesta demostrativa.</strong> El proveedor está en modo MOCK. No se puede aprobar ni utilizar como calificación real.</div>' : ''}
    ${(proposal.warnings || []).length ? `<details class="disclosure" id="ws-warnings"><summary>Advertencias para revisar (${proposal.warnings.length}) ${icon('chevron')}</summary><div class="disclosure-body"><ul>${proposal.warnings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div></details>` : ''}
    ${summaryBar(submission)}
    <div class="review-grid">
      ${sourceColumn(submission)}
      <div class="review-main">
        <form id="workspace-approve-form" novalidate>
          ${section('ws-sec-criteria', 'Criterios', criteriaSummary(), list.length ? `${onlyToggle}${list.map((item, position) => criterionCard(item, position, submission)).join('')}` : '<p class="muted">La propuesta no incluye criterios.</p>', true)}
          ${synthesis ? section('ws-sec-summary', 'Síntesis de la IA', 'Logros e ideas para seguir mejorando', synthesis) : ''}
          ${section('ws-sec-feedback', 'Devolución al estudiante', isApproved() ? 'Devolución final' : 'Editable antes de aprobar', feedbackSection())}
          ${actionFooter()}
        </form>
      </div>
    </div>`;
}

/** Restaura un criterio a la propuesta original de la IA. */
export function restoreCriterion(index) {
  const original = originalCriteria()[index];
  const current = criteria()[index];
  if (!original || !current) return;
  current.score = original.score;
  current.justification = original.justification;
  current.level = original.level;
}
