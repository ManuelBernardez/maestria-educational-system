import { state } from '../core/state.js';
import { escapeHtml, formatNumber, formatInputNumber, btn, heading, statusPill, date, panel, resourceError, emptyState, searchField, resultCount, chipGroup, toneOf, icon } from '../core/utils.js';
import { gradeFor } from './workspace/review-step.js';
import { scoreStepper } from './workspace/workspace-markup.js';

/** Prefijo de los chips «filtrar por evaluación» de cada curso (el resto del nombre es la clave del curso). */
export const CORRECTION_ASSESSMENT_GROUP = 'correction-assessment-';

function correctionRow(item) {
  const approved = item.status === 'approved';
  const assessmentId = escapeHtml(item.submission_assessment_id ?? 'none');
  return `<article class="correction-history-item" data-row data-assessment="${assessmentId}"><div class="correction-history-main"><div class="correction-history-title"><strong>${escapeHtml(item.student_name || 'Estudiante sin identificar')}</strong>${statusPill(item.status)}</div><small>${escapeHtml(item.submission_title || 'Evaluación')} · ${date(item.created_at, true)}</small></div><div class="correction-history-score"><strong>${escapeHtml(formatNumber(item.total_score))}</strong><small>puntaje</small></div><div class="table-actions">${btn('Ver devolución', 'open-correction', `data-id="${item.id}"`, 'primary')}${approved ? btn('Exportar', 'export-correction', `data-id="${item.id}"`) : ''}</div></article>`;
}

/** Un curso del historial: plegable con filtro por evaluación (sólo si el curso tiene más de una). */
function correctionGroup(key, group, open) {
  const assessments = new Map();
  group.items.forEach(item => {
    const id = String(item.submission_assessment_id ?? 'none');
    const entry = assessments.get(id) || { title: item.submission_title || 'Evaluación', count: 0 };
    entry.count += 1;
    assessments.set(id, entry);
  });
  const chipName = `${CORRECTION_ASSESSMENT_GROUP}${key}`;
  const saved = state.correctionsAssessmentFilter[key];
  const selected = saved && assessments.has(saved) ? saved : 'all';
  const filter = assessments.size > 1 ? chipGroup('Filtrar por evaluación', chipName, [
    { value: 'all', label: 'Todas', count: group.items.length, active: selected === 'all' },
    ...[...assessments.entries()].sort((a, b) => a[1].title.localeCompare(b[1].title, 'es-AR')).map(([value, entry]) => ({ value, label: entry.title, count: entry.count, active: selected === value }))
  ], { idPrefix: `correction-filter-${key}` }) : '';
  const pending = group.items.filter(item => item.status === 'pending_review').length;
  const detail = `${group.items.length} ${group.items.length === 1 ? 'devolución' : 'devoluciones'}${pending ? ` · ${pending} por revisar` : ''}`;
  return `<details class="fold correction-group" id="correction-group-${escapeHtml(key)}" data-tone="${toneOf(key)}"${open ? ' open' : ''}><summary><span class="fold-copy"><strong>${escapeHtml(group.name)}</strong><small>${detail}</small></span><span class="fold-count">${group.items.length}</span>${icon('chevron')}</summary><div class="fold-body">${filter}<div class="correction-history-list" data-filter-scope="${escapeHtml(chipName)}" data-filter-attr="assessment">${group.items.map(correctionRow).join('')}</div></div></details>`;
}

export function renderCorrections() {
  const courses = new Map(state.data.courses.map(item => [String(item.id), item.name]));
  const courseOptions = [...courses.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es-AR'));
  const query = state.search.trim().toLocaleLowerCase('es-AR');
  const filtered = state.data.corrections.filter(item => {
    const matchesQuery = !query || [item.student_name, item.submission_title, item.course_name, item.subject].filter(Boolean).join(' ').toLocaleLowerCase('es-AR').includes(query);
    const courseId = item.course_id == null ? 'unassigned' : String(item.course_id);
    const matchesCourse = state.correctionsCourseFilter === 'all' || state.correctionsCourseFilter === courseId;
    const matchesStatus = state.correctionsStatusFilter === 'all' || item.status === state.correctionsStatusFilter;
    return matchesQuery && matchesCourse && matchesStatus;
  });
  const grouped = new Map();
  filtered.forEach(item => {
    const key = item.course_id == null ? 'unassigned' : String(item.course_id);
    const name = item.course_name || courses.get(key) || 'Sin curso asignado';
    if (!grouped.has(key)) grouped.set(key, { name, items: [] });
    grouped.get(key).items.push(item);
  });
  // Sólo un curso abierto a la vez (acordeón): el elegido en el filtro, o el primero de la lista.
  const groups = [...grouped.entries()].map(([key, group], index) => correctionGroup(key, group, index === 0)).join('');
  return `${heading('Correcciones', 'Devoluciones agrupadas por curso. Dentro de cada curso podés filtrar por evaluación.', `${btn('Ir a entregas', 'navigate', 'data-view="submissions"', 'primary')}`)}${resourceError('corrections', 'el historial de correcciones')}<div class="toolbar" role="search">${searchField('Buscar correcciones', state.search, 'Estudiante o evaluación…', 'data-search="corrections" id="correction-search"')}<select class="toolbar-select" data-filter="corrections-course" id="corrections-course" aria-label="Filtrar por curso"><option value="all">Todos los cursos</option>${courseOptions.map(([id, name]) => `<option value="${escapeHtml(id)}" ${state.correctionsCourseFilter === id ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}${state.data.corrections.some(item => item.course_id == null) ? `<option value="unassigned" ${state.correctionsCourseFilter === 'unassigned' ? 'selected' : ''}>Sin curso asignado</option>` : ''}</select><select class="toolbar-select" data-filter="corrections-status" id="corrections-status" aria-label="Filtrar por estado"><option value="all" ${state.correctionsStatusFilter === 'all' ? 'selected' : ''}>Todos los estados</option><option value="pending_review" ${state.correctionsStatusFilter === 'pending_review' ? 'selected' : ''}>Pendientes</option><option value="approved" ${state.correctionsStatusFilter === 'approved' ? 'selected' : ''}>Aprobadas</option><option value="rejected" ${state.correctionsStatusFilter === 'rejected' ? 'selected' : ''}>Rechazadas</option></select>${resultCount(`${filtered.length} ${filtered.length === 1 ? 'devolución' : 'devoluciones'}`)}</div>${groups ? `<section class="fold-list" aria-label="Correcciones por curso">${groups}</section>` : emptyState('No hay correcciones para mostrar', 'Probá modificar los filtros o generá una nueva propuesta desde Entregas.')}`;
}

/** Criterio con los puntajes que hay hoy en el formulario (o los de la propuesta). */
function formCriteria(form, criteria) {
  return criteria.map((item, index) => {
    const input = form?.querySelector(`[name="score-${index}"]`);
    return input ? { ...item, score: Number(input.value) } : item;
  });
}

/** Misma regla que el espacio de trabajo: motivo sólo si cambió un puntaje o la nota final. */
function closingState(form, criteria) {
  const current = formCriteria(form, criteria);
  const { computed, max, minimum } = gradeFor(current);
  const finalInput = form?.querySelector('[data-correction-final]');
  const manual = form?.dataset.finalManual === '1' && finalInput ? Number(String(finalInput.value).replace(',', '.')) : NaN;
  const valid = Number.isFinite(manual) && manual >= minimum && manual <= max;
  const overridden = valid && Math.abs(manual - computed) >= 0.005;
  const changed = current.some((item, index) => Number(item.score) !== Number(criteria[index]?.score));
  const manualInvalid = form?.dataset.finalManual === '1' && !valid;
  return { current, computed, max, minimum, overridden, changed, manualInvalid, final: overridden ? Math.round(manual * 100) / 100 : computed };
}

const finalHint = (computed, overridden) => overridden ? `Calculada: ${escapeHtml(formatNumber(computed))} · <button type="button" class="text-link" data-action="correction-final-reset">Usar la calculada</button>` : '';

/** Actualiza en vivo los puntajes de las cabeceras, la nota final, su ayuda y el motivo. */
export function refreshCorrectionForm(form) {
  const criteria = state.currentCorrection?.proposal?.criteria || [];
  const { current, computed, overridden, changed } = closingState(form, criteria);
  current.forEach((item, index) => {
    const label = form.querySelector(`[data-correction-score-label="${index}"]`);
    if (label) label.textContent = `${formatNumber(item.score)} / ${formatNumber(item.max_score)}`;
  });
  const finalInput = form.querySelector('[data-correction-final]');
  if (finalInput && form.dataset.finalManual !== '1' && document.activeElement !== finalInput) finalInput.value = formatInputNumber(computed);
  const hint = form.querySelector('[data-correction-final-hint]');
  if (hint) hint.innerHTML = finalHint(computed, overridden);
  const reason = form.querySelector('[data-correction-reason]');
  if (reason) reason.hidden = !(changed || overridden);
}

/** El docente tocó la nota final: queda «a mano» salvo que coincida con la calculada. */
export function onCorrectionFinalInput(form, input) {
  const criteria = state.currentCorrection?.proposal?.criteria || [];
  const { computed } = gradeFor(formCriteria(form, criteria));
  form.dataset.finalManual = Math.abs(Number(String(input.value).replace(',', '.')) - computed) >= 0.005 ? '1' : '';
  refreshCorrectionForm(form);
}

export function resetCorrectionFinal(form) {
  form.dataset.finalManual = '';
  const input = form.querySelector('[data-correction-final]');
  if (input) input.value = '';
  refreshCorrectionForm(form);
}

export { closingState as correctionClosingState };

export function renderCorrection() {
  const correction = state.currentCorrection;
  const submission = state.currentSubmission;
  if (!correction || !submission) return emptyState('No hay una corrección seleccionada', 'Elegí una entrega desde el listado.');
  const approved = correction.status === 'approved';
  const proposal = approved ? correction.final_result : correction.proposal;
  const criteria = Array.isArray(proposal?.criteria) ? proposal.criteria : [];
  const readonly = approved || Boolean(proposal?.demo);
  const warning = proposal?.demo ? `<div class="notice notice-warning"><strong>Propuesta demostrativa.</strong> El proveedor está en modo MOCK. No se puede aprobar ni utilizar como calificación real.</div>` : '';
  const backLabel = state.correctionOrigin === 'course' ? 'Volver al curso' : 'Volver a la entrega';
  const sharingActions = approved
    ? btn('Compartir / guardar', 'share-correction', '', 'primary')
    : `${btn('Copiar borrador', 'copy-correction')}${btn('Imprimir', 'print-correction')}`;
  const { computed, max, minimum } = gradeFor(criteria);
  const shown = approved && correction.total_score != null ? Number(correction.total_score) : computed;
  const scoreNote = approved && proposal?.final_score_overridden ? ` <small class="muted">(fijada por el docente; calculada: ${escapeHtml(formatNumber(proposal.computed_score))})</small>` : '';

  const cards = criteria.map((item, index) => {
    // Igual que en el espacio de trabajo: enunciado, puntaje, evidencia literal y justificación.
    const name = item.criterion || `Criterio ${index + 1}`;
    const level = item.level ? statusPill('review', item.level) : '';
    const prompt = item.question_prompt ? `<p class="criterion-prompt">${escapeHtml(item.question_prompt)}</p>` : '';
    const evidence = item.evidence
      ? `<span class="read-label">Evidencia</span><blockquote class="evidence">${escapeHtml(item.evidence)}</blockquote>`
      : '<p class="muted">Sin evidencia literal: revisalo en la respuesta.</p>';
    const score = readonly
      ? (level ? `<p class="criterion-score-line">${level}</p>` : '')
      : `<div class="criterion-score-line"><label for="score-${index}">Puntaje</label>${scoreStepper({ id: `score-${index}`, value: formatInputNumber(item.score), max: Number(item.max_score || 0), attrs: `name="score-${index}" data-correction-score="${index}" required`, label: name })}<span class="muted">/ ${escapeHtml(formatNumber(item.max_score))}</span>${level}</div>`;
    const justification = readonly
      ? `<p class="criterion-justification">${escapeHtml(item.justification || '—')}</p>`
      : `<div class="form-field"><label for="justification-${index}">Justificación</label><textarea id="justification-${index}" name="justification-${index}" rows="2">${escapeHtml(item.justification || '')}</textarea></div>`;
    // Plegable (acordeón, el primero abierto). Un campo inválido dentro de uno plegado se
    // abre solo al enviar (ver el listener «invalid» en events.js).
    return `<details class="criterion-review" id="criterion-review-${index}" ${index === 0 ? 'open' : ''}><summary><span class="fold-copy"><strong>${escapeHtml(name)}</strong><small data-correction-score-label="${index}">${escapeHtml(formatNumber(item.score))} / ${escapeHtml(formatNumber(item.max_score))}</small></span>${icon('chevron')}</summary><div class="criterion-review-body">${prompt}${score}${evidence}${justification}</div></details>`;
  }).join('');

  const feedbackText = correction.teacher_feedback || proposal?.feedback || '';
  const feedback = readonly
    ? `<div class="feedback-preview">${escapeHtml(feedbackText || 'Todavía no hay devolución.')}</div>`
    : `<label class="visually-hidden" for="teacher_feedback">Devolución para el estudiante</label><textarea id="teacher_feedback" name="teacher_feedback" class="lined autogrow" rows="6">${escapeHtml(feedbackText)}</textarea>`;

  const closing = readonly ? '' : `<div class="step-actions step-actions--review correction-closing">
      <div class="form-field reason-row" data-correction-reason hidden><label for="change_reason">Motivo del cambio <small class="ws-block-optional">obligatorio</small></label><input id="change_reason" name="change_reason" type="text" maxlength="250" placeholder="Por qué cambiaste el puntaje o la nota"></div>
      <div class="final-score-row"><label for="correction-final-score">Nota final</label>${scoreStepper({ id: 'correction-final-score', value: formatInputNumber(computed), max, min: minimum, attrs: 'name="final_score" data-correction-final', label: 'la nota final' })}<span class="muted">/ ${escapeHtml(formatNumber(max))}</span><span class="field-hint" data-correction-final-hint></span></div>
      <div class="step-actions-buttons">${btn('Exportar Markdown', 'export-correction', `data-id="${correction.id}"`)}<button class="btn btn-primary" type="submit">Aprobar devolución</button></div>
    </div>`;

  return `${heading('Revisión pedagógica', `${submission.student_display_name || submission.student_name || 'Estudiante'} · ${correction.submission_title || 'Evaluación'}`, `${btn(backLabel, 'return-submission', `data-id="${submission.id}"`)}${sharingActions}`)}${warning}
    <p class="ai-disclaimer"><strong>La IA sugiere. Vos decidís.</strong> Nada se aprueba sin tu revisión.</p>
    ${panel('Síntesis', '', `<p>${escapeHtml(proposal?.summary || 'La IA no incluyó una síntesis.')}</p><p class="correction-grade"><strong>${escapeHtml(formatNumber(shown))}</strong> / ${escapeHtml(formatNumber(max))}${approved ? '' : ' <small class="muted">propuesta</small>'}${scoreNote}</p>`)}
    <form id="approve-correction-form" novalidate>
      ${panel('Criterios', 'Puntaje, evidencia literal y justificación de cada criterio.', cards || '<p class="muted">La propuesta no incluye criterios.</p>')}
      ${panel('Devolución al estudiante', approved ? 'Devolución final' : 'Editable antes de aprobar', `${feedback}`)}
      ${approved ? `<div class="notice"><strong>Envíos registrados</strong><div id="correction-delivery-log"><small class="muted">Cargando…</small></div></div><div class="notice notice-success">Aprobada el ${date(correction.approved_at, true)} · el historial permanece inmutable</div>${btn('Exportar Markdown', 'export-correction', `data-id="${correction.id}"`)}` : ''}
      ${proposal?.demo ? '<p class="form-error">Las propuestas MOCK no pueden aprobarse.</p>' : ''}
      ${closing}
    </form>`;
}
