import { state, content } from './state.js';
import { closeSidebar, updateChrome, toast } from './ui.js';

export function render() {
  const isAdmin = ['admin', 'superadmin'].includes(state.profile?.role);
  if (state.profile && isAdmin && !['admin', 'profile', 'institution-memberships'].includes(state.view)) state.view = 'admin';
  if (state.profile && !isAdmin && state.view === 'admin') state.view = 'dashboard';
  updateChrome();
  // The app entrypoint owns the renderer registry; the router only changes state
  // and emits a render request so feature modules remain outside navigation policy.
  window.dispatchEvent(new CustomEvent('maestria:render', { detail: { view: state.view } }));
}

export function navigate(view) {
  const isAdmin = ['admin', 'superadmin'].includes(state.profile?.role);
  if (isAdmin && !['admin', 'profile', 'institution-memberships'].includes(view)) { toast('Esta cuenta sólo puede acceder a las vistas de administración.', 'error'); return; }
  if (!isAdmin && ['admin', 'institution', 'institution-memberships'].includes(view)) { toast('Tu cuenta no tiene permisos para esta sección.', 'error'); return; }
  const teacherViews = ['dashboard', 'courses', 'course', 'students', 'assessment', 'submission', 'correction', 'rubrics', 'rubric', 'profile'];
  if (!isAdmin && !teacherViews.includes(view)) view = state.selectedCourse ? 'course' : 'courses';
  state.view = view; state.search = '';
  closeSidebar(); render();
  window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
