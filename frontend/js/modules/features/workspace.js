import { api } from '../core/api.js';
import { state, content } from '../core/state.js';
import { escapeHtml, formatNumber, date, statusLabel, statusPill, emptyState } from '../core/utils.js';
import { render, navigate } from '../core/router.js';
import { openCorrectionShareModal, copyCorrection } from './share.js';

const ACCEPTED_FILES = '.txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const workspace = {
  loaded: false,
  loading: false,
  error: '',
  message: '',
  step: 1,
  assessmentId: '',
  courseFilter: 'all',
  questions: [],
  objectives: '',
  instructions: '',
  referenceMaterial: '',
  questionId: '',
  studentId: '',
  studentName: '',
  rubricId: '',
  feedbackStyle: state.feedbackStyle || 'constructivo',
  answerText: '',
  answerFile: null,
  materialFile: null,
  materialMode: 'append',
  questionSuggestions: [],
  questionSuggestionDemo: false,
  generatingQuestions: false,
  search: '',
  statusFilter: 'all',
  activeSubmission: null,
  correction: null,
  proposal: null,
  feedback: '',
  changeReason: '',
  aiProvider: 'mock',
  approvedCount: 0,
  reviewedCount: 0
};

let loadController = null;
let selectionController = null;
let loadSequence = 0;
let selectionSequence = 0;
let actionLocked = false;

function setMessage(message = '', error = '') {
  workspace.message = message;
  workspace.error = error;
}

function selectedAssessment() {
  return state.data.assessments.find(item => String(item.id) === String(workspace.assessmentId)) || null;
}

function selectedRubric() {
  return state.data.rubrics.find(item => String(item.id) === String(workspace.rubricId)) || null;
}

function assessmentQuestions() {
  return workspace.questions.filter(item => String(item.assessment) === String(workspace.assessmentId))
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
}

function updateWorkspaceUrl({ assessment = workspace.assessmentId, submission = '' } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set('view', 'workspace');
  if (assessment) url.searchParams.set('assessment', String(assessment));
  else url.searchParams.delete('assessment');
  if (submission) url.searchParams.set('submission', String(submission));
  else url.searchParams.delete('submission');
  window.history.replaceState({}, '', url.toString());
}

function syncCurrentSelection() {
  state.currentSubmission = workspace.activeSubmission;
  state.selectedSubmission = workspace.activeSubmission?.id || null;
  state.currentCorrection = workspace.correction;
  state.selectedCorrection = workspace.correction?.id || null;
}

function summarizeCorrection(item) {
  if (!item) return null;
  return {
    id: item.id,
    submission: item.submission,
    status: item.status,
    total_score: item.total_score,
    submission_assessment_id: item.submission_assessment_id ?? workspace.assessmentId,
    submission_title: item.submission_title || selectedAssessment()?.title || 'Evaluación',
    student_name: item.student_name || workspace.activeSubmission?.student_display_name || workspace.activeSubmission?.student_name || 'Estudiante sin identificar',
    course_id: item.course_id ?? selectedAssessment()?.course ?? null,
    course_name: item.course_name ?? selectedAssessment()?.course_name ?? null,
    subject: item.subject || selectedAssessment()?.subject || '',
    created_at: item.created_at
  };
}

function replaceData(payload) {
  state.data.courses = Array.isArray(payload.courses) ? payload.courses : [];
  state.data.assessments = Array.isArray(payload.assessments) ? payload.assessments : [];
  state.data.students = Array.isArray(payload.students) ? payload.students : [];
  state.data.rubrics = Array.isArray(payload.rubrics) ? payload.rubrics : [];
  state.data.submissions = Array.isArray(payload.submissions) ? payload.submissions : [];
  state.data.corrections = Array.isArray(payload.corrections) ? payload.corrections : [];
  state.data.enrollments = Array.isArray(payload.enrollments) ? payload.enrollments : [];
}

function resetForAssessment(assessment) {
  workspace.assessmentId = assessment ? String(assessment.id) : '';
  workspace.questions = Array.isArray(assessment?.questions) ? assessment.questions : [];
  workspace.objectives = assessment?.objectives || '';
  workspace.instructions = assessment?.instructions || '';
  workspace.referenceMaterial = assessment?.reference_material || '';
  const questions = assessmentQuestions();
  workspace.questionId = String(questions[0]?.id || '');
  workspace.studentId = '';
  workspace.studentName = '';
  workspace.rubricId = '';
  workspace.answerText = '';
  workspace.answerFile = null;
  workspace.materialFile = null;
  workspace.questionSuggestions = [];
  workspace.questionSuggestionDemo = false;
  workspace.activeSubmission = null;
  workspace.correction = null;
  workspace.proposal = null;
  workspace.feedback = '';
  workspace.changeReason = '';
  workspace.step = 1;
  setMessage();
  syncCurrentSelection();
}

function clearSelectedAssessment() {
  resetForAssessment(null);
  workspace.loaded = true;
  workspace.loading = false;
  state.data.submissions = [];
  state.data.corrections = [];
  updateWorkspaceUrl({ assessment: '', submission: '' });
  render();
}

async function loadWorkspaceData(preferredAssessment = null, requestedSubmission = null) {
  loadController?.abort();
  selectionController?.abort();
  const controller = new AbortController();
  loadController = controller;
  const sequence = ++loadSequence;
  workspace.loading = true;
  workspace.error = '';
  workspace.loaded = false;
  render();
  try {
    const params = new URLSearchParams();
    const assessmentId = preferredAssessment ?? new URLSearchParams(window.location.search).get('assessment') ?? '';
    if (assessmentId) params.set('assessment', String(assessmentId));
    params.set('summary', '1');
    const payload = await api.get(`correction-workspace/?${params.toString()}`, { signal: controller.signal });
    if (controller.signal.aborted || sequence !== loadSequence) return;
    replaceData(payload);
    workspace.aiProvider = payload.ai_provider || 'mock';
    workspace.feedbackStyle = ['formal', 'constructivo', 'motivador'].includes(state.feedbackStyle) ? state.feedbackStyle : 'constructivo';
    const selected = payload.selected_assessment || state.data.assessments.find(item => String(item.id) === String(assessmentId)) || null;
    workspace.questions = Array.isArray(payload.questions) ? payload.questions : selected?.questions || [];
    const requestedCourse = new URLSearchParams(window.location.search).get('course');
    workspace.courseFilter = requestedCourse || 'all';
    if (selected) {
      const selectedExists = state.data.assessments.some(item => String(item.id) === String(selected.id));
      state.data.assessments = selectedExists
        ? state.data.assessments.map(item => String(item.id) === String(selected.id) ? { ...item, ...selected } : item)
        : [selected, ...state.data.assessments];
      resetForAssessment({ ...selected, questions: workspace.questions });
    } else {
      resetForAssessment(null);
    }
    const submissionId = requestedSubmission || new URLSearchParams(window.location.search).get('submission');
    if (selected && submissionId) {
      await loadWorkspaceSubmission(submissionId, { signal: controller.signal, sequence });
    }
    workspace.loaded = true;
    workspace.error = '';
    updateWorkspaceUrl({ assessment: workspace.assessmentId, submission: workspace.activeSubmission?.id || '' });
  } catch (error) {
    if (!controller.signal.aborted && sequence === loadSequence) {
      workspace.error = error?.message || 'No pudimos cargar el espacio de trabajo.';
      workspace.loaded = true;
    }
  } finally {
    if (!controller.signal.aborted && sequence === loadSequence) {
      workspace.loading = false;
      if (state.view === 'workspace') render();
    }
  }
}

export async function ensureWorkspaceLoaded() {
  if (workspace.loaded || workspace.loading) return;
  await loadWorkspaceData();
}

async function loadWorkspaceSubmission(id, { signal, sequence, requestId: suppliedRequestId } = {}) {
  if (selectionController && selectionController.signal !== signal) selectionController.abort();
  const controller = signal ? null : new AbortController();
  if (controller) selectionController = controller;
  const requestSignal = signal || controller.signal;
  const requestId = suppliedRequestId ?? ++selectionSequence;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId < 1) return;
  const summary = state.data.corrections.find(item => Number(item.submission) === targetId);
  const [submission, correction] = await Promise.all([
    api.get(`submissions/${targetId}/`, { signal: requestSignal }),
    summary ? api.get(`corrections/${summary.id}/`, { signal: requestSignal }) : Promise.resolve(null)
  ]);
  if (requestSignal.aborted || requestId !== selectionSequence || (sequence != null && sequence !== loadSequence)) return;
  workspace.activeSubmission = submission;
  state.data.submissions = state.data.submissions.map(item => String(item.id) === String(submission.id) ? { ...item, ...submission } : item);
  workspace.answerText = submission.answer_text || '';
  workspace.studentId = submission.student ? String(submission.student) : '';
  workspace.studentName = submission.student_name || submission.student_display_name || '';
  workspace.questionId = submission.question ? String(submission.question) : workspace.questionId;
  workspace.answerFile = null;
  if (correction) {
    workspace.correction = correction;
    workspace.rubricId = correction.rubric ? String(correction.rubric) : '';
    const visible = correction.status === 'approved' && correction.final_result?.criteria?.length
      ? correction.final_result : correction.proposal;
    workspace.proposal = visible ? JSON.parse(JSON.stringify(visible)) : null;
    workspace.feedback = correction.teacher_feedback || visible?.feedback || '';
    workspace.step = 3;
  } else {
    workspace.correction = null;
    workspace.proposal = null;
    workspace.feedback = '';
    workspace.changeReason = '';
    workspace.step = 2;
  }
  syncCurrentSelection();
}

function filteredAssessments() {
  return state.data.assessments.filter(item => item.status !== 'archived' &&
    (workspace.courseFilter === 'all' || String(item.course ?? item.course_id ?? 'unassigned') === workspace.courseFilter));
}

function visibleSubmissions() {
  const query = workspace.search.trim().toLocaleLowerCase('es-AR');
  return state.data.submissions.filter(item => {
    if (String(item.assessment) !== String(workspace.assessmentId)) return false;
    const haystack = `${item.student_display_name || item.student_name || ''} ${item.source_filename || ''} ${item.answer_text || ''}`.toLocaleLowerCase('es-AR');
    if (!haystack.includes(query)) return false;
    const correction = state.data.corrections.find(row => String(row.submission) === String(item.id));
    if (workspace.statusFilter === 'pending') return !correction;
    if (workspace.statusFilter === 'review') return Boolean(correction) && !['approved', 'rejected'].includes(correction.status);
    if (workspace.statusFilter === 'approved') return correction?.status === 'approved';
    if (workspace.statusFilter === 'rejected') return correction?.status === 'rejected';
    return true;
  });
}

function queueStatus(submission) {
  const correction = state.data.corrections.find(row => String(row.submission) === String(submission.id));
  if (correction?.status === 'approved') return 'approved';
  if (correction?.status === 'rejected') return 'rejected';
  if (correction) return 'review';
  return 'pending';
}

function stepper() {
  const steps = [
    ['1', 'Contexto', 'Consigna y criterios'],
    ['2', 'Entrega', 'Respuesta del estudiante'],
    ['3', 'Revisar', 'Editar y aprobar']
  ];
  return `<nav class="teacher-workspace-stepper" aria-label="Etapas del proceso de corrección">${steps.map(([number, label, hint], index) => {
    const step = index + 1;
    const complete = workspace.step > step;
    const active = workspace.step === step;
    return `<button type="button" class="teacher-workspace-step${active ? ' is-active' : ''}${complete ? ' is-complete' : ''}" data-action="workspace-step" data-step="${step}" aria-current="${active ? 'step' : 'false'}" ${step > 1 && !workspace.assessmentId ? 'disabled' : ''}><span class="teacher-workspace-step-number">${complete ? '✓' : number}</span><span><strong>${label}</strong><small>${hint}</small></span></button>`;
  }).join('')}</nav>`;
}

function messageRegion() {
  return `${workspace.error ? `<div class="notice notice-error" role="alert">${escapeHtml(workspace.error)}</div>` : ''}${workspace.message ? `<div class="notice notice-success" role="status" aria-live="polite">${escapeHtml(workspace.message)}</div>` : ''}`;
}

function workspaceHeaderControls() {
  const courses = state.data.courses.filter(item => item.active);
  const assessments = filteredAssessments();
  const selected = selectedAssessment();
  return `<div class="teacher-workspace-toolbar">
    <div class="teacher-workspace-toolbar-fields">
      <div class="form-field"><label for="workspace-course-filter">Materia o curso</label><select id="workspace-course-filter" data-workspace-course ${workspace.loading || actionLocked || workspace.generatingQuestions ? 'disabled' : ''}><option value="all">Todas las materias</option>${courses.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(workspace.courseFilter) ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}${state.data.assessments.some(item => !item.course && !item.course_id) ? `<option value="unassigned" ${workspace.courseFilter === 'unassigned' ? 'selected' : ''}>Sin materia asignada</option>` : ''}</select></div>
      <div class="form-field"><label for="workspace-assessment">Evaluación</label><select id="workspace-assessment" data-workspace-assessment ${workspace.loading || actionLocked || workspace.generatingQuestions || state.data.assessments.length === 0 ? 'disabled' : ''}><option value="">Elegí una evaluación…</option>${assessments.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(workspace.assessmentId) ? 'selected' : ''}>${escapeHtml(item.title)}${item.course_name ? ` · ${escapeHtml(item.course_name)}` : ''}</option>`).join('')}</select></div>
    </div>
    <div class="teacher-workspace-toolbar-actions">
      ${selected ? `<div class="teacher-workspace-assessment-meta"><span>${statusPill(selected.status)}</span><span>${escapeHtml(selected.subject || selected.course_name || 'Sin materia indicada')}</span><button class="text-link" type="button" data-action="edit-assessment" data-id="${escapeHtml(selected.id)}">Editar ↗</button></div>` : ''}
      <button class="btn btn-primary btn-small" type="button" data-action="new-assessment">＋ Nueva evaluación</button>
    </div>
  </div>`;
}

function contextView() {
  const selected = selectedAssessment();
  const questions = assessmentQuestions();
  const rubricOptions = state.data.rubrics.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(workspace.rubricId) ? 'selected' : ''}>${escapeHtml(item.title)}</option>`).join('');
  const suggestions = workspace.questionSuggestions.map((item, index) => `<article class="teacher-workspace-suggestion"><div class="teacher-workspace-suggestion-head"><strong>Consigna sugerida ${index + 1}</strong><button class="btn btn-ghost btn-small" type="button" data-action="workspace-discard-question" data-index="${index}">Descartar</button></div><label for="workspace-suggestion-${index}">Consigna propuesta (editable)</label><textarea id="workspace-suggestion-${index}" data-workspace-suggestion="${index}" data-field="prompt" rows="3" maxlength="5000">${escapeHtml(item.prompt)}</textarea><p>${escapeHtml(item.rationale || 'Propuesta editable; revisá que corresponda a los objetivos de la evaluación.')}</p><div class="teacher-workspace-suggestion-meta"><label for="workspace-suggestion-score-${index}">Puntaje máximo</label><input id="workspace-suggestion-score-${index}" type="number" min="0.5" max="1000" step="0.5" data-workspace-suggestion="${index}" data-field="max_score" value="${escapeHtml(item.max_score)}"><button class="btn btn-secondary btn-small" type="button" data-action="workspace-accept-question" data-index="${index}" ${workspace.generatingQuestions || actionLocked ? 'disabled' : ''}>Agregar a la evaluación</button></div></article>`).join('');
  return `<section class="teacher-workspace-section" aria-labelledby="workspace-context-title"><div class="teacher-workspace-section-heading"><div><span class="view-kicker">CONTEXTO Y CRITERIOS</span><h2 id="workspace-context-title">Contexto y criterios</h2><p>Consigna, materiales y rúbrica.</p></div></div>
    <div class="panel teacher-workspace-context-panel"><div class="panel-head"><div><h3>Contexto y criterios</h3><p>${escapeHtml(selected?.title || 'Elegí una evaluación para continuar')}</p></div></div><div class="panel-body">
      ${selected ? `<form id="workspace-context-form"><div class="form-grid"><div class="form-field full"><label for="workspace-objectives">Objetivos de aprendizaje</label><small class="field-hint">¿Qué deberían comprender o poder hacer los estudiantes?</small><textarea id="workspace-objectives" name="objectives" rows="3" maxlength="5000" data-workspace-field="objectives" placeholder="Ej. comparar dos teorías y justificar una conclusión con evidencia.">${escapeHtml(workspace.objectives)}</textarea></div><div class="form-field full"><label for="workspace-instructions">¿Qué querés evaluar?</label><textarea id="workspace-instructions" name="instructions" rows="4" maxlength="8000" data-workspace-field="instructions" placeholder="Describí el tema, la consigna o qué debería resolver el estudiante.">${escapeHtml(workspace.instructions)}</textarea></div></div>
      <section class="teacher-workspace-question-list" aria-labelledby="workspace-questions-title"><div class="section-row"><div><h3 id="workspace-questions-title">Consignas</h3><p>Consignas guardadas para esta evaluación.</p></div><button class="text-link" type="button" data-action="edit-assessment" data-id="${escapeHtml(selected.id)}">Gestionar consignas ↗</button></div>${questions.length ? `<ol class="teacher-workspace-question-items">${questions.map(item => `<li class="teacher-workspace-question"><span><strong>${escapeHtml(item.prompt)}</strong><small>${escapeHtml(formatNumber(item.max_score))} pts</small></span></li>`).join('')}</ol>` : '<p class="muted">Todavía no hay consignas guardadas para esta evaluación. Podés agregarlas desde el editor.</p>'}<details class="teacher-workspace-question-assistance"><summary><span><strong>Proponer consignas con MaestrIA</strong><small>Ideas editables a partir del contexto y los apuntes.</small></span><span aria-hidden="true">＋</span></summary><div><p class="field-hint">Revisá las propuestas y agregá solo las que quieras conservar.</p><button class="btn btn-secondary btn-small" type="button" data-action="workspace-suggest-questions" ${workspace.generatingQuestions || actionLocked ? 'disabled' : ''}>${workspace.generatingQuestions ? 'Preparando ideas…' : 'Proponer 3 consignas'}</button></div></details></section>
      ${workspace.questionSuggestionDemo ? '<p class="field-hint">Modo demostración: estas consignas son ejemplos editables; no fueron generadas por un modelo real.</p>' : ''}${suggestions ? `<div class="teacher-workspace-suggestions" aria-label="Consignas propuestas">${suggestions}</div>` : ''}
      <div class="teacher-workspace-material-row"><div><strong>Apuntes y materiales de la cursada</strong><small>PDF con texto seleccionable, DOCX, TXT o MD · máximo 5 MB</small>${workspace.materialFile ? `<small class="field-hint">Seleccionado: ${escapeHtml(workspace.materialFile.name)}</small>` : ''}</div><label class="btn btn-secondary btn-small teacher-workspace-upload-button" for="workspace-material-file">Elegir archivo<input id="workspace-material-file" type="file" accept="${ACCEPTED_FILES}" data-workspace-file="material"></label><button class="btn btn-primary btn-small" type="button" data-action="workspace-import-reference" ${workspace.materialFile && !actionLocked ? '' : 'disabled'}>${actionLocked ? 'Procesando…' : 'Incorporar material'}</button></div>
      <details class="teacher-workspace-more-details"><summary>Más detalles</summary><div class="teacher-workspace-more-details-body">${workspace.referenceMaterial ? `<details class="teacher-workspace-reference-preview"><summary>Ver material incorporado (${workspace.referenceMaterial.length.toLocaleString('es-AR')} caracteres)</summary><pre>${escapeHtml(workspace.referenceMaterial.slice(0, 12000))}${workspace.referenceMaterial.length > 12000 ? '\n\n[Vista previa recortada; se conserva el texto completo.]' : ''}</pre></details>` : '<p class="field-hint">Todavía no hay material de referencia incorporado.</p>'}<div class="form-field"><label for="workspace-material-mode">Al incorporar el archivo</label><select id="workspace-material-mode" data-workspace-material-mode><option value="append" ${workspace.materialMode === 'append' ? 'selected' : ''}>Agregar al material existente</option><option value="replace" ${workspace.materialMode === 'replace' ? 'selected' : ''}>Reemplazar el material existente</option></select></div>${rubricOptions ? `<div class="form-field teacher-workspace-rubric-select"><label for="workspace-rubric">Rúbrica para la corrección</label><select id="workspace-rubric" data-workspace-rubric><option value="">Usar criterios generales de la consigna</option>${rubricOptions}</select></div>${selectedRubric() ? `<div class="teacher-workspace-rubric-summary"><strong>${escapeHtml(selectedRubric().title)}</strong><span>${(selectedRubric().criteria || []).length} criterios</span><details><summary>Ver criterios</summary><ul>${(selectedRubric().criteria || []).map(item => `<li>${escapeHtml(item.name)} <small>${escapeHtml(formatNumber(item.max_score))} pts</small></li>`).join('')}</ul></details></div>` : ''}` : '<p class="muted">Todavía no hay rúbricas disponibles.</p>'}<p class="field-hint">Para crear o modificar una rúbrica, entrá al editor de esta evaluación.</p><button class="btn btn-ghost btn-small" type="button" data-action="workspace-manage-rubrics">Configurar rúbricas ↗</button></div></details>
      <div class="teacher-workspace-form-actions"><button class="btn btn-primary" type="submit" ${actionLocked ? 'disabled' : ''}>${actionLocked ? 'Guardando…' : 'Guardar contexto'}</button></div></form>` : `<div class="empty-state"><h3>Primero necesitamos una evaluación</h3><p>Creá una evaluación, aunque sea sencilla. Después vas a poder sumar materiales, elegir una entrega y generar una propuesta de corrección.</p><button class="btn btn-primary" type="button" data-action="new-assessment">Crear evaluación</button></div>`}
    </div></div></section>`;
}

function queueRowsMarkup() {
  return visibleSubmissions().map(item => {
    const status = queueStatus(item);
    const active = String(workspace.activeSubmission?.id) === String(item.id);
    return `<button type="button" class="teacher-workspace-queue-item${active ? ' is-active' : ''}" data-action="workspace-select-submission" data-id="${escapeHtml(item.id)}" aria-pressed="${active}"><span class="teacher-workspace-queue-avatar" aria-hidden="true">${escapeHtml((item.student_display_name || item.student_name || 'E').slice(0, 1).toLocaleUpperCase('es-AR'))}</span><span class="teacher-workspace-queue-copy"><strong>${escapeHtml(item.student_display_name || item.student_name || 'Estudiante sin identificar')}</strong><small>${escapeHtml(item.source_filename || (item.answer_text || 'Entrega').slice(0, 68))}</small><small>${escapeHtml(date(item.created_at, true))}</small></span>${statusPill(status)}</button>`;
  }).join('') || '<div class="empty-state"><h3>Aún no hay entregas para mostrar</h3><p>Cuando guardes una respuesta, aparecerá acá para poder retomarla.</p></div>';
}

function queueView() {
  const submissions = visibleSubmissions();
  const allForAssessment = state.data.submissions.filter(item => String(item.assessment) === String(workspace.assessmentId));
  const reviewed = submissions.filter(item => ['review', 'approved', 'rejected'].includes(queueStatus(item))).length;
  const approved = submissions.filter(item => queueStatus(item) === 'approved').length;
  const questions = assessmentQuestions();
  const availableStudents = state.data.students.filter(item => item.active);
  const editingExistingSubmission = Boolean(workspace.activeSubmission?.id);
  const questionOptions = questions.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(workspace.questionId) ? 'selected' : ''}>${escapeHtml(item.prompt)}</option>`).join('');
  const studentOptions = availableStudents.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(workspace.studentId) ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
  const rows = queueRowsMarkup();
  return `<section class="teacher-workspace-section" aria-labelledby="workspace-submission-title"><div class="teacher-workspace-section-heading"><div><span class="view-kicker">ENTREGA DEL ESTUDIANTE</span><h2 id="workspace-submission-title">${editingExistingSubmission ? 'Editar entrega' : 'Entrega del estudiante'}</h2><p>${editingExistingSubmission ? 'Modificá la respuesta. La evaluación, consigna y estudiante originales se conservan.' : 'Elegí a quién corresponde y cargá su respuesta.'}</p></div></div><div class="teacher-workspace-delivery-grid"><div class="panel"><div class="panel-head"><div><h3>${editingExistingSubmission ? 'Editar entrega existente' : 'Nueva entrega'}</h3><p>${escapeHtml(selectedAssessment()?.title || 'Evaluación seleccionada')}</p></div></div><div class="panel-body"><form id="workspace-submission-form"><div class="teacher-workspace-student-fields"><div class="form-field"><label for="workspace-student-select">Estudiante <span class="muted">(o escribí un nombre)</span></label><select id="workspace-student-select" data-workspace-student ${editingExistingSubmission ? 'disabled aria-describedby="workspace-identity-locked"' : ''}><option value="">Elegir estudiante…</option>${studentOptions}</select></div><div class="form-field"><label for="workspace-student-name">Nombre identificador</label><input id="workspace-student-name" type="text" maxlength="180" value="${escapeHtml(workspace.studentName)}" data-workspace-field="studentName" placeholder="Ej. Estudiante 01" ${editingExistingSubmission ? 'readonly aria-describedby="workspace-identity-locked"' : ''}></div></div>${editingExistingSubmission ? '<p id="workspace-identity-locked" class="field-hint">La identidad del estudiante queda vinculada a la entrega original y no se puede modificar desde esta edición.</p>' : ''}<details class="teacher-workspace-delivery-options"><summary>Opciones de la entrega <span class="muted">(consigna y tono)</span></summary><div class="teacher-workspace-delivery-options-fields"><div class="form-field"><label for="workspace-question-select">Consigna específica</label><select id="workspace-question-select" data-workspace-question-select ${editingExistingSubmission ? 'disabled' : ''}><option value="">Usar consigna general</option>${questionOptions}</select></div><div class="form-field"><label for="workspace-feedback-style">Tono de la devolución</label><select id="workspace-feedback-style" data-workspace-feedback-style><option value="formal" ${workspace.feedbackStyle === 'formal' ? 'selected' : ''}>Formal / académico</option><option value="constructivo" ${workspace.feedbackStyle === 'constructivo' ? 'selected' : ''}>Constructivo / orientador</option><option value="motivador" ${workspace.feedbackStyle === 'motivador' ? 'selected' : ''}>Motivador / empático</option></select></div></div></details><div class="form-field full"><label for="workspace-answer-text">Respuesta del estudiante</label><textarea id="workspace-answer-text" rows="8" maxlength="50000" data-workspace-field="answerText" placeholder="Pegá acá la respuesta. Se conservará el texto original para contrastarlo con la propuesta.">${escapeHtml(workspace.answerText)}</textarea></div><div class="form-field full"><label for="workspace-answer-file">¿Tenés un archivo? TXT, MD, PDF con texto seleccionable o DOCX · máximo 5 MB</label><input id="workspace-answer-file" type="file" accept="${ACCEPTED_FILES}" data-workspace-file="answer" ${editingExistingSubmission ? 'disabled' : ''}>${workspace.answerFile ? `<small class="field-hint">Seleccionado: ${escapeHtml(workspace.answerFile.name)} <button type="button" class="text-link" data-action="workspace-remove-answer-file">Quitar</button></small>` : ''}${editingExistingSubmission ? '<small class="field-hint">Para reevaluar una entrega existente, editá el texto extraído. El archivo fuente original se conserva.</small>' : ''}</div><details class="teacher-workspace-privacy-note"><summary>Privacidad y uso de IA</summary><p>Antes de enviar una respuesta a un proveedor de IA, evitá incluir datos personales innecesarios. Verificá la configuración del proveedor y revisá el texto extraído antes de confiar en una propuesta.</p></details><div class="teacher-workspace-form-actions"><button class="btn btn-primary" type="submit" ${actionLocked ? 'disabled' : ''}>${actionLocked ? 'Procesando…' : (editingExistingSubmission ? 'Guardar y generar nueva propuesta' : 'Guardar y proponer corrección')}</button></div><p class="field-hint">La generación puede tardar. La IA propone; vos revisás y decidís la calificación final.</p></form></div></div>
    <aside class="panel teacher-workspace-queue-panel"><div class="panel-head"><div><h3>Entregas</h3><p data-workspace-queue-count>${submissions.length} registradas · ${approved} aprobadas</p></div></div><div class="panel-body"><div class="teacher-workspace-progress"><progress class="teacher-workspace-progress-bar" data-workspace-queue-progress max="100" value="${submissions.length ? Math.round(reviewed / submissions.length * 100) : 0}" aria-label="Entregas revisadas"></progress><small data-workspace-queue-progress-text>${reviewed} de ${submissions.length} revisadas</small></div><label class="teacher-workspace-queue-filter" for="workspace-search">Buscar entrega<input id="workspace-search" type="search" value="${escapeHtml(workspace.search)}" data-workspace-search placeholder="Nombre, archivo o primeras palabras de la respuesta"></label><label class="teacher-workspace-queue-filter" for="workspace-status">Estado<select id="workspace-status" data-workspace-status><option value="all" ${workspace.statusFilter === 'all' ? 'selected' : ''}>Todas</option><option value="pending" ${workspace.statusFilter === 'pending' ? 'selected' : ''}>Pendientes</option><option value="review" ${workspace.statusFilter === 'review' ? 'selected' : ''}>En revisión</option><option value="rejected" ${workspace.statusFilter === 'rejected' ? 'selected' : ''}>Rechazadas</option><option value="approved" ${workspace.statusFilter === 'approved' ? 'selected' : ''}>Aprobadas</option></select></label><div class="teacher-workspace-queue-list" aria-live="polite">${rows || '<div class="empty-state"><h3>Aún no hay entregas para mostrar</h3><p>Cuando guardes una respuesta, aparecerá acá para poder retomarla.</p></div>'}</div></div></aside></div></section>`;
}

function reviewView() {
  const submission = workspace.activeSubmission;
  const correction = workspace.correction;
  const proposal = workspace.proposal;
  if (!submission || !correction || !proposal) {
    return `<section class="teacher-workspace-section"><div class="empty-state"><h2>Elegí una entrega para revisar</h2><p>Volvé a Entregas y seleccioná una respuesta, o cargá una nueva para generar su propuesta.</p><button class="btn btn-primary" type="button" data-action="workspace-back-step" data-step="2">Ver entregas</button></div></section>`;
  }
  const approved = correction.status === 'approved';
  const readonly = approved;
  const questions = assessmentQuestions();
  const question = questions.find(item => String(item.id) === String(submission.question || workspace.questionId));
  const rubric = selectedRubric();
  const criteria = Array.isArray(proposal.criteria) ? proposal.criteria : [];
  const score = criteria.reduce((sum, item) => sum + Number(item.score || 0), 0);
  const maxScore = criteria.reduce((sum, item) => sum + Number(item.max_score || 0), 0);
  const criteriaMarkup = criteria.map((item, index) => `<fieldset class="teacher-workspace-criterion"><legend>${escapeHtml(item.criterion || `Criterio ${index + 1}`)}</legend><div class="teacher-workspace-criterion-head"><span>${item.weight != null ? `Ponderación ${escapeHtml(formatNumber(item.weight))}%` : 'Criterio de evaluación'}</span><strong>Máximo ${escapeHtml(formatNumber(item.max_score))} puntos</strong></div><div class="form-grid"><div class="form-field"><label for="workspace-score-${index}">Puntaje</label><input id="workspace-score-${index}" type="number" min="0" max="${Number(item.max_score || 0)}" step="0.01" value="${escapeHtml(item.score)}" data-workspace-criterion="${index}" data-field="score" ${readonly ? 'disabled' : ''}></div><div class="form-field"><label for="workspace-level-${index}">Nivel sugerido</label><input id="workspace-level-${index}" type="text" value="${escapeHtml(item.level || 'Sin nivel sugerido')}" disabled></div><div class="form-field full"><span class="teacher-workspace-evidence-label">Evidencia literal en la respuesta</span><blockquote class="teacher-workspace-evidence">${escapeHtml(item.evidence || 'No se encontró evidencia literal suficiente. Revisá manualmente.')}</blockquote></div><div class="form-field full"><label for="workspace-justification-${index}">Justificación del puntaje</label><textarea id="workspace-justification-${index}" rows="3" data-workspace-criterion="${index}" data-field="justification" ${readonly ? 'disabled' : ''}>${escapeHtml(item.justification || '')}</textarea></div></div></fieldset>`).join('');
  return `<section class="teacher-workspace-section teacher-workspace-review" aria-labelledby="workspace-review-title"><header class="teacher-workspace-review-header"><div><span class="view-kicker">PASO 3 · REVISIÓN DOCENTE</span><h2 id="workspace-review-title">${escapeHtml(submission.student_display_name || submission.student_name || 'Estudiante sin identificar')}</h2><p>${escapeHtml([selectedAssessment()?.course_name, selectedAssessment()?.title, approved ? 'Resultado aprobado' : 'Propuesta pendiente de tu revisión'].filter(Boolean).join(' · '))}</p><label class="teacher-workspace-review-picker" for="workspace-review-submission">Entrega a revisar<select id="workspace-review-submission" data-workspace-review-submission>${state.data.submissions.filter(item => String(item.assessment) === String(workspace.assessmentId)).map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(submission.id) ? 'selected' : ''}>${escapeHtml(item.student_display_name || item.student_name || 'Estudiante')} · #${escapeHtml(item.id)}</option>`).join('')}</select></label></div><div class="teacher-workspace-review-actions"><span>${statusPill(correction.status)}</span><button class="btn btn-secondary btn-small" type="button" data-action="workspace-back-step" data-step="2">← Entregas</button></div></header>
  ${proposal.demo ? '<div class="notice notice-warning" role="note"><strong>Propuesta demostrativa.</strong> El proveedor está en modo MOCK. No se puede aprobar ni utilizar como calificación real.</div>' : ''}
  ${(proposal.warnings || []).length ? `<details class="teacher-workspace-warnings"><summary>Advertencias para revisar (${proposal.warnings.length})</summary><ul>${proposal.warnings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>` : ''}
  <div class="teacher-workspace-review-grid"><article class="panel teacher-workspace-source"><div class="panel-head"><div><h3>Respuesta original</h3><p>El contenido que entregó el estudiante no se modifica durante la evaluación.</p></div></div><div class="panel-body"><div class="teacher-workspace-source-block"><span>CONSIGNA</span><p>${escapeHtml(question?.prompt || selectedAssessment()?.instructions || 'No hay una consigna específica guardada.')}</p></div>${selectedAssessment()?.objectives ? `<div class="teacher-workspace-source-block"><span>OBJETIVOS DE APRENDIZAJE</span><p>${escapeHtml(selectedAssessment().objectives)}</p></div>` : ''}${rubric ? `<div class="teacher-workspace-source-block"><span>CRITERIOS ACORDADOS</span><strong>${escapeHtml(rubric.title)}</strong><ul>${(rubric.criteria || []).map(item => `<li>${escapeHtml(item.name)} <small>${escapeHtml(formatNumber(item.max_score))} pts</small></li>`).join('')}</ul></div>` : ''}<div class="teacher-workspace-source-block"><span>RESPUESTA DEL ESTUDIANTE</span><blockquote>${escapeHtml(submission.answer_text || 'No hay texto disponible.')}</blockquote></div>${submission.source_filename ? `<p class="field-hint">Archivo de origen: ${escapeHtml(submission.source_filename)}</p>` : ''}</div></article>
  <article class="panel teacher-workspace-proposal"><div class="panel-head"><div><h3>${approved ? 'Resultado aprobado' : 'Propuesta de MaestrIA'}</h3><p>${approved ? 'Esta es la devolución final guardada.' : 'Editá puntajes, evidencias y comentarios. Nada es definitivo hasta aprobarlo.'}</p></div></div><div class="panel-body"><div class="teacher-workspace-total"><span>Puntaje total</span><strong>${escapeHtml(formatNumber(score))}<small> / ${escapeHtml(formatNumber(maxScore))} puntos</small></strong></div><p class="teacher-workspace-summary">${escapeHtml(proposal.summary || 'Sin síntesis adicional.')}</p>${proposal.strengths?.length ? `<div class="teacher-workspace-highlights"><h4>Lo que logró</h4><ul>${proposal.strengths.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>` : ''}<form id="workspace-approve-form">${criteriaMarkup}${proposal.improvement_suggestions?.length ? `<div class="teacher-workspace-highlights"><h4>Ideas para seguir mejorando</h4><ul>${proposal.improvement_suggestions.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>` : ''}<div class="form-field full"><label for="workspace-feedback">Retroalimentación para el estudiante</label><textarea id="workspace-feedback" rows="5" data-workspace-feedback ${readonly ? 'disabled' : ''}>${escapeHtml(workspace.feedback || proposal.feedback || '')}</textarea></div>${!approved ? `<div class="form-field full"><label for="workspace-change-reason">Motivo si ajustaste la puntuación</label><textarea id="workspace-change-reason" rows="2" data-workspace-change-reason placeholder="Explicá el criterio pedagógico que justifica el cambio (si corresponde)." ${readonly ? 'disabled' : ''}>${escapeHtml(workspace.changeReason)}</textarea><small class="field-hint">Solo es obligatorio cuando modificás uno o más puntajes de la propuesta (mínimo 8 caracteres).</small></div>` : ''}<div class="teacher-workspace-form-actions">${approved ? `<span class="teacher-workspace-approved-label">✓ Resultado final guardado</span><button class="btn btn-primary" type="button" data-action="workspace-share">Compartir o guardar devolución</button><button class="btn btn-secondary" type="button" data-action="workspace-export">Exportar Markdown</button>` : `<button class="btn btn-primary" type="submit" ${readonly || actionLocked || proposal.demo ? 'disabled' : ''}>${actionLocked ? 'Guardando…' : 'Aprobar y guardar resultado'}</button><button class="btn btn-secondary" type="button" data-action="workspace-copy">Copiar borrador</button>`}</div></form></div></article></div><div class="teacher-workspace-review-footer"><button class="btn btn-secondary" type="button" data-action="workspace-back-step" data-step="2">← Volver a las entregas</button><button class="btn btn-ghost" type="button" data-action="workspace-open-corrections">Ver historial de correcciones →</button></div></section>`;
}

export function renderWorkspace() {
  if (workspace.loading) return `<section class="panel" aria-live="polite" aria-busy="true"><div class="panel-body"><p>Cargando espacio de trabajo…</p><div class="skeleton-grid" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div></div></section>`;
  if (workspace.error && !workspace.loaded) return `<section class="panel" role="alert"><div class="panel-body"><h2>No se pudo cargar el espacio de trabajo</h2><p>${escapeHtml(workspace.error)}</p><button class="btn btn-primary" type="button" data-action="workspace-retry">Reintentar</button></div></section>`;
  const current = workspace.step === 3
    ? reviewView()
    : selectedAssessment()
      ? `<div class="teacher-workspace-intake-grid">${contextView()}${queueView()}</div>`
      : contextView();
  return `<header class="view-header teacher-workspace-header"><div class="view-heading-copy"><p class="view-kicker">ESPACIO DE TRABAJO</p><h1>Vamos a corregir con criterio.</h1><p>Elegí la materia, prepará el contexto y revisá cada propuesta antes de aprobarla.</p></div><div class="view-actions"><button class="btn btn-secondary btn-small" type="button" data-action="workspace-open-corrections">Historial de correcciones</button></div></header>${workspaceHeaderControls()}${selectedAssessment() && workspace.aiProvider === 'mock' ? '<p class="notice notice-warning" role="note"><strong>Modo de práctica.</strong> Las propuestas son simuladas y no deben usarse para calificar respuestas reales.</p>' : ''}${selectedAssessment()?.title?.startsWith('Ejemplo MaestrIA') ? '<details class="teacher-workspace-practice-help"><summary>ⓘ Cómo usar el ejemplo de práctica</summary><p>Este conjunto contiene un curso, estudiantes y respuestas ficticios guardados en tu cuenta. No se subió un archivo de respuesta: los textos de práctica se guardan como texto.</p><ol><li>Elegí una entrega pendiente y revisá la consigna y la rúbrica.</li><li>Generá la propuesta con un proveedor de IA real configurado; el modo MOCK está bloqueado para este conjunto.</li><li>Revisá la evidencia y la justificación de cada criterio. Podés editar los puntajes y la devolución.</li><li>Aprobá para guardar la decisión docente; después podés compartir la devolución o guardarla como PDF desde la impresión del navegador.</li></ol><p class="field-hint">Si falla la generación, revisá el proveedor, las claves y los permisos de procesamiento externo del servidor.</p></details>' : ''}${selectedAssessment() ? stepper() : state.data.assessments.length ? '<p class="notice" role="alert">Seleccioná una evaluación para continuar.</p>' : ''}${messageRegion()}${workspace.loadingSelection ? '<p class="teacher-workspace-loading-selection" role="status" aria-live="polite">Cargando la entrega seleccionada…</p>' : ''}${current}<p class="app-disclaimer">MaestrIA asiste en la corrección; el docente revisa y aprueba la calificación final.</p>`;
}

async function withActionLock(operation) {
  if (actionLocked) return;
  actionLocked = true;
  try { await operation(); }
  finally { actionLocked = false; if (state.view === 'workspace') render(); }
}

async function saveContext() {
  const assessment = selectedAssessment();
  if (!assessment) throw new Error('Seleccioná una evaluación primero.');
  const updated = await api.patch(`assessments/${assessment.id}/`, {
    objectives: workspace.objectives.trim(),
    instructions: workspace.instructions.trim(),
    reference_material: workspace.referenceMaterial,
    title: assessment.title,
    subject: assessment.subject,
    level: assessment.level,
    status: assessment.status,
    course: assessment.course || null
  });
  state.data.assessments = state.data.assessments.map(item => String(item.id) === String(updated.id) ? { ...item, ...updated } : item);
  return updated;
}

async function importReference() {
  const assessment = selectedAssessment();
  const file = workspace.materialFile;
  if (!assessment || !file) throw new Error('Seleccioná una evaluación y un archivo de referencia.');
  validateFile(file);
  await saveContext();
  const form = new FormData();
  form.set('file', file);
  form.set('mode', workspace.materialMode);
  const result = await api.upload(`assessments/${assessment.id}/import-reference/`, form);
  workspace.referenceMaterial = result.reference_material || workspace.referenceMaterial;
  workspace.materialFile = null;
  state.data.assessments = state.data.assessments.map(item => String(item.id) === String(assessment.id) ? { ...item, reference_material: workspace.referenceMaterial } : item);
  setMessage(`Material incorporado: ${Number(result.chars || 0).toLocaleString('es-AR')} caracteres extraídos.`);
}

async function suggestQuestions() {
  const assessment = selectedAssessment();
  if (!assessment) throw new Error('Seleccioná una evaluación primero.');
  workspace.generatingQuestions = true;
  render();
  try {
    await saveContext();
    const result = await api.post(`assessments/${assessment.id}/generate-questions/`, { count: 3 }, { timeoutMs: 180000 });
    workspace.questionSuggestions = Array.isArray(result.questions) ? result.questions.map(item => ({ ...item })) : [];
    workspace.questionSuggestionDemo = Boolean(result.demo);
    if (!workspace.questionSuggestions.length) throw new Error('No recibimos preguntas válidas. Revisá la configuración de IA e intentá de nuevo.');
    setMessage(result.demo ? 'Se prepararon consignas de ejemplo. Editalas antes de incorporarlas.' : 'Revisá las consignas sugeridas y agregá solo las que quieras conservar.');
  } finally {
    workspace.generatingQuestions = false;
  }
}

async function acceptQuestion(index) {
  const assessment = selectedAssessment();
  const suggestion = workspace.questionSuggestions[index];
  if (!assessment || !suggestion) return;
  const prompt = String(suggestion.prompt || '').trim();
  const maxScore = Number(suggestion.max_score || 10);
  if (prompt.length < 4 || !Number.isFinite(maxScore) || maxScore < 0.5 || maxScore > 1000) throw new Error('Revisá el texto de la consigna y su puntaje máximo.');
  if (assessmentQuestions().some(item => String(item.prompt || '').trim().toLocaleLowerCase('es-AR') === prompt.toLocaleLowerCase('es-AR'))) throw new Error('Esta consigna ya está incluida en la evaluación.');
  const position = assessmentQuestions().reduce((max, item) => Math.max(max, Number(item.position || 0)), 0) + 1;
  const created = await api.post('questions/', { assessment: Number(assessment.id), prompt, max_score: maxScore, position });
  workspace.questions = [...workspace.questions, created].sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  workspace.questionId = String(created.id);
  workspace.questionSuggestions = workspace.questionSuggestions.filter((_, itemIndex) => itemIndex !== index);
  state.data.assessments = state.data.assessments.map(item => String(item.id) === String(assessment.id) ? { ...item, questions: workspace.questions } : item);
  setMessage('Consigna agregada a la evaluación y seleccionada para la próxima entrega.');
}

function validateFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) throw new Error('El archivo supera el máximo permitido de 5 MB.');
  if (!/\.(txt|md|pdf|docx)$/i.test(file.name)) throw new Error('Formato no admitido. Usá PDF, DOCX, TXT o MD.');
}

async function createSubmissionAndCorrection(form) {
  const assessment = selectedAssessment();
  if (!assessment) throw new Error('Seleccioná una evaluación primero.');
  const studentName = workspace.studentName.trim();
  if (!workspace.answerText.trim() && !workspace.answerFile) throw new Error('Pegá la respuesta o adjuntá un archivo antes de generar la corrección.');
  if (!workspace.studentId && !studentName) throw new Error('Seleccioná un estudiante o indicá un nombre para identificar la entrega.');
  validateFile(workspace.answerFile);
  setMessage();
  workspace.correction = null;
  workspace.proposal = null;
  workspace.feedback = '';
  workspace.changeReason = '';
  syncCurrentSelection();
  await saveContext();
  let submission;
  const existing = workspace.activeSubmission && String(workspace.activeSubmission.assessment) === String(assessment.id);
  if (existing && workspace.answerFile) {
    throw new Error('Para modificar una entrega existente, editá el texto extraído. El archivo fuente original se conserva.');
  }
  if (existing) {
    // PATCH must contain only editable fields. Assessment, question and student
    // are immutable identities; resending them from UI state can look like an
    // accidental reassignment (for example, when a selector was reset).
    submission = await api.patch(`submissions/${workspace.activeSubmission.id}/`, {
      answer_text: workspace.answerText.trim()
    });
  } else if (workspace.answerFile) {
    const payload = new FormData();
    payload.set('file', workspace.answerFile);
    payload.set('assessment', String(assessment.id));
    if (workspace.questionId) payload.set('question', workspace.questionId);
    if (workspace.studentId) payload.set('student', workspace.studentId);
    if (studentName) payload.set('student_name', studentName);
    submission = await api.upload('submissions/import-file/', payload, { timeoutMs: 90000 });
  } else {
    const data = {
      assessment: Number(assessment.id),
      question: workspace.questionId ? Number(workspace.questionId) : null,
      student: workspace.studentId ? Number(workspace.studentId) : null,
      student_name: studentName,
      answer_text: workspace.answerText.trim(),
      source_type: 'text'
    };
    submission = await api.post('submissions/', data);
  }
  workspace.activeSubmission = submission;
  syncCurrentSelection();
  const correction = await api.post(`submissions/${submission.id}/generate-correction/`, {
    rubric_id: workspace.rubricId ? Number(workspace.rubricId) : null,
    feedback_style: workspace.feedbackStyle || 'constructivo'
  }, { timeoutMs: 180000 });
  workspace.correction = correction;
  workspace.proposal = correction.proposal ? JSON.parse(JSON.stringify(correction.proposal)) : null;
  workspace.feedback = correction.teacher_feedback || correction.proposal?.feedback || '';
  workspace.changeReason = '';
  workspace.answerFile = null;
  workspace.step = 3;
  state.data.submissions = [submission, ...state.data.submissions.filter(item => String(item.id) !== String(submission.id))];
  const summary = summarizeCorrection(correction);
  state.data.corrections = [summary, ...state.data.corrections.filter(item => String(item.id) !== String(summary.id) && String(item.submission) !== String(summary.submission))];
  syncCurrentSelection();
  updateWorkspaceUrl({ assessment: assessment.id, submission: submission.id });
  setMessage('La propuesta está lista. Revisá cada criterio antes de aprobarla.');
}

async function selectSubmission(id) {
  selectionController?.abort();
  const controller = new AbortController();
  selectionController = controller;
  const requestId = ++selectionSequence;
  setMessage();
  workspace.error = '';
  workspace.loadingSelection = true;
  render();
  try {
    await loadWorkspaceSubmission(id, { signal: controller.signal, requestId });
    if (controller.signal.aborted || requestId !== selectionSequence) return;
    workspace.loadingSelection = false;
    updateWorkspaceUrl({ assessment: workspace.assessmentId, submission: id });
    setMessage(workspace.correction ? '' : 'Entrega cargada. Podés completar o revisar su respuesta y generar una propuesta.');
  } catch (error) {
    if (!controller.signal.aborted && requestId === selectionSequence) workspace.error = error?.message || 'No se pudo cargar el detalle de la entrega.';
  } finally {
    if (requestId === selectionSequence) {
      workspace.loadingSelection = false;
      if (state.view === 'workspace') render();
    }
  }
}

async function approveCorrection(form) {
  const correction = workspace.correction;
  const proposal = workspace.proposal;
  if (!correction || !proposal || !workspace.activeSubmission || proposal.demo) return;
  const criteria = proposal.criteria || [];
  const originalCriteria = correction.proposal?.criteria || [];
  const changed = criteria.length !== originalCriteria.length || criteria.some((item, index) =>
    Number(item.score) !== Number(originalCriteria[index]?.score)
  );
  for (const item of criteria) {
    const value = Number(item.score);
    const maximum = Number(item.max_score);
    if (!Number.isFinite(value) || !Number.isFinite(maximum) || value < 0 || value > maximum) {
      throw new Error('Cada puntaje debe ser un número válido entre 0 y el máximo de su criterio.');
    }
  }
  const reason = workspace.changeReason.trim();
  if (changed && reason.length < 8) throw new Error('Explicá brevemente por qué modificaste el puntaje (al menos 8 caracteres).');
  const result = await api.post(`corrections/${correction.id}/approve/`, {
    final_result: proposal,
    teacher_feedback: workspace.feedback,
    change_reason: reason
  }, { timeoutMs: 90000 });
  workspace.correction = result;
  workspace.proposal = result.final_result || proposal;
  workspace.feedback = result.teacher_feedback || workspace.feedback;
  state.data.corrections = [summarizeCorrection(result), ...state.data.corrections.filter(item => String(item.id) !== String(result.id))];
  state.data.submissions = state.data.submissions.map(item => String(item.id) === String(workspace.activeSubmission.id) ? { ...item, status: 'approved' } : item);
  syncCurrentSelection();
  setMessage('Corrección aprobada y guardada en el historial.');
}

export async function handleWorkspaceAction(button) {
  const action = button.dataset.action;
  const id = button.dataset.id;
  const index = Number(button.dataset.index);
  if (!action?.startsWith('workspace-')) return false;
  try {
    if (action === 'workspace-retry') {
      workspace.loaded = false;
      workspace.error = '';
      await ensureWorkspaceLoaded();
    } else if (action === 'workspace-step' || action === 'workspace-go-step' || action === 'workspace-back-step') {
      const next = Number(button.dataset.step);
      if (next > 1 && !workspace.assessmentId) throw new Error('Seleccioná una evaluación antes de continuar.');
      if (next === 3 && (!workspace.correction || !workspace.proposal || !workspace.activeSubmission)) {
        workspace.step = 2;
        setMessage('');
      } else {
        workspace.step = Math.min(3, Math.max(1, next));
        setMessage();
      }
      render();
    } else if (action === 'workspace-open-evaluations') {
      navigate('assessments');
    } else if (action === 'workspace-manage-rubrics') {
      navigate('rubrics');
    } else if (action === 'workspace-open-corrections') {
      navigate('corrections');
    } else if (action === 'workspace-import-reference') {
      await withActionLock(async () => { await importReference(); });
    } else if (action === 'workspace-suggest-questions') {
      await withActionLock(async () => { await suggestQuestions(); });
    } else if (action === 'workspace-accept-question') {
      await withActionLock(async () => { await acceptQuestion(index); });
    } else if (action === 'workspace-remove-answer-file') {
      workspace.answerFile = null;
      render();
    } else if (action === 'workspace-discard-question') {
      workspace.questionSuggestions = workspace.questionSuggestions.filter((_, itemIndex) => itemIndex !== index);
      render();
    } else if (action === 'workspace-select-submission') {
      if (actionLocked || workspace.loadingSelection) return true;
      await selectSubmission(id);
    } else if (action === 'workspace-share') {
      syncCurrentSelection();
      openCorrectionShareModal();
    } else if (action === 'workspace-export') {
      if (workspace.correction?.id) await api.download(`corrections/${workspace.correction.id}/export/`, `devolucion-maestria-${workspace.correction.id}.md`);
    } else if (action === 'workspace-copy') {
      syncCurrentSelection();
      await copyCorrection();
    } else {
      return false;
    }
    return true;
  } catch (error) {
    workspace.error = error?.message || 'No se pudo completar la acción.';
    render();
    return true;
  }
}

export async function handleWorkspaceSubmit(form) {
  if (actionLocked) return true;
  const id = form.id;
  await withActionLock(async () => {
    setMessage();
    if (id === 'workspace-context-form') {
      await saveContext();
      workspace.step = 2;
      setMessage('Contexto guardado. Ya podés cargar una entrega en el panel siguiente.');
    } else if (id === 'workspace-submission-form') {
      await createSubmissionAndCorrection(form);
    } else if (id === 'workspace-approve-form') {
      await approveCorrection(form);
    } else return;
  }).catch(error => { workspace.error = error?.message || 'No se pudo completar el flujo.'; });
  render();
  return true;
}

export function handleWorkspaceInput(event) {
  const target = event.target;
  if (target.matches('[data-workspace-field]')) {
    const key = target.dataset.workspaceField;
    workspace[key] = target.value;
    return true;
  }
  if (target.matches('[data-workspace-search]')) {
    workspace.search = target.value;
    const queue = content.querySelector('.teacher-workspace-queue-list');
    const visible = visibleSubmissions();
    if (queue) queue.innerHTML = queueRowsMarkup();
    const reviewed = visible.filter(item => ['review', 'approved', 'rejected'].includes(queueStatus(item))).length;
    const approved = visible.filter(item => queueStatus(item) === 'approved').length;
    const count = content.querySelector('[data-workspace-queue-count]');
    const progressText = content.querySelector('[data-workspace-queue-progress-text]');
    const progress = content.querySelector('[data-workspace-queue-progress]');
    if (count) count.textContent = `${visible.length} registradas · ${approved} aprobadas`;
    if (progressText) progressText.textContent = `${reviewed} de ${visible.length} revisadas`;
    if (progress) progress.value = visible.length ? Math.round(reviewed / visible.length * 100) : 0;
    return true;
  }
  if (target.matches('[data-workspace-suggestion]')) {
    const item = workspace.questionSuggestions[Number(target.dataset.workspaceSuggestion)];
    if (item) item[target.dataset.field] = target.dataset.field === 'max_score' ? Number(target.value) : target.value;
    return true;
  }
  if (target.matches('[data-workspace-criterion]')) {
    const item = workspace.proposal?.criteria?.[Number(target.dataset.workspaceCriterion)];
    if (item) item[target.dataset.field] = target.dataset.field === 'score' ? Number(target.value) : target.value;
    if (target.dataset.field === 'score' && workspace.proposal?.criteria) {
      const criteria = workspace.proposal.criteria;
      const total = criteria.reduce((sum, row) => sum + (Number(row.score) || 0), 0);
      const totalNode = content.querySelector('.teacher-workspace-total strong');
      if (totalNode?.firstChild) totalNode.firstChild.nodeValue = formatNumber(total);
    }
    return true;
  }
  if (target.matches('[data-workspace-feedback]')) { workspace.feedback = target.value; return true; }
  if (target.matches('[data-workspace-change-reason]')) { workspace.changeReason = target.value; return true; }
  return false;
}

export async function handleWorkspaceChange(event) {
  const target = event.target;
  if (target.matches('[data-workspace-assessment]')) {
    const id = target.value;
    workspace.loaded = false;
    workspace.message = '';
    workspace.error = '';
    if (id) updateWorkspaceUrl({ assessment: id });
    else updateWorkspaceUrl({ assessment: '', submission: '' });
    if (id) await loadWorkspaceData(id, null);
    else clearSelectedAssessment();
    return true;
  }
  if (target.matches('[data-workspace-course]')) {
    workspace.courseFilter = target.value;
    const url = new URL(window.location.href);
    if (workspace.courseFilter === 'all') url.searchParams.delete('course');
    else url.searchParams.set('course', workspace.courseFilter);
    window.history.replaceState({ ...(window.history.state || {}), view: 'workspace' }, '', url.toString());
    const next = filteredAssessments();
    if (!next.some(item => String(item.id) === String(workspace.assessmentId))) {
      if (next[0]) {
        updateWorkspaceUrl({ assessment: next[0].id, submission: '' });
        await loadWorkspaceData(String(next[0].id), null);
      }
      else clearSelectedAssessment();
    } else render();
    return true;
  }
  if (target.matches('[data-workspace-question]')) { workspace.questionId = target.value; return true; }
  if (target.matches('[data-workspace-question-select]')) { workspace.questionId = target.value; return true; }
  if (target.matches('[data-workspace-student]')) {
    workspace.studentId = target.value;
    const student = state.data.students.find(item => String(item.id) === String(target.value));
    if (student) {
      workspace.studentName = student.name;
      const nameField = content.querySelector('[data-workspace-field="studentName"]');
      if (nameField) nameField.value = student.name;
    }
    return true;
  }
  if (target.matches('[data-workspace-rubric]')) { workspace.rubricId = target.value; return true; }
  if (target.matches('[data-workspace-feedback-style]')) { workspace.feedbackStyle = target.value; state.feedbackStyle = target.value; try { localStorage.setItem('maestria-feedback-style', target.value); } catch { /* La preferencia sigue disponible en memoria. */ } return true; }
  if (target.matches('[data-workspace-material-mode]')) { workspace.materialMode = target.value; return true; }
  if (target.matches('[data-workspace-status]')) {
    workspace.statusFilter = target.value;
    render();
    return true;
  }
  if (target.matches('[data-workspace-review-submission]')) {
    await selectSubmission(target.value);
    return true;
  }
  if (target.matches('[data-workspace-file="answer"]')) {
    workspace.answerFile = target.files?.[0] || null;
    if (workspace.answerFile) workspace.answerText = '';
    render();
    return true;
  }
  if (target.matches('[data-workspace-file="material"]')) {
    workspace.materialFile = target.files?.[0] || null;
    render();
    return true;
  }
  return false;
}
