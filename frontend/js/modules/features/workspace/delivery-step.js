import { state } from '../../core/state.js';
import { escapeHtml, date, statusPill, chipGroup, emptyState, showMore, icon } from '../../core/utils.js';
import { workspace, assessmentQuestions, assessmentSubmissions, visibleSubmissions, queueStatus, selectedAssessment, stepDirty } from './workspace-state.js';
import { stepHeader, saveStatus, shortcutsHint, dropzone } from './workspace-markup.js';

const QUEUE_LABELS = Object.freeze({ pending: 'Sin propuesta', review: 'A revisar', approved: 'Aprobada', rejected: 'Rechazada' });
const QUEUE_PILL = Object.freeze({ pending: 'inactive', review: 'pending_review', approved: 'approved', rejected: 'rejected' });

const studentLabel = (item) => item.student_display_name || item.student_name || 'Estudiante sin identificar';

function queueCard(item) {
  const status = queueStatus(item);
  const active = String(workspace.activeSubmission?.id) === String(item.id);
  const name = studentLabel(item);
  return `<button type="button" class="queue-card${active ? ' is-active' : ''}" data-status="${status}" data-action="workspace-select-submission" data-id="${escapeHtml(item.id)}" aria-pressed="${active}">
    <span class="avatar avatar-tone" aria-hidden="true">${escapeHtml(name.slice(0, 1).toLocaleUpperCase('es-AR'))}</span>
    <span class="queue-card-copy"><strong>${escapeHtml(name)}</strong><small class="queue-card-excerpt">${escapeHtml(item.source_filename || item.answer_text || 'Entrega')}</small><small class="queue-card-date">${escapeHtml(date(item.created_at, true))}</small></span>
    ${status === 'approved' ? '<span class="mini-stamp" aria-hidden="true">✓</span>' : ''}${statusPill(QUEUE_PILL[status], QUEUE_LABELS[status])}
  </button>`;
}

/** Sólo la lista (se reemplaza sola al buscar, sin re-renderizar el paso). */
export function queueListMarkup() {
  const all = assessmentSubmissions();
  const items = visibleSubmissions();
  if (!all.length) return emptyState('Todavía no hay entregas', 'Cargá la primera respuesta con el formulario de esta página.', '<a class="text-link" href="#workspace-answer-text">← Ir al formulario</a>');
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

function queuePanel() {
  const { total, reviewed, approved, pending } = queueSummary();
  return `<details class="queue-panel" id="ws-queue" open>
    <summary><span><strong>Entregas</strong> <span class="visually-hidden">·</span><small data-workspace-queue-count>${total} registradas · ${approved} aprobadas</small></span></summary>
    <div class="queue-body">
      <progress class="meter meter--progress" max="${Math.max(total, 1)}" value="${reviewed}" aria-label="Entregas revisadas" aria-describedby="ws-queue-progress-text" data-workspace-queue-progress></progress>
      <p class="progress-text" id="ws-queue-progress-text" data-workspace-queue-progress-text>${reviewed} de ${total} revisadas</p>
      <label class="search-control"><span class="search-control-icon" aria-hidden="true">⌕</span><input id="workspace-search" class="search-input" type="search" value="${escapeHtml(workspace.search)}" data-workspace-search placeholder="Nombre, archivo o primeras palabras" aria-label="Buscar entrega"></label>
      ${chipGroup('Filtrar entregas por estado', 'ws-queue-status', [{ value: 'all', label: 'Todas', count: total, active: workspace.statusFilter === 'all' }, { value: 'pending', label: 'Pendientes', count: pending, active: workspace.statusFilter === 'pending' }, { value: 'approved', label: 'Aprobadas', count: approved, active: workspace.statusFilter === 'approved' }])}
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
  return `${stepHeader(2, editing ? 'Editar entrega' : 'Nueva entrega', editing ? 'Modificá la respuesta: evaluación, consigna y estudiante originales se conservan.' : `Elegí a quién corresponde y cargá su respuesta para ${selectedAssessment()?.title || 'esta evaluación'}.`, shortcutsHint('ws-shortcuts-2'))}
    <div class="step-grid step-grid--delivery">
      <form id="workspace-submission-form" class="step-col" novalidate>
        <div class="form-grid">
          <div class="form-field"><label for="workspace-student-select">Estudiante</label><select id="workspace-student-select" data-workspace-student ${locked}><option value="">Elegir estudiante…</option>${students.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(workspace.studentId) ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></div>
          <div class="form-field"><label for="workspace-student-name">Nombre identificador</label><input id="workspace-student-name" type="text" maxlength="180" value="${escapeHtml(workspace.studentName)}" data-workspace-field="studentName" placeholder="Ej. Estudiante 01" title="Si no está en la lista, escribí un nombre para identificar la entrega." ${editing ? 'readonly aria-describedby="workspace-identity-locked"' : ''}></div>
        </div>
        <p class="field-hint" ${editing ? 'id="workspace-identity-locked"' : ''}>${editing ? 'La identidad del estudiante queda vinculada a la entrega original.' : 'Elegí de la lista o escribí un nombre identificador.'}</p>
        <div class="form-field form-field--lead"><div class="label-row"><label for="workspace-answer-text">Respuesta del estudiante</label><span class="char-count" data-char-count="workspace-answer-text">${workspace.answerText.length.toLocaleString('es-AR')} caracteres</span></div><textarea id="workspace-answer-text" class="lined lined--answer" maxlength="50000" data-workspace-field="answerText" placeholder="Pegá acá la respuesta. Se conserva el texto original para contrastarlo con la propuesta.">${escapeHtml(workspace.answerText)}</textarea></div>
        ${editing ? '<p class="field-hint">Para reevaluar una entrega existente, editá el texto extraído. El archivo fuente original se conserva.</p>' : dropzone({ id: 'workspace-answer-file', kind: 'answer', file: workspace.answerFile, hint: 'TXT, MD, PDF con texto seleccionable o DOCX · máximo 5 MB' })}
        <details class="disclosure" id="ws-delivery-options"><summary>Opciones de la entrega (consigna y tono) ${icon('chevron')}</summary><div class="disclosure-body form-grid">
          <div class="form-field"><label for="workspace-question-select">Consigna específica</label><select id="workspace-question-select" data-workspace-question-select ${editing ? 'disabled' : ''}><option value="">Usar consigna general</option>${questions.map(item => `<option value="${escapeHtml(item.id)}" ${String(item.id) === String(workspace.questionId) ? 'selected' : ''}>${escapeHtml(item.prompt)}</option>`).join('')}</select></div>
          <div class="form-field"><label for="workspace-feedback-style">Tono de la devolución</label><select id="workspace-feedback-style" data-workspace-feedback-style><option value="formal" ${workspace.feedbackStyle === 'formal' ? 'selected' : ''}>Formal / académico</option><option value="constructivo" ${workspace.feedbackStyle === 'constructivo' ? 'selected' : ''}>Constructivo / orientador</option><option value="motivador" ${workspace.feedbackStyle === 'motivador' ? 'selected' : ''}>Motivador / empático</option></select></div>
        </div></details>
        <details class="disclosure" id="ws-privacy"><summary><span class="info-dot" aria-hidden="true"></span>Privacidad y uso de IA <span class="visually-hidden">(información recomendada)</span> ${icon('chevron')}</summary><div class="disclosure-body"><p>Antes de enviar una respuesta a un proveedor de IA, evitá incluir datos personales innecesarios. Verificá la configuración del proveedor y revisá el texto extraído antes de confiar en una propuesta.</p></div></details>
        <div class="cta-row">${saveStatus(2, stepDirty(2), editing ? 'Sin cambios' : 'Nada para guardar')}<button class="btn btn-primary btn-large" type="submit" id="ws-submit-delivery" ${busy ? 'disabled aria-busy="true"' : ''}>${ctaLabel}</button></div>
        <p class="field-hint cta-hint">La generación puede tardar. La IA propone; vos revisás y decidís la calificación final.</p>
      </form>
      ${queuePanel()}
    </div>`;
}
