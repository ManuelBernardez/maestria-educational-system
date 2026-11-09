/* ---------- Desplegables exclusivos (acordeón) ----------
 * En todo el espacio docente sólo puede haber un desplegable abierto por grupo:
 * al abrir uno, el que estaba abierto se pliega.
 *
 * Grupo = los <details> del mismo contenedor ([data-accordion] más cercano o, si no
 * hay, el elemento padre) que están en el mismo nivel de anidamiento. Así un
 * desplegable anidado nunca cierra al que lo contiene.
 *
 * Sólo se aplica a aperturas hechas por la persona (clic o teclado sobre el
 * <summary>) y a las que pasan por openExclusive(). Los estados iniciales del
 * markup y la restauración tras un re-render no se tocan, y una orden explícita
 * como «Expandir todo» puede seguir abriendo varios a la vez. */

const parentDetails = node => node.parentElement?.closest('details') ?? null;

function groupOf(details) {
  const root = details.closest('[data-accordion]') || details.parentElement;
  if (!root) return [];
  const level = parentDetails(details);
  return [...root.querySelectorAll('details[open]')]
    .filter(other => other !== details && parentDetails(other) === level);
}

/** Pliega los demás desplegables abiertos del grupo de `details`. */
export function closeSiblings(details) {
  groupOf(details).forEach(other => { other.open = false; });
}

/** Abre `details` (y sus contenedores) plegando a los demás de cada grupo. */
export function openExclusive(details) {
  if (!(details instanceof HTMLDetailsElement)) return;
  for (let node = details; node; node = parentDetails(node)) {
    closeSiblings(node);
    node.open = true;
  }
}

/** Instala el comportamiento en `root` (una sola vez por raíz). */
export function bindExclusiveDetails(root = document) {
  if (!root || root.dataset?.exclusiveDetails === 'bound') return;
  if (root.dataset) root.dataset.exclusiveDetails = 'bound';
  root.addEventListener('click', event => {
    const summary = event.target instanceof Element ? event.target.closest('summary') : null;
    const details = summary?.parentElement;
    // Sólo el <summary> propio de un <details> lo alterna; los enlaces o botones internos no.
    if (!(details instanceof HTMLDetailsElement) || details.querySelector(':scope > summary') !== summary) return;
    const interactive = event.target.closest('a, button, input, select, textarea, label');
    if (event.defaultPrevented || (interactive && summary.contains(interactive))) return;
    if (!details.open) closeSiblings(details);
  });
}
