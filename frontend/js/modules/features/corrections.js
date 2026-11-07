import { state } from '../core/state.js';
import { escapeHtml, formatNumber, formatInputNumber, btn, heading, table, statusPill, statusLabel, date, panel, textField, resourceError, emptyState, searchField, resultCount } from '../core/utils.js';

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
  const groups = [...grouped.entries()].map(([key, group]) => `<section class="panel correction-course-group"><header class="panel-head"><div><h2>${escapeHtml(group.name)}</h2><p>${group.items.length} ${group.items.length === 1 ? 'devolución' : 'devoluciones'}</p></div></header><div class="panel-body correction-history-list">${group.items.map(item => {
    const approved = item.status === 'approved';
    return `<article class="correction-history-item"><div class="correction-history-main"><div class="correction-history-title"><strong>${escapeHtml(item.submission_title || 'Evaluación')}</strong>${statusPill(item.status)}</div><p>${escapeHtml(item.student_name || 'Estudiante sin identificar')} · ${escapeHtml(item.subject || 'Sin materia')}</p><small>${date(item.created_at, true)} · ${escapeHtml(item.provider || 'Proveedor no informado')}</small></div><div class="correction-history-score"><strong>${escapeHtml(formatNumber(item.total_score))}</strong><small>puntaje</small></div><div class="table-actions">${btn('Ver devolución', 'open-correction', `data-id="${item.id}"`, 'primary')}${approved ? btn('Exportar', 'export-correction', `data-id="${item.id}"`) : ''}</div></article>`;
  }).join('')}</div></section>`).join('');
  return `${heading('Correcciones', 'Historial de devoluciones agrupado por curso. Abrí cada detalle cuando necesites revisar, compartir o exportar.', `${btn('Ir a entregas', 'navigate', 'data-view="submissions"', 'primary')}`)}${resourceError('corrections', 'el historial de correcciones')}<div class="toolbar" role="search">${searchField('Buscar correcciones', state.search, 'Estudiante, evaluación o materia…', 'data-search="corrections" id="correction-search"')}<select class="toolbar-select" data-filter="corrections-course" id="corrections-course" aria-label="Filtrar por curso"><option value="all">Todos los cursos</option>${courseOptions.map(([id, name]) => `<option value="${escapeHtml(id)}" ${state.correctionsCourseFilter === id ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}${state.data.corrections.some(item => item.course_id == null) ? `<option value="unassigned" ${state.correctionsCourseFilter === 'unassigned' ? 'selected' : ''}>Sin curso asignado</option>` : ''}</select><select class="toolbar-select" data-filter="corrections-status" id="corrections-status" aria-label="Filtrar por estado"><option value="all" ${state.correctionsStatusFilter === 'all' ? 'selected' : ''}>Todos los estados</option><option value="pending_review" ${state.correctionsStatusFilter === 'pending_review' ? 'selected' : ''}>Pendientes</option><option value="approved" ${state.correctionsStatusFilter === 'approved' ? 'selected' : ''}>Aprobadas</option><option value="rejected" ${state.correctionsStatusFilter === 'rejected' ? 'selected' : ''}>Rechazadas</option></select>${resultCount(`${filtered.length} ${filtered.length === 1 ? 'devolución' : 'devoluciones'}`)}</div>${groups || emptyState('No hay correcciones para mostrar', 'Probá modificar los filtros o generá una nueva propuesta desde Entregas.')}`;
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
  return `${heading('Revisión pedagógica', `${submission.student_display_name || submission.student_name || 'Estudiante'} · ${correction.submission_title || 'Evaluación'}`, `${btn(backLabel, 'return-submission', `data-id="${submission.id}"`)}${sharingActions}`, { kicker: 'Revisión' })}${warning}
    <p class="ai-disclaimer"><strong>La IA sugiere. Vos decidís.</strong> Nada se aprueba sin tu revisión.</p>
    ${panel('Síntesis propuesta', '', `<p>${escapeHtml(proposal?.summary || 'La IA no incluyó una síntesis.')}</p><div class="notice">Proveedor: ${escapeHtml(correction.provider || '—')} · Puntaje propuesto: ${escapeHtml(formatNumber(correction.total_score ?? criteria.reduce((sum, item) => sum + Number(item.score || 0), 0)))}</div>`)}
    ${panel('Criterios y evidencias', 'Revisá puntajes, justificaciones y citas literales. Los cambios de puntaje requieren explicar el motivo.', `<form id="approve-correction-form">${criteria.map((item, index) => `<fieldset class="criterion-review"><legend>${escapeHtml(item.criterion || `Criterio ${index + 1}`)}${item.weight != null && criteria.length > 1 ? ` · pondera ${escapeHtml(formatNumber(Math.round((Number(item.weight) / weightSum) * 1000) / 10))}%` : ''}</legend><div class="form-grid"><div class="form-field"><label for="score-${index}">Puntaje (máx. ${escapeHtml(formatNumber(item.max_score))})</label><input id="score-${index}" name="score-${index}" type="number" min="0" max="${Number(item.max_score || 0)}" step="0.01" value="${escapeHtml(formatInputNumber(item.score))}" ${readonly ? 'disabled' : ''} required></div><div class="form-field"><label for="level-${index}">Nivel</label><input id="level-${index}" name="level-${index}" value="${escapeHtml(item.level || '')}" ${readonly ? 'disabled' : ''}></div>${textField('Justificación', `justification-${index}`, item.justification || '', readonly ? 'disabled' : '')}${textField('Evidencia textual (cita exacta)', `evidence-${index}`, item.evidence || '', readonly ? 'disabled' : '')}</div></fieldset>`).join('')}
    ${textField('Devolución general al estudiante', 'teacher_feedback', correction.teacher_feedback || proposal?.feedback || '', readonly ? 'disabled' : '')}
    ${correction.status === 'approved' ? `<div class="notice"><strong>Envíos registrados</strong><div id="correction-delivery-log"><small class="muted">Cargando…</small></div></div>` : ''}
    ${correction.status === 'approved' ? `<div class="notice notice-success">Esta devolución fue aprobada el ${date(correction.approved_at, true)}. El historial permanece inmutable.</div>` : ''}
    ${proposal?.demo ? '<p class="form-error">Las propuestas MOCK no pueden aprobarse.</p>' : ''}
    ${correction.status !== 'approved' && !proposal?.demo ? `<div class="form-grid">${textField('Motivo del ajuste de puntaje (obligatorio si modificás algún puntaje)', 'change_reason', '', '', false)}</div><div class="modal-actions">${btn('Exportar Markdown', 'export-correction', `data-id="${correction.id}"`)}<button class="btn btn-primary" type="submit">Aprobar devolución</button></div>` : `${btn('Exportar Markdown', 'export-correction', `data-id="${correction.id}"`)}`}</form>`)}`;
}
