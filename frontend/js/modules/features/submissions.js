import { state } from '../core/state.js';
import { escapeHtml, btn, heading, table, statusPill, statusLabel, date, panel, optionRows, textField, selectField, resourceError, emptyState, searchField, resultCount } from '../core/utils.js';
import { examStatus } from './exam-status.js';

/** Estado de flujo de una entrega (fuente única: exam-status.js). */
export const submissionWorkflowStatus = examStatus;

export function renderSubmissions() {
  const query = state.search.trim().toLowerCase();
  const all = state.data.submissions;
  const counts = {
    all: all.length,
    pending: all.filter(item => submissionWorkflowStatus(item) === 'pending').length,
    review: all.filter(item => submissionWorkflowStatus(item) === 'review').length,
    approved: all.filter(item => submissionWorkflowStatus(item) === 'approved').length
  };
  const filtered = all.filter(item => {
    const assessment = state.data.assessments.find(row => String(row.id) === String(item.assessment));
    const matchesQuery = !query || `${item.student_display_name || item.student_name || ''} ${item.submission_title || item.assessment_title || assessment?.title || ''} ${item.answer_text || ''}`.toLowerCase().includes(query);
    const matchesCourse = state.submissionCourseFilter === 'all' || String(assessment?.course ?? 'unassigned') === state.submissionCourseFilter;
    const matchesStatus = state.submissionStatusFilter === 'all' || submissionWorkflowStatus(item) === state.submissionStatusFilter;
    return matchesQuery && matchesCourse && matchesStatus;
  });
  const rows = filtered.map(item => {
    const assessment = state.data.assessments.find(row => String(row.id) === String(item.assessment));
    const correction = state.data.corrections.find(row => String(row.submission) === String(item.id));
    const workflowStatus = submissionWorkflowStatus(item);
    return `<tr><td><strong>${escapeHtml(item.student_display_name || item.student_name || 'Estudiante sin identificar')}</strong><small>${escapeHtml(item.source_filename || item.source_type || 'Texto')}</small></td><td>${escapeHtml(assessment?.title || item.submission_title || 'Evaluación')}</td><td><span class="answer-preview">${escapeHtml(item.answer_text || 'Sin vista previa')}</span></td><td>${statusPill(item.status)}</td><td>${correction ? statusPill(correction.status) : statusPill(workflowStatus)}</td><td>${btn(correction ? 'Revisar devolución' : 'Abrir entrega', 'open-submission', `data-id="${item.id}"`)}</td></tr>`;
  });
  const statusCards = [
    ['all', 'Todas las entregas', counts.all, 'Ver el listado completo'],
    ['pending', 'Pendientes', counts.pending, 'Sin propuesta generada'],
    ['review', 'Para revisar', counts.review, 'Propuestas pendientes'],
    ['approved', 'Aprobadas', counts.approved, 'Resultado confirmado']
  ].map(([key, label, value, hint]) => `<button type="button" class="submission-status-card ${state.submissionStatusFilter === key ? 'is-selected' : ''}" data-submission-status="${key}" aria-pressed="${state.submissionStatusFilter === key}"><span>${label}</span><strong>${value}</strong><small>${hint}</small></button>`).join('');
  return `${heading('Entregas', 'Encontrá cada respuesta y continuá directamente con su revisión.', `${btn('Historial de correcciones', 'navigate', 'data-view="corrections"')}${btn('Ver evaluaciones', 'navigate', 'data-view="assessments"')}${btn('Nueva entrega', 'new-submission', '', 'primary')}`)}${resourceError('submissions', 'las entregas')}${resourceError('corrections', 'las correcciones')}<section class="submission-summary-grid" aria-label="Estados de entrega">${statusCards}</section><div class="toolbar" role="search">${searchField('Buscar entregas', state.search, 'Buscar estudiante, evaluación o respuesta', 'data-search="submissions" id="submission-search"')}<select class="toolbar-select" data-filter="submission-course" id="submission-course" aria-label="Filtrar por curso"><option value="all" ${state.submissionCourseFilter === 'all' ? 'selected' : ''}>Todos los cursos</option>${state.data.courses.map(course => `<option value="${course.id}" ${String(course.id) === String(state.submissionCourseFilter) ? 'selected' : ''}>${escapeHtml(course.name)}</option>`).join('')}<option value="unassigned" ${state.submissionCourseFilter === 'unassigned' ? 'selected' : ''}>Sin curso asignado</option></select>${resultCount(`${filtered.length} de ${all.length} entregas`)}</div>${table(['Estudiante', 'Evaluación', 'Respuesta', 'Entrega', 'Corrección', 'Acciones'], rows, 'No hay entregas que coincidan con los filtros.')}`;
}

export function renderSubmissionDetail() {
  const submission = state.currentSubmission;
  if (!submission) return emptyState('No se encontró la entrega', 'Volvé al listado e intentá abrirla nuevamente.', btn('Volver', 'navigate', 'data-view="submissions"'));
  const assessment = state.data.assessments.find(item => String(item.id) === String(submission.assessment));
  const correction = state.data.corrections.find(item => String(item.submission) === String(submission.id));
  const rubricOptions = optionRows(state.data.rubrics, item => item.title, true);
  const answers = Array.isArray(submission.answers) ? submission.answers : [];
  const questions = state.assessmentEditor?.questions || [];
  const alreadyAnswered = new Set(answers.map(item => String(item.question)));
  if (submission.question) alreadyAnswered.add(String(submission.question));
  const availableQuestions = questions.filter(item => !alreadyAnswered.has(String(item.id)));
  const answerRows = answers.map(answer => `<article class="list-row"><div class="list-main"><strong>${escapeHtml(answer.question_prompt || questions.find(question => String(question.id) === String(answer.question))?.prompt || 'Consigna')}</strong><small>${escapeHtml(answer.source_filename || 'Respuesta en texto')}</small><p class="answer-full">${escapeHtml(answer.answer_text || '')}</p></div><small class="muted">${date(answer.created_at, true)}</small></article>`).join('');
  const canAddAnswers = !correction && !['processing', 'approved'].includes(submission.status);
  const addAnswer = canAddAnswers && availableQuestions.length ? `<form id="add-submission-answer-form" class="panel-body"><div class="form-grid">${selectField('Consigna', 'question', availableQuestions.map(item => ({ value: item.id, label: item.prompt })), '', true)}${textField('Respuesta', 'answer_text', '', 'maxlength="50000"', true)}</div><div class="modal-actions"><button class="btn btn-primary" type="submit">Agregar respuesta</button></div></form>` : `<p class="muted">${correction ? 'La entrega ya tiene una corrección asociada. Para mantener la trazabilidad, no se agregan respuestas después de generar la propuesta.' : submission.status === 'processing' ? 'No se pueden modificar respuestas mientras se procesa la corrección.' : questions.length ? 'Todas las consignas disponibles ya tienen una respuesta asociada.' : 'Esta evaluación todavía no tiene consignas.'}</p>`;
  return `${heading('Detalle de entrega', `${submission.student_display_name || submission.student_name || 'Estudiante'} · ${assessment?.title || 'Evaluación'}`, `${btn('Volver al curso', 'return-submission', `data-id="${submission.id}"`)}`)}
    ${panel('Respuesta general', '', `<p class="answer-full">${escapeHtml(submission.answer_text || 'La entrega no contiene una respuesta general. Revisá las respuestas asociadas a cada consigna.')}</p><small class="muted">${escapeHtml(submission.source_filename || submission.source_type || 'Texto')} · ${date(submission.created_at, true)}</small>`)}
    ${panel('Respuestas por consigna', 'Podés agregar respuestas adicionales mientras la entrega no esté en procesamiento.', `${answerRows || '<p class="muted">Todavía no hay respuestas individuales.</p>'}${addAnswer}`)}
    ${correction ? panel('Corrección existente', 'Hay una propuesta o resultado asociado a esta entrega.', `<div class="list-row"><div class="list-main"><strong>${escapeHtml(correction.provider || 'Proveedor')} · ${statusLabel(correction.status)}</strong><small>${date(correction.created_at, true)}</small></div>${btn('Revisar corrección', 'open-correction', `data-id="${correction.id}"`, 'primary')}</div>`) : panel('Generar propuesta', 'La IA utiliza el material de la evaluación y la rúbrica elegida. Revisá siempre la propuesta.', `<form id="generate-correction-form"><div class="form-grid">${selectField('Rúbrica', 'rubric_id', rubricOptions, '', false)}${selectField('Estilo de devolución', 'feedback_style', [{ value: 'constructivo', label: 'Constructivo' }, { value: 'formal', label: 'Formal' }, { value: 'motivador', label: 'Motivador' }], state.feedbackStyle || 'constructivo')}</div><div class="modal-actions"><button type="submit" class="btn btn-primary">Generar propuesta de corrección</button></div><p class="muted">La generación puede tardar y está sujeta a límites y configuración del proveedor IA.</p></form>`)}
  `;
}
