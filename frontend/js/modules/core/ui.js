import { $, $$, state, modal, modalContent, toastRegion } from './state.js';
import { escapeHtml, initials } from './utils.js';
import { setCustomProperties } from './dynamic-styles.js';

const TOAST_MS = 5000;

/** Notificación temporal: se cierra sola a los 5 s (pausa con mouse o foco) o con su botón ×. */
export function toast(message, type = 'success') {
  if (!toastRegion) return;
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.setAttribute('role', type === 'error' ? 'alert' : 'status');
  node.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  const text = document.createElement('p');
  text.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Cerrar aviso');
  close.textContent = '×';
  node.append(text, close);
  toastRegion.appendChild(node);

  let remaining = TOAST_MS;
  let startedAt = Date.now();
  let timer = window.setTimeout(() => node.remove(), remaining);
  const pause = () => {
    window.clearTimeout(timer);
    remaining = Math.max(0, remaining - (Date.now() - startedAt));
  };
  const resume = () => {
    startedAt = Date.now();
    timer = window.setTimeout(() => node.remove(), Math.max(1200, remaining));
  };
  node.addEventListener('mouseenter', pause);
  node.addEventListener('mouseleave', resume);
  node.addEventListener('focusin', pause);
  node.addEventListener('focusout', resume);
  close.addEventListener('click', () => { window.clearTimeout(timer); node.remove(); });
}

/**
 * Abre o cierra el menú de perfil anclado al disparador que lo pidió
 * (avatar superior, selector de espacio o perfil del menú lateral).
 * La posición se publica como --menu-left / --menu-top para que el CSS la aplique.
 */
export function toggleProfileMenu(trigger, force) {
  const menu = $('#profile-menu');
  if (!menu) return;
  const open = force ?? menu.hidden;
  $$('[aria-controls="profile-menu"]').forEach(node => node.setAttribute('aria-expanded', String(open && node === trigger)));
  menu.hidden = !open;
  if (!open || !trigger) return;
  const rect = trigger.getBoundingClientRect();
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const fromSidebar = Boolean(trigger.closest('.sidebar'));
  const left = fromSidebar
    ? Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)
    : Math.max(12, rect.right - width);
  const below = rect.bottom + 8;
  const top = below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 8) : below;
  setCustomProperties('#profile-menu', { '--menu-left': `${Math.round(left)}px`, '--menu-top': `${Math.round(top)}px` });
  menu.querySelector('button:not([hidden])')?.focus();
}

let modalReturnFocus = null;

function trapModalFocus(event) {
  if (event.key !== 'Tab' || modal?.hidden) return;
  const focusable = [...modal.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
  if (!focusable.length) {
    event.preventDefault();
    $('.modal-dialog')?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function openModal(title, body, kind, wide = false) {
  modalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  $('#modal-title').textContent = title;
  modalContent.innerHTML = body;
  state.modalKind = kind;
  state.modalBusy = false;
  $('.modal-dialog').classList.toggle('modal-wide', wide);
  modal.hidden = false;
  document.body.classList.add('has-open-modal');
  modal.addEventListener('keydown', trapModalFocus);
  window.setTimeout(() => {
    ($('#modal-content input:not([type="hidden"]), #modal-content select, #modal-content textarea, #modal-close') || $('.modal-dialog'))?.focus();
  }, 0);
}

export function closeModal(force = false) {
  if (!modal || modal.hidden || (state.modalBusy && !force)) return;
  modal.hidden = true;
  document.body.classList.remove('has-open-modal');
  state.modalKind = null;
  state.modalBusy = false;
  modalContent.innerHTML = '';
  modal.removeEventListener('keydown', trapModalFocus);
  if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
  modalReturnFocus = null;
}

export function modalForm(fields, submitLabel = 'Guardar', extra = '') {
  return `<form id="workspace-modal-form" novalidate><div class="form-grid">${fields}</div><p class="form-error" id="modal-error" role="alert"></p><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" type="submit">${submitLabel}</button></div>${extra}</form>`;
}

export function setModalError(message) {
  const error = $('#modal-error');
  if (error) error.textContent = message || '';
}

export async function withBusy(button, operation) {
  if (button?.disabled) return;
  const original = button?.textContent;
  if (button) { button.disabled = true; button.textContent = 'Procesando…'; }
  try { return await operation(); }
  finally { if (button) { button.disabled = false; button.textContent = original; } }
}

export function updateChrome() {
  const role = state.profile?.role || 'teacher';
  const isAdmin = ['admin', 'superadmin'].includes(role);
  const name = state.profile?.full_name || state.profile?.email?.split('@')[0] || (isAdmin ? 'Administrador' : 'Docente');
  const email = state.profile?.email || '';
  const initialsText = initials(name);
  ['#workspace-avatar', '#profile-avatar', '#top-profile'].forEach(selector => { const node = $(selector); if (node) node.textContent = initialsText; });
  if ($('#profile-name')) $('#profile-name').textContent = name;
  if ($('#profile-email')) $('#profile-email').textContent = email;
  if ($('#workspace-role')) $('#workspace-role').textContent = role === 'superadmin' ? 'Superadministración' : role === 'admin' ? 'Administración global' : 'Docencia · Personal';
  if ($('#course-count')) $('#course-count').textContent = String(state.data.courses.filter(item => item.active).length);
  if ($('#pending-count')) $('#pending-count').textContent = String(state.data.corrections.filter(item => item.status === 'pending_review').length);
  if ($('#submission-count')) $('#submission-count').textContent = String(state.data.submissions.length);
  const shortcuts = $('#sidebar-course-shortcuts');
  if (shortcuts) {
    const activeCourses = state.data.courses.filter(item => item.active).slice(0, 5);
    shortcuts.hidden = isAdmin || activeCourses.length === 0;
    shortcuts.innerHTML = shortcuts.hidden ? '' : `<div class="sidebar-shortcut-heading"><span>MIS MATERIAS</span><button type="button" data-action="new-course" aria-label="Crear materia" title="Crear materia">＋</button></div>${activeCourses.map(course => {
      const selected = state.view === 'course' && String(state.selectedCourse) === String(course.id);
      const letter = String(course.subject || course.name || 'M').trim().slice(0, 1).toLocaleUpperCase('es-AR');
      return `<button class="side-link side-link--course${selected ? ' active' : ''}" type="button" data-open-course="${escapeHtml(course.id)}" title="${escapeHtml(course.name)}" ${selected ? 'aria-current="page"' : ''}><span class="side-icon" aria-hidden="true">${escapeHtml(letter)}</span><span class="side-text">${escapeHtml(course.name)}</span></button>`;
    }).join('')}`;
  }
  $$('[data-teacher-nav]').forEach(link => { link.hidden = isAdmin; });
  if ($('#admin-nav')) $('#admin-nav').hidden = !isAdmin;
  if ($('#institution-nav')) $('#institution-nav').hidden = true;
  const tip = $('.sidebar-tip'); if (tip) tip.hidden = true;
  const helpButton = $('#help-button'); if (helpButton) helpButton.hidden = isAdmin;
  const guideMenuItem = $('[data-profile-action="guide"]'); if (guideMenuItem) guideMenuItem.hidden = isAdmin;
  const workspaceTitle = $('.workspace-switch strong'); if (workspaceTitle) workspaceTitle.textContent = isAdmin ? 'Administración' : 'Mi espacio';
  const sideNav = $('.side-nav'); if (sideNav) sideNav.setAttribute('aria-label', isAdmin ? 'Navegación de administración' : 'Navegación del espacio docente');
  const today = $('#today-label');
  if (today) today.textContent = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const navName = ({ dashboard: 'Panel docente', workspace: 'Espacio de trabajo', courses: 'Mis materias', course: 'Mis materias', students: 'Estudiantes', student: 'Estudiantes', assessments: 'Evaluaciones', 'assessment-new': 'Nueva evaluación', assessment: 'Evaluación', rubrics: 'Rúbricas', submissions: 'Entregas', submission: 'Entregas', corrections: 'Correcciones', correction: 'Correcciones', admin: 'Administración', institution: 'Institución', 'institution-memberships': 'Institución', profile: 'Mi perfil' })[state.view] || (isAdmin ? 'Administración' : 'Resumen');
  if ($('#breadcrumb-current')) $('#breadcrumb-current').textContent = navName;
}

const SIDEBAR_PREFERENCE_KEY = 'maestria.workspace.sidebar.collapsed.v1';
export function setSidebarCollapsed(collapsed, persist = true) {
  const layout = $('.app-layout');
  const sidebar = $('#sidebar');
  const button = $('#sidebar-collapse');
  if (!layout || !sidebar || !button) return;
  layout.classList.toggle('is-sidebar-collapsed', collapsed);
  sidebar.classList.toggle('is-collapsed', collapsed);
  button.setAttribute('aria-expanded', String(!collapsed));
  const label = collapsed ? 'Expandir menú' : 'Contraer menú';
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  if (persist) {
    try { sessionStorage.setItem(SIDEBAR_PREFERENCE_KEY, collapsed ? '1' : '0'); } catch {}
  }
}

export function restoreSidebarPreference() {
  let collapsed = false;
  try { collapsed = sessionStorage.getItem(SIDEBAR_PREFERENCE_KEY) === '1'; } catch {}
  setSidebarCollapsed(collapsed, false);
}

export function openSidebar() {
  $('#sidebar')?.classList.add('is-open');
  $('.sidebar-scrim')?.classList.add('is-open');
  $('#mobile-menu-button')?.setAttribute('aria-expanded', 'true');
}

export function closeSidebar() {
  $('#sidebar')?.classList.remove('is-open');
  $('.sidebar-scrim')?.classList.remove('is-open');
  $('#mobile-menu-button')?.setAttribute('aria-expanded', 'false');
}

const THEME_KEY = 'maestria-theme';
export function applyTheme(theme, persist = true) {
  const resolved = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = resolved;
  if (persist) { try { sessionStorage.setItem(THEME_KEY, resolved); } catch {} }
  const label = resolved === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro';
  ['#theme-toggle', '#theme-toggle-profile'].forEach(selector => {
    const button = $(selector); if (!button) return;
    button.setAttribute('aria-pressed', String(resolved === 'dark'));
    button.setAttribute('aria-label', label);
    if (selector === '#theme-toggle-profile') { const text = $('#theme-label-profile'); if (text) text.textContent = label; }
  });
  window.dispatchEvent(new CustomEvent('maestria-theme-change', { detail: { theme: resolved } }));
}

export function toggleTheme() {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
}
