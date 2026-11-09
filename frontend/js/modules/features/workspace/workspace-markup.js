import { escapeHtml, icon } from '../../core/utils.js';

export const ACCEPTED_FILES = '.txt,.md,.pdf,.docx,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Caracteres del material de referencia que recibe la IA (= REFERENCE_CONTEXT_CHARS en backend/apps/core/ai.py). */
export const REFERENCE_CONTEXT_CHARS = 12000;

/** Ids históricos de los títulos de cada paso (se conservan: otras partes pueden apuntarlos). */
const STEP_TITLE_IDS = Object.freeze({ 1: 'workspace-context-title', 2: 'workspace-submission-title', 3: 'workspace-review-title' });
export const stepTitleId = (step) => STEP_TITLE_IDS[step];

/**
 * Encabezado único de panel: título + una línea de ayuda. Recibe el foco al cambiar de paso.
 * El número y nombre del paso ya están en la pestaña: no se repiten acá.
 */
export const stepHeader = (step, title, help, aside = '') => `<header class="step-head"><div><h2 class="step-title" id="${stepTitleId(step)}" tabindex="-1">${escapeHtml(title)}</h2>${help ? `<p class="step-help">${escapeHtml(help)}</p>` : ''}</div>${aside}</header>`;

/** Indicador "Guardado / Cambios sin guardar" (se actualiza en vivo vía data-save-status). */
export const saveStatus = (step, dirty, savedLabel = 'Guardado') => `<span class="save-status${dirty ? ' is-dirty' : ''}" role="status" data-save-status="${step}" data-saved-label="${escapeHtml(savedLabel)}">${dirty ? 'Cambios sin guardar' : escapeHtml(savedLabel)}</span>`;

/** Barra de acciones al pie del panel: estado a la izquierda, acciones a la derecha. */
export const actionBar = (status, actions) => `<div class="step-actions">${status}<div class="step-actions-buttons">${actions}</div></div>`;

/** Botón "?" con la lista de atajos de teclado (tooltip accesible). */
export const shortcutsHint = (id) => `<span class="shortcut-hint"><button type="button" class="icon-button" aria-describedby="${id}" aria-label="Atajos de teclado">?</button><span class="shortcut-tip" role="tooltip" id="${id}">Ctrl/⌘ + S guarda el paso · Ctrl/⌘ + Enter envía o guarda la edición · Shift + Enter en el puntaje guarda la consigna y abre otra · Esc cancela · ← → cambian de pestaña</span></span>`;

export const formatBytes = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Zona de carga de archivos: el input nativo queda visualmente oculto pero
 * enfocable dentro del <label>, así Enter/Espacio y clic abren el selector.
 */
export function dropzone({ id, kind, file, hint, disabled = false, label = 'Elegí un archivo o soltalo acá' }) {
  if (file) {
    return `<div class="file-chip"><span class="file-chip-icon" aria-hidden="true">${icon('clip')}</span><span class="file-chip-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span><span class="file-chip-size">${escapeHtml(formatBytes(file.size))}</span><button type="button" class="text-link" data-action="workspace-remove-file" data-kind="${kind}">Quitar</button></div>`;
  }
  return `<label class="dropzone${disabled ? ' is-disabled' : ''}" for="${id}" data-dropzone="${kind}"><input class="visually-hidden" id="${id}" type="file" accept="${ACCEPTED_FILES}" data-workspace-file="${kind}" ${disabled ? 'disabled' : ''}><span class="dropzone-icon" aria-hidden="true">${icon('clip')}</span><span class="dropzone-copy"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(hint)}</small></span></label>`;
}

/** Campo numérico con botones −/+ (paso 0.5). */
export function scoreStepper({ id, value, max, attrs = '', label, disabled = false, min = 0 }) {
  return `<div class="stepper"><button type="button" class="stepper-btn" data-action="workspace-score-step" data-target="${id}" data-delta="-0.5" aria-label="Restar medio punto en ${escapeHtml(label)}" ${disabled ? 'disabled' : ''}>${icon('minus')}</button><input id="${id}" type="number" inputmode="decimal" min="${min}" ${max != null ? `max="${escapeHtml(max)}"` : ''} step="0.01" value="${escapeHtml(value)}" ${attrs} ${disabled ? 'disabled' : ''}><button type="button" class="stepper-btn" data-action="workspace-score-step" data-target="${id}" data-delta="0.5" aria-label="Sumar medio punto en ${escapeHtml(label)}" ${disabled ? 'disabled' : ''}>${icon('plus')}</button></div>`;
}

/** Mensajes de error del servidor ({campo: [mensajes]}) para un campo. */
export const fieldError = (errors, name, id) => errors?.[name]?.length ? `<p class="field-error" id="${id}-error" role="alert">${escapeHtml(errors[name].join(' '))}</p>` : '';

/** Normaliza un error de API al formato {campo: [mensajes]} (o {} si no es por campo). */
export function serverFieldErrors(error) {
  const payload = error?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.detail) return {};
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, (Array.isArray(value) ? value : [value]).map(String)]));
}

export const separator = () => '<div class="ornament-sep" aria-hidden="true"><span>✳</span></div>';
