import { api } from './core/api.js';
import { state, content, modal, $, $$ } from './core/state.js';
import { toast, openModal, closeModal, setSidebarCollapsed, openSidebar, closeSidebar, toggleTheme } from './core/ui.js';
import { navigate, render } from './core/router.js';
import { refreshCore, refreshAdmin, loadAssessmentEditor, loadCorrectionForSubmission, afterWrite } from './data/repository.js';
import { errorText, escapeHtml } from './core/utils.js';
import { courseIdForSubmission, courseIdForCorrection } from './core/utils.js';
import { courseForm } from './features/courses.js';
import { studentForm, assessmentForm, questionForm, rubricForm, importStudentsForm, enrollmentForm, submissionForm, generateQuestionsForm, importReferenceForm, newRubricCriterionForm, editCriterionForm, editLevelForm, newLevelForm, adminUserForm, institutionForm, membershipForm, messageForm, providerForm, generateRubric, handleModalSubmit, handleGenerateCorrection, handleApproveCorrection, handleAddSubmissionAnswer, handleQuestionProposal } from './features/forms.js';
import { copyCorrection, openCorrectionShareModal, handleShareAction } from './features/share.js';
import { saveProfilePreferences } from './features/profile.js';
import { GUIDE_STEPS, guideStep, setGuideStep, renderQuickStart, openQuickStart, closeQuickStart } from './features/guide.js';

async function openSubmission(id) {
  const submission = await api.get(`submissions/${id}/`);
  state.currentSubmission = submission;
  const submissionCourse = courseIdForSubmission(submission);
  if (submissionCourse != null) state.selectedCourse = submissionCourse;
  state.correctionOrigin = state.view === 'course' ? 'course' : 'submissions';
  try { state.assessmentEditor = await loadAssessmentEditor(submission.assessment); } catch { state.assessmentEditor = null; }
  state.selectedSubmission = id;
  const correction = await loadCorrectionForSubmission(id);
  if (correction) {
    state.currentCorrection = correction;
    state.selectedCorrection = correction.id;
    state.view = 'correction';
  } else {
    state.currentCorrection = null;
    state.view = 'submission';
  }
  render();
}

async function openCorrection(id) {
  state.correctionOrigin = state.view === 'course' ? 'course' : state.view === 'corrections' ? 'corrections' : 'submissions';
  const correction = await api.get(`corrections/${id}/`);
  state.currentCorrection = correction;
  state.selectedCorrection = id;
  const correctionCourse = courseIdForCorrection(correction);
  if (correctionCourse != null) state.selectedCourse = correctionCourse;
  if (!state.currentSubmission || String(state.currentSubmission.id) !== String(correction.submission)) {
    state.currentSubmission = await api.get(`submissions/${correction.submission}/`);
    state.selectedSubmission = correction.submission;
    const submissionCourse = courseIdForSubmission(state.currentSubmission);
    if (submissionCourse != null) state.selectedCourse = submissionCourse;
  }
  state.view = 'correction'; render();
}

async function clickAction(button) {
  const action = button.dataset.action;
  const id = button.dataset.id;
  try {
    switch (action) {
      case 'navigate': navigate(button.dataset.view); break;
      case 'open-fold': {
        const fold = $(`.course-fold[data-fold="${button.dataset.fold}"]`, content);
        if (!fold) break;
        fold.open = true;
        fold.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        $('summary', fold)?.focus({ preventScroll: true });
        break;
      }
      case 'seed-demo': {
        if (!window.confirm('Se creará un conjunto de práctica con datos ficticios. ¿Continuar?')) break;
        const result = await api.post('demo/seed/', {}); await refreshCore(); state.selectedCourse = result.course_id; state.selectedAssessment = result.assessment_id; state.view = 'assessment'; state.assessmentEditor = await loadAssessmentEditor(result.assessment_id); render(); toast(result.message || 'Ejemplo de práctica disponible.'); break;
      }
      case 'new-course': courseForm(); break;
      case 'edit-course': courseForm(state.data.courses.find(item => String(item.id) === String(id))); break;
      case 'open-course': state.selectedCourse = id; navigate('course'); break;
      case 'open-course-corrections': state.selectedCourse = id; state.view = 'course'; render(); break;
      case 'toggle-course': {
        const item = state.data.courses.find(row => String(row.id) === String(id));
        if (!item || !window.confirm(item.active ? '¿Archivar este curso?' : '¿Reactivar este curso?')) break;
        await api.patch(`courses/${id}/`, { active: !item.active }); await afterWrite(item.active ? 'Curso archivado.' : 'Curso reactivado.'); break;
      }
      case 'new-student': {
        const defaultCourse = button.dataset.course || (state.view === 'course' ? state.selectedCourse : !['all', 'unassigned'].includes(state.studentCourseFilter) ? state.studentCourseFilter : '');
        studentForm(null, defaultCourse || ''); break;
      }
      case 'edit-student': studentForm(state.data.students.find(item => String(item.id) === String(id))); break;
      case 'toggle-student': {
        const item = state.data.students.find(row => String(row.id) === String(id));
        if (!item || !window.confirm(item.active ? '¿Desactivar a este estudiante?' : '¿Reactivar a este estudiante?')) break;
        await api.patch(`students/${id}/`, { active: !item.active }); await afterWrite(item.active ? 'Estudiante desactivado.' : 'Estudiante reactivado.'); break;
      }
      case 'import-students': {
        const defaultCourse = button.dataset.course || (state.view === 'course' ? state.selectedCourse : !['all', 'unassigned'].includes(state.studentCourseFilter) ? state.studentCourseFilter : '');
        importStudentsForm(defaultCourse || ''); break;
      }
      case 'manage-course-students': state.studentCourseFilter = String(button.dataset.course || state.selectedCourse || 'all'); state.view = 'students'; render(); break;
      case 'enroll-student': enrollmentForm(button.dataset.course); break;
      case 'deactivate-enrollment': if (window.confirm('¿Desmatricular a este estudiante?')) { await api.patch(`enrollments/${id}/`, { status: 'inactive' }); await afterWrite('Matrícula desactivada.'); } break;
      case 'new-assessment': state.selectedCourse = button.dataset.course || state.selectedCourse; state.selectedAssessment = null; assessmentForm(null, state.selectedCourse || ''); break;
      case 'edit-assessment': {
        const assessment = state.data.assessments.find(item => String(item.id) === String(id));
        const full = await api.get(`assessments/${id}/editor/`); assessmentForm({ ...assessment, ...full.assessment }); break;
      }
      case 'open-assessment': {
        const item = state.data.assessments.find(row => String(row.id) === String(id));
        state.assessmentOrigin = state.view === 'course' ? 'course' : 'courses';
        const assessmentCourse = item?.course ?? item?.course_id;
        if (assessmentCourse != null) state.selectedCourse = assessmentCourse;
        state.selectedAssessment = id;
        state.assessmentEditor = await loadAssessmentEditor(id);
        state.view = 'assessment'; render(); break;
      }
      case 'new-question': questionForm(null, button.dataset.assessment); break;
      case 'edit-question': {
        const question = state.assessmentEditor?.questions?.find(item => String(item.id) === String(id));
        if (question) questionForm(question); break;
      }
      case 'delete-question': if (window.confirm('¿Eliminar esta consigna?')) { await api.delete(`questions/${id}/`); state.assessmentEditor = await loadAssessmentEditor(state.selectedAssessment); await refreshCore(); state.view = 'assessment'; render(); toast('Consigna eliminada.'); } break;
      case 'generate-questions': generateQuestionsForm(id); break;
      case 'import-reference': importReferenceForm(id); break;
      case 'new-rubric': rubricForm(); break;
      case 'edit-rubric': rubricForm(state.data.rubrics.find(item => String(item.id) === String(id))); break;
      case 'open-rubric': state.selectedRubric = id; navigate('rubric'); break;
      case 'generate-rubric': await generateRubric(); break;
      case 'generate-assessment-rubric': await generateRubric(id); break;
      case 'new-criterion': newRubricCriterionForm(button.dataset.rubric); break;
      case 'edit-criterion': {
        const criterion = state.data.rubrics.flatMap(item => item.criteria || []).find(item => String(item.id) === String(id)); if (criterion) editCriterionForm(criterion); break;
      }
      case 'edit-level': {
        const level = state.data.rubrics.flatMap(item => item.criteria || []).flatMap(item => item.levels || []).find(item => String(item.id) === String(id)); if (level) editLevelForm(level); break;
      }
      case 'add-level': {
        const criterion = state.data.rubrics.flatMap(item => item.criteria || []).find(item => String(item.id) === String(button.dataset.criterion)); if (criterion) newLevelForm(criterion.id, criterion.max_score); break;
      }
      case 'new-submission': state.selectedCourse = button.dataset.course || state.selectedCourse; submissionForm(state.selectedCourse || ''); break;
      case 'open-submission': await openSubmission(id); break;
      case 'return-submission': {
        // Desde una devolución se vuelve a la entrega (o al curso si se llegó desde él);
        // desde la entrega se vuelve siempre al curso, que es donde viven las entregas.
        const courseExists = state.selectedCourse != null && state.data.courses.some(item => String(item.id) === String(state.selectedCourse));
        if (state.view === 'correction' && state.correctionOrigin !== 'course' && state.currentSubmission) state.view = 'submission';
        else state.view = courseExists ? 'course' : 'courses';
        render(); break;
      }
      case 'return-assessment': state.view = state.assessmentOrigin === 'course' && state.selectedCourse ? 'course' : 'courses'; render(); break;
      case 'open-correction': await openCorrection(id); break;
      case 'export-correction': await api.download(`corrections/${id}/export/`, `devolucion-maestria-${id}.md`); break;
      case 'copy-correction': await copyCorrection(); break;
      case 'share-correction': openCorrectionShareModal(); break;
      case 'email-correction': openCorrectionShareModal(); break;
      case 'whatsapp-correction': openCorrectionShareModal(); break;
      case 'print-correction': window.print(); break;
      case 'new-admin-user': adminUserForm(); break;
      case 'edit-admin-user': adminUserForm(state.data.admin.users.find(item => String(item.id) === String(id))); break;
      case 'new-institution': institutionForm(); break;
      case 'edit-institution': institutionForm(state.data.admin.institutions.find(item => String(item.id) === String(id))); break;
      case 'edit-institution-scope': institutionForm(state.data.admin.institutions.find(item => String(item.id) === String(id)), true); break;
      case 'manage-institution': state.selectedInstitution = id; state.adminTab = 'institutions'; state.view = 'institution-memberships'; render(); break;
      case 'new-membership': membershipForm(null, button.dataset.institution || state.selectedInstitution || ''); break;
      case 'edit-membership': membershipForm(state.data.admin.memberships.find(item => String(item.id) === String(id))); break;
      case 'suspend-membership': if (window.confirm('¿Suspender esta membresía?')) { await api.delete(`admin/institution-memberships/${id}/`); await afterWrite('Membresía suspendida.'); } break;
      case 'view-memberships': {
        const tab = $('#app-content [data-admin-tab="institutions"]'); tab?.click();
        break;
      }
      case 'edit-message': messageForm(state.data.admin.messages.find(item => String(item.id) === String(id))); break;
      case 'new-provider': providerForm(); break;
      case 'edit-provider': providerForm(state.data.admin.providers.find(item => String(item.id) === String(id))); break;
      case 'logout':
        api.clearSession(); closeModal(); window.location.replace('../acceso.html'); break;
      case 'refresh-resource':
        if (['admin', 'superadmin'].includes(state.profile?.role)) await refreshAdmin(); else await refreshCore(); render(); break;
      case 'help': openQuickStart(); break;
      default: break;
    }
  } catch (error) { toast(errorText(error), 'error'); }
}

content?.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button) { event.preventDefault(); clickAction(button); }
  const submissionStatus = event.target.closest('[data-submission-status]');
  if (submissionStatus) { state.submissionStatusFilter = submissionStatus.dataset.submissionStatus; render(); return; }
  const adminTab = event.target.closest('[data-admin-tab]');
  if (adminTab) {
    state.adminTab = adminTab.dataset.adminTab;
    $$('.admin-tab', content).forEach(tab => {
      const active = tab === adminTab;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    $$('[data-admin-section]', content).forEach(section => { section.hidden = section.dataset.adminSection !== adminTab.dataset.adminTab; });
  }
});

content?.addEventListener('input', event => {
  if (event.target.matches('[data-admin-search]')) {
    state.adminSearch = event.target.value;
    const position = event.target.selectionStart; render();
    const next = $('[data-admin-search]'); next?.focus(); next?.setSelectionRange(position, position); return;
  }
  if (event.target.matches('[data-search]')) {
    state.search = event.target.value;
    const position = event.target.selectionStart; render();
    const next = $('[data-search]'); next?.focus(); next?.setSelectionRange(position, position);
  }
});

content?.addEventListener('change', async event => {
  if (event.target.matches('[data-filter="student-course"]')) { state.studentCourseFilter = event.target.value; render(); return; }
  if (event.target.matches('[data-filter="student-status"]')) { state.studentStatusFilter = event.target.value; render(); return; }
  if (event.target.matches('[data-filter="assessment-course"]')) { state.assessmentCourseFilter = event.target.value; render(); return; }
  if (event.target.matches('[data-filter="submission-course"]')) { state.submissionCourseFilter = event.target.value; render(); return; }
  if (event.target.matches('[data-filter="corrections-course"]')) { state.correctionsCourseFilter = event.target.value; render(); return; }
  if (event.target.matches('[data-filter="corrections-status"]')) { state.correctionsStatusFilter = event.target.value; render(); return; }
  if (event.target.matches('[data-filter="assessment-status"]')) { state.assessmentStatusFilter = event.target.value; render(); return; }
  if (event.target.matches('[data-admin-status="messages"], [data-admin-filter="messages"]')) {
    try {
      state.adminMessageStatus = $('[data-admin-status="messages"]')?.value || '';
      state.adminMessageSearch = $('[data-admin-filter="messages"]')?.value || '';
      const status = state.adminMessageStatus;
      const q = state.adminMessageSearch;
      const query = new URLSearchParams(); if (status) query.set('status', status); if (q.trim()) query.set('q', q.trim());
      state.data.admin.messages = await api.list(`admin/contact-messages/?${query.toString()}`);
      render();
      $('[data-admin-tab="messages"]')?.click();
    } catch (error) { toast(errorText(error), 'error'); }
  }
});

document.addEventListener('submit', async event => {
  const form = event.target;
  if (form.id === 'workspace-modal-form') { event.preventDefault(); await handleModalSubmit(form, form.querySelector('[type="submit"]')); }
  else if (form.id === 'proposal-questions-form') { event.preventDefault(); await handleQuestionProposal(form, form.querySelector('[type="submit"]')); }
  else if (form.id === 'add-submission-answer-form') { event.preventDefault(); await handleAddSubmissionAnswer(form); }
  else if (form.id === 'generate-correction-form') { event.preventDefault(); await handleGenerateCorrection(form, form.querySelector('[type="submit"]')); }
  else if (form.id === 'approve-correction-form') { event.preventDefault(); await handleApproveCorrection(form, form.querySelector('[type="submit"]')); }
  else if (form.id === 'generate-rubric-form') { event.preventDefault(); }
  else if (form.id === 'profile-settings-form') { event.preventDefault(); await saveProfilePreferences(form); }
});

modal?.addEventListener('change', async event => {
  if (!event.target.matches('[name="assessment"]')) return;
  const form = event.target.closest('form');
  if (!form || form.id !== 'workspace-modal-form') return;
  const assessmentId = event.target.value;
  const questionSelect = form.querySelector('[name="question"]');
  const studentSelect = form.querySelector('[name="student"]');
  if (!assessmentId) return;
  try {
    const workspace = await api.get(`correction-workspace/?assessment=${encodeURIComponent(assessmentId)}&summary=1`);
    if (questionSelect) {
      questionSelect.innerHTML = `<option value="">Sin asociar a una consigna</option>${(workspace.questions || []).map(item => `<option value="${item.id}">${escapeHtml(item.prompt)}</option>`).join('')}`;
    }
    if (studentSelect && Array.isArray(workspace.students)) {
      studentSelect.innerHTML = `<option value="">Sin estudiante asignado</option>${workspace.students.map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('')}`;
    }
  } catch (error) { toast(`No se pudieron cargar consignas/estudiantes: ${errorText(error)}`, 'error'); }
});

document.addEventListener('click', event => {
  if (event.target.closest('#retry-workspace-init')) {
    event.preventDefault();
    window.dispatchEvent(new Event('maestria:retry-init'));
    return;
  }
  const sideLink = event.target.closest('.side-link[data-view]');
  if (sideLink) { event.preventDefault(); navigate(sideLink.dataset.view); return; }
  if (event.target.closest('[data-close-modal]') || event.target.id === 'modal-close') closeModal();
  const shareAction = event.target.closest('[data-share-action]')?.dataset.shareAction;
  if (shareAction) { event.preventDefault(); handleShareAction(shareAction).catch(error => toast(errorText(error), 'error')); return; }
  const profileButton = event.target.closest('#profile-trigger, #top-profile');
  if (profileButton) $('#profile-menu').hidden = !$('#profile-menu').hidden;
  const profileAction = event.target.closest('[data-profile-action]');
  if (profileAction?.dataset.profileAction === 'profile') { $('#profile-menu').hidden = true; navigate('profile'); }
  if (profileAction?.dataset.profileAction === 'logout') { api.clearSession(); window.location.replace('../acceso.html'); }
  if (profileAction?.dataset.profileAction === 'guide') { $('#profile-menu').hidden = true; openQuickStart(); }
  if (event.target.closest('#theme-toggle, #theme-toggle-profile')) toggleTheme();
  const courseShortcut = event.target.closest('[data-open-course]');
  if (courseShortcut) { state.selectedCourse = courseShortcut.dataset.openCourse; navigate('course'); }
  if (event.target.closest('#mobile-menu-button')) openSidebar();
  if (event.target.closest('#sidebar-close') || event.target.closest('#sidebar-scrim')) closeSidebar();
  if (event.target.closest('#sidebar-collapse')) {
    const collapsed = $('.app-layout')?.classList.contains('is-sidebar-collapsed') || false;
    setSidebarCollapsed(!collapsed);
  }
  if (event.target.closest('#help-button')) openQuickStart();
});

document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeModal(); closeSidebar(); $('#profile-menu').hidden = true; if ($('#quickstart-root')?.innerHTML) closeQuickStart(false); } });
window.addEventListener('maestria:session-expired', () => { api.clearSession(); window.location.replace('../acceso.html'); });
window.addEventListener('online', () => toast('Conexión restablecida. Actualizá la vista para recuperar datos recientes.'));
window.addEventListener('offline', () => toast('Sin conexión. Las operaciones no se guardarán hasta recuperar la conexión.', 'error'));
window.addEventListener('maestria:open-guide', openQuickStart);
