import { escapeHtml, formatNumber, formatInputNumber, statusPill, icon, initials } from '../../core/utils.js';
import { workspace, assessmentQuestions, assessmentSubmissions, selectedAssessment, selectedRubric, criteria, originalCriteria, criterionModified, isApproved, canReview, queueStatus, stepDirty } from './workspace-state.js';
import { stepHeader, saveStatus, scoreStepper, shortcutsHint } from './workspace-markup.js';

const PREVIEW_ITEMS = 3;
const EVIDENCE_CLAMP_CHARS = 220;

/* ---------- Utilidades de datos ---------- */

export const totals = () => {
  const list = criteria();
  return { score: list.reduce((sum, item) => sum + (Number(item.score) || 0), 0), max: list.reduce((sum, item) => sum + (Number(item.max_score) || 0), 0) };
};

export const reviewedCount = () => criteria().filter((_, index) => workspace.review.reviewed.has(index)).length;

/** Ponderación relativa: el peso del criterio sobre la suma de pesos (1 = 100 % si es el único). */
function weightPercent(item) {
  if (item.weight == null) return null;
  const sum = criteria().reduce((acc, row) => acc + (row.weight == null ? 0 : Number(row.weight) || 0), 0);
  return sum > 0 ? Math.round(Number(item.weight) / sum * 1000) / 10 : null;
}

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

function criterionMark(index) {
  if (workspace.review.reviewed.has(index)) return '<span class="origin-mark origin-mark--reviewed">✓ Revisado</span>';
  if (criterionModified(index)) return `<span class="origin-mark origin-mark--edited">${icon('pencil')} Modificado por vos</span>`;
  return '<span class="origin-mark origin-mark--ai">Sugerido por la IA</span>';
}

function evidenceBlock(item, index, answer) {
  const evidence = item.evidence || '';
  if (!evidence) return '<p class="muted">No se encontró evidencia literal suficiente. Revisá manualmente.</p>';
  const found = findFragment(answer, evidence);
  const long = evidence.length > EVIDENCE_CLAMP_CHARS;
  return `<blockquote class="evidence${long ? ' is-clamped' : ''}" id="ws-evidence-${index}">${escapeHtml(evidence)}</blockquote>
    <p class="evidence-links">${long ? `<button type="button" class="text-link" data-action="workspace-evidence-expand" data-index="${index}" aria-controls="ws-evidence-${index}" aria-expanded="false">Ver completa</button>` : ''}${found ? `<button type="button" class="text-link" data-action="workspace-show-evidence" data-index="${index}">Ver en la respuesta</button>` : '<span class="muted">No se encontró en la respuesta</span>'}</p>`;
}

function criterionCard(item, index, answer) {
  const readonly = isApproved() || Boolean(workspace.proposal?.demo);
  const open = workspace.review.open.has(index);
  const reviewed = workspace.review.reviewed.has(index);
  const name = item.criterion || `Criterio ${index + 1}`;
  const max = Number(item.max_score || 0);
  const weight = weightPercent(item);
  const hidden = workspace.review.onlyUnreviewed && reviewed;
  const editable = readonly
    ? `<dl class="read-values"><div><dt>Puntaje</dt><dd>${escapeHtml(formatNumber(item.score))} / ${escapeHtml(formatNumber(max))}</dd></div><div><dt>Nivel sugerido</dt><dd>${escapeHtml(item.level || 'Sin nivel sugerido')}</dd></div></dl>
       <p class="read-label">Evidencia literal en la respuesta</p>${evidenceBlock(item, index, answer)}
       <dl class="read-values"><div class="full"><dt>Justificación del puntaje</dt><dd>${escapeHtml(item.justification || '—')}</dd></div></dl>`
    : `<div class="form-grid">
        <div class="form-field"><label for="workspace-score-${index}">Puntaje</label>${scoreStepper({ id: `workspace-score-${index}`, value: formatInputNumber(item.score), max, attrs: `data-workspace-criterion="${index}" data-field="score" aria-describedby="workspace-score-${index}-error"`, label: name })}<p class="field-error" id="workspace-score-${index}-error" role="alert" data-score-error="${index}"></p></div>
        <div class="form-field"><span class="read-label">Nivel sugerido</span><p class="read-value" id="workspace-level-${index}">${item.level ? statusPill('review', item.level) : 'Sin nivel sugerido'}</p></div>
      </div>
      <p class="read-label">Evidencia literal en la respuesta</p>${evidenceBlock(item, index, answer)}
      <div class="form-field"><div class="label-row"><label for="workspace-justification-${index}">Justificación del puntaje</label><span class="char-count" data-char-count="workspace-justification-${index}">${String(item.justification || '').length} caracteres</span></div><textarea id="workspace-justification-${index}" class="lined autogrow" rows="3" data-workspace-criterion="${index}" data-field="justification">${escapeHtml(item.justification || '')}</textarea></div>
      <div class="criterion-foot"><label class="check"><input type="checkbox" data-workspace-reviewed="${index}" ${reviewed ? 'checked' : ''}><span>Revisé este criterio</span></label><button type="button" class="text-link" data-action="workspace-restore-criterion" data-index="${index}" ${criterionModified(index) ? '' : 'hidden'}>Restablecer a la sugerencia de la IA</button></div>`;
  return `<article class="criterion" id="ws-criterion-${index}" data-criterion="${index}" ${hidden ? 'hidden' : ''}>
    <h4 class="criterion-heading"><button type="button" class="criterion-toggle" data-action="workspace-criterion-toggle" data-index="${index}" aria-expanded="${open}" aria-controls="ws-criterion-body-${index}">
      <span class="step-number" aria-hidden="true">${index + 1}</span>
      <span class="criterion-name">${escapeHtml(name)}</span>
      <span class="mini-meter"><span class="mini-meter-text" data-criterion-score="${index}">${escapeHtml(formatNumber(item.score))} / ${escapeHtml(formatNumber(max))}</span><progress class="meter meter--mini" max="${Math.max(max, 0.01)}" value="${Math.max(0, Number(item.score) || 0)}" data-criterion-meter="${index}" aria-hidden="true"></progress></span>
      <span class="criterion-mark" data-criterion-mark="${index}">${criterionMark(index)}</span>
      ${icon('chevron')}
    </button></h4>
    <div class="criterion-body" id="ws-criterion-body-${index}" ${open ? '' : 'hidden'}>
      <p class="mono-meta">${weight != null ? `Ponderación ${escapeHtml(formatNumber(weight))}% · ` : ''}Máximo ${escapeHtml(formatNumber(max))} puntos</p>
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

function section(id, title, summary, body) {
  return `<details class="review-section" id="${id}" open><summary><span class="fold-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(summary)}</small></span>${icon('chevron')}</summary><div class="review-section-body">${body}</div></details>`;
}

function summaryBar(submission) {
  const list = navigationList();
  const position = list.findIndex(item => String(item.id) === String(submission.id)) + 1;
  const previous = navigationTarget(-1);
  const next = navigationTarget(1);
  const assessment = selectedAssessment();
  const { score, max } = totals();
  const name = submission.student_display_name || submission.student_name || 'Estudiante sin identificar';
  const options = assessmentSubmissions().map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(submission.id) ? 'selected' : ''}>${escapeHtml(item.student_display_name || item.student_name || 'Estudiante')} · #${escapeHtml(item.id)}</option>`).join('');
  return `<div class="review-bar">
    <div class="review-bar-who"><span class="avatar avatar-tone" aria-hidden="true">${escapeHtml(initials(name))}</span><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml([assessment?.title, assessment?.course_name].filter(Boolean).join(' · '))}</small></div></div>
    <div class="review-bar-nav">
      <button type="button" class="icon-button" data-action="workspace-nav" data-id="${escapeHtml(previous?.id || '')}" aria-label="Entrega anterior" ${previous ? '' : 'disabled'}>${icon('arrowLeft')}</button>
      <span class="mono-meta">${position || 1} de ${list.length || 1}</span>
      <button type="button" class="icon-button" data-action="workspace-nav" data-id="${escapeHtml(next?.id || '')}" aria-label="Entrega siguiente" ${next ? '' : 'disabled'}>${icon('arrowRight')}</button>
      <label class="pill-field" for="workspace-review-submission"><span class="pill-field-label">Entrega a revisar</span><select id="workspace-review-submission" data-workspace-review-submission>${options}</select></label>
      <button type="button" class="chip" id="ws-only-pending" data-action="workspace-only-pending" aria-pressed="${workspace.review.onlyPending}">Sólo pendientes</button>
    </div>
    <div class="review-bar-score"><p class="total"><strong data-review-total>${escapeHtml(formatNumber(score))}</strong> <span>/ ${escapeHtml(formatNumber(max))}</span></p><progress class="meter" max="${Math.max(max, 0.01)}" value="${score}" data-review-meter aria-label="Puntaje total"></progress><p class="mono-meta" aria-live="polite" data-review-progress>${reviewedCount()} de ${criteria().length} criterios revisados</p></div>
    <div class="review-bar-status">${isApproved() ? '<span class="stamp">Aprobada</span>' : statusPill('pending_review', 'Pendiente de revisión')}</div>
  </div>`;
}

function sourceColumn(submission) {
  const assessment = selectedAssessment();
  const question = assessmentQuestions().find(item => String(item.id) === String(submission.question || workspace.questionId));
  const prompt = question?.prompt || assessment?.instructions || 'No hay una consigna específica guardada.';
  const short = (text) => String(text || '').length <= 240;
  const answer = submission.answer_text || '';
  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0;
  const rubric = selectedRubric();
  return `<details class="review-source" id="ws-source" open><summary>Respuesta del estudiante ${icon('chevron')}</summary><div class="review-source-body">
    <details class="source-block" id="ws-source-prompt" ${short(prompt) ? 'open' : ''}><summary>Consigna ${icon('chevron')}</summary><p>${escapeHtml(prompt)}</p></details>
    ${assessment?.objectives ? `<details class="source-block" id="ws-source-objectives" ${short(assessment.objectives) ? 'open' : ''}><summary>Objetivos de aprendizaje ${icon('chevron')}</summary><p>${escapeHtml(assessment.objectives)}</p></details>` : ''}
    ${rubric ? `<details class="source-block" id="ws-source-rubric"><summary>Criterios acordados ${icon('chevron')}</summary><p><strong>${escapeHtml(rubric.title)}</strong></p><ul>${(rubric.criteria || []).map(item => `<li>${escapeHtml(item.name)} <small>${escapeHtml(formatNumber(item.max_score))} pts</small></li>`).join('')}</ul></details>` : ''}
    <details class="source-block" id="ws-source-answer" open><summary>Respuesta del estudiante ${icon('chevron')}</summary><div class="answer-text" id="ws-answer-text">${escapeHtml(answer || 'No hay texto disponible.')}</div><p class="answer-tools"><span class="mono-meta">${words} palabras</span><button type="button" class="text-link" data-action="workspace-copy-answer">Copiar respuesta</button></p>${submission.source_filename ? `<p class="field-hint">Archivo de origen: ${escapeHtml(submission.source_filename)}</p>` : ''}</details>
  </div></details>`;
}

function feedbackSection() {
  const readonly = isApproved() || Boolean(workspace.proposal?.demo);
  const text = workspace.feedback || workspace.proposal?.feedback || '';
  const preview = workspace.review.feedbackMode === 'preview' || readonly;
  const toggle = readonly ? '' : `<div class="segmented" role="group" aria-label="Modo de la devolución"><button type="button" class="chip" data-action="workspace-feedback-mode" data-mode="edit" aria-pressed="${!preview}">Editar</button><button type="button" class="chip" data-action="workspace-feedback-mode" data-mode="preview" aria-pressed="${preview}">Vista previa</button></div>`;
  const body = preview
    ? `<div class="feedback-preview">${escapeHtml(text || 'Todavía no hay devolución.')}</div>`
    : `<div class="form-field"><div class="label-row"><label for="workspace-feedback">Retroalimentación para el estudiante</label><span class="char-count" data-char-count="workspace-feedback">${text.length} caracteres</span></div><textarea id="workspace-feedback" class="lined autogrow" rows="6" data-workspace-feedback>${escapeHtml(text)}</textarea></div>`;
  const reason = isApproved() ? '' : `<div class="form-field"><label for="workspace-change-reason">Motivo si ajustaste la puntuación</label><textarea id="workspace-change-reason" rows="2" data-workspace-change-reason placeholder="Explicá el criterio pedagógico que justifica el cambio (si corresponde)." ${readonly ? 'disabled' : ''}>${escapeHtml(workspace.changeReason)}</textarea><small class="field-hint">Obligatorio sólo si modificaste algún puntaje (mínimo 8 caracteres).</small></div>`;
  return `${toggle}${body}<p class="evidence-links">${readonly ? '' : '<button type="button" class="text-link" data-action="workspace-feedback-restore">Restablecer a la propuesta</button>'}<button type="button" class="text-link" data-action="workspace-copy-feedback">Copiar</button></p>${reason}`;
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
  return `${warning}<div class="step-actions step-actions--review">${status}<div class="step-actions-buttons">${menu}${primary}</div></div>`;
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
  const answer = submission.answer_text || '';
  const pendingCount = list.length - reviewedCount();
  const showOnlyToggle = list.length > 4;
  const index = `<nav class="review-index" aria-label="Secciones de la revisión">
    <a class="chip" href="#ws-sec-summary" data-review-anchor="ws-sec-summary">Resumen</a><a class="chip" href="#ws-sec-criteria" data-review-anchor="ws-sec-criteria">Criterios (${list.length})</a><a class="chip" href="#ws-sec-feedback" data-review-anchor="ws-sec-feedback">Devolución</a>
    <span class="review-index-tools"><button type="button" class="text-link" data-action="workspace-expand-all">Expandir todo</button><button type="button" class="text-link" data-action="workspace-collapse-all">Plegar todo</button>${showOnlyToggle && !isApproved() ? `<button type="button" class="chip" id="ws-only-unreviewed" data-action="workspace-only-unreviewed" aria-pressed="${workspace.review.onlyUnreviewed}">Sólo sin revisar</button>` : ''}</span>
  </nav>`;
  return `${stepHeader(3, isApproved() ? 'Resultado aprobado' : 'Revisión docente', 'La IA sugiere. Vos decidís.', shortcutsHint('ws-shortcuts-3'))}
    ${proposal.demo ? '<div class="notice notice-warning" role="note"><strong>Propuesta demostrativa.</strong> El proveedor está en modo MOCK. No se puede aprobar ni utilizar como calificación real.</div>' : ''}
    ${(proposal.warnings || []).length ? `<details class="disclosure" id="ws-warnings"><summary>Advertencias para revisar (${proposal.warnings.length}) ${icon('chevron')}</summary><div class="disclosure-body"><ul>${proposal.warnings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div></details>` : ''}
    ${summaryBar(submission)}
    <div class="review-grid">
      ${sourceColumn(submission)}
      <div class="review-main">
        ${index}
        <form id="workspace-approve-form" novalidate>
          ${section('ws-sec-summary', 'Resumen general', proposal.summary ? 'Síntesis de la propuesta' : 'Sin síntesis adicional', `<p class="reading">${escapeHtml(proposal.summary || 'Sin síntesis adicional.')}</p><div class="insight-grid">${listCard('Lo que logró', proposal.strengths, 'success', 'strengths')}${listCard('Ideas para seguir mejorando', proposal.improvement_suggestions, 'note', 'improvements')}</div>`)}
          ${section('ws-sec-criteria', 'Criterios', isApproved() ? `${list.length} criterios` : `${pendingCount} de ${list.length} sin revisar`, list.length ? list.map((item, position) => criterionCard(item, position, answer)).join('') : '<p class="muted">La propuesta no incluye criterios.</p>')}
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
