import { state } from '../../core/state.js';
import { escapeHtml, statusPill, toolbarSelect, emptyState, showMore, icon } from '../../core/utils.js';
import { workspace, assessmentQuestions, assessmentSubmissions, visibleSubmissions, queueStatus, stepDirty, studentCode } from './workspace-state.js';
import { stepHeader, saveStatus, shortcutsHint, dropzone } from './workspace-markup.js';

const QUEUE_LABELS = Object.freeze({ pending: 'Sin propuesta', review: 'A revisar', approved: 'Aprobada', rejected: 'Rechazada' });
const QUEUE_PILL = Object.freeze({ pending: 'inactive', review: 'pending_review', approved: 'approved', rejected: 'rejected' });

const studentLabel = (item) => item.student_display_name || item.student_name || 'Estudiante sin identificar';

function queueCard(item) {
  const status = queueStatus(item);
  const active = String(workspace.activeSubmission?.id) === String(item.id);
  const code = studentCode(item);
  // Nombre y legajo identifican la entrega; el estado va en la píldora y en el borde de color.
  return `<button type="button" class="queue-card${active ? ' is-active' : ''}" data-status="${status}" data-action="workspace-select-submission" data-id="${escapeHtml(item.id)}" aria-pressed="${active}">
    <span class="queue-card-copy"><strong>${escapeHtml(studentLabel(item))}</strong><small class="queue-card-meta">${code ? `Legajo ${escapeHtml(code)}` : 'Sin legajo'}</small></span>
    ${statusPill(QUEUE_PILL[status], QUEUE_LABELS[status])}
  </button>`;
}

/** Sólo la lista (se reemplaza sola al buscar, sin re-renderizar el paso). */
export function queueListMarkup() {
  const all = assessmentSubmissions();
  const items = visibleSubmissions();
  if (!all.length) return emptyState('Todavía no hay entregas', 'Cargá la primera respuesta con el formulario de esta página.', '<a class="text-link" href="#workspace-answer-text">← Ir al formulario</a>');
  if (!items.length && workspace.statusFilter === 'pending' && !workspace.search.trim()) return `<div class="empty-state"><div class="empty-icon" aria-hidden="true">✓</div><h3>No quedan entregas pendientes.</h3><button type="button" class="text-link" data-action="workspace-clear-queue-filters">Ver todas</button></div>`;
  if (!items.length) return `<div class="empty-state"><div class="empty-icon" aria-hidden="true">✳</div><h3>No hay entregas con estos filtros.</h3><p>Probá con otro estado o búsqueda.</p><button type="button" class="text-link" data-action="workspace-clear-queue-filters">Limpiar filtros</button></div>`;
  const shown = items.slice(0, workspace.queueLimit);
  return `${shown.map(queueCard).join('')}${showMore(shown.length, items.length, 'workspace-queue-more')}`;
}

export function queueSummary() {
  const all = assessmentSubmissions();
  const reviewed = all.filter(item => ['approved', 'rejected'].includes(queueStatus(item))).length;
  const approved = all.filter(item => queueStatus(item) === 'approved').length;
  return { total: all.length, reviewed, approved, pending: all.length - approved };
}

/** Lista de entregas de la evaluación (por defecto, sólo las pendientes). */
function queuePanel() {
  const { total, approved, pending } = queueSummary();
  const filter = toolbarSelect('Filtrar entregas por estado', 'id="workspace-queue-status" data-workspace-queue-status', [
    { value: 'pending', label: `Pendientes (${pending})` },
    { value: 'approved', label: `Aprobadas (${approved})` },
    { value: 'all', label: `Todas (${total})` }
  ], workspace.statusFilter);
  return `<details class="queue-panel" id="ws-queue" open>
    <summary><span><strong>Entregas</strong> <span class="visually-hidden">·</span><small data-workspace-queue-count>${approved} de ${total} aprobadas</small></span></summary>
    <div class="queue-body">
      <div class="queue-tools"><label class="search-control"><span class="search-control-icon" aria-hidden="true">⌕</span><input id="workspace-search" class="search-input" type="search" value="${escapeHtml(workspace.search)}" data-workspace-search placeholder="Nombre o legajo" aria-label="Buscar entrega"></label>${filter}</div>
      <div class="queue-list" aria-live="polite" data-workspace-queue>${queueListMarkup()}</div>
    </div>
  </details>`;
}

export function deliveryStep() {
  const editing = Boolean(workspace.activeSubmission?.id);
  const students = state.data.students.filter(item => item.active);
  const questions = assessmentQuestions();
  const busy = workspace.submitting;
  const ctaLabel = busy ? 'Generando propuesta…' : editing ? 'Guardar y generar nueva propuesta' : 'Guardar y proponer corrección';
  const locked = editing ? 'disabled aria-describedby="workspace-identity-locked"' : '';
  // Con un archivo adjunto, la respuesta sale de ese archivo: el cuadro de texto queda bloqueado
  // para que no parezca que lo escrito ahí también se va a corregir.
  const fromFile = !editing && Boolean(workspace.answerFile);
  return `${stepHeader(2, editing ? 'Editar entrega' : 'Nueva entrega', editing ? 'Podés corregir el texto de la respuesta; el estudiante y la consigna no cambian.' : 'Elegí al estudiante y pegá o adjuntá su respuesta.', `<div class="step-head-tools">${editing ? `<button type="button" class="btn btn-secondary btn-small" data-action="workspace-new-submission">${icon('plus')} Nueva entrega</button>` : ''}${shortcutsHint('ws-shortcuts-2')}</div>`)}
    <div class="step-grid step-grid--delivery">
      <form id="workspace-submission-form" class="step-col" novalidate>
        <div class="form-grid">
          <div class="form-field"><label for="workspace-student-select">Estudiante</label><select id="workspace-student-select" data-workspace-student ${locked}><option value="">Elegir estudiante…</option>${students.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(workspace.studentId) ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></div>
          <div class="form-field"><label for="workspace-student-name">O un nombre identificador</label><input id="workspace-student-name" type="text" maxlength="180" value="${escapeHtml(workspace.studentName)}" data-workspace-field="studentName" placeholder="Ej. Estudiante 01" ${editing ? 'readonly aria-describedby="workspace-identity-locked"' : ''}></div>
        </div>
        ${editing ? '<p class="field-hint" id="workspace-identity-locked">La entrega queda vinculada a su estudiante original.</p>' : ''}
        <div class="form-field form-field--lead"><label for="workspace-answer-text">Respuesta del estudiante</label><textarea id="workspace-answer-text" class="lined lined--answer" maxlength="50000" data-workspace-field="answerText" placeholder="${fromFile ? 'Se va a usar el texto del archivo adjunto.' : 'Pegá acá la respuesta.'}" ${fromFile ? 'disabled' : ''}>${escapeHtml(workspace.answerText)}</textarea></div>
        ${editing ? '' : dropzone({ id: 'workspace-answer-file', kind: 'answer', file: workspace.answerFile, label: 'O adjuntá un archivo', hint: 'PDF con texto seleccionable, DOCX, TXT o MD · máx. 5 MB' })}
        <details class="disclosure" id="ws-delivery-options"><summary>Consigna y tono de la devolución ${icon('chevron')}</summary><div class="disclosure-body form-grid">
          <div class="form-field"><label for="workspace-question-select">Consigna específica</label><select id="workspace-question-select" data-workspace-question-select ${editing ? 'disabled' : ''}><option value="">Usar consigna general</option>${questions.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(workspace.questionId) ? 'selected' : ''}>${escapeHtml(item.prompt)}</option>`).join('')}</select></div>
          <div class="form-field"><label for="workspace-feedback-style">Tono de la devolución</label><select id="workspace-feedback-style" data-workspace-feedback-style><option value="formal" ${workspace.feedbackStyle === 'formal' ? 'selected' : ''}>Formal / académico</option><option value="constructivo" ${workspace.feedbackStyle === 'constructivo' ? 'selected' : ''}>Constructivo / orientador</option><option value="motivador" ${workspace.feedbackStyle === 'motivador' ? 'selected' : ''}>Motivador / empático</option></select></div>
        </div></details>
        <div class="cta-row">${saveStatus(2, stepDirty(2), editing ? 'Sin cambios' : 'Nada para guardar')}<button class="btn btn-primary btn-large" type="submit" id="ws-submit-delivery" ${busy ? 'disabled aria-busy="true"' : ''}>${ctaLabel}</button></div>
        <p class="field-hint cta-hint">El texto se envía al proveedor de IA: evitá datos personales innecesarios. La propuesta puede demorar un poco.</p>
      </form>
      ${queuePanel()}
    </div>`;
}
