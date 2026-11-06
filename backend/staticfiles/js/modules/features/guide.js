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
      case 'close': closeQuickStart(false); break;
      case 'previous': setGuideStep(Math.max(0, guideStep - 1)); renderQuickStart(); break;
      case 'next': setGuideStep(Math.min(GUIDE_STEPS.length - 1, guideStep + 1)); renderQuickStart(); break;
      case 'go': { const step = GUIDE_STEPS[guideStep]; closeQuickStart(true); if (step?.view) navigate(step.view); break; }
      default: break;
    }
  });
  guideEventsBound = true;
}

export function guidePreferenceKey() { return `maestria-quickstart-complete:${state.profile?.user_id || state.profile?.email || 'teacher'}`; }
export function guideDismissedKey() { return `${guidePreferenceKey()}:dismissed`; }

export function renderQuickStart() {
  const root = $('#quickstart-root'); if (!root) return;
  const step = GUIDE_STEPS[guideStep];
  root.innerHTML = `<div class="quickstart-backdrop" role="presentation"><section class="quickstart-dialog" role="dialog" aria-modal="true" aria-labelledby="quickstart-title" aria-describedby="quickstart-description"><div class="quickstart-topline"><span class="eyebrow">PRIMEROS PASOS CON MAESTRIA</span><button type="button" class="quickstart-close" data-guide-action="close" aria-label="Cerrar guía">×</button></div><div class="quickstart-progress" aria-label="Paso ${guideStep + 1} de ${GUIDE_STEPS.length}">${GUIDE_STEPS.map((item, index) => `<span class="${index <= guideStep ? 'is-current' : ''}"></span>`).join('')}</div><div class="quickstart-icon" aria-hidden="true">${['▣', '▤', '✓', '≡'][guideStep]}</div><span class="quickstart-step-label">PASO ${guideStep + 1} DE ${GUIDE_STEPS.length}</span><h2 id="quickstart-title">${escapeHtml(step.title)}</h2><p id="quickstart-description">${escapeHtml(step.body)}</p><div class="quickstart-tip"><span>${escapeHtml(step.tip)}</span></div><div class="quickstart-footer"><button type="button" class="btn btn-secondary" data-guide-action="close">Lo veo después</button><div>${guideStep > 0 ? '<button type="button" class="btn btn-secondary" data-guide-action="previous">Anterior</button>' : ''}${guideStep < GUIDE_STEPS.length - 1 ? '<button type="button" class="btn btn-primary" data-guide-action="next">Siguiente</button>' : `<button type="button" class="btn btn-primary" data-guide-action="go">${escapeHtml(step.action)}</button>`}</div></div><p class="quickstart-link-row">La guía está disponible desde el botón de ayuda.</p></section></div>`;
  root.querySelector('.quickstart-close')?.focus();
}

export function openQuickStart() {
  if (['admin', 'superadmin'].includes(state.profile?.role)) return;
  if (!$('#quickstart-root')?.innerHTML) guideOpener = document.activeElement;
  guideStep = 0; renderQuickStart();
}

export function closeQuickStart(completed = true) {
  const root = $('#quickstart-root'); if (root) root.innerHTML = '';
  try {
    if (completed) { sessionStorage.setItem(guidePreferenceKey(), 'true'); sessionStorage.removeItem(guideDismissedKey()); }
    else sessionStorage.setItem(guideDismissedKey(), 'true');
  } catch {}
  const opener = guideOpener; guideOpener = null;
  if (opener instanceof HTMLElement && opener.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
}

export function maybeOpenQuickStart() {
  if (['admin', 'superadmin'].includes(state.profile?.role)) return;
  try {
    if (sessionStorage.getItem(guidePreferenceKey()) !== 'true' && sessionStorage.getItem(guideDismissedKey()) !== 'true') openQuickStart();
  } catch {}
}
