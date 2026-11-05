import { state, modal, modalContent } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml, formatInputNumber, formField, textField, selectField, optionRows, formValues, errorText } from '../core/utils.js';
import { openModal, closeModal, modalForm, setModalError, toast } from '../core/ui.js';
import { afterWrite, loadAssessmentEditor } from '../data/repository.js';
import { render } from '../core/router.js';

export {
  studentForm, assessmentForm, questionForm, rubricForm, importStudentsForm,
  enrollmentForm, submissionForm, generateQuestionsForm, importReferenceForm,
  newRubricCriterionForm, editCriterionForm, editLevelForm, newLevelForm
} from './forms/teacher.js';

export {
  adminUserForm, institutionForm, membershipForm, messageForm, providerForm
} from './forms/admin.js';

export async function handleModalSubmit(form, button) {
  if (state.modalBusy || !form.reportValidity()) return;
  const kind = state.modalKind;
  const values = formValues(form);
  try {
    state.modalBusy = true;
    if (button) { button.disabled = true; button.textContent = 'Guardando…'; }
    setModalError('');
    if (kind === 'new-course' || kind === 'edit-course') {
      const payload = { name: values.name.trim(), subject: values.subject.trim(), level: values.level.trim(), academic_year: values.academic_year.trim(), description: values.description.trim() };
      if (kind === 'new-course') await api.post('courses/', payload);
      else await api.patch(`courses/${modal.dataset.recordId}/`, payload);
      closeModal(true); await afterWrite(kind === 'new-course' ? 'Curso creado.' : 'Curso actualizado.');
    } else if (kind === 'new-student' || kind === 'edit-student') {
      const payload = { name: values.name.trim(), email: values.email.trim(), phone: values.phone.trim(), external_code: values.external_code.trim() };
      if (kind === 'new-student') { payload.course = Number(values.course); await api.post('students/', payload); }
      else { payload.active = values.active === 'true'; await api.patch(`students/${modal.dataset.recordId}/`, payload); }
      closeModal(true); await afterWrite(kind === 'new-student' ? 'Estudiante agregado y matriculado.' : 'Estudiante actualizado.');
    } else if (kind === 'new-assessment' || kind === 'edit-assessment') {
      const payload = { title: values.title.trim(), course: values.course ? Number(values.course) : null, subject: values.subject.trim(), level: values.level.trim(), status: values.status, objectives: values.objectives.trim(), instructions: values.instructions.trim(), reference_material: values.reference_material.trim() };
      if (kind === 'new-assessment') await api.post('assessments/', payload);
      else await api.patch(`assessments/${modal.dataset.recordId}/`, payload);
      closeModal(true); await afterWrite(kind === 'new-assessment' ? 'Evaluación creada.' : 'Evaluación actualizada.');
    } else if (kind === 'new-question' || kind === 'edit-question') {
      const assessmentId = Number(modal.dataset.assessmentId || state.selectedAssessment || values.assessment || 0);
      const payload = { prompt: values.prompt.trim(), expected_answer: values.expected_answer.trim(), question_type: values.question_type, max_score: Number(values.max_score), position: Number(values.position || 0), rubric: values.rubric ? Number(values.rubric) : null };
      if (kind === 'new-question') {
        payload.assessment = assessmentId;
        await api.post('questions/', payload);
      } else {
        // The assessment relationship is immutable after creation; do not send a stale FK in PATCH.
        await api.patch(`questions/${modal.dataset.recordId}/`, payload);
      }
      closeModal(true); state.assessmentEditor = await loadAssessmentEditor(assessmentId); await afterWrite(kind === 'new-question' ? 'Consigna creada.' : 'Consigna actualizada.');
    } else if (kind === 'new-rubric' || kind === 'edit-rubric') {
      const payload = { title: values.title.trim(), description: values.description.trim(), scale_type: values.scale_type };
      if (kind === 'edit-rubric') {
        await api.patch(`rubrics/${modal.dataset.recordId}/`, payload);
      } else {
        const names = values.criteria_text.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
        if (names.length < 2 || names.length > 20) throw new Error('Ingresá entre 2 y 20 criterios, uno por línea.');
        payload.criteria = names.map(name => ({ name, description: '', max_score: 10, weight: Math.round(100 / names.length * 100) / 100 }));
        await api.post('rubrics/create-with-criteria/', payload);
      }
      closeModal(true); await afterWrite(kind === 'new-rubric' ? 'Rúbrica creada.' : 'Rúbrica actualizada.');
    } else if (kind === 'import-students') {
      const file = form.querySelector('[name="file"]')?.files?.[0];
      if (!file) throw new Error('Seleccioná un archivo CSV.');
      const payload = new FormData(); payload.append('file', file); payload.append('course', values.course);
      const result = await api.upload('students/import-csv/', payload);
      closeModal(true);
      const skipped = Number(result.skipped || 0);
      const reasons = (result.errors || []).slice(0, 3).map(item => `fila ${item.row}: ${item.reason}`).join('; ');
      await afterWrite(`Importación finalizada: ${result.created ?? 0} estudiantes agregados${skipped ? `, ${skipped} omitidos (${reasons})` : ''}.`);
    } else if (kind === 'enroll-student') {
      await api.post('enrollments/', { course: Number(modal.dataset.courseId), student: Number(values.student), status: 'active', notes: values.notes.trim() });
      closeModal(true); await afterWrite('Estudiante matriculado.');
    } else if (kind === 'new-submission') {
      const file = form.querySelector('[name="file"]')?.files?.[0];
      if (file) {
        const payload = new FormData(); payload.append('file', file); payload.append('assessment', values.assessment);
        if (values.student) payload.append('student', values.student);
        if (values.student_name.trim()) payload.append('student_name', values.student_name.trim());
        if (values.question) payload.append('question', values.question);
        await api.upload('submissions/import-file/', payload);
      } else {
        if (!values.answer_text.trim()) throw new Error('Ingresá una respuesta o seleccioná un archivo.');
        await api.post('submissions/', { assessment: Number(values.assessment), question: values.question ? Number(values.question) : null, student: values.student ? Number(values.student) : null, student_name: values.student_name.trim(), answer_text: values.answer_text.trim(), source_type: 'text' });
      }
      closeModal(true); await afterWrite('Entrega registrada.');
    } else if (kind === 'generate-questions') {
      const result = await api.post(`assessments/${modal.dataset.recordId}/generate-questions/`, { count: Number(values.count) });
      state.questionProposal = { assessmentId: Number(modal.dataset.recordId), result };
      closeModal(true); showQuestionProposal(result, Number(modal.dataset.recordId));
    } else if (kind === 'import-reference') {
      const file = form.querySelector('[name="file"]')?.files?.[0];
      if (!file) throw new Error('Seleccioná un archivo.');
      const payload = new FormData(); payload.append('file', file); payload.append('mode', values.mode);
      const result = await api.upload(`assessments/${modal.dataset.recordId}/import-reference/`, payload);
      closeModal(true); toast(`Material importado: ${result.chars} caracteres extraídos.`); state.assessmentEditor = await loadAssessmentEditor(Number(modal.dataset.recordId)); render();
    } else if (kind === 'generate-rubric') {
      const result = await api.post('rubrics/generate/', {
        title: values.title.trim(), subject: values.subject.trim(), level: values.level.trim(),
        count: Number(values.count), objectives: values.objectives.trim(), instructions: values.instructions.trim(),
        question_prompts: values.question_prompts.split(/\r?\n/).map(item => item.trim()).filter(Boolean).slice(0, 10),
        reference_material: values.reference_material.trim()
      }, { timeoutMs: 180000 });
      closeModal(true); showRubricProposal(result);
    } else if (kind === 'save-rubric-proposal') {
      const criteriaCount = Number(modal.dataset.criteriaCount || 0);
      const proposal = state.rubricProposal;
      const criteria = (proposal?.criteria || []).slice(0, criteriaCount).map((item, index) => ({
        name: String(form.querySelector(`[name=\"criterion-${index}\"]`)?.value || item.name || '').trim(),
        description: String(form.querySelector(`[name="criterion-description-${index}"]`)?.value ?? item.description ?? '').trim(), max_score: Number(form.querySelector(`[name="criterion-score-${index}"]`)?.value ?? item.max_score ?? 10), weight: Number(form.querySelector(`[name="criterion-weight-${index}"]`)?.value ?? item.weight ?? 1)
      })).filter(item => item.name);
      if (criteria.length < 2) throw new Error('La rúbrica debe contener al menos dos criterios.');
      if (criteria.some(item => !Number.isFinite(item.max_score) || item.max_score < 0.5 || item.max_score > 1000 || !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 100)) throw new Error('Revisá los puntajes máximos y las ponderaciones de los criterios.');
      await api.post('rubrics/create-with-criteria/', {
        title: values.title.trim(), description: values.description.trim(), scale_type: values.scale_type || 'both', criteria
      });
      closeModal(true); await afterWrite('Rúbrica propuesta guardada.');
    } else if (kind === 'new-criterion') {
      const existingRubric = state.data.rubrics.find(item => String(item.id) === String(modal.dataset.rubricId));
      await api.post('rubric-criteria/', { rubric: Number(modal.dataset.rubricId), name: values.name.trim(), max_score: Number(values.max_score), weight: Number(values.weight || 1), description: values.description.trim(), position: (existingRubric?.criteria?.length || 0) + 1 });
      closeModal(true); await afterWrite('Criterio agregado.');
    } else if (kind === 'edit-criterion') {
      await api.patch(`rubric-criteria/${modal.dataset.recordId}/`, { name: values.name.trim(), max_score: Number(values.max_score), weight: Number(values.weight || 0), description: values.description.trim() });
      closeModal(true); await afterWrite('Criterio actualizado.');
    } else if (kind === 'new-level') {
      await api.post('rubric-levels/', { criterion: Number(modal.dataset.criterionId), name: values.name.trim(), score: Number(values.score), description: values.description.trim(), position: 1 });
      closeModal(true); await afterWrite('Nivel agregado.');
    } else if (kind === 'edit-level') {
      await api.patch(`rubric-levels/${modal.dataset.recordId}/`, { name: values.name.trim(), score: Number(values.score), description: values.description.trim() });
      closeModal(true); await afterWrite('Nivel actualizado.');
    } else if (kind === 'new-admin-user' || kind === 'edit-admin-user') {
      const payload = { email: values.email.trim(), full_name: values.full_name.trim(), role: values.role, status: values.status, suspension_reason: values.suspension_reason.trim() };
      if (kind === 'new-admin-user') { payload.user_id = values.user_id.trim(); await api.post('admin/users/', payload); }
      else await api.patch(`admin/users/${modal.dataset.recordId}/`, payload);
      closeModal(true); await afterWrite('Perfil actualizado.', ['admin']);
    } else if (kind === 'new-institution' || kind === 'edit-institution' || kind === 'edit-institution-scope') {
      const payload = kind === 'edit-institution-scope'
        ? { name: values.name.trim(), contact_email: values.contact_email.trim() }
        : { name: values.name.trim(), slug: values.slug.trim(), contact_email: values.contact_email.trim(), status: values.status };
      if (kind === 'new-institution') await api.post('admin/institutions/', payload);
      else await api.patch(`admin/institutions/${modal.dataset.recordId}/`, payload);
      closeModal(true); await afterWrite('Institución guardada.', ['admin']);
    } else if (kind === 'new-membership' || kind === 'edit-membership') {
      if (kind === 'new-membership') {
        await api.post('admin/institution-memberships/', { institution: Number(values.institution), user_id: values.user_id.trim(), role: values.role, status: values.status });
      } else {
        await api.patch(`admin/institution-memberships/${modal.dataset.recordId}/`, { role: values.role, status: values.status });
      }
      closeModal(true); await afterWrite('Membresía guardada.', ['admin']);
    } else if (kind === 'edit-message') {
      const payload = { status: values.status, assigned_to: values.assigned_to || null, internal_notes: values.internal_notes.trim() };
      await api.patch(`admin/contact-messages/${modal.dataset.recordId}/`, payload);
      closeModal(true); await afterWrite('Mensaje actualizado.', ['admin']);
    } else if (kind === 'new-provider' || kind === 'edit-provider') {
      const payload = { provider: values.provider, model_name: values.model_name.trim(), enabled: values.enabled === 'true', priority: Number(values.priority), timeout_seconds: Number(values.timeout_seconds), input_usd_per_1k_tokens: values.input_usd_per_1k_tokens === '' ? null : Number(values.input_usd_per_1k_tokens), output_usd_per_1k_tokens: values.output_usd_per_1k_tokens === '' ? null : Number(values.output_usd_per_1k_tokens) };
      if (kind === 'new-provider') await api.post('admin/ai-providers/', payload);
      else await api.patch(`admin/ai-providers/${modal.dataset.recordId}/`, payload);
      closeModal(true); await afterWrite('Configuración de proveedor guardada.', ['admin']);
    } else {
      throw new Error('La acción solicitada no está disponible.');
    }
  } catch (error) {
    setModalError(errorText(error));
    state.modalBusy = false;
    if (button) { button.disabled = false; button.textContent = 'Guardar'; }
  }
}

export function showQuestionProposal(result, assessmentId) {
  const questions = Array.isArray(result?.questions) ? result.questions : [];
  if (!questions.length) { toast('El proveedor no devolvió consignas para revisar.', 'error'); return; }
  const items = questions.map((question, index) => `<label class="proposal-item"><input type="checkbox" name="selected" value="${index}" checked><span><strong>Consigna ${index + 1}</strong><br>${escapeHtml(question.prompt || question.question || '')}</span></label>`).join('');
  openModal('Revisar consignas propuestas', `<form id="proposal-questions-form"><p>${result.demo ? 'La propuesta proviene del modo MOCK; revisala cuidadosamente antes de incorporarla.' : 'Seleccioná las consignas que querés incorporar a la evaluación.'}</p>${items}<div class="form-error" id="modal-error" role="alert"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-modal>Descartar</button><button type="submit" class="btn btn-primary">Guardar consignas seleccionadas</button></div></form>`, 'save-question-proposal', true);
  modal.dataset.assessmentId = assessmentId;
  state.questionProposal = { assessmentId, result };
}

export async function handleQuestionProposal(form, button) {
  const selected = new FormData(form).getAll('selected').map(Number);
  const result = state.questionProposal?.result;
  const questions = (result?.questions || []).filter((_, index) => selected.includes(index));
  if (!questions.length) { setModalError('Seleccioná al menos una consigna.'); return; }
  try {
    button.disabled = true;
    for (let index = 0; index < questions.length; index += 1) {
      const item = questions[index];
      await api.post('questions/', {
        assessment: Number(state.questionProposal.assessmentId), prompt: String(item.prompt || item.question || '').trim(),
        expected_answer: String(item.expected_answer || ''), question_type: ['open', 'short', 'case'].includes(item.question_type) ? item.question_type : 'open',
        max_score: Number(item.max_score || 10), position: Number(item.position || index + 1), rubric: item.rubric_id ? Number(item.rubric_id) : null
      });
    }
    const id = state.questionProposal.assessmentId;
    closeModal(true); state.assessmentEditor = await loadAssessmentEditor(id); render(); toast('Consignas seleccionadas guardadas.');
  } catch (error) { setModalError(errorText(error)); button.disabled = false; }
}

export function showRubricProposal(result) {
  const criteria = Array.isArray(result?.criteria) ? result.criteria : [];
  if (!criteria.length) { toast('El proveedor no devolvió criterios.', 'error'); return; }
  state.rubricProposal = result;
  const fields = `${formField('Título', 'title', result.rubric_title || 'Rúbrica sugerida', 'text', 'maxlength="180"', true)}${selectField('Tipo de escala', 'scale_type', [{ value: 'numeric', label: 'Numérica' }, { value: 'levels', label: 'Niveles' }, { value: 'both', label: 'Numérica y niveles' }], 'both')}${textField('Descripción', 'description', result.description || '')}<div class="form-field full"><label>Criterios sugeridos (podés editarlos antes de guardar)</label>${criteria.map((item, index) => `<fieldset class="proposal-criterion"><legend>Criterio ${index + 1}</legend><div class="form-grid"><div class="form-field full"><label for="criterion-name-${index}">Nombre</label><input id="criterion-name-${index}" type="text" name="criterion-${index}" value="${escapeHtml(item.name || '')}" required maxlength="180"></div><div class="form-field full"><label for="criterion-description-${index}">Descripción</label><textarea id="criterion-description-${index}" name="criterion-description-${index}">${escapeHtml(item.description || '')}</textarea></div><div class="form-field"><label for="criterion-score-${index}">Puntaje máximo</label><input id="criterion-score-${index}" type="number" name="criterion-score-${index}" min="0.5" max="1000" step="0.5" value="${escapeHtml(formatInputNumber(item.max_score ?? 10))}" required></div><div class="form-field"><label for="criterion-weight-${index}">Ponderación (%)</label><input id="criterion-weight-${index}" type="number" name="criterion-weight-${index}" min="0" max="100" step="0.1" value="${escapeHtml(formatInputNumber(item.weight ?? 1))}" required></div></div></fieldset>`).join('')}</div>`;
  openModal('Revisar rúbrica propuesta', modalForm(fields, 'Guardar rúbrica'), 'save-rubric-proposal', true);
  modal.dataset.criteriaCount = String(criteria.length);
  const notice = document.createElement('p'); notice.className = 'notice'; notice.textContent = result.demo ? 'Modo MOCK: esta propuesta es orientativa y debe adaptarse antes de usarla.' : 'Revisá y adaptá los criterios antes de guardarlos.';
  modalContent.querySelector('form')?.prepend(notice);
}

export async function generateRubric(assessmentId = null) {
  let assessment = null;
  let questions = [];
  if (assessmentId) {
    const payload = state.assessmentEditor?.assessment?.id === Number(assessmentId) ? state.assessmentEditor : await loadAssessmentEditor(assessmentId);
    assessment = payload?.assessment || state.data.assessments.find(item => String(item.id) === String(assessmentId));
    questions = payload?.questions || [];
  }
  const fields = `${formField('Título de la rúbrica', 'title', assessment ? `${assessment.title} · Rúbrica` : '', 'text', 'maxlength="180"', true)}${formField('Materia', 'subject', assessment?.subject || assessment?.course_name || '', 'text', 'maxlength="120"')}${formField('Nivel', 'level', assessment?.level || '', 'text', 'maxlength="120"')}${formField('Cantidad de criterios', 'count', '4', 'number', 'min="2" max="6"', true)}${textField('Objetivos', 'objectives', assessment?.objectives || '')}${textField('Instrucciones', 'instructions', assessment?.instructions || '')}${textField('Consignas relacionadas (una por línea)', 'question_prompts', questions.slice(0, 10).map(item => item.prompt).join('\n'))}${textField('Material de referencia', 'reference_material', assessment?.reference_material || '')}`;
  openModal(assessment ? 'Proponer rúbrica para la evaluación' : 'Generar una rúbrica', modalForm(fields, 'Generar propuesta'), 'generate-rubric', true);
}

export async function handleGenerateCorrection(form, button) {
  const values = formValues(form);
  try {
    button.disabled = true; button.textContent = 'Generando…';
    const result = await api.post(`submissions/${state.currentSubmission.id}/generate-correction/`, { rubric_id: values.rubric_id ? Number(values.rubric_id) : null, feedback_style: values.feedback_style || state.feedbackStyle || 'constructivo' }, { timeoutMs: 180000 });
    state.currentCorrection = result; state.selectedCorrection = result.id; state.view = 'correction';
    if (state.currentSubmission) state.currentSubmission = { ...state.currentSubmission, status: 'review' };
    await afterWrite(result.proposal?.demo ? 'Se generó una propuesta de demostración.' : 'Propuesta generada.');
  } catch (error) { toast(errorText(error), 'error'); button.disabled = false; button.textContent = 'Generar propuesta de corrección'; }
}

export async function handleApproveCorrection(form, button) {
  const correction = state.currentCorrection;
  const proposal = correction?.proposal;
  if (!correction || proposal?.demo) return;
  const criteria = Array.isArray(proposal?.criteria) ? proposal.criteria : [];
  const finalCriteria = criteria.map((item, index) => ({
    ...item,
    score: Number(form.querySelector(`[name="score-${index}"]`)?.value),
    level: form.querySelector(`[name="level-${index}"]`)?.value || '',
    justification: form.querySelector(`[name="justification-${index}"]`)?.value || '',
    evidence: form.querySelector(`[name="evidence-${index}"]`)?.value || ''
  }));
  const changed = finalCriteria.some((item, index) => Number(item.score) !== Number(criteria[index].score));
  const changeReason = form.querySelector('[name="change_reason"]')?.value?.trim() || '';
  if (changed && changeReason.length < 8) { toast('Explicá el motivo del cambio de puntaje (al menos 8 caracteres).', 'error'); return; }
  if (!window.confirm('¿Confirmás la aprobación de esta devolución?')) return;
  try {
    button.disabled = true; button.textContent = 'Aprobando…';
    const result = await api.post(`corrections/${correction.id}/approve/`, { final_result: { ...proposal, criteria: finalCriteria }, teacher_feedback: form.querySelector('[name="teacher_feedback"]')?.value || '', change_reason: changeReason }, { timeoutMs: 90000 });
    // La respuesta de /approve/ ya es la corrección completa; afterWrite la vuelve a leer una sola vez.
    state.currentCorrection = result;
    state.selectedCorrection = result.id;
    state.view = 'correction';
    await afterWrite('Devolución aprobada y registrada.');
  } catch (error) { toast(errorText(error), 'error'); button.disabled = false; button.textContent = 'Aprobar devolución'; }
}

export async function handleAddSubmissionAnswer(form) {
  if (!form.reportValidity()) return;
  const values = formValues(form);
  const button = form.querySelector('[type="submit"]');
  if (button?.disabled) return;
  if (button) { button.disabled = true; button.textContent = 'Guardando…'; }
  try {
    await api.post('submission-answers/', { submission: Number(state.currentSubmission.id), question: Number(values.question), answer_text: values.answer_text.trim() });
    state.currentSubmission = await api.get(`submissions/${state.currentSubmission.id}/`);
    await afterWrite('Respuesta agregada a la entrega.');
  } catch (error) { toast(errorText(error), 'error'); if (button) { button.disabled = false; button.textContent = 'Agregar respuesta'; } }
}
