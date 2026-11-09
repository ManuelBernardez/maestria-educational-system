import { state } from '../core/state.js';
import { escapeHtml, formatNumber, toneOf, firstName, greeting, courseName, btn, date, heading, panel, chipGroup, courseIdForCorrection } from '../core/utils.js';

const QUEUE_LIMIT = 8;
/** A partir de esta cantidad de filas se ofrecen chips para filtrar en el cliente. */
const FILTER_THRESHOLD = 4;

function estimatedTime(approved) {
  const minutes = approved * 8;
  return minutes >= 60 ? `${(minutes / 60).toLocaleString('es-AR', { maximumFractionDigits: 1 })} h` : `${minutes} min`;
}

function queueMarkup(pending, pendingCount) {
  if (!pending.length) {
    const message = state.loading ? 'Cargando tus devoluciones…'
      : state.errors.corrections ? 'No se pudo cargar el detalle de las devoluciones. El contador del resumen sigue actualizado.'
        : pendingCount ? 'Hay devoluciones pendientes; no se pudo mostrar su detalle.' : 'No tenés devoluciones esperando tu decisión.';
    return `<div class="queue-clear"><span class="stamp">${pendingCount ? 'En revisión' : 'Al día'}</span><p>${message}</p></div>`;
  }
  const rows = pending.slice(0, QUEUE_LIMIT).map(item => {
    const courseId = courseIdForCorrection(item);
    return `<article class="queue-item" data-row data-course="${escapeHtml(courseId ?? 'none')}" data-tone="${toneOf(courseId)}"><div class="queue-copy"><button type="button" class="entity-link" data-action="open-correction" data-id="${escapeHtml(item.id)}">${escapeHtml(item.student_name || 'Estudiante')}</button><small>${escapeHtml(item.submission_title || 'Evaluación')} · ${escapeHtml(courseName(courseId))}</small></div><span class="queue-score" title="Puntaje propuesto">${escapeHtml(formatNumber(item.total_score))}</span>${btn('Revisar', 'open-correction', `data-id="${escapeHtml(item.id)}"`, 'primary')}</article>`;
  }).join('');

  // Chips por curso: filtran las filas visibles con [hidden], sin volver a pedir datos.
  const shown = pending.slice(0, QUEUE_LIMIT);
  let chips = '';
  if (shown.length >= FILTER_THRESHOLD) {
    const byCourse = new Map();
    shown.forEach(item => { const id = String(courseIdForCorrection(item) ?? 'none'); byCourse.set(id, (byCourse.get(id) || 0) + 1); });
    if (byCourse.size > 1) {
      const active = state.dashboardCourseFilter;
      chips = chipGroup('Filtrar por curso', 'dashboard-course', [
        { value: 'all', label: 'Todos', count: shown.length, active: active === 'all' || !byCourse.has(active) },
        ...[...byCourse.entries()].map(([id, count]) => ({ value: id, label: id === 'none' ? 'Sin curso' : courseName(id), count, active: active === id }))
      ]);
    }
  }
  const more = pendingCount > QUEUE_LIMIT ? `<p class="queue-more">y ${pendingCount - QUEUE_LIMIT} más dentro de tus cursos</p>` : '';
  return `${chips}<div class="queue-list" data-filter-scope="dashboard-course">${rows}</div>${more}`;
}

export function renderDashboard() {
  const summary = state.data.overview?.summary || {};
  const approved = Number(summary.approved_corrections || 0);
  const pending = state.data.corrections.filter(item => item.status === 'pending_review');
  const pendingCount = Number(summary.pending_corrections ?? pending.length);
  const pendingByCourse = new Map((state.data.overview?.course_correction_counts || [])
    .filter(item => item.status === 'pending_review')
    .map(item => [String(item.course_id), Number(item.count || 0)]));
  const name = firstName();
  const intro = pendingCount
    ? `Tenés <strong>${pendingCount}</strong> ${pendingCount === 1 ? 'devolución esperando' : 'devoluciones esperando'} tu revisión.`
    : 'No hay nada pendiente. Buen momento para preparar la próxima evaluación.';
  // Cada indicador lleva al historial de correcciones filtrado por lo que cuenta.
  const stats = [
    { label: 'Por revisar', value: pendingCount, detail: 'Propuestas que esperan tu decisión', tone: 2, note: pendingCount > 0, status: 'pending_review', cta: 'Ver pendientes' },
    { label: 'Revisadas', value: approved, detail: 'Devoluciones aprobadas por vos', tone: 0, status: 'approved', cta: 'Ver aprobadas' },
    { label: 'Tiempo ahorrado estimado', value: estimatedTime(approved), detail: 'Estimación orientativa · 8 min por devolución aprobada', tone: 1, status: 'approved', cta: 'Ver devoluciones' }
  ];

  const courseItems = state.data.courses.filter(item => item.active)
    .map(course => ({ course, count: pendingByCourse.get(String(course.id)) ?? pending.filter(item => String(courseIdForCorrection(item)) === String(course.id)).length }))
    .sort((a, b) => b.count - a.count || String(a.course.name).localeCompare(String(b.course.name), 'es-AR'))
    .slice(0, 6)
    .map(({ course, count }) => `<button type="button" class="mini-course" data-tone="${toneOf(course.id)}" data-action="open-course" data-id="${escapeHtml(course.id)}"><span class="mini-course-name">${escapeHtml(course.name)}</span><small>${escapeHtml([course.subject, course.academic_year].filter(Boolean).join(' · ') || 'Curso activo')}</small>${count ? `<span class="count-badge" title="${count} por revisar"><span class="visually-hidden">Por revisar: </span>${count}</span>` : ''}</button>`).join('');

  const last = [...state.data.assessments].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
  const resume = last
    ? `<section class="resume-card"><span class="eyebrow">Seguí donde quedaste</span><strong>${escapeHtml(last.title)}</strong><small>${escapeHtml(courseName(last.course ?? last.course_id))} · Actualizada ${date(last.updated_at)}</small>${btn('Abrir evaluación', 'open-assessment', `data-id="${escapeHtml(last.id)}"`)}</section>`
    : '';

  const hasCourses = state.data.courses.some(item => item.active);
  const body = !state.loading && !hasCourses
    ? `<section class="next-step"><span class="next-step-mark" aria-hidden="true">✳</span><p><strong>Todo empieza por un curso.</strong> Creá una materia para sumar su grupo, armar evaluaciones, revisar entregas y aprobar devoluciones sin mezclar información.</p><button class="btn btn-primary btn-small" type="button" data-action="new-course">Crear mi primer curso</button></section>`
    : `<div class="today-grid">
        ${panel('Para revisar ahora', 'Propuestas de la IA que esperan tu decisión', queueMarkup(pending, pendingCount))}
        <div class="today-side">
          ${panel('Tus cursos', '', courseItems ? `<div class="mini-course-list">${courseItems}</div>` : '<p class="muted">Todavía no hay cursos activos.</p>', btn('Ver todos', 'navigate', 'data-view="courses"'))}
          ${resume}
          <p class="margin-note"><strong>Una nota al margen.</strong> La IA sugiere. Vos decidís: ninguna devolución se aprueba sin tu revisión.</p>
        </div>
      </div>`;

  const title = `${greeting()}${name ? `, ${name}` : ''}`;
  return `${heading(title, '', btn('Ir a cursos', 'navigate', 'data-view="courses"', 'primary'), { tone: 2, leadHtml: intro })}
    ${state.errors.overview ? `<div class="notice notice-error" role="alert"><strong>No se pudo cargar el resumen.</strong> ${escapeHtml(state.errors.overview)} ${btn('Reintentar', 'refresh-resource', 'data-resource="overview"')}</div>` : ''}
    <section class="stat-grid" aria-label="Resumen de actividad">
      ${stats.map(stat => `<button type="button" class="stat stat-link${stat.note ? ' stat--note' : ''}" data-tone="${stat.tone}" data-action="open-corrections" data-status="${stat.status}" title="${escapeHtml(stat.cta)}"><strong>${state.data.overview ? escapeHtml(stat.value) : '—'}</strong><span>${escapeHtml(stat.label)}</span><small>${escapeHtml(stat.detail)}</small></button>`).join('')}
    </section>
    ${body}`;
}
