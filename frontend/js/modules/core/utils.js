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

/** Display application scores with at most two meaningful decimal places.
 * PostgreSQL DecimalFields use scale 18; those storage zeros must never leak into UI.
 * Inputs keep their exact normalized decimal string through formatInputNumber().
 */
export const formatNumber = (value) => {
  const normalized = formatInputNumber(value);
  if (normalized === '') return '—';
  const number = Number(normalized);
  if (!Number.isFinite(number)) return normalized;
  const safeNumber = Math.abs(number) < 0.005 ? 0 : number;
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(safeNumber);
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

/** Estado de dominio -> familia visual (éxito, atención, error, información, neutro). */
export const statusClass = (value) => ({
  active: 'success', ready: 'success', approved: 'success', handled: 'success',
  pending: 'warning', review: 'warning', pending_review: 'warning', in_progress: 'warning', draft: 'warning', invited: 'warning',
  processing: 'info', new: 'info',
  rejected: 'error', suspended: 'error', spam: 'error', deleted: 'error',
  archived: 'neutral', inactive: 'neutral'
})[value] || 'neutral';

export const statusPill = (value, label = statusLabel(value)) => `<span class="status status-${statusClass(value)}">${escapeHtml(label)}</span>`;
export const toneOf = (value) => [...String(value)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 5;
export const firstName = () => String(state.profile?.full_name || '').trim().split(/\s+/)[0];
export const greeting = () => {
  const hour = new Date().getHours();
  return hour < 12 ? 'Buen día' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
};
export const courseName = (id) => state.data.courses.find(item => String(item.id) === String(id))?.name || 'Curso';

const REQUIRED_MARK = ' <span class="required-mark" aria-hidden="true">*</span>';

export const btn = (label, action, attrs = '', kind = 'secondary') => `<button class="btn btn-${escapeHtml(kind)} btn-small" type="button" data-action="${escapeHtml(action)}" ${attrs}>${escapeHtml(label)}</button>`;
export const formField = (label, name, value = '', type = 'text', extra = '', required = false) => `<div class="form-field"><label for="f-${name}">${label}${required ? REQUIRED_MARK : ''}</label><input id="f-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? 'required' : ''} ${extra}></div>`;
export const textField = (label, name, value = '', extra = '', required = false) => `<div class="form-field full"><label for="f-${name}">${label}${required ? REQUIRED_MARK : ''}</label><textarea id="f-${name}" name="${name}" ${required ? 'required' : ''} ${extra}>${escapeHtml(value)}</textarea></div>`;
export const selectField = (label, name, options, selected = '', required = false) => `<div class="form-field"><label for="f-${name}">${label}${required ? REQUIRED_MARK : ''}</label><select id="f-${name}" name="${name}" ${required ? 'required' : ''}>${options.map(option => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(selected) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></div>`;
export const optionRows = (items, label, includeAll = false) => [...(includeAll ? [{ value: '', label: 'Sin asignar' }] : []), ...items.map(item => ({ value: item.id, label: label(item) }))];
export const listFrom = (payload) => Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : [];
export const formValues = (form) => Object.fromEntries(new FormData(form).entries());
export const errorText = (error) => error?.message || 'No se pudo completar la operación.';

/**
 * Portada de sección: hoja pegada con cinta. `tone` fija el tono de la portada
 * (por defecto hereda el `--tone` del contenedor o usa salvia). `leadHtml` sólo
 * debe recibir HTML ya escapado.
 */
export function heading(title, description, actions = '', { tone, leadHtml } = {}) {
  const toneAttr = tone == null ? '' : ` data-tone-h="${Number(tone)}"`;
  return `<header class="view-header"${toneAttr}><div class="view-heading-copy"><h1>${escapeHtml(title)}</h1>${leadHtml || description ? `<p class="view-lead">${leadHtml || escapeHtml(description)}</p>` : ''}</div>${actions ? `<div class="view-actions">${actions}</div>` : ''}</header>`;
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

/* ---------- Íconos (SVG en línea, trazo en currentColor) ---------- */
const ICON_PATHS = Object.freeze({
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  up: '<path d="m6 14 6-6 6 6"/>',
  down: '<path d="m6 10 6 6 6-6"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  clip: '<path d="m20 11-8.5 8.5a5 5 0 0 1-7-7L13 4a3.3 3.3 0 0 1 4.7 4.7L9.4 17a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  arrowLeft: '<path d="m15 6-6 6 6 6"/>',
  arrowRight: '<path d="m9 6 6 6-6 6"/>',
  book: '<path d="M12 6.5C9.5 4.8 6.4 4.6 3.5 5.8v13c3-1.2 6.1-1 8.5.7m0-13c2.5-1.7 5.6-1.9 8.5-.7v13c-2.9-1.2-6-1-8.5.7m0-13v13.7"/>'
});

/** Ícono decorativo: el control que lo contiene debe tener texto o aria-label. */
export const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ''}</svg>`;

/* ---------- Barra de herramientas de listados ---------- */

/** Buscador con lupa decorativa. `attrs` agrega data-* propios de la vista. */
export const searchField = (label, value, placeholder, attrs = '') => `<label class="search-control"><span class="search-control-icon" aria-hidden="true">⌕</span><input class="search-input" type="search" aria-label="${escapeHtml(label)}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}" ${attrs}></label>`;

/**
 * Grupo de chips de filtro (`<button aria-pressed>`). Cada chip lleva
 * data-chip-group/data-chip-value; el contador es opcional.
 */
export function chipGroup(label, group, chips, { idPrefix = group } = {}) {
  return `<div class="chip-group" role="group" aria-label="${escapeHtml(label)}">${chips.map(chip => `<button type="button" class="chip" id="${escapeHtml(`${idPrefix}-${chip.value}`)}" data-chip-group="${escapeHtml(group)}" data-chip-value="${escapeHtml(chip.value)}" aria-pressed="${chip.active ? 'true' : 'false'}">${escapeHtml(chip.label)}${chip.count == null ? '' : `<span class="chip-count">${escapeHtml(chip.count)}</span>`}</button>`).join('')}</div>`;
}

/** Selector en píldora para barras de herramientas (distinto del select de formulario). */
export const toolbarSelect = (label, attrs, options, selected) => `<select class="toolbar-select" aria-label="${escapeHtml(label)}" ${attrs}>${options.map(option => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(selected) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>`;

/** Contador de resultados anunciado + "Limpiar filtros" cuando hay filtros activos. */
export const resultCount = (text, clearAction = '') => `<span class="toolbar-end">${clearAction ? `<button type="button" class="text-link" data-action="${escapeHtml(clearAction)}">Limpiar filtros</button>` : ''}<span class="filter-result-count" role="status" aria-live="polite">${escapeHtml(text)}</span></span>`;

/** Estado vacío propio de "filtros sin resultados" (distinto de "todavía no hay nada"). */
export const filteredEmpty = (noun, clearAction = '') => emptyState(`No hay ${noun} con estos filtros.`, 'Probá con otro estado, ciclo o búsqueda.', clearAction ? `<button type="button" class="btn btn-secondary btn-small" data-action="${escapeHtml(clearAction)}">Limpiar filtros</button>` : '');

/** Tarjeta/fila "Mostrar más" para listas largas paginadas en el cliente. */
export const PAGE_SIZE = 50;
export const showMore = (shown, total, action, attrs = '') => total > shown ? `<div class="show-more"><button type="button" class="btn btn-secondary btn-small" data-action="${escapeHtml(action)}" ${attrs}>Mostrar más (${total - shown} restantes)</button></div>` : '';
