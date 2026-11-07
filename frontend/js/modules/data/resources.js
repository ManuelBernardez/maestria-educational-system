import { api } from '../core/api-client.js';
import { state } from '../core/state.js';
import { errorText } from '../core/utils.js';

// Listas completas que el docente carga bajo demanda. El resumen (dashboard/overview)
// ya trae cursos y evaluaciones compactos, así que el inicio no necesita ninguna de estas.
const RESOURCES = Object.freeze({
  courses: 'courses/', students: 'students/', enrollments: 'enrollments/',
  assessments: 'assessments/', rubrics: 'rubrics/', submissions: 'submissions/',
  corrections: 'corrections/?summary=1'
});

const COURSE_WORK = ['courses', 'assessments', 'students', 'enrollments', 'submissions', 'corrections', 'rubrics'];
const REVIEW = ['courses', 'assessments', 'submissions', 'corrections', 'rubrics', 'students', 'enrollments'];

// Datos que cada vista necesita antes de dibujarse (hard) y los que completan el panel sin bloquearlo (soft).
const VIEW_RESOURCES = Object.freeze({
  dashboard: { hard: [], soft: ['corrections', 'submissions', 'assessments'] },
  courses: { hard: ['courses'], soft: ['enrollments', 'assessments', 'submissions', 'corrections'] },
  course: { hard: COURSE_WORK },
  students: { hard: ['courses', 'students', 'enrollments'] },
  student: { hard: ['courses', 'students', 'enrollments', 'assessments', 'submissions', 'corrections'] },
  assessments: { hard: ['courses', 'assessments', 'submissions', 'corrections'] },
  'assessment-new': { hard: ['courses'] },
  assessment: { hard: ['courses', 'assessments', 'rubrics'] },
  rubrics: { hard: ['rubrics'] },
  rubric: { hard: ['rubrics'] },
  submissions: { hard: REVIEW },
  submission: { hard: REVIEW },
  corrections: { hard: REVIEW },
  correction: { hard: REVIEW }
  // El espacio de trabajo obtiene un resumen acotado desde /correction-workspace/.
  // Evitamos duplicar esas siete solicitudes con las listas generales.
});

const loaded = new Set();
const inflight = new Map();

export const loadedResources = () => [...loaded];
export const missingResources = (view, kind = 'hard') => (VIEW_RESOURCES[view]?.[kind] || []).filter(key => !loaded.has(key));

async function loadOne(key) {
  try {
    state.data[key] = await api.list(RESOURCES[key]);
    delete state.errors[key];
    return true;
  } catch (error) {
    state.errors[key] = errorText(error);
    return false;
  }
}

/** Carga las listas indicadas una sola vez; nunca rechaza: el error queda en state.errors[key]. */
export function loadResources(keys) {
  const pending = keys.filter(key => RESOURCES[key] && !loaded.has(key)).map(key => {
    if (!inflight.has(key)) inflight.set(key, loadOne(key).then(success => {
      if (success) loaded.add(key);
      inflight.delete(key);
      return success;
    }));
    return inflight.get(key);
  });
  return Promise.all(pending);
}

/** Vuelve a pedir solo lo que la sesión ya cargó (tras guardar o al reintentar). */
export function reloadLoadedResources() {
  return Promise.all([...loaded].map(loadOne));
}

/** Vuelve a pedir solo las listas indicadas tras una escritura (p. ej. cursos tras crear uno).
 *  Fuerza el refetch incluso si la lista ya estaba cargada. */
export async function reloadResources(keys) {
  await Promise.all((keys || []).map(async key => { if (RESOURCES[key] && await loadOne(key)) loaded.add(key); }));
}

/** Marca listas como no cargadas: otra vista las reemplazó con un subconjunto
 *  (p. ej. el espacio de trabajo trae solo las entregas de una evaluación). */
export function invalidateResources(keys) {
  (keys || []).forEach(key => loaded.delete(key));
}
