import { state } from './state.js';
import { closeSidebar, updateChrome, toast } from './ui.js';
import { loadResources, missingResources } from '../data/resources.js';

const TEACHER_VIEWS = new Set([
  'dashboard', 'workspace', 'courses', 'course', 'students', 'student', 'assessments', 'assessment-new', 'assessment',
  'rubrics', 'rubric', 'submissions', 'submission', 'corrections', 'correction', 'profile'
]);
const ADMIN_VIEWS = new Set(['admin', 'profile', 'institution-memberships']);

function isAdminProfile() {
  return ['admin', 'superadmin'].includes(state.profile?.role);
}

function syncRouteUrl() {
  const url = new URL(window.location.href);
  const viewParam = state.view === 'dashboard' ? '' : state.view;
  const currentView = url.searchParams.get('view') || '';
  let changed = false;

  if (viewParam && currentView !== viewParam) {
    url.searchParams.set('view', viewParam);
    changed = true;
  } else if (!viewParam && currentView) {
    url.searchParams.delete('view');
    changed = true;
  }

  // Workspace-only context must not leak into unrelated sections.
  if (state.view !== 'workspace') {
    for (const key of ['assessment', 'submission']) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
  }

  if (changed) {
    window.history.replaceState({ ...(window.history.state || {}), view: state.view }, '', url.toString());
  }
}

function viewFromLocation() {
  const requested = new URLSearchParams(window.location.search).get('view') || 'dashboard';
  const allowed = isAdminProfile() ? ADMIN_VIEWS : TEACHER_VIEWS;
  if (allowed.has(requested)) return requested;
  return isAdminProfile() ? 'admin' : 'dashboard';
}

export function render() {
  const isAdmin = isAdminProfile();
  if (state.profile && isAdmin && !ADMIN_VIEWS.has(state.view)) state.view = 'admin';
  if (state.profile && !isAdmin && !TEACHER_VIEWS.has(state.view)) state.view = 'dashboard';

  syncRouteUrl();
  updateChrome();
  const view = state.view;
  const rerenderWhenReady = keys => loadResources(keys).then(() => {
    if (state.view === view) render();
  });
  // Each view loads only its required resource set, then paints a skeleton.
  const missing = isAdmin ? [] : missingResources(view);
  if (missing.length) {
    window.dispatchEvent(new CustomEvent('maestria:render', { detail: { view, pending: true } }));
    void rerenderWhenReady(missing);
    return;
  }

  // The app entrypoint owns the renderer registry; the router only changes state
  // and emits a render request so feature modules remain outside navigation policy.
  window.dispatchEvent(new CustomEvent('maestria:render', { detail: { view } }));
  const soft = isAdmin ? [] : missingResources(view, 'soft');
  if (soft.length) void rerenderWhenReady(soft);
}

export function navigate(view) {
  const isAdmin = isAdminProfile();
  const allowed = isAdmin ? ADMIN_VIEWS : TEACHER_VIEWS;
  if (!allowed.has(view)) {
    toast('No tenés permisos para acceder a esa sección.', 'error');
    return;
  }

  const previousView = state.view;
  state.view = view;
  state.search = '';
  if (previousView !== view) {
    const url = new URL(window.location.href);
    if (view === 'dashboard') url.searchParams.delete('view');
    else url.searchParams.set('view', view);
    if (view !== 'workspace') {
      url.searchParams.delete('assessment');
      url.searchParams.delete('submission');
    }
    window.history.pushState({ view }, '', url.toString());
  }

  closeSidebar();
  render();
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  });
}

window.addEventListener('popstate', () => {
  if (!state.profile) return;
  state.view = viewFromLocation();
  state.search = '';
  render();
});
