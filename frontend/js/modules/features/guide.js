import { state, $ } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { navigate } from '../core/router.js';

export const GUIDE_STEPS = [
  { title: 'Organizá tus cursos', body: 'Creá una materia o comisión y agregá los estudiantes correspondientes.', action: 'Ir a cursos', view: 'courses', tip: 'Podés importar estudiantes desde un archivo CSV.' },
  { title: 'Prepará una evaluación', body: 'Entrá en uno de tus cursos y creá una evaluación desde ese espacio.', action: 'Ir a cursos', view: 'courses', tip: 'Las consignas propuestas por IA siempre se revisan antes de incorporarlas.' },
  { title: 'Revisá las entregas', body: 'Desde el curso correspondiente, abrí una entrega, generá una propuesta y revisá las evidencias.', action: 'Ir a cursos', view: 'courses', tip: 'La IA propone; la decisión pedagógica y la aprobación son docentes.' },
  { title: 'Consultá tu historial', body: 'Cada curso conserva su historial de devoluciones para revisar, compartir o exportar.', action: 'Ir a cursos', view: 'courses', tip: 'Las devoluciones aprobadas se pueden compartir desde su detalle.' }
];

export let guideStep = 0;
let guideOpener = null;
let guideEventsBound = false;
export function setGuideStep(step) { guideStep = step; }

/** Bind controls to the persistent root, not to buttons replaced at every step. */
export function bindQuickStartEvents() {
  const root = $('#quickstart-root');
  if (!root || guideEventsBound) return;
  root.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('[data-guide-action]') : null;
    if (!button || !root.contains(button)) return;
    event.preventDefault();
    event.stopPropagation();
    switch (button.dataset.guideAction) {
      case 'close': closeQuickStart(); break;
      case 'previous': setGuideStep(Math.max(0, guideStep - 1)); renderQuickStart(); break;
      case 'next': setGuideStep(Math.min(GUIDE_STEPS.length - 1, guideStep + 1)); renderQuickStart(); break;
      case 'go': { const step = GUIDE_STEPS[guideStep]; closeQuickStart(); if (step?.view) navigate(step.view); break; }
      default: break;
    }
  });
  guideEventsBound = true;
}

/* Apertura automática de la guía:
 *  - la primera vez que la persona entra (marca persistente en localStorage), o
 *  - mientras no tenga ningún curso creado (una vez por sesión, para no insistir
 *    en cada recarga si la cierra).
 * La marca guarda sólo el id de usuario; nunca el correo. */
const SEEN_PREFIX = 'maestria-quickstart-seen:';
const SESSION_DISMISSED_PREFIX = 'maestria-quickstart-dismissed:';
const userKey = () => String(state.profile?.user_id || 'teacher');

// `kind` es 'localStorage' o 'sessionStorage': se accede dentro del try porque
// el propio acceso puede lanzar con el almacenamiento bloqueado.
function readFlag(kind, key) {
  try { return window[kind].getItem(key) === 'true'; } catch { return false; }
}
function writeFlag(kind, key) {
  try { window[kind].setItem(key, 'true'); } catch { /* almacenamiento bloqueado: la guía puede volver a abrirse */ }
}

export function renderQuickStart() {
  const root = $('#quickstart-root'); if (!root) return;
  const step = GUIDE_STEPS[guideStep];
  root.innerHTML = `<div class="quickstart-backdrop" role="presentation"><section class="quickstart-dialog" role="dialog" aria-modal="true" aria-labelledby="quickstart-title" aria-describedby="quickstart-description"><div class="quickstart-topline"><span class="eyebrow">PRIMEROS PASOS CON MAESTRIA</span><button type="button" class="quickstart-close" data-guide-action="close" aria-label="Cerrar guía">×</button></div><div class="quickstart-progress" aria-label="Paso ${guideStep + 1} de ${GUIDE_STEPS.length}">${GUIDE_STEPS.map((item, index) => `<span class="${index <= guideStep ? 'is-current' : ''}"></span>`).join('')}</div><h2 id="quickstart-title">${escapeHtml(step.title)}</h2><p id="quickstart-description">${escapeHtml(step.body)}</p><div class="quickstart-tip"><span>${escapeHtml(step.tip)}</span></div><div class="quickstart-footer"><button type="button" class="btn btn-secondary" data-guide-action="close">Lo veo después</button><div>${guideStep > 0 ? '<button type="button" class="btn btn-secondary" data-guide-action="previous">Anterior</button>' : ''}${guideStep < GUIDE_STEPS.length - 1 ? '<button type="button" class="btn btn-primary" data-guide-action="next">Siguiente</button>' : `<button type="button" class="btn btn-primary" data-guide-action="go">${escapeHtml(step.action)}</button>`}</div></div></section></div>`;
  root.querySelector('.quickstart-close')?.focus();
}

export function openQuickStart() {
  if (['admin', 'superadmin'].includes(state.profile?.role)) return;
  if (!$('#quickstart-root')?.innerHTML) guideOpener = document.activeElement;
  guideStep = 0; renderQuickStart();
}

export function closeQuickStart() {
  const root = $('#quickstart-root'); if (root) root.innerHTML = '';
  // Cerrarla (completa o «Lo veo después») cuenta como primera visita hecha.
  writeFlag('localStorage', `${SEEN_PREFIX}${userKey()}`);
  writeFlag('sessionStorage', `${SESSION_DISMISSED_PREFIX}${userKey()}`);
  const opener = guideOpener; guideOpener = null;
  if (opener instanceof HTMLElement && opener.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
}

export function maybeOpenQuickStart() {
  if (['admin', 'superadmin'].includes(state.profile?.role)) return;
  const firstVisit = !readFlag('localStorage', `${SEEN_PREFIX}${userKey()}`);
  // Si los cursos no se pudieron cargar, no se asume que la lista esté vacía.
  const coursesKnown = !state.errors.courses && (Boolean(state.data.overview) || !state.errors.overview);
  const withoutCourses = coursesKnown && state.data.courses.length === 0;
  const dismissedThisSession = readFlag('sessionStorage', `${SESSION_DISMISSED_PREFIX}${userKey()}`);
  if (firstVisit || (withoutCourses && !dismissedThisSession)) openQuickStart();
}
