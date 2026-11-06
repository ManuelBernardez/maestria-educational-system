import { api } from './core/api.js';
import { state, content, $$ } from './core/state.js';
import { loadProfile, refreshCore, refreshAdmin, readOverviewCache } from './data/repository.js';
import { listFrom } from './core/utils.js';
import { render, navigate } from './core/router.js';
import { restoreSidebarPreference, applyTheme, updateChrome } from './core/ui.js';
import { maybeOpenQuickStart, bindQuickStartEvents } from './features/guide.js';

// Views
import { renderDashboard } from './features/dashboard.js';
import { renderCourses, renderCourseDetail } from './features/courses.js';
import { renderStudents } from './features/students.js';
import { renderAssessments, renderAssessmentDetail, renderNewAssessment } from './features/assessments.js';
import { renderRubrics, renderRubricDetail } from './features/rubrics.js';
import { renderSubmissions, renderSubmissionDetail } from './features/submissions.js';
import { renderCorrections, renderCorrection } from './features/corrections.js';
import { renderAdmin, renderInstitutionScope } from './features/admin.js';
import { renderProfile } from './features/profile.js';
import { renderWorkspace, ensureWorkspaceLoaded } from './features/workspace.js';
import { loadDeliveries } from './features/share.js';

import './events.js'; // initialize delegated event handlers

const VIEW_RENDERERS = Object.freeze({
  dashboard: renderDashboard, courses: renderCourses, course: renderCourseDetail,
  students: renderStudents, assessments: renderAssessments, 'assessment-new': renderNewAssessment, assessment: renderAssessmentDetail,
  rubrics: renderRubrics, rubric: renderRubricDetail, submissions: renderSubmissions,
  submission: renderSubmissionDetail, corrections: renderCorrections, correction: renderCorrection,
  admin: renderAdmin, institution: renderInstitutionScope,
  'institution-memberships': renderInstitutionScope, profile: renderProfile, workspace: renderWorkspace
});

const LOADING_VIEW = `<section class="panel" aria-live="polite" aria-busy="true"><div class="panel-body"><div class="skeleton-grid" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton skeleton-wide"></span></div></div></section>`;

// Vista de detalle -> entrada del menú lateral que debe quedar marcada.
const NAV_PARENT = Object.freeze({ 'assessment-new': 'workspace', course: 'courses', assessments: 'workspace', assessment: 'workspace', rubrics: 'workspace', rubric: 'workspace', 'institution-memberships': 'admin' });

function markActiveNav() {
  const active = NAV_PARENT[state.view] || state.view;
  $$('.side-link[data-view]').forEach(link => {
    const isActive = link.dataset.view === active;
    link.classList.toggle('active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
}

// Al refrescar datos (alta de estudiante, evaluación, etc.) la vista se vuelve a dibujar;
// se conservan los bloques desplegados del curso para que el docente vea lo que acaba de crear.
let lastRendered = { view: null, course: null };

window.addEventListener('maestria:render', (e) => {
  const view = e.detail.view;
  if (e.detail.pending) { content.innerHTML = LOADING_VIEW; markActiveNav(); return; }
  const sameCourse = lastRendered.view === 'course' && view === 'course' && String(lastRendered.course) === String(state.selectedCourse);
  const openFolds = sameCourse ? $$('details[data-fold][open]', content).map(node => node.dataset.fold) : [];
  const scrollY = sameCourse ? window.scrollY : null;
  content.innerHTML = (VIEW_RENDERERS[view] || renderDashboard)();
  lastRendered = { view, course: state.selectedCourse };
  openFolds.forEach(key => { const fold = content.querySelector(`details[data-fold="${key}"]`); if (fold) fold.open = true; });
  if (scrollY != null) window.scrollTo({ top: scrollY, behavior: 'auto' });
  markActiveNav();
  content.focus({ preventScroll: true });
  if (view === 'correction') loadDeliveries();
  if (view === 'workspace') void ensureWorkspaceLoaded();
});

let initializationPromise = null;

async function runInit() {
  restoreSidebarPreference();
  applyTheme(document.documentElement.dataset.theme || 'light', false);
  state.loading = true;
  content.innerHTML = `<section class="panel" aria-live="polite" aria-busy="true"><div class="panel-body"><p>Conectando con MaestrIA…</p><div class="skeleton-grid" aria-hidden="true"><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton"></span><span class="skeleton skeleton-wide"></span></div></div></section>`;
  // El resumen no depende del perfil: se pide en paralelo con /me/ en lugar de esperar a que termine.
  let overviewPromise = null;
  if (api.getSession()) { overviewPromise = api.get('dashboard/overview/'); overviewPromise.catch(() => {}); }
  try {
    const ok = await loadProfile();
    if (!ok) return;
    if (['admin', 'superadmin'].includes(state.profile?.role)) {
      state.view = 'admin';
      await refreshAdmin();
    } else {
      const allowedViews = new Set(['dashboard', 'workspace', 'courses', 'course', 'students', 'assessments', 'assessment-new', 'assessment', 'rubrics', 'rubric', 'submissions', 'submission', 'corrections', 'correction', 'profile']);
      const requestedView = new URLSearchParams(window.location.search).get('view');
      state.view = allowedViews.has(requestedView) ? requestedView : 'dashboard';
      // Pintado inmediato con el último resumen de esta sesión mientras se actualiza en segundo plano.
      const cached = readOverviewCache();
      if (cached) {
        state.data.overview = cached; state.data.courses = listFrom(cached.courses); state.data.assessments = listFrom(cached.assessments);
        state.loading = false; render();
      }
      await refreshCore({ overviewPromise, onOverviewReady: () => render() });
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
