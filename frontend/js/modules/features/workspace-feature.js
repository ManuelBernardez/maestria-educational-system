import { api } from '../core/api-client.js';
import { state, content } from '../core/state.js';
import { escapeHtml, formatNumber, formatInputNumber, statusPill, toneOf, icon } from '../core/utils.js';
import { render, navigate } from '../core/router.js';
import { toast } from '../core/ui.js';
import { openExclusive } from '../core/disclosure.js';
import { invalidateResources } from '../data/resources.js';
import { openCorrectionShareModal, copyCorrection } from './share.js';
import {
  workspace, STEP_TONES, rememberStep, recalledStep, selectedAssessment, assessmentQuestions, questionTotal,
  assessmentSubmissions, queueStatus, criteria, isApproved, canReview, criterionModified, stepDirty, anyDirty, reviewSnapshot
} from './workspace/workspace-state.js';
import { MAX_FILE_BYTES, serverFieldErrors, stepTitleId } from './workspace/workspace-markup.js';
import { contextStep, emptyQuestionDraft, questionDraft } from './workspace/context-step.js';
import { deliveryStep, queueListMarkup } from './workspace/delivery-step.js';
import { reviewStep, totals, reviewedCount, findFragment, criterionAnswer, criterionMark, criteriaSummary, fullAnswerText, navigationTarget, restoreCriterion, finalScoreHint, needsReason } from './workspace/review-step.js';

const SEARCH_DEBOUNCE_MS = 250;
const HIGHLIGHT_MS = 4000;
const STEP_TITLES = Object.freeze({ 1: 'Contexto y criterios', 2: 'Entrega del estudiante', 3: 'Revisar y aprobar' });
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const scrollBehavior = () => (reducedMotion() ? 'auto' : 'smooth');

let loadController = null;
let selectionController = null;
let loadSequence = 0;
let selectionSequence = 0;
let actionLocked = false;
let searchTimer = null;
let pendingFocus = null;

/* =========================================================================
 * Datos
 * ========================================================================= */

function updateWorkspaceUrl({ assessment = workspace.assessmentId, submission = '' } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set('view', 'workspace');
  if (assessment) url.searchParams.set('assessment', String(assessment)); else url.searchParams.delete('assessment');
  if (submission) url.searchParams.set('submission', String(submission)); else url.searchParams.delete('submission');
  window.history.replaceState({ ...(window.history.state || {}), view: 'workspace' }, '', url.toString());
}

function syncCurrentSelection() {
  state.currentSubmission = workspace.activeSubmission;
  state.selectedSubmission = workspace.activeSubmission?.id || null;
  state.currentCorrection = workspace.correction;
  state.selectedCorrection = workspace.correction?.id || null;
}

function summarizeCorrection(item) {
  const assessment = selectedAssessment();
  return {
    id: item.id, submission: item.submission, status: item.status, total_score: item.total_score,
    submission_assessment_id: item.submission_assessment_id ?? workspace.assessmentId,
    submission_title: item.submission_title || assessment?.title || 'Evaluación',
    student_name: item.student_name || workspace.activeSubmission?.student_display_name || workspace.activeSubmission?.student_name || 'Estudiante sin identificar',
    course_id: item.course_id ?? assessment?.course ?? null, course_name: item.course_name ?? assessment?.course_name ?? null,
    subject: item.subject || assessment?.subject || '', created_at: item.created_at
  };
}

/** El espacio trae listas acotadas a una evaluación: se publican y se invalidan para otras vistas. */
function replaceData(payload) {
  const keys = ['courses', 'assessments', 'students', 'rubrics', 'submissions', 'corrections', 'enrollments'];
  keys.forEach(key => { state.data[key] = Array.isArray(payload[key]) ? payload[key] : []; });
  invalidateResources(keys);
}

function resetReview() {
  workspace.review = { reviewed: new Set(), open: new Set(), expandedLists: new Set(), onlyUnreviewed: false, onlyPending: workspace.review?.onlyPending || false, approveWarning: false, menuOpen: false };
}

/**
 * Consigna por defecto de una entrega nueva: con varias, ninguna en particular (valor vacío
 * = «Todas las consignas», la respuesta se corrige contra cada una); con una sola, esa.
 */
function defaultQuestionId() {
  const questions = assessmentQuestions();
  return questions.length === 1 ? String(questions[0].id) : '';
}

function resetForAssessment(assessment) {
  workspace.assessmentId = assessment ? String(assessment.id) : '';
  workspace.questions = Array.isArray(assessment?.questions) ? assessment.questions : [];
  workspace.objectives = assessment?.objectives || '';
  workspace.instructions = assessment?.instructions || '';
  workspace.referenceMaterial = assessment?.reference_material || '';
  workspace.savedContext = { objectives: workspace.objectives, instructions: workspace.instructions };
  workspace.questionId = defaultQuestionId();
  Object.assign(workspace, {
    studentId: '', studentName: '', rubricId: '', answerText: '', answerFile: null, materialFile: null,
    materialConfirmRemove: false, questionEditor: null, questionDeleteId: '', questionDeleteError: '', questionSuggestions: [],
    questionSuggestionDemo: false, suggestError: '', activeSubmission: null, correction: null, proposal: null, feedback: '',
    changeReason: '', finalScore: '', baseline: '', contextJustSaved: false, proposalReady: false, leaveGuard: null, lockedNotice: false,
    search: '', statusFilter: 'pending', queueLimit: 50, error: ''
  });
  resetReview();
  workspace.step = assessment ? Math.min(2, recalledStep(assessment.id)) : 1;
  syncCurrentSelection();
}

function applyCorrection(correction) {
  workspace.correction = correction;
  workspace.rubricId = correction.rubric ? String(correction.rubric) : workspace.rubricId;
  const visible = correction.status === 'approved' && correction.final_result?.criteria?.length ? correction.final_result : correction.proposal;
  workspace.proposal = visible ? structuredClone(visible) : null;
  workspace.feedback = correction.teacher_feedback || visible?.feedback || '';
  workspace.changeReason = '';
  workspace.finalScore = '';
  resetReview();
  const list = criteria();
  if (list.length) workspace.review.open.add(0);
  workspace.baseline = reviewSnapshot();
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
    workspace.courseFilter = new URLSearchParams(window.location.search).get('course') || 'all';
    if (selected) {
      const exists = state.data.assessments.some(item => String(item.id) === String(selected.id));
      state.data.assessments = exists ? state.data.assessments.map(item => String(item.id) === String(selected.id) ? { ...item, ...selected } : item) : [selected, ...state.data.assessments];
      resetForAssessment({ ...selected, questions: workspace.questions });
    } else {
      resetForAssessment(null);
    }
    const submissionId = requestedSubmission || new URLSearchParams(window.location.search).get('submission');
    if (selected && submissionId) await loadWorkspaceSubmission(submissionId, { signal: controller.signal, sequence });
    workspace.loaded = true;
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

/** Abre una evaluación en el espacio de trabajo desde otra vista (p. ej. Evaluaciones). */
export function openAssessmentInWorkspace(id) {
  workspace.loaded = false;
  updateWorkspaceUrl({ assessment: id, submission: '' });
  navigate('workspace');
}

async function loadWorkspaceSubmission(id, { signal, sequence, requestId: suppliedRequestId } = {}) {
  const requestId = suppliedRequestId ?? ++selectionSequence;
  const targetId = Number(id);
  if (!Number.isInteger(targetId) || targetId < 1) return;
  const summary = state.data.corrections.find(item => Number(item.submission) === targetId);
  const [submission, correction] = await Promise.all([
    api.get(`submissions/${targetId}/`, { signal }),
    summary ? api.get(`corrections/${summary.id}/`, { signal }) : Promise.resolve(null)
  ]);
  if (signal?.aborted || requestId !== selectionSequence || (sequence != null && sequence !== loadSequence)) return;
  workspace.activeSubmission = submission;
  state.data.submissions = state.data.submissions.map(item => String(item.id) === String(submission.id) ? { ...item, ...submission } : item);
  workspace.answerText = submission.answer_text || '';
  workspace.studentId = submission.student ? String(submission.student) : '';
  workspace.studentName = submission.student_name || submission.student_display_name || '';
  // Una entrega sin consigna puntual abarca todas: el selector tiene que mostrarlo así.
  workspace.questionId = submission.question ? String(submission.question) : '';
  workspace.answerFile = null;
  workspace.proposalReady = false;
  if (correction) {
    applyCorrection(correction);
    workspace.step = 3;
  } else {
    workspace.correction = null;
    workspace.proposal = null;
    workspace.feedback = '';
    workspace.baseline = '';
    resetReview();
    workspace.step = 2;
  }
  syncCurrentSelection();
}

async function selectSubmission(id) {
  selectionController?.abort();
  const controller = new AbortController();
  selectionController = controller;
  const requestId = ++selectionSequence;
  workspace.error = '';
  workspace.loadingSelection = true;
  render();
  try {
    await loadWorkspaceSubmission(id, { signal: controller.signal, requestId });
    if (controller.signal.aborted || requestId !== selectionSequence) return;
    updateWorkspaceUrl({ assessment: workspace.assessmentId, submission: id });
    rememberStep();
    pendingFocus = `#${stepTitleId(workspace.step)}`;
  } catch (error) {
    if (!controller.signal.aborted && requestId === selectionSequence) workspace.error = error?.message || 'No se pudo cargar el detalle de la entrega.';
  } finally {
    if (requestId === selectionSequence) {
      workspace.loadingSelection = false;
      if (state.view === 'workspace') render();
    }
  }
}

/* =========================================================================
 * Operaciones (reutilizan los endpoints existentes)
 * ========================================================================= */

function validateFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) throw new Error('El archivo supera el máximo permitido de 5 MB.');
  if (!/\.(txt|md|pdf|docx)$/i.test(file.name)) throw new Error('Formato no admitido. Usá PDF, DOCX, TXT o MD.');
}

function storeAssessment(updated) {
  state.data.assessments = state.data.assessments.map(item => String(item.id) === String(updated.id) ? { ...item, ...updated } : item);
}

async function saveContext() {
  const assessment = selectedAssessment();
  if (!assessment) throw new Error('Seleccioná una evaluación primero.');
  const updated = await api.patch(`assessments/${assessment.id}/`, {
    objectives: workspace.objectives.trim(), instructions: workspace.instructions.trim(), reference_material: workspace.referenceMaterial,
    title: assessment.title, subject: assessment.subject, level: assessment.level, status: assessment.status, course: assessment.course || null
  });
  storeAssessment(updated);
  workspace.savedContext = { objectives: workspace.objectives, instructions: workspace.instructions };
  return updated;
}

/**
 * Guarda el contexto y, si hay una consigna abierta con cambios, también la consigna.
 * Devuelve false si la consigna no pudo guardarse (los errores quedan visibles en su
 * editor) para no anunciar "Contexto guardado" mientras se pierde ese borrador.
 */
async function saveContextAndOpenQuestion() {
  if (workspace.questionEditor?.dirty) {
    await saveQuestion();
    if (workspace.questionEditor) return false;
  }
  await saveContext();
  return true;
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
  storeAssessment({ id: assessment.id, reference_material: workspace.referenceMaterial });
  toast(`Material incorporado: ${Number(result.chars || 0).toLocaleString('es-AR')} caracteres extraídos.`);
}

async function removeReference() {
  const assessment = selectedAssessment();
  if (!assessment) return;
  const updated = await api.patch(`assessments/${assessment.id}/`, { reference_material: '' });
  storeAssessment(updated);
  workspace.referenceMaterial = '';
  workspace.materialConfirmRemove = false;
  toast('Material quitado.');
}

const nextPosition = () => assessmentQuestions().reduce((max, item) => Math.max(max, Number(item.position || 0)), 0) + 1;

function storeQuestion(saved) {
  workspace.questions = [...workspace.questions.filter(row => String(row.id) !== String(saved.id)), saved];
  storeAssessment({ id: workspace.assessmentId, questions: workspace.questions });
}

async function saveQuestion({ chain = false } = {}) {
  const draft = workspace.questionEditor;
  if (!draft || draft.saving) return;
  const prompt = String(draft.prompt || '').trim();
  const maxScore = Number(draft.max_score);
  const errors = {};
  if (prompt.length < 4) errors.prompt = ['Escribí el enunciado (al menos 4 caracteres).'];
  if (!Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 1000) errors.max_score = ['El puntaje máximo debe ser mayor que 0 y no superar 1000.'];
  if (Object.keys(errors).length) { draft.errors = errors; render(); focusFirstError(); return; }
  const payload = { prompt, max_score: maxScore, expected_answer: String(draft.expected_answer || ''), question_type: draft.question_type || 'open', rubric: draft.rubric ? Number(draft.rubric) : null };
  draft.saving = true;
  draft.errors = {};
  render();
  try {
    const saved = draft.id
      ? await api.patch(`questions/${draft.id}/`, payload)
      : await api.post('questions/', { ...payload, assessment: Number(workspace.assessmentId), position: nextPosition() });
    storeQuestion(saved);
    workspace.questionHighlight = String(saved.id);
    workspace.questionEditor = chain ? emptyQuestionDraft() : null;
    pendingFocus = chain ? '#ws-q-prompt' : draft.id ? `#ws-question-${saved.id} [data-action="workspace-question-edit"]` : '#ws-add-question';
    announce(draft.id ? 'Consigna guardada.' : 'Consigna agregada.');
  } catch (error) {
    draft.saving = false;
    const fieldErrors = serverFieldErrors(error);
    draft.errors = Object.keys(fieldErrors).length ? fieldErrors : { detail: [error?.message || 'No se pudo guardar la consigna.'] };
    pendingFocus = 'focus-first-error';
  }
  render();
}

async function duplicateQuestion(id) {
  const source = assessmentQuestions().find(row => String(row.id) === String(id));
  if (!source) return;
  const created = await api.post('questions/', { assessment: Number(workspace.assessmentId), prompt: `${source.prompt} (copia)`, max_score: Number(source.max_score), expected_answer: source.expected_answer || '', question_type: source.question_type || 'open', rubric: source.rubric || null, position: nextPosition() });
  storeQuestion(created);
  workspace.questionHighlight = String(created.id);
  announce('Consigna duplicada.');
}

/** Mueve una consigna y renumera las posiciones que cambian (aunque vinieran repetidas). */
async function moveQuestion(id, direction) {
  const ordered = assessmentQuestions();
  const from = ordered.findIndex(row => String(row.id) === String(id));
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ordered.length) return;
  const reordered = [...ordered];
  [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
  // Una sola petición atómica: el índice único (evaluación, posición) de la base no
  // admite intercambiar posiciones con un PATCH por consigna (respondía 500).
  const result = await api.post(`assessments/${workspace.assessmentId}/reorder-questions/`, { order: reordered.map(row => Number(row.id)) });
  workspace.questions = [
    ...workspace.questions.filter(row => String(row.assessment) !== String(workspace.assessmentId)),
    ...(Array.isArray(result?.questions) ? result.questions : [])
  ];
  storeAssessment({ id: workspace.assessmentId, questions: workspace.questions });
  pendingFocus = `#ws-question-${id} [data-action="workspace-question-move"][data-direction="${direction}"], #ws-question-${id} [data-action="workspace-question-edit"]`;
  announce('Orden de consignas actualizado.');
}

async function deleteQuestion(id) {
  try {
    await api.delete(`questions/${id}/`);
    workspace.questions = workspace.questions.filter(row => String(row.id) !== String(id));
    storeAssessment({ id: workspace.assessmentId, questions: workspace.questions });
    workspace.questionDeleteId = '';
    workspace.questionDeleteError = '';
    pendingFocus = '#ws-add-question';
    announce('Consigna eliminada.');
  } catch (error) {
    workspace.questionDeleteError = error?.message || 'No se pudo eliminar la consigna.';
  }
}

async function suggestQuestions() {
  const assessment = selectedAssessment();
  if (!assessment) throw new Error('Seleccioná una evaluación primero.');
  const count = Math.min(5, Math.max(1, Math.round(Number(workspace.suggestCount) || 3)));
  workspace.generatingQuestions = true;
  workspace.suggestError = '';
  render();
  try {
    await saveContext();
    const result = await api.post(`assessments/${assessment.id}/generate-questions/`, { count }, { timeoutMs: 180000 });
    workspace.questionSuggestions = (Array.isArray(result.questions) ? result.questions : []).map(item => ({ ...item, selected: true }));
    workspace.questionSuggestionDemo = Boolean(result.demo);
    if (!workspace.questionSuggestions.length) throw new Error('No recibimos consignas válidas. Revisá la configuración de IA e intentá de nuevo.');
  } catch (error) {
    workspace.suggestError = error?.message || 'No se pudieron proponer consignas.';
  } finally {
    workspace.generatingQuestions = false;
  }
}

async function acceptSelectedSuggestions() {
  const selected = workspace.questionSuggestions.filter(item => item.selected);
  const existing = new Set(assessmentQuestions().map(item => String(item.prompt || '').trim().toLocaleLowerCase('es-AR')));
  for (const item of selected) {
    const prompt = String(item.prompt || '').trim();
    const maxScore = Number(item.max_score || 10);
    if (prompt.length < 4 || !Number.isFinite(maxScore) || maxScore < 0.5 || maxScore > 1000) throw new Error('Revisá el texto y el puntaje de las sugerencias seleccionadas.');
    if (existing.has(prompt.toLocaleLowerCase('es-AR'))) continue;
    const created = await api.post('questions/', { assessment: Number(workspace.assessmentId), prompt, max_score: maxScore, position: nextPosition() });
    storeQuestion(created);
    existing.add(prompt.toLocaleLowerCase('es-AR'));
    workspace.questionSuggestions = workspace.questionSuggestions.filter(row => row !== item);
    workspace.questionHighlight = String(created.id);
  }
  announce(`${selected.length === 1 ? 'Consigna agregada' : 'Consignas agregadas'} a la evaluación.`);
}

async function createSubmissionAndCorrection() {
  const assessment = selectedAssessment();
  if (!assessment) throw new Error('Seleccioná una evaluación primero.');
  const studentName = workspace.studentName.trim();
  if (!workspace.answerText.trim() && !workspace.answerFile) throw new Error('Pegá la respuesta o adjuntá un archivo antes de generar la corrección.');
  if (!workspace.studentId && !studentName) throw new Error('Seleccioná un estudiante o indicá un nombre para identificar la entrega.');
  validateFile(workspace.answerFile);
  await saveContext();
  const existing = workspace.activeSubmission && String(workspace.activeSubmission.assessment) === String(assessment.id);
  if (existing && workspace.answerFile) throw new Error('Esta entrega ya tiene su texto cargado. Quitá el archivo adjunto y editá el texto directamente.');
  let submission;
  if (existing) {
    // PATCH sólo con campos editables: evaluación, consigna y estudiante son identidades inmutables.
    submission = await api.patch(`submissions/${workspace.activeSubmission.id}/`, { answer_text: workspace.answerText.trim() });
  } else if (workspace.answerFile) {
    const payload = new FormData();
    payload.set('file', workspace.answerFile);
    payload.set('assessment', String(assessment.id));
    if (workspace.questionId) payload.set('question', workspace.questionId);
    if (workspace.studentId) payload.set('student', workspace.studentId);
    if (studentName) payload.set('student_name', studentName);
    submission = await api.upload('submissions/import-file/', payload, { timeoutMs: 90000 });
    // El archivo ya se convirtió en texto guardado: si la corrección falla, el reintento
    // reutiliza esta entrega en vez de chocar con «ya existe» por el archivo pendiente.
    workspace.answerFile = null;
  } else {
    submission = await api.post('submissions/', {
      assessment: Number(assessment.id), question: workspace.questionId ? Number(workspace.questionId) : null,
      student: workspace.studentId ? Number(workspace.studentId) : null, student_name: studentName,
      answer_text: workspace.answerText.trim(), source_type: 'text'
    });
  }
  workspace.activeSubmission = submission;
  workspace.answerText = submission.answer_text || workspace.answerText;
  syncCurrentSelection();
  const correction = await api.post(`submissions/${submission.id}/generate-correction/`, {
    rubric_id: workspace.rubricId ? Number(workspace.rubricId) : null,
    feedback_style: workspace.feedbackStyle || 'constructivo'
  }, { timeoutMs: 180000 });
  applyCorrection(correction);
  workspace.answerFile = null;
  workspace.proposalReady = true;
  state.data.submissions = [submission, ...state.data.submissions.filter(item => String(item.id) !== String(submission.id))];
  const summary = summarizeCorrection(correction);
  state.data.corrections = [summary, ...state.data.corrections.filter(item => String(item.id) !== String(summary.id) && String(item.submission) !== String(summary.submission))];
  syncCurrentSelection();
  updateWorkspaceUrl({ assessment: assessment.id, submission: submission.id });
  pendingFocus = '#ws-next-step button';
}

async function approveCorrection() {
  const correction = workspace.correction;
  const proposal = workspace.proposal;
  if (!correction || !proposal || !workspace.activeSubmission || proposal.demo) return;
  const list = criteria();
  const original = correction.proposal?.criteria || [];
  const changed = list.length !== original.length || list.some((item, index) => Number(item.score) !== Number(original[index]?.score));
  for (const item of list) {
    const value = Number(item.score);
    const maximum = Number(item.max_score);
    if (!Number.isFinite(value) || !Number.isFinite(maximum) || value < 0 || value > maximum) throw new Error('Cada puntaje debe ser un número válido entre 0 y el máximo de su criterio.');
  }
  const { score, max, minimum, overridden } = totals();
  if (workspace.finalScore !== '' && !overridden && Math.abs(Number(workspace.finalScore) - score) >= 0.005) {
    pendingFocus = '#workspace-final-score';
    throw new Error(`La nota final debe ser un número entre ${formatNumber(minimum)} y ${formatNumber(max)}.`);
  }
  const reason = workspace.changeReason.trim();
  if ((changed || overridden) && reason.length < 8) { pendingFocus = '#workspace-change-reason'; throw new Error(`Explicá brevemente por qué modificaste ${overridden && !changed ? 'la nota final' : 'el puntaje'} (al menos 8 caracteres).`); }
  workspace.approving = true;
  render();
  try {
    const payload = { final_result: proposal, teacher_feedback: workspace.feedback, change_reason: reason, ...(overridden ? { final_score: score } : {}) };
    const result = await api.post(`corrections/${correction.id}/approve/`, payload, { timeoutMs: 90000 });
    const reviewed = workspace.review.reviewed;
    applyCorrection({ ...result, final_result: result.final_result || proposal });
    workspace.review.reviewed = reviewed;
    state.data.corrections = [summarizeCorrection(result), ...state.data.corrections.filter(item => String(item.id) !== String(result.id))];
    state.data.submissions = state.data.submissions.map(item => String(item.id) === String(workspace.activeSubmission.id) ? { ...item, status: 'approved' } : item);
    syncCurrentSelection();
    toast('Corrección aprobada y guardada en el historial.');
  } finally {
    workspace.approving = false;
  }
}

/* =========================================================================
 * Navegación entre pasos y protección de cambios
 * ========================================================================= */

function discardStep(step) {
  if (step === 1) { workspace.objectives = workspace.savedContext.objectives; workspace.instructions = workspace.savedContext.instructions; workspace.questionEditor = null; }
  if (step === 2) { workspace.answerText = workspace.activeSubmission?.answer_text || ''; workspace.answerFile = null; }
  if (step === 3 && workspace.correction) applyCorrection(workspace.correction);
}

function goToStep(step, { focusTab = false } = {}) {
  if (step > 1 && !workspace.assessmentId) throw new Error('Seleccioná una evaluación antes de continuar.');
  if (step === 3 && !canReview()) { workspace.lockedNotice = true; render(); return; }
  workspace.lockedNotice = false;
  workspace.leaveGuard = null;
  workspace.step = step;
  if (step !== 1) workspace.contextJustSaved = false;
  rememberStep();
  pendingFocus = focusTab ? `#workspace-tab-${step}` : `#${stepTitleId(step)}`;
  render();
}

/**
 * Deselecciona la entrega activa y deja el formulario del paso 2 vacío para cargar otra.
 * Conserva evaluación, consigna y tono elegidos: suelen repetirse entre entregas.
 */
function startNewSubmission() {
  selectionController?.abort();
  Object.assign(workspace, {
    activeSubmission: null, correction: null, proposal: null, feedback: '', changeReason: '', finalScore: '', baseline: '',
    studentId: '', studentName: '', answerText: '', answerFile: null, proposalReady: false, leaveGuard: null, error: '',
    questionId: defaultQuestionId()
  });
  resetReview();
  workspace.step = 2;
  syncCurrentSelection();
  updateWorkspaceUrl({ assessment: workspace.assessmentId, submission: '' });
  pendingFocus = '#workspace-student-select';
  render();
}

/** Cambiar de paso, entrega o evaluación con cambios pendientes muestra un aviso en línea. */
function guarded(target, proceed) {
  // Al cambiar de paso importa el paso actual; al cambiar de entrega o evaluación, cualquiera.
  const dirtyStep = target.type === 'step'
    ? (target.value !== workspace.step && stepDirty(workspace.step) ? workspace.step : 0)
    : target.type === 'submission' ? [2, 3].find(step => stepDirty(step)) : [workspace.step, 1, 2, 3].find(step => stepDirty(step));
  if (dirtyStep) {
    workspace.leaveGuard = { ...target, from: dirtyStep, proceed };
    pendingFocus = '#ws-leave-guard button';
    render();
    return;
  }
  proceed();
}

function announce(message) {
  const region = content.querySelector('#ws-live');
  if (region) { region.textContent = ''; window.setTimeout(() => { region.textContent = message; }, 30); }
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    announce('Copiado');
    toast(`${label} copiada.`);
  } catch {
    toast('No se pudo copiar. Seleccioná el texto y copialo manualmente.', 'error');
  }
}

/* =========================================================================
 * Render
 * ========================================================================= */

function cover() {
  const assessment = selectedAssessment();
  const courses = state.data.courses.filter(item => item.active);
  const assessments = state.data.assessments.filter(item => item.status !== 'archived' && (workspace.courseFilter === 'all' || String(item.course ?? item.course_id ?? 'unassigned') === workspace.courseFilter));
  const disabled = workspace.loading || actionLocked || workspace.generatingQuestions ? 'disabled' : '';
  const tone = toneOf(assessment?.course ?? assessment?.course_id ?? 'none');
  // Sólo identidad de la evaluación: los conteos de consignas y entregas ya están en cada pestaña.
  const meta = assessment ? `<ul class="meta-chips" aria-label="Datos de la evaluación"><li>${statusPill(assessment.status)}</li>${assessment.course_name ? `<li class="meta-chip">${escapeHtml(assessment.course_name)}</li>` : ''}</ul>` : '';
  const actions = `${assessment ? `<button class="btn btn-secondary btn-small" type="button" data-action="edit-assessment" data-id="${escapeHtml(assessment.id)}">${icon('pencil')} Editar</button>` : ''}<button class="btn btn-primary btn-small" type="button" data-action="new-assessment">${icon('plus')} Nueva evaluación</button>`;
  return `<header class="view-header ws-cover" data-tone-h="${tone}">
    <div class="view-heading-copy"><h1>${escapeHtml(assessment?.title || 'Vamos a corregir con criterio.')}</h1>${assessment ? meta : '<p class="view-lead">Elegí la materia, prepará el contexto y revisá cada propuesta antes de aprobarla.</p>'}</div>
    <div class="view-actions">${actions}</div>
    <div class="ws-selectors">
      <label class="pill-field" for="workspace-course-filter"><span class="pill-field-label">Materia o curso</span><select id="workspace-course-filter" data-workspace-course ${disabled}><option value="all">Todas las materias</option>${courses.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(workspace.courseFilter) ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}${state.data.assessments.some(item => !item.course && !item.course_id) ? `<option value="unassigned" ${workspace.courseFilter === 'unassigned' ? 'selected' : ''}>Sin materia asignada</option>` : ''}</select></label>
      <label class="pill-field" for="workspace-assessment"><span class="pill-field-label">Evaluación</span><select id="workspace-assessment" data-workspace-assessment ${disabled || (state.data.assessments.length ? '' : 'disabled')}><option value="">Elegí una evaluación…</option>${assessments.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(workspace.assessmentId) ? 'selected' : ''}>${escapeHtml(item.title)}${item.course_name ? ` · ${escapeHtml(item.course_name)}` : ''}</option>`).join('')}</select></label>
    </div>
  </header>`;
}

function tabs() {
  const questions = assessmentQuestions();
  const deliveries = assessmentSubmissions();
  const pending = deliveries.filter(item => queueStatus(item) !== 'approved').length;
  const toReview = deliveries.filter(item => queueStatus(item) === 'review').length;
  const lines = {
    1: questions.length ? `${questions.length} ${questions.length === 1 ? 'consigna' : 'consignas'} · ${formatNumber(questionTotal(questions))} pts` : 'Falta definir el contexto',
    2: deliveries.length ? `${deliveries.length} ${deliveries.length === 1 ? 'entrega' : 'entregas'} · ${pending} ${pending === 1 ? 'pendiente' : 'pendientes'}` : 'Sin entregas todavía',
    3: toReview ? `${toReview} por revisar` : 'Nada para revisar'
  };
  const done = { 1: questions.length > 0 && !stepDirty(1) && Boolean(workspace.savedContext.instructions || workspace.savedContext.objectives), 2: deliveries.length > 0, 3: isApproved() };
  return `<div class="notebook-tabs" role="tablist" aria-label="Pasos para trabajar la evaluación">${[1, 2, 3].map(step => {
    const active = workspace.step === step;
    const locked = step === 3 && !canReview();
    const stateClass = active ? 'is-active' : done[step] ? 'is-done' : '';
    return `<button type="button" role="tab" id="workspace-tab-${step}" aria-controls="workspace-panel-${step}" aria-selected="${active}" tabindex="${active ? 0 : -1}" class="notebook-tab ${stateClass}${locked ? ' is-locked' : ''}" data-tone="${STEP_TONES[step]}" data-action="workspace-step" data-step="${step}" title="${escapeHtml(lines[step])}" ${locked ? 'aria-disabled="true"' : ''}><span class="step-number" aria-hidden="true">${done[step] && !active ? '✓' : step}</span><span class="notebook-tab-copy"><strong>${STEP_TITLES[step]}</strong><small>${escapeHtml(lines[step])}</small></span>${done[step] && !active ? '<span class="visually-hidden">(completo)</span>' : ''}</button>`;
  }).join('')}</div>`;
}

function inlineNotices() {
  const notices = [];
  if (workspace.lockedNotice) notices.push(`<div class="notice notice-info notice-dismissible" role="status"><p>Cargá una entrega para poder revisar. <button type="button" class="text-link" data-action="workspace-step" data-step="2">Ir a la entrega del estudiante</button></p><button type="button" class="notice-close" data-action="workspace-dismiss-locked" aria-label="Cerrar aviso" title="Cerrar">×</button></div>`);
  if (workspace.leaveGuard) {
    const canSave = workspace.leaveGuard.from === 1;
    notices.push(`<div class="inline-confirm" id="ws-leave-guard" role="alert"><p>Tenés cambios sin guardar en «${STEP_TITLES[workspace.leaveGuard.from]}».</p>${canSave ? '<button type="button" class="btn btn-primary btn-small" data-action="workspace-guard-save">Guardar y seguir</button>' : ''}<button type="button" class="btn btn-secondary btn-small" data-action="workspace-guard-discard">Descartar</button><button type="button" class="text-link" data-action="workspace-guard-stay">Quedarme</button></div>`);
  }
  return notices.join('');
}

function nextStepNote() {
  let note = null;
  if (workspace.step === 1 && workspace.contextJustSaved) note = { text: 'Contexto listo. Seguí con la entrega del estudiante.', label: 'Ir a la entrega', action: 'workspace-step', attrs: 'data-step="2"' };
  else if (workspace.step === 2 && workspace.proposalReady && canReview()) note = { text: 'Propuesta lista. Revisala y aprobala.', label: 'Revisar ahora', action: 'workspace-step', attrs: 'data-step="3"' };
  else if (workspace.step === 3 && isApproved()) {
    const next = assessmentSubmissions().find(item => queueStatus(item) === 'review' && String(item.id) !== String(workspace.activeSubmission?.id));
    if (next) note = { text: 'Devolución aprobada. Hay otra propuesta esperando tu revisión.', label: 'Siguiente propuesta', action: 'workspace-nav', attrs: `data-id="${escapeHtml(next.id)}"` };
  }
  return note ? `<div class="next-step" id="ws-next-step" role="status"><span class="next-step-mark" aria-hidden="true">✳</span><p>${note.text}</p><button type="button" class="btn btn-primary btn-small" data-action="${note.action}" ${note.attrs}>${note.label}</button></div>` : '';
}

const PRACTICE_HELP = '<details class="disclosure" id="ws-practice-help"><summary>ⓘ Cómo usar el ejemplo de práctica <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg></summary><div class="disclosure-body"><p>Este conjunto contiene un curso, estudiantes y respuestas ficticios guardados en tu cuenta. No se subió un archivo de respuesta: los textos de práctica se guardan como texto.</p><ol><li>Elegí una entrega pendiente y revisá la consigna y la rúbrica.</li><li>Generá la propuesta con un proveedor de IA real configurado; el modo MOCK está bloqueado para este conjunto.</li><li>Revisá la evidencia y la justificación de cada criterio. Podés editar los puntajes y la devolución.</li><li>Aprobá para guardar la decisión docente; después podés compartir la devolución o guardarla como PDF desde la impresión del navegador.</li></ol><p class="field-hint">Si falla la generación, revisá el proveedor, las claves y los permisos de procesamiento externo del servidor.</p></div></details>';

export function renderWorkspace() {
  if (workspace.loading) return `<section class="panel" aria-live="polite" aria-busy="true"><div class="panel-body"><p>Cargando espacio de trabajo…</p><div class="skeleton-grid" aria-hidden="true"><span class="skeleton skeleton-wide"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span></div></div></section>`;
  if (workspace.error && !workspace.loaded) return `<section class="panel" role="alert"><div class="panel-body"><div class="empty-state"><div class="empty-icon" aria-hidden="true">!</div><h2>No se pudo cargar el espacio de trabajo</h2><p>${escapeHtml(workspace.error)}</p><button class="btn btn-primary" type="button" data-action="workspace-retry">Reintentar</button></div></div></section>`;
  const assessment = selectedAssessment();
  const error = workspace.error ? `<div class="notice notice-error" role="alert">${escapeHtml(workspace.error)}</div>` : '';
  const live = '<p class="visually-hidden" id="ws-live" aria-live="polite"></p>';
  if (!assessment) {
    return `${cover()}${error}${live}${state.data.assessments.length
      ? '<div class="empty-state"><div class="empty-icon" aria-hidden="true">✳</div><h3>Elegí una evaluación para empezar</h3><p>Usá el selector de arriba para trabajar el contexto, las entregas y la revisión.</p></div>'
      : '<div class="empty-state"><div class="empty-icon" aria-hidden="true">✳</div><h3>Primero necesitamos una evaluación</h3><p>Creá una evaluación, aunque sea sencilla. Después vas a poder sumar materiales, elegir una entrega y generar una propuesta de corrección.</p><button class="btn btn-primary" type="button" data-action="new-assessment">Crear evaluación</button></div>'}`;
  }
  const panels = { 1: contextStep, 2: deliveryStep, 3: reviewStep };
  return `${cover()}
    ${workspace.aiProvider === 'mock' ? '<p class="notice notice-warning" role="note"><strong>Modo de práctica.</strong> Las propuestas son simuladas y no deben usarse para calificar respuestas reales.</p>' : ''}
    ${assessment.title?.startsWith('Ejemplo MaestrIA') ? PRACTICE_HELP : ''}
    ${tabs()}${live}
    ${[1, 2, 3].map(step => {
      // Avisos y "próximo paso" van dentro del panel activo: la pestaña sigue pegada a su hoja.
      const notices = workspace.step === step ? `${inlineNotices()}${nextStepNote()}${error}${workspace.loadingSelection ? '<p class="notice notice-info" role="status" aria-live="polite">Cargando la entrega seleccionada…</p>' : ''}` : '';
      return `<section class="step-panel" role="tabpanel" id="workspace-panel-${step}" aria-labelledby="workspace-tab-${step}" data-tone="${STEP_TONES[step]}" ${workspace.step === step ? '' : 'hidden'}>${notices}${panels[step]()}</section>`;
    }).join('')}`;
}

/* ---------- Ajustes después de pintar ---------- */

/** Enfoca un nodo; con desplegables exclusivos puede estar plegado, así que primero se abre. */
function revealAndFocus(target) {
  if (!target) return;
  const folded = target.closest('details:not([open])');
  if (folded) openExclusive(folded);
  target.focus?.({ preventScroll: false });
}

function focusFirstError() {
  revealAndFocus(content.querySelector('[aria-invalid="true"], .question-editor .notice-error'));
}

window.addEventListener('maestria:rendered', event => {
  if (event.detail.view !== 'workspace') return;
  // En pantallas angostas la barra de pestañas hace scroll: la pestaña activa queda a la vista.
  const tabsBar = content.querySelector('.notebook-tabs');
  const activeTab = tabsBar?.querySelector('[aria-selected="true"]');
  if (tabsBar && activeTab && tabsBar.scrollWidth > tabsBar.clientWidth) tabsBar.scrollLeft = Math.max(0, activeTab.offsetLeft - 12);
  if (workspace.questionHighlight) {
    const id = workspace.questionHighlight;
    window.setTimeout(() => { if (workspace.questionHighlight === id) { workspace.questionHighlight = ''; content.querySelector(`#ws-question-${id}`)?.classList.remove('is-new'); } }, 1200);
  }
  if (pendingFocus) {
    if (pendingFocus === 'focus-first-error') focusFirstError();
    else revealAndFocus(content.querySelector(pendingFocus));
    pendingFocus = null;
  }
});

window.addEventListener('beforeunload', event => {
  if (state.view === 'workspace' && workspace.assessmentId && anyDirty()) { event.preventDefault(); event.returnValue = ''; }
});

/* ---------- Actualizaciones en vivo (sin re-render) ---------- */

function refreshSaveStatus() {
  content.querySelectorAll('[data-save-status]').forEach(node => {
    const dirty = stepDirty(Number(node.dataset.saveStatus));
    node.classList.toggle('is-dirty', dirty);
    node.textContent = dirty ? 'Cambios sin guardar' : node.dataset.savedLabel;
  });
}

/** Nota total de la barra, el campo «Nota final» (si sigue a la calculada) y su ayuda. */
function refreshTotals() {
  const { score, computed, overridden } = totals();
  const totalNode = content.querySelector('[data-review-total]');
  if (totalNode) totalNode.textContent = formatNumber(score);
  const totalMeter = content.querySelector('[data-review-meter]');
  if (totalMeter) totalMeter.value = score;
  const finalInput = content.querySelector('[data-workspace-final-score]');
  if (finalInput && workspace.finalScore === '' && document.activeElement !== finalInput) finalInput.value = formatInputNumber(computed);
  const hint = content.querySelector('[data-final-score-hint]');
  if (hint) hint.innerHTML = finalScoreHint(computed, overridden);
  // El motivo sólo aparece cuando cambió un puntaje o la nota final.
  const reasonField = content.querySelector('[data-reason-field]');
  if (reasonField) reasonField.hidden = !needsReason();
}

function refreshCriterion(index) {
  const item = criteria()[index];
  if (!item) return;
  const max = Number(item.max_score || 0);
  const scoreNode = content.querySelector(`[data-criterion-score="${index}"]`);
  if (scoreNode) scoreNode.textContent = `${formatNumber(item.score)} / ${formatNumber(max)}`;
  const meter = content.querySelector(`[data-criterion-meter="${index}"]`);
  if (meter) meter.value = Math.max(0, Number(item.score) || 0);
  const mark = content.querySelector(`[data-criterion-mark="${index}"]`);
  if (mark) mark.innerHTML = criterionMark(index);
  const restore = content.querySelector(`[data-action="workspace-restore-criterion"][data-index="${index}"]`);
  if (restore) restore.hidden = !criterionModified(index);
  refreshTotals();
  const progress = content.querySelector('[data-review-progress]');
  if (progress) progress.textContent = `${reviewedCount()} de ${criteria().length} criterios revisados`;
  const sectionSummary = content.querySelector('[data-section-summary="ws-sec-criteria"]');
  if (sectionSummary) sectionSummary.textContent = criteriaSummary();
  refreshSaveStatus();
}

function updateCharCount(target) {
  const counter = content.querySelector(`[data-char-count="${target.id}"]`);
  if (counter) counter.textContent = `${target.value.length.toLocaleString('es-AR')} caracteres`;
}

/** Abre un único criterio (acordeón): pliega el que estuviera abierto. */
function openOnlyCriterion(index) {
  [...workspace.review.open].filter(position => position !== index).forEach(position => setCriterionOpen(position, false));
  setCriterionOpen(index, true);
}

function setCriterionOpen(index, open) {
  if (open) workspace.review.open.add(index); else workspace.review.open.delete(index);
  const toggle = content.querySelector(`#ws-criterion-${index} .criterion-toggle`);
  const body = content.querySelector(`#ws-criterion-body-${index}`);
  toggle?.setAttribute('aria-expanded', String(open));
  if (body) body.hidden = !open;
}

function openFirstUnreviewed() {
  const index = criteria().findIndex((_, position) => !workspace.review.reviewed.has(position));
  if (index < 0) return;
  workspace.review.approveWarning = false;
  workspace.review.onlyUnreviewed = false;
  workspace.review.open = new Set([index]);
  pendingFocus = `#ws-criterion-${index} .criterion-toggle`;
  render();
  content.querySelector(`#ws-criterion-${index}`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
}

function showEvidence(index) {
  const item = criteria()[index];
  // La cita sale de la respuesta por consigna que se corrigió, no de la respuesta general.
  const { text, nodeId } = criterionAnswer(workspace.activeSubmission, item);
  const range = findFragment(text, item?.evidence);
  const node = content.querySelector(`#${nodeId}`);
  if (!range || !node) return;
  openExclusive(node.closest('details'));
  // Se arma con nodos DOM: el texto del estudiante nunca pasa por innerHTML.
  const mark = document.createElement('mark');
  mark.textContent = text.slice(range[0], range[1]);
  node.replaceChildren(document.createTextNode(text.slice(0, range[0])), mark, document.createTextNode(text.slice(range[1])));
  mark.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  window.setTimeout(() => { if (mark.isConnected) node.textContent = text; }, HIGHLIGHT_MS);
}

function closeMoreMenu(focusTrigger = false) {
  workspace.review.menuOpen = false;
  const menu = content.querySelector('#ws-more-menu');
  const trigger = content.querySelector('#ws-more-trigger');
  if (menu) menu.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  if (focusTrigger) trigger?.focus();
}

async function withActionLock(operation) {
  if (actionLocked) return;
  actionLocked = true;
  try { await operation(); }
  finally { actionLocked = false; if (state.view === 'workspace') render(); }
}

/* =========================================================================
 * Manejadores (enlazados desde events.js)
 * ========================================================================= */

export async function handleWorkspaceAction(button) {
  const action = button.dataset.action;
  const id = button.dataset.id;
  const index = Number(button.dataset.index);
  if (!action?.startsWith('workspace-')) return false;
  if (action !== 'workspace-more-menu' && workspace.review.menuOpen) closeMoreMenu();
  try {
    switch (action) {
      case 'workspace-retry': workspace.loaded = false; workspace.error = ''; await ensureWorkspaceLoaded(); break;
      case 'workspace-step': case 'workspace-go-step': case 'workspace-back-step': {
        const step = Number(button.dataset.step);
        if (button.getAttribute('aria-disabled') === 'true') { workspace.lockedNotice = true; render(); break; }
        guarded({ type: 'step', value: step }, () => goToStep(step));
        break;
      }
      case 'workspace-guard-save': {
        const guard = workspace.leaveGuard;
        let saved = false;
        await withActionLock(async () => { saved = await saveContextAndOpenQuestion(); if (saved) toast('Contexto guardado.'); });
        workspace.leaveGuard = null;
        if (saved) guard?.proceed();
        else render();
        break;
      }
      case 'workspace-guard-discard': { const guard = workspace.leaveGuard; discardStep(guard?.from); workspace.leaveGuard = null; guard?.proceed(); if (guard?.type !== 'step') render(); break; }
      // Al cerrar el aviso el foco vuelve a la pestaña activa (el botón × deja de existir).
      case 'workspace-dismiss-locked': workspace.lockedNotice = false; pendingFocus = `#workspace-tab-${workspace.step}`; render(); break;
      case 'workspace-new-submission': guarded({ type: 'submission', value: '' }, startNewSubmission); break;
      case 'workspace-guard-stay': workspace.leaveGuard = null; pendingFocus = `#${stepTitleId(workspace.step)}`; render(); break;
      case 'workspace-open-evaluations': navigate('assessments'); break;
      case 'workspace-manage-rubrics': navigate('rubrics'); break;

      // Paso 1 · consignas en línea
      case 'workspace-question-new': workspace.questionEditor = emptyQuestionDraft(); workspace.questionDeleteId = ''; pendingFocus = '#ws-q-prompt'; render(); break;
      case 'workspace-question-edit': {
        const item = assessmentQuestions().find(row => String(row.id) === String(id));
        if (!item) break;
        if (workspace.questionEditor?.dirty && String(workspace.questionEditor.id) !== String(id)) { workspace.questionEditor.confirmCancel = true; pendingFocus = '[data-action="workspace-question-discard"]'; render(); break; }
        workspace.questionEditor = questionDraft(item); workspace.questionDeleteId = ''; pendingFocus = '#ws-q-prompt'; render(); break;
      }
      case 'workspace-question-cancel': {
        const draft = workspace.questionEditor;
        if (draft?.dirty && !draft.confirmCancel) { draft.confirmCancel = true; pendingFocus = '[data-action="workspace-question-discard"]'; render(); break; }
        workspace.questionEditor = null; pendingFocus = draft?.id ? `#ws-question-${draft.id} [data-action="workspace-question-edit"]` : '#ws-add-question'; render(); break;
      }
      case 'workspace-question-discard': { const draft = workspace.questionEditor; workspace.questionEditor = null; pendingFocus = draft?.id ? `#ws-question-${draft.id} [data-action="workspace-question-edit"]` : '#ws-add-question'; render(); break; }
      case 'workspace-question-keep': workspace.questionEditor.confirmCancel = false; pendingFocus = '#ws-q-prompt'; render(); break;
      case 'workspace-question-delete': workspace.questionDeleteId = id; workspace.questionDeleteError = ''; workspace.questionEditor = null; pendingFocus = '#ws-question-delete-cancel'; render(); break;
      case 'workspace-question-cancel-delete': pendingFocus = `#ws-question-${workspace.questionDeleteId} [data-action="workspace-question-delete"]`; workspace.questionDeleteId = ''; render(); break;
      case 'workspace-question-delete-confirm': await withActionLock(() => deleteQuestion(id)); break;
      case 'workspace-question-duplicate': await withActionLock(() => duplicateQuestion(id)); break;
      case 'workspace-question-move': await withActionLock(() => moveQuestion(id, Number(button.dataset.direction))); break;
      case 'workspace-score-step': {
        const input = content.querySelector(`#${CSS.escape(button.dataset.target)}`);
        if (!input || input.disabled) break;
        const next = Math.round(((Number(input.value) || 0) + Number(button.dataset.delta)) * 100) / 100;
        const max = input.max === '' ? Infinity : Number(input.max);
        input.value = String(Math.min(max, Math.max(Number(input.min) || 0, next)));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        break;
      }

      // Paso 1 · propuestas y materiales
      case 'workspace-suggest-toggle': workspace.suggestOpen = !(workspace.suggestOpen || workspace.questionSuggestions.length > 0); if (!workspace.suggestOpen) workspace.questionSuggestions = []; render(); break;
      case 'workspace-suggest-retry': case 'workspace-suggest-questions': await withActionLock(suggestQuestions); break;
      // Acciones históricas por sugerencia individual (compatibilidad con integraciones previas).
      case 'workspace-accept-question': workspace.questionSuggestions.forEach((item, position) => { item.selected = position === index; }); await withActionLock(acceptSelectedSuggestions); break;
      case 'workspace-discard-question': workspace.questionSuggestions = workspace.questionSuggestions.filter((_, position) => position !== index); render(); break;
      case 'workspace-accept-selected': await withActionLock(acceptSelectedSuggestions); break;
      case 'workspace-discard-suggestions': workspace.questionSuggestions = []; workspace.questionSuggestionDemo = false; render(); break;
      case 'workspace-import-reference': await withActionLock(importReference); break;
      case 'workspace-material-remove': workspace.materialConfirmRemove = true; pendingFocus = '[data-action="workspace-material-remove-cancel"]'; render(); break;
      case 'workspace-material-remove-cancel': workspace.materialConfirmRemove = false; render(); break;
      case 'workspace-material-remove-confirm': await withActionLock(removeReference); break;
      case 'workspace-remove-file': case 'workspace-remove-answer-file':
        if ((button.dataset.kind || 'answer') === 'material') workspace.materialFile = null; else workspace.answerFile = null;
        pendingFocus = `#workspace-${button.dataset.kind || 'answer'}-file`; render(); break;

      // Paso 2 · entregas
      case 'workspace-select-submission': {
        if (actionLocked || workspace.loadingSelection) break;
        guarded({ type: 'submission', value: id }, () => selectSubmission(id));
        break;
      }
      case 'workspace-queue-more': workspace.queueLimit += 50; render(); break;
      case 'workspace-clear-queue-filters': workspace.search = ''; workspace.statusFilter = 'all'; pendingFocus = '#workspace-search'; render(); break;

      // Paso 3 · revisión
      case 'workspace-nav': if (id) guarded({ type: 'submission', value: id }, () => selectSubmission(id)); break;
      case 'workspace-only-pending': workspace.review.onlyPending = !workspace.review.onlyPending; render(); break;
      case 'workspace-only-unreviewed': workspace.review.onlyUnreviewed = !workspace.review.onlyUnreviewed; render(); break;
      case 'workspace-criterion-toggle': if (workspace.review.open.has(index)) setCriterionOpen(index, false); else openOnlyCriterion(index); break;
      case 'workspace-final-score-reset': workspace.finalScore = ''; pendingFocus = '#workspace-final-score'; render(); announce('Nota final restablecida a la calculada por criterios.'); break;
      case 'workspace-restore-criterion': restoreCriterion(index); workspace.review.open = new Set([index]); pendingFocus = `#workspace-score-${index}`; render(); announce('Criterio restablecido a la sugerencia de la IA.'); break;
      case 'workspace-evidence-expand': {
        const quote = content.querySelector(`#ws-evidence-${index}`);
        const expanded = quote?.classList.toggle('is-clamped') === false;
        button.setAttribute('aria-expanded', String(expanded));
        button.textContent = expanded ? 'Ver menos' : 'Ver completa';
        break;
      }
      case 'workspace-show-evidence': showEvidence(index); break;
      case 'workspace-toggle-list': { const key = button.dataset.list; if (workspace.review.expandedLists.has(key)) workspace.review.expandedLists.delete(key); else workspace.review.expandedLists.add(key); render(); break; }
      case 'workspace-feedback-restore': workspace.feedback = workspace.correction?.proposal?.feedback || ''; render(); announce('Devolución restablecida a la propuesta.'); break;
      case 'workspace-copy-feedback': await copyText(workspace.feedback || workspace.proposal?.feedback || '', 'Devolución'); break;
      case 'workspace-copy-answer': await copyText(fullAnswerText(workspace.activeSubmission), 'Respuesta'); break;
      case 'workspace-approve-anyway': workspace.review.approveWarning = false; workspace.review.confirmedApprove = true; content.querySelector('#workspace-approve-form')?.requestSubmit(); break;
      case 'workspace-review-unreviewed': openFirstUnreviewed(); break;
      case 'workspace-more-menu': {
        workspace.review.menuOpen = !workspace.review.menuOpen;
        const menu = content.querySelector('#ws-more-menu');
        if (menu) menu.hidden = !workspace.review.menuOpen;
        button.setAttribute('aria-expanded', String(workspace.review.menuOpen));
        if (workspace.review.menuOpen) menu?.querySelector('[role="menuitem"]')?.focus();
        break;
      }
      case 'workspace-share': syncCurrentSelection(); openCorrectionShareModal(); break;
      case 'workspace-export': if (workspace.correction?.id) await api.download(`corrections/${workspace.correction.id}/export/`, `devolucion-maestria-${workspace.correction.id}.md`); break;
      case 'workspace-copy': syncCurrentSelection(); await copyCorrection(); break;
      case 'workspace-print': window.print(); break;
      default: return false;
    }
    return true;
  } catch (error) {
    workspace.error = error?.message || 'No se pudo completar la acción.';
    render();
    return true;
  }
}

export async function handleWorkspaceSubmit(form) {
  const id = form.id;
  if (id === 'workspace-question-form') { await saveQuestion({ chain: Boolean(workspace.questionEditor?.chain) }); return true; }
  if (id === 'workspace-suggest-form') { await withActionLock(suggestQuestions); return true; }
  if (actionLocked) return true;
  workspace.error = '';
  if (id === 'workspace-approve-form') {
    const unreviewed = criteria().length - reviewedCount();
    if (unreviewed > 0 && !workspace.review.confirmedApprove && !isApproved()) {
      workspace.review.approveWarning = true;
      pendingFocus = '[data-action="workspace-approve-anyway"]';
      render();
      return true;
    }
    workspace.review.confirmedApprove = false;
  }
  if (id === 'workspace-submission-form') { workspace.submitting = true; render(); }
  await withActionLock(async () => {
    if (id === 'workspace-context-form') {
      if (!(await saveContextAndOpenQuestion())) return;
      workspace.contextJustSaved = true;
      pendingFocus = '#ws-next-step button';
      toast('Contexto guardado.');
    } else if (id === 'workspace-submission-form') {
      await createSubmissionAndCorrection();
    } else if (id === 'workspace-approve-form') {
      await approveCorrection();
    }
  }).catch(error => { workspace.error = error?.message || 'No se pudo completar el flujo.'; });
  workspace.submitting = false;
  render();
  return true;
}

export function handleWorkspaceInput(event) {
  const target = event.target;
  if (target.matches('[data-workspace-field]')) {
    workspace[target.dataset.workspaceField] = target.value;
    if (target.dataset.workspaceField !== 'answerText' || !workspace.activeSubmission) workspace.contextJustSaved = false;
    updateCharCount(target);
    refreshSaveStatus();
    return true;
  }
  if (target.matches('[data-qe-field]')) {
    const draft = workspace.questionEditor;
    if (draft) { draft[target.dataset.qeField] = target.value; draft.dirty = true; workspace.contextJustSaved = false; refreshSaveStatus(); }
    return true;
  }
  if (target.matches('[data-workspace-search]')) {
    workspace.search = target.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      const list = content.querySelector('[data-workspace-queue]');
      if (list) list.innerHTML = queueListMarkup();
    }, SEARCH_DEBOUNCE_MS);
    return true;
  }
  if (target.matches('[data-workspace-suggest-count]')) { workspace.suggestCount = target.value; return true; }
  if (target.matches('[data-workspace-suggestion]')) {
    const item = workspace.questionSuggestions[Number(target.dataset.workspaceSuggestion)];
    if (item && target.dataset.field !== 'selected') item[target.dataset.field] = target.dataset.field === 'max_score' ? Number(target.value) : target.value;
    return true;
  }
  if (target.matches('[data-workspace-criterion]')) {
    const index = Number(target.dataset.workspaceCriterion);
    const item = criteria()[index];
    if (!item) return true;
    if (target.dataset.field === 'score') {
      const value = Number(target.value);
      const max = Number(item.max_score || 0);
      const valid = target.value !== '' && Number.isFinite(value) && value >= 0 && value <= max;
      const errorNode = content.querySelector(`[data-score-error="${index}"]`);
      if (errorNode) errorNode.textContent = valid ? '' : `! Ingresá un número entre 0 y ${formatNumber(max)}.`;
      target.setAttribute('aria-invalid', String(!valid));
      if (valid) item.score = value;
    } else {
      item[target.dataset.field] = target.value;
      updateCharCount(target);
    }
    refreshCriterion(index);
    return true;
  }
  if (target.matches('[data-workspace-feedback]')) { workspace.feedback = target.value; updateCharCount(target); refreshSaveStatus(); return true; }
  if (target.matches('[data-workspace-change-reason]')) { workspace.changeReason = target.value; return true; }
  if (target.matches('[data-workspace-final-score]')) {
    const { computed, max, minimum } = totals();
    const value = Number(String(target.value).replace(',', '.'));
    const valid = target.value !== '' && Number.isFinite(value) && value >= minimum && value <= max;
    target.setAttribute('aria-invalid', String(!valid && target.value !== ''));
    // Igual a la calculada = sin ajuste manual: sigue a los criterios si cambian.
    workspace.finalScore = valid && Math.abs(value - computed) >= 0.005 ? String(value) : (valid ? '' : target.value);
    refreshTotals();
    refreshSaveStatus();
    return true;
  }
  return false;
}

export async function handleWorkspaceChange(event) {
  const target = event.target;
  if (target.matches('[data-workspace-assessment]')) {
    const id = target.value;
    const change = async () => {
      workspace.loaded = false;
      workspace.error = '';
      if (id) { updateWorkspaceUrl({ assessment: id }); await loadWorkspaceData(id, null); } else {
        resetForAssessment(null);
        workspace.loaded = true;
        updateWorkspaceUrl({ assessment: '', submission: '' });
        render();
      }
    };
    if (anyDirty()) { target.value = workspace.assessmentId; guarded({ type: 'assessment', value: id }, change); } else await change();
    return true;
  }
  if (target.matches('[data-workspace-course]')) {
    workspace.courseFilter = target.value;
    const url = new URL(window.location.href);
    if (workspace.courseFilter === 'all') url.searchParams.delete('course'); else url.searchParams.set('course', workspace.courseFilter);
    window.history.replaceState({ ...(window.history.state || {}), view: 'workspace' }, '', url.toString());
    render();
    return true;
  }
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
  if (target.matches('[data-workspace-rubric]')) { workspace.rubricId = target.value; render(); return true; }
  if (target.matches('[data-workspace-feedback-style]')) {
    workspace.feedbackStyle = target.value;
    state.feedbackStyle = target.value;
    try { localStorage.setItem('maestria-feedback-style', target.value); } catch { /* preferencia en memoria */ }
    return true;
  }
  if (target.matches('[data-workspace-material-mode]')) { workspace.materialMode = target.value; return true; }
  if (target.matches('[data-workspace-queue-status]')) {
    workspace.statusFilter = ['pending', 'approved', 'all'].includes(target.value) ? target.value : 'pending';
    workspace.queueLimit = 50;
    pendingFocus = '#workspace-queue-status';
    render();
    return true;
  }
  if (target.matches('[data-workspace-suggestion][data-field="selected"]')) {
    const item = workspace.questionSuggestions[Number(target.dataset.workspaceSuggestion)];
    if (item) item.selected = target.checked;
    render();
    return true;
  }
  if (target.matches('[data-workspace-reviewed]')) {
    const index = Number(target.dataset.workspaceReviewed);
    if (target.checked) workspace.review.reviewed.add(index); else workspace.review.reviewed.delete(index);
    refreshCriterion(index);
    return true;
  }
  if (target.matches('[data-workspace-file]')) {
    setFile(target.dataset.workspaceFile, target.files?.[0] || null);
    return true;
  }
  return false;
}

function setFile(kind, file) {
  try { validateFile(file); } catch (error) { workspace.error = error.message; render(); return; }
  workspace.error = '';
  if (kind === 'material') workspace.materialFile = file;
  else { workspace.answerFile = file; if (file) workspace.answerText = ''; }
  pendingFocus = `[data-action="workspace-remove-file"][data-kind="${kind}"]`;
  render();
}

/* ---------- Teclado, doble clic y arrastrar/soltar ---------- */

function onKeydown(event) {
  if (state.view !== 'workspace') return;
  const target = event.target;
  const mod = event.ctrlKey || event.metaKey;

  if (target.matches?.('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const current = workspace.step;
    const next = event.key === 'Home' ? 1 : event.key === 'End' ? 3 : event.key === 'ArrowRight' ? Math.min(3, current + 1) : Math.max(1, current - 1);
    if (next === 3 && !canReview()) { content.querySelector('#workspace-tab-3')?.focus(); workspace.lockedNotice = true; pendingFocus = '#workspace-tab-3'; render(); return; }
    guarded({ type: 'step', value: next }, () => goToStep(next, { focusTab: true }));
    return;
  }

  if (target.closest?.('#ws-more-menu') && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault();
    const items = [...content.querySelectorAll('#ws-more-menu [role="menuitem"]')];
    const at = items.indexOf(target);
    items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    return;
  }

  if (event.key === 'Escape') {
    if (workspace.review.menuOpen) { event.preventDefault(); event.stopPropagation(); closeMoreMenu(true); return; }
    if (workspace.questionEditor && target.closest?.('#workspace-question-form')) { event.preventDefault(); event.stopPropagation(); content.querySelector('[data-action="workspace-question-cancel"]')?.click(); return; }
  }

  if (mod && event.key === 'Enter') {
    const form = target.closest?.('form');
    if (form?.id?.startsWith('workspace-')) { event.preventDefault(); form.requestSubmit(); }
    return;
  }

  if (event.key === 'Enter' && event.shiftKey && target.matches?.('#ws-q-max_score')) {
    event.preventDefault();
    if (workspace.questionEditor) workspace.questionEditor.chain = true;
    target.form?.requestSubmit();
    return;
  }

  if (mod && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (workspace.questionEditor) { content.querySelector('#workspace-question-form')?.requestSubmit(); return; }
    if (workspace.step === 1) content.querySelector('#workspace-context-form')?.requestSubmit();
    else if (workspace.step === 2 && stepDirty(2)) content.querySelector('#workspace-submission-form')?.requestSubmit();
    else toast(workspace.step === 3 ? 'Los cambios de la revisión se guardan al aprobar la devolución.' : 'No hay cambios para guardar.');
  }
}

function onDblclick(event) {
  const text = event.target.closest?.('[data-question-text]');
  if (!text || state.view !== 'workspace') return;
  const button = content.querySelector(`#ws-question-${CSS.escape(text.dataset.questionText)} [data-action="workspace-question-edit"]`);
  button?.click();
}

function onDrag(event) {
  const zone = event.target.closest?.('[data-dropzone]');
  if (!zone || state.view !== 'workspace') return;
  event.preventDefault();
  if (event.type === 'dragover') zone.classList.add('is-dragover');
  if (event.type === 'dragleave' && !zone.contains(event.relatedTarget)) zone.classList.remove('is-dragover');
  if (event.type === 'drop') {
    zone.classList.remove('is-dragover');
    const file = event.dataTransfer?.files?.[0];
    if (file) setFile(zone.dataset.dropzone, file);
  }
}

let bound = false;
export function bindWorkspaceEvents(root) {
  if (bound || !root) return;
  bound = true;
  root.addEventListener('keydown', onKeydown);
  root.addEventListener('dblclick', onDblclick);
  ['dragover', 'dragleave', 'drop'].forEach(type => root.addEventListener(type, onDrag));
  document.addEventListener('click', event => {
    if (workspace.review.menuOpen && !event.target.closest('.split-menu')) closeMoreMenu();
  });
}
