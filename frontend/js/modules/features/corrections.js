import { state } from '../core/state.js';
import { escapeHtml, formatNumber, formatInputNumber, btn, heading, statusPill, date, panel, textField, resourceError, emptyState, searchField, resultCount, chipGroup, toneOf, icon } from '../core/utils.js';

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

export function renderCorrection() {
  const correction = state.currentCorrection;
  const submission = state.currentSubmission;
  if (!correction || !submission) return emptyState('No hay una corrección seleccionada', 'Elegí una entrega desde el listado.');
  const proposal = correction.status === 'approved' ? correction.final_result : correction.proposal;
  const criteria = Array.isArray(proposal?.criteria) ? proposal.criteria : [];
  const weightSum = criteria.reduce((sum, item) => sum + (item.weight == null ? 1 : Number(item.weight)), 0) || 1;
  const readonly = correction.status === 'approved' || Boolean(proposal?.demo);
  const warning = proposal?.demo ? `<div class="notice notice-warning"><strong>Propuesta demostrativa.</strong> El proveedor está en modo MOCK. No se puede aprobar ni utilizar como calificación real.</div>` : '';
  const backLabel = state.correctionOrigin === 'course' ? 'Volver al curso' : 'Volver a la entrega';
  const sharingActions = correction.status === 'approved'
    ? btn('Compartir / guardar', 'share-correction', '', 'primary')
    : `${btn('Copiar borrador', 'copy-correction')}${btn('Imprimir', 'print-correction')}`;
  return `${heading('Revisión pedagógica', `${submission.student_display_name || submission.student_name || 'Estudiante'} · ${correction.submission_title || 'Evaluación'}`, `${btn(backLabel, 'return-submission', `data-id="${submission.id}"`)}${sharingActions}`)}${warning}
    <p class="ai-disclaimer"><strong>La IA sugiere. Vos decidís.</strong> Nada se aprueba sin tu revisión.</p>
    ${panel('Síntesis propuesta', '', `<p>${escapeHtml(proposal?.summary || 'La IA no incluyó una síntesis.')}</p><div class="notice">Puntaje propuesto: ${escapeHtml(formatNumber(correction.total_score ?? criteria.reduce((sum, item) => sum + Number(item.score || 0), 0)))}</div>`)}
    ${panel('Criterios y evidencias', 'Revisá puntajes, justificaciones y citas literales. Los cambios de puntaje requieren explicar el motivo.', `<form id="approve-correction-form">${criteria.map((item, index) => {
      // Cada criterio es un plegable (acordeón, el primero abierto). Un campo inválido dentro de
      // uno plegado se abre solo al enviar (ver el listener «invalid» en events.js).
      const name = item.criterion || `Criterio ${index + 1}`;
      const weight = item.weight != null && criteria.length > 1 ? ` · pondera ${escapeHtml(formatNumber(Math.round((Number(item.weight) / weightSum) * 1000) / 10))}%` : '';
      return `<details class="criterion-review" id="criterion-review-${index}" ${index === 0 ? 'open' : ''}><summary><span class="fold-copy"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(formatNumber(item.score))} / ${escapeHtml(formatNumber(item.max_score))} puntos${weight}</small></span>${icon('chevron')}</summary><fieldset><legend class="visually-hidden">${escapeHtml(name)}</legend><div class="form-grid"><div class="form-field"><label for="score-${index}">Puntaje (máx. ${escapeHtml(formatNumber(item.max_score))})</label><input id="score-${index}" name="score-${index}" type="number" min="0" max="${Number(item.max_score || 0)}" step="0.01" value="${escapeHtml(formatInputNumber(item.score))}" ${readonly ? 'disabled' : ''} required></div><div class="form-field"><label for="level-${index}">Nivel</label><input id="level-${index}" name="level-${index}" value="${escapeHtml(item.level || '')}" ${readonly ? 'disabled' : ''}></div>${textField('Justificación', `justification-${index}`, item.justification || '', readonly ? 'disabled' : '')}${textField('Evidencia textual (cita exacta)', `evidence-${index}`, item.evidence || '', readonly ? 'disabled' : '')}</div></fieldset></details>`;
    }).join('')}
    ${textField('Devolución general al estudiante', 'teacher_feedback', correction.teacher_feedback || proposal?.feedback || '', readonly ? 'disabled' : '')}
    ${correction.status === 'approved' ? `<div class="notice"><strong>Envíos registrados</strong><div id="correction-delivery-log"><small class="muted">Cargando…</small></div></div>` : ''}
    ${correction.status === 'approved' ? `<div class="notice notice-success">Esta devolución fue aprobada el ${date(correction.approved_at, true)}. El historial permanece inmutable.</div>` : ''}
    ${proposal?.demo ? '<p class="form-error">Las propuestas MOCK no pueden aprobarse.</p>' : ''}
    ${correction.status !== 'approved' && !proposal?.demo ? `<div class="form-grid">${textField('Motivo del ajuste de puntaje (obligatorio si modificás algún puntaje)', 'change_reason', '', '', false)}</div><div class="modal-actions">${btn('Exportar Markdown', 'export-correction', `data-id="${correction.id}"`)}<button class="btn btn-primary" type="submit">Aprobar devolución</button></div>` : `${btn('Exportar Markdown', 'export-correction', `data-id="${correction.id}"`)}`}</form>`)}`;
}
