import { state } from '../../core/state.js';

/**
 * Estado en memoria del espacio de trabajo (una evaluación a la vez).
 * Todo lo que el docente escribe vive acá, así que re-renderizar o cambiar
 * de pestaña nunca pierde texto.
 */
export const workspace = {
  loaded: false,
  loading: false,
  loadingSelection: false,
  error: '',
  step: 1,
  assessmentId: '',
  courseFilter: 'all',
  aiProvider: 'mock',

  // Paso 1 · contexto y criterios
  questions: [],
  objectives: '',
  instructions: '',
  referenceMaterial: '',
  savedContext: { objectives: '', instructions: '' },
  contextJustSaved: false,
  rubricId: '',
  materialFile: null,
  materialMode: 'append',
  materialConfirmRemove: false,
  questionEditor: null,
  questionDeleteId: '',
  questionDeleteError: '',
  questionHighlight: '',
  questionSuggestions: [],
  questionSuggestionDemo: false,
  suggestCount: 3,
  suggestOpen: false,
  generatingQuestions: false,
  suggestError: '',

  // Paso 2 · entrega
  questionId: '',
  studentId: '',
  studentName: '',
  feedbackStyle: state.feedbackStyle || 'constructivo',
  answerText: '',
  answerFile: null,
  search: '',
  statusFilter: 'all',
  queueLimit: 50,
  proposalReady: false,

  // Paso 3 · revisión
  activeSubmission: null,
  correction: null,
  proposal: null,
  feedback: '',
  changeReason: '',
  baseline: '',
  review: { reviewed: new Set(), open: new Set(), onlyUnreviewed: false, onlyPending: false, feedbackMode: 'edit', approveWarning: false, menuOpen: false },

  // Aviso en línea al salir de un paso con cambios sin guardar.
  leaveGuard: null
};

export const STEP_TONES = Object.freeze({ 1: 2, 2: 3, 3: 1 });
const STEP_KEY = (id) => `maestria.workspace.step.${id}`;

export function rememberStep() {
  if (!workspace.assessmentId) return;
  try { sessionStorage.setItem(STEP_KEY(workspace.assessmentId), String(workspace.step)); } catch { /* almacenamiento no disponible */ }
}

export function recalledStep(id) {
  try { return Number(sessionStorage.getItem(STEP_KEY(id))) || 1; } catch { return 1; }
}

/* ---------- Selectores ---------- */

export const selectedAssessment = () => state.data.assessments.find(item => String(item.id) === String(workspace.assessmentId)) || null;
export const selectedRubric = () => state.data.rubrics.find(item => String(item.id) === String(workspace.rubricId)) || null;

export function assessmentQuestions() {
  return workspace.questions.filter(item => String(item.assessment) === String(workspace.assessmentId))
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0) || Number(a.id) - Number(b.id));
}

export const questionTotal = (questions = assessmentQuestions()) => questions.reduce((sum, item) => sum + Number(item.max_score || 0), 0);

export const assessmentSubmissions = () => state.data.submissions.filter(item => String(item.assessment) === String(workspace.assessmentId));

export const correctionFor = (submission) => state.data.corrections.find(row => String(row.submission) === String(submission.id)) || null;

/** pending (sin propuesta) · review · approved · rejected */
export function queueStatus(submission) {
  const correction = correctionFor(submission);
  if (correction?.status === 'approved') return 'approved';
  if (correction?.status === 'rejected') return 'rejected';
  if (correction) return 'review';
  return 'pending';
}

export function visibleSubmissions() {
  const query = workspace.search.trim().toLocaleLowerCase('es-AR');
  return assessmentSubmissions().filter(item => {
    const haystack = `${item.student_display_name || item.student_name || ''} ${item.source_filename || ''} ${item.answer_text || ''}`.toLocaleLowerCase('es-AR');
    if (query && !haystack.includes(query)) return false;
    const status = queueStatus(item);
    if (workspace.statusFilter === 'pending') return status !== 'approved';
    if (workspace.statusFilter === 'approved') return status === 'approved';
    return true;
  });
}

export const criteria = () => (Array.isArray(workspace.proposal?.criteria) ? workspace.proposal.criteria : []);
export const originalCriteria = () => (Array.isArray(workspace.correction?.proposal?.criteria) ? workspace.correction.proposal.criteria : []);
export const isApproved = () => workspace.correction?.status === 'approved';
export const canReview = () => Boolean(workspace.correction && workspace.proposal && workspace.activeSubmission);

/** Un criterio difiere de la propuesta original de la IA. */
export function criterionModified(index) {
  const current = criteria()[index];
  const original = originalCriteria()[index];
  if (!current || !original) return false;
  return Number(current.score) !== Number(original.score) || String(current.justification || '') !== String(original.justification || '') || String(current.level || '') !== String(original.level || '');
}

/* ---------- Cambios sin guardar ---------- */

export function stepDirty(step = workspace.step) {
  if (step === 1) return workspace.objectives !== workspace.savedContext.objectives || workspace.instructions !== workspace.savedContext.instructions;
  if (step === 2) {
    if (workspace.activeSubmission) return workspace.answerText !== (workspace.activeSubmission.answer_text || '');
    return Boolean(workspace.answerText.trim() || workspace.answerFile);
  }
  if (step === 3) return Boolean(workspace.correction) && !isApproved() && reviewSnapshot() !== workspace.baseline;
  return false;
}

export const anyDirty = () => [1, 2, 3].some(stepDirty);
export const reviewSnapshot = () => JSON.stringify([criteria().map(item => [Number(item.score), item.justification || '', item.level || '']), workspace.feedback]);
