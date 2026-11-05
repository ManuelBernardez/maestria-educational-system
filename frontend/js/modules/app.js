import { api } from './core/api.js';
import { state, content, $$ } from './core/state.js';
import { loadProfile, refreshCore, refreshAdmin } from './data/repository.js';
import { render, navigate } from './core/router.js';
import { restoreSidebarPreference, applyTheme, updateChrome } from './core/ui.js';
import { maybeOpenQuickStart, bindQuickStartEvents } from './features/guide.js';

// Views
import { renderDashboard } from './features/dashboard.js';
import { renderCourses, renderCourseDetail } from './features/courses.js';
import { renderStudents } from './features/students.js';
import { renderAssessments, renderAssessmentDetail } from './features/assessments.js';
import { renderRubrics, renderRubricDetail } from './features/rubrics.js';
import { renderSubmissions, renderSubmissionDetail } from './features/submissions.js';
import { renderCorrections, renderCorrection } from './features/corrections.js';
import { renderAdmin, renderInstitutionScope } from './features/admin.js';
import { renderProfile } from './features/profile.js';

import './events.js'; // initialize delegated event handlers

const VIEW_RENDERERS = Object.freeze({
  dashboard: renderDashboard, courses: renderCourses, course: renderCourseDetail,
  students: renderStudents, assessments: renderAssessments, assessment: renderAssessmentDetail,
  rubrics: renderRubrics, rubric: renderRubricDetail, submissions: renderSubmissions,
  submission: renderSubmissionDetail, corrections: renderCorrections, correction: renderCorrection,
  admin: renderAdmin, institution: renderInstitutionScope,
  'institution-memberships': renderInstitutionScope, profile: renderProfile
});

// Al refrescar datos (alta de estudiante, evaluación, etc.) la vista se vuelve a dibujar;
// se conservan los bloques desplegados del curso para que el docente vea lo que acaba de crear.
let lastRendered = { view: null, course: null };

window.addEventListener('maestria:render', (e) => {
  const view = e.detail.view;
  const sameCourse = lastRendered.view === 'course' && view === 'course' && String(lastRendered.course) === String(state.selectedCourse);
  const openFolds = sameCourse ? $$('details[data-fold][open]', content).map(node => node.dataset.fold) : [];
  const scrollY = sameCourse ? window.scrollY : null;
  content.innerHTML = (VIEW_RENDERERS[view] || renderDashboard)();
  lastRendered = { view, course: state.selectedCourse };
  openFolds.forEach(key => { const fold = content.querySelector(`details[data-fold="${key}"]`); if (fold) fold.open = true; });
  if (scrollY != null) window.scrollTo({ top: scrollY, behavior: 'auto' });
  $$('.side-link').forEach(link => {
    const active = link.dataset.view === state.view || (state.view === 'course' && link.dataset.view === 'courses') || (state.view === 'assessment' && link.dataset.view === 'assessments') || (state.view === 'submission' && link.dataset.view === 'submissions') || (state.view === 'correction' && link.dataset.view === 'corrections') || (state.view === 'rubric' && link.dataset.view === 'rubrics') || (state.view === 'institution-memberships' && link.dataset.view === 'admin');
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  content.focus({ preventScroll: true });
});

let initializationPromise = null;

async function runInit() {
  restoreSidebarPreference();
  applyTheme(document.documentElement.dataset.theme || 'light', false);
  state.loading = true;
  content.innerHTML = `<section class="panel" aria-live="polite"><div class="panel-body"><p>Conectando con MaestrIA…</p></div></section>`;
  try {
    const ok = await loadProfile();
    if (!ok) return;
    if (['admin', 'superadmin'].includes(state.profile?.role)) {
      state.view = 'admin';
      await refreshAdmin();
    } else {
      state.view = 'dashboard';
      await refreshCore({ onOverviewReady: () => render() });
    }
    state.loading = false;
    render();
    if (window.location.hash === '#contacto') navigate('profile');
    maybeOpenQuickStart();
  } catch (error) {
    state.loading = false;
    content.innerHTML = `
      <section class="panel" role="alert">
        <div class="panel-body">
          <div class="empty-state">
            <h2>No se pudo iniciar MaestrIA</h2>
            <p>Ocurrió un error inesperado al preparar el espacio docente.</p>
            <p class="form-error">${String(error?.message || 'Error inesperado').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}</p>
            <button class="btn btn-primary" id="retry-workspace-init" type="button">Reintentar</button>
          </div>
        </div>
      </section>`;
  }
}

export function init() {
  bindQuickStartEvents();
  if (initializationPromise) return initializationPromise;
  initializationPromise = runInit().finally(() => { initializationPromise = null; });
  return initializationPromise;
}

window.addEventListener('maestria:retry-init', () => { init(); });
