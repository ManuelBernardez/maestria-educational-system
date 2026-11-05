import { state } from './state.js';

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

export const initials = (value) => String(value || 'MaestrIA').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || 'M';

/** Normalize numeric values returned by PostgreSQL without inventing precision. */
export const formatInputNumber = (value) => {
  if (value === null || value === undefined || value === '') return '';
  const raw = String(value).trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return raw;
  const normalized = raw.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
  return normalized === '-0' ? '0' : normalized;
};

/** Display numeric values in es-AR, hiding decimals that are only database padding. */
export const formatNumber = (value) => {
  const normalized = formatInputNumber(value);
  if (normalized === '') return '—';
  const number = Number(normalized);
  if (!Number.isFinite(number)) return normalized;
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 18 }).format(number);
};

export const date = (value, includeTime = false) => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return new Intl.DateTimeFormat('es-AR', includeTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
};

export const statusLabel = (value) => ({
  active: 'Activo', inactive: 'Inactivo', draft: 'Borrador', ready: 'Lista', archived: 'Archivada',
  pending: 'Pendiente', processing: 'Procesando', review: 'A revisar', approved: 'Aprobada',
  pending_review: 'A revisar', rejected: 'Rechazada', new: 'Nuevo', in_progress: 'En gestión',
  handled: 'Atendido', spam: 'Spam', suspended: 'Suspendida', deleted: 'Eliminada', invited: 'Invitada'
})[value] || value || '—';

export const statusClass = (value) => ({
  active: 'green', ready: 'green', approved: 'green', handled: 'green',
  pending: 'yellow', processing: 'yellow', review: 'yellow', pending_review: 'yellow', in_progress: 'yellow', draft: 'gray',
  archived: 'gray', inactive: 'gray', suspended: 'coral', rejected: 'coral', spam: 'coral', deleted: 'coral'
})[value] || 'gray';

export const statusPill = (value) => `<span class="status status-${statusClass(value)}">${escapeHtml(statusLabel(value))}</span>`;
export const toneOf = (value) => [...String(value)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
export const firstName = () => String(state.profile?.full_name || '').trim().split(/\s+/)[0];
export const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Buen día' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
};
export const courseName = (id) => state.data.courses.find(item => String(item.id) === String(id))?.name || 'Curso';

export const btn = (label, action, attrs = '', kind = 'secondary') => `<button class="btn btn-${escapeHtml(kind)} btn-small" type="button" data-action="${escapeHtml(action)}" ${attrs}>${escapeHtml(label)}</button>`;
export const iconBtn = (label, action, attrs = '') => `<button class="icon-action" type="button" data-action="${escapeHtml(action)}" ${attrs} aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${escapeHtml(label)}</button>`;
export const formField = (label, name, value = '', type = 'text', extra = '', required = false) => `<div class="form-field"><label for="f-${name}">${label}${required ? ' <span aria-hidden="true">*</span>' : ''}</label><input id="f-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? 'required' : ''} ${extra}></div>`;
export const textField = (label, name, value = '', extra = '', required = false) => `<div class="form-field full"><label for="f-${name}">${label}${required ? ' <span aria-hidden="true">*</span>' : ''}</label><textarea id="f-${name}" name="${name}" ${required ? 'required' : ''} ${extra}>${escapeHtml(value)}</textarea></div>`;
export const selectField = (label, name, options, selected = '', required = false) => `<div class="form-field"><label for="f-${name}">${label}${required ? ' <span aria-hidden="true">*</span>' : ''}</label><select id="f-${name}" name="${name}" ${required ? 'required' : ''}>${options.map(option => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(selected) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></div>`;
export const optionRows = (items, label, includeAll = false) => [...(includeAll ? [{ value: '', label: 'Sin asignar' }] : []), ...items.map(item => ({ value: item.id, label: label(item) }))];
export const listFrom = (payload) => Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : [];
export const formValues = (form) => Object.fromEntries(new FormData(form).entries());
export const errorText = (error) => error?.message || 'No se pudo completar la operación.';

export function heading(title, description, actions = '') {
  const isAdmin = ['admin', 'superadmin'].includes(state.profile?.role);
  const dashboard = title === 'Tu espacio docente';
  const modifier = dashboard ? ' view-header--dashboard' : '';
  const kicker = isAdmin ? 'ADMINISTRACIÓN' : 'ESPACIO DOCENTE';
  return `<header class="view-header${modifier}"><div class="view-heading-copy"><p class="view-kicker">${kicker}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><div class="view-actions">${actions}</div></header>`;
}

export function panel(title, description, body, actions = '') {
  return `<section class="panel"><div class="panel-head"><div><h2>${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div>${actions}</div><div class="panel-body">${body}</div></section>`;
}

export function emptyState(title, description, action = '') {
  return `<div class="empty-state"><div class="empty-icon" aria-hidden="true">✳</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${action}</div>`;
}

export function resourceError(key, label) {
  return state.errors[key] ? `<div class="notice notice-error" role="alert"><strong>No se pudo cargar ${escapeHtml(label)}.</strong><br>${escapeHtml(state.errors[key])} ${btn('Reintentar', 'refresh-resource', `data-resource="${escapeHtml(key)}"`)}</div>` : '';
}

export function table(headers, rows, emptyText = 'No hay registros para mostrar.') {
  return rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(item => `<th scope="col">${item}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : emptyState('Todavía no hay registros', emptyText);
}

export function courseIdForSubmission(submission) {
  const assessment = state.data.assessments.find(item => String(item.id) === String(submission?.assessment));
  return assessment?.course ?? assessment?.course_id ?? null;
}

export function courseIdForCorrection(correction) {
  if (correction?.course_id != null) return correction.course_id;
  const submission = state.data.submissions.find(item => String(item.id) === String(correction?.submission));
  return courseIdForSubmission(submission);
}
