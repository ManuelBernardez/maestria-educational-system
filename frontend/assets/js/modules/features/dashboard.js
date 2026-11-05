import { state } from '../core/state.js';
import { escapeHtml, toneOf, firstName, greeting, courseName, btn, date, heading, panel, emptyState, courseIdForCorrection } from '../core/utils.js';

export function renderDashboard() {
  const summary = state.data.overview?.summary || {};
  const approved = Number(summary.approved_corrections || 0);
  const estimatedMinutes = approved * 8;
  const estimated = estimatedMinutes >= 60
    ? `${(estimatedMinutes / 60).toLocaleString('es-AR', { maximumFractionDigits: 1 })} h`
    : `${estimatedMinutes} min`;
  const pending = state.data.corrections.filter(item => item.status === 'pending_review');
  const pendingCount = Number(summary.pending_corrections ?? pending.length);
  const pendingByCourse = new Map((state.data.overview?.course_correction_counts || [])
    .filter(item => item.status === 'pending_review')
    .map(item => [String(item.course_id), Number(item.count || 0)]));
  const today = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const name = firstName();
  const intro = pendingCount
    ? `Tenés <strong>${pendingCount}</strong> ${pendingCount === 1 ? 'devolución esperando' : 'devoluciones esperando'} tu revisión.`
    : 'No hay nada pendiente. Buen momento para preparar la próxima evaluación.';
  const stats = [
    { label: 'Por revisar', value: pendingCount, detail: 'Propuestas que esperan tu decisión', tone: 2, note: pendingCount > 0 },
    { label: 'Revisadas', value: approved, detail: 'Devoluciones aprobadas por vos', tone: 0 },
    { label: 'Tiempo ahorrado estimado', value: estimated, detail: 'Estimación orientativa · 8 min por devolución aprobada', tone: 1 }
  ];

  const queue = pending.slice(0, 5).map(item => {
    const courseId = courseIdForCorrection(item);
    return `<article class="queue-item" data-tone="${toneOf(courseId)}"><div class="queue-copy"><strong>${escapeHtml(item.student_name || 'Estudiante')}</strong><small>${escapeHtml(item.submission_title || 'Evaluación')} · ${escapeHtml(courseName(courseId))}</small></div><span class="queue-score" title="Puntaje propuesto">${escapeHtml(item.total_score ?? '—')}</span>${btn('Revisar', 'open-correction', `data-id="${escapeHtml(item.id)}"`, 'primary')}</article>`;
  }).join('');
  const queueBody = pending.length
    ? `${queue}${pendingCount > 5 ? `<p class="queue-more">y ${pendingCount - 5} más dentro de tus cursos</p>` : ''}`
    : `<div class="queue-clear"><span class="stamp">${pendingCount ? 'En revisión' : 'Al día'}</span><p>${state.loading ? 'Cargando tus devoluciones…' : state.errors.corrections ? 'No se pudo cargar el detalle de las devoluciones. El contador del resumen sigue actualizado.' : pendingCount ? 'Hay devoluciones pendientes; no se pudo mostrar su detalle.' : 'No tenés devoluciones esperando tu decisión.'}</p></div>`;

  const courseItems = state.data.courses.filter(item => item.active)
    .map(course => ({ course, count: pendingByCourse.get(String(course.id)) ?? pending.filter(item => String(courseIdForCorrection(item)) === String(course.id)).length }))
    .sort((a, b) => b.count - a.count || String(a.course.name).localeCompare(String(b.course.name), 'es-AR'))
    .slice(0, 6)
    .map(({ course, count }) => `<button type="button" class="mini-course" data-tone="${toneOf(course.id)}" data-action="open-course" data-id="${escapeHtml(course.id)}"><span class="mini-course-name">${escapeHtml(course.name)}</span><small>${escapeHtml([course.subject, course.academic_year].filter(Boolean).join(' · ') || 'Curso activo')}</small>${count ? `<span class="mini-course-badge" title="${count} por revisar">${count}</span>` : ''}</button>`).join('');

  const last = [...state.data.assessments].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))[0];
  const resume = last
    ? `<section class="resume-card"><span class="eyebrow">SEGUÍ DONDE QUEDASTE</span><strong>${escapeHtml(last.title)}</strong><small>${escapeHtml(courseName(last.course ?? last.course_id))} · Actualizada ${date(last.updated_at)}</small>${btn('Abrir evaluación', 'open-assessment', `data-id="${escapeHtml(last.id)}"`)}</section>`
    : '';

  const hasCourses = state.data.courses.some(item => item.active);
  const body = !state.loading && !hasCourses
    ? `<section class="summary-next-step"><div><span class="eyebrow">TU ESPACIO DE TRABAJO</span><h2>Todo empieza por un curso</h2><p>Creá una materia para sumar su grupo, armar evaluaciones, revisar entregas y aprobar devoluciones sin mezclar información.</p></div><button class="btn btn-primary" type="button" data-action="new-course">Crear mi primer curso</button></section>`
    : `<div class="today-grid">
        ${panel('Para revisar ahora', 'Propuestas de la IA que esperan tu decisión', queueBody)}
        <div class="today-side">
          ${panel('Tus cursos', '', courseItems || '<p class="muted">Todavía no hay cursos activos.</p>', btn('Ver todos', 'navigate', 'data-view="courses"'))}
          ${resume}
          <p class="margin-note"><strong>✳ Una nota al margen.</strong> La IA sugiere. Vos decidís: ninguna devolución se aprueba sin tu revisión.</p>
        </div>
      </div>`;

  return `<header class="view-header view-header--today"><div class="view-heading-copy"><p class="view-kicker">${escapeHtml(today)}</p><h1>${greeting()}${name ? `, ${escapeHtml(name)}` : ''}</h1><p>${intro}</p></div><div class="view-actions">${btn('Ir a cursos', 'navigate', 'data-view="courses"', 'primary')}</div></header>
    ${state.errors.overview ? `<div class="notice notice-error" role="alert"><strong>No se pudo cargar el resumen.</strong><br>${escapeHtml(state.errors.overview)} ${btn('Reintentar', 'refresh-resource', 'data-resource="overview"')}</div>` : ''}
    <section class="today-stats" aria-label="Resumen de actividad">
      ${stats.map(stat => `<article class="today-stat${stat.note ? ' today-stat--note' : ''}" data-tone="${stat.tone}"><strong>${state.data.overview ? escapeHtml(stat.value) : '—'}</strong><span>${escapeHtml(stat.label)}</span><small>${escapeHtml(stat.detail)}</small></article>`).join('')}
    </section>
    ${body}`;
}
