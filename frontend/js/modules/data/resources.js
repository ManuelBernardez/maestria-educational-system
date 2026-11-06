import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { listFrom, errorText } from '../core/utils.js';

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
  courses: { hard: ['courses'] },
  course: { hard: COURSE_WORK },
  students: { hard: ['courses', 'students', 'enrollments'] },
  assessments: { hard: ['courses', 'assessments', 'rubrics'] },
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
    state.data[key] = listFrom(await api.get(RESOURCES[key]));
    delete state.errors[key];
  } catch (error) {
    state.errors[key] = errorText(error);
  }
}

/** Carga las listas indicadas una sola vez; nunca rechaza: el error queda en state.errors[key]. */
export function loadResources(keys) {
  const pending = keys.filter(key => RESOURCES[key] && !loaded.has(key)).map(key => {
    if (!inflight.has(key)) inflight.set(key, loadOne(key).then(() => { loaded.add(key); inflight.delete(key); }));
    return inflight.get(key);
  });
  return Promise.all(pending);
}

/** Vuelve a pedir solo lo que la sesión ya cargó (tras guardar o al reintentar). */
export function reloadLoadedResources() {
  return Promise.all([...loaded].map(loadOne));
}
