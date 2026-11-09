import { state } from '../core/state.js';
import { escapeHtml, btn, heading, table, statusPill, resourceError, emptyState, date, formatNumber, toneOf, icon, searchField, toolbarSelect, resultCount, chipGroup, initials } from '../core/utils.js';
import { EXAM_STATUS, examStatus, examCorrection } from './exam-status.js';

export function renderStudents() {
  const query = state.search.trim().toLowerCase();
  const courseId = state.studentCourseFilter;
  const items = state.data.students.filter(student => {
    const activeEnrollments = state.data.enrollments.filter(item => String(item.student) === String(student.id) && item.status === 'active');
    const matchesCourse = courseId === 'all' || (courseId === 'unassigned' ? activeEnrollments.length === 0 : activeEnrollments.some(item => String(item.course) === String(courseId)));
    const matchesStatus = state.studentStatusFilter === 'all' || (state.studentStatusFilter === 'active' ? student.active : !student.active);
    return matchesCourse && matchesStatus && (!query || `${student.name} ${student.email} ${student.external_code}`.toLowerCase().includes(query));
  });
  const rows = items.map(student => {
    const courseLinks = state.data.enrollments.filter(item => String(item.student) === String(student.id) && item.status === 'active').map(item => {
      const course = state.data.courses.find(row => String(row.id) === String(item.course));
      return course ? `<button type="button" class="inline-entity-link" data-action="open-course" data-id="${escapeHtml(course.id)}">${escapeHtml(course.name)}</button>` : '';
    }).filter(Boolean).join('');
    return `<tr><td><button type="button" class="entity-link" data-action="open-student" data-id="${escapeHtml(student.id)}">${escapeHtml(student.name)}</button><small>${escapeHtml(student.email || 'Sin correo')}</small></td><td>${escapeHtml(student.external_code || '—')}</td><td>${courseLinks || '<span class="muted">Sin curso activo</span>'}</td><td>${statusPill(student.active ? 'active' : 'inactive')}</td><td><div class="table-actions">${btn('Ver exámenes', 'open-student', `data-id="${escapeHtml(student.id)}"`)}${btn('Editar', 'edit-student', `data-id="${escapeHtml(student.id)}"`)}${btn(student.active ? 'Desactivar' : 'Activar', 'toggle-student', `data-id="${escapeHtml(student.id)}"`)}</div></td></tr>`;
  });
  const courseOptions = [{ value: 'all', label: 'Todos los cursos' }, ...state.data.courses.map(course => ({ value: course.id, label: course.name })), { value: 'unassigned', label: 'Sin curso activo' }];
  const filtered = query || state.studentCourseFilter !== 'all' || state.studentStatusFilter !== 'active';
  return `${heading('Estudiantes', 'Administrá los datos de las personas y sus matrículas. Abrí a cada estudiante para ver sus exámenes.', `${btn('Importar CSV', 'import-students')}${btn('Agregar estudiante', 'new-student', '', 'primary')}`)}${resourceError('students', 'los estudiantes')}
    <div class="toolbar" role="search">${searchField('Buscar estudiantes', state.search, 'Buscar nombre, correo o código', 'data-search="students" id="student-search"')}${toolbarSelect('Filtrar por curso', 'data-filter="student-course" id="student-course"', courseOptions, state.studentCourseFilter)}${chipGroup('Estado del estudiante', 'student-status', [{ value: 'active', label: 'Activos', active: state.studentStatusFilter === 'active' }, { value: 'inactive', label: 'Inactivos', active: state.studentStatusFilter === 'inactive' }, { value: 'all', label: 'Todos', active: state.studentStatusFilter === 'all' }])}${resultCount(`${items.length} estudiantes`, filtered ? 'clear-student-filters' : '')}</div>
    ${table(['Estudiante', 'Código externo', 'Cursos', 'Estado', 'Acciones'], rows, 'No hay estudiantes que coincidan con los filtros.')}`;
}

/** Un examen (entrega) del estudiante como plegable cerrado por defecto. */
function examFold(submission) {
  const assessment = state.data.assessments.find(item => String(item.id) === String(submission.assessment));
  const correction = examCorrection(submission);
  const status = examStatus(submission);
  const courseId = assessment?.course ?? assessment?.course_id ?? correction?.course_id;
  const course = state.data.courses.find(item => String(item.id) === String(courseId));
  const score = correction ? formatNumber(correction.total_score) : '—';
  const title = assessment?.title || correction?.submission_title || 'Evaluación';
  return `<details class="fold exam-fold" data-row data-status="${status}" data-ui-key="exam-${escapeHtml(submission.id)}" data-tone="${toneOf(courseId ?? 'none')}">
    <summary><span class="fold-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(course?.name || 'Sin curso')} · Entregado el ${escapeHtml(date(submission.created_at))}</small></span><span class="exam-score" title="Nota"><span class="visually-hidden">Nota: </span>${escapeHtml(score)}</span>${statusPill(EXAM_STATUS[status].pill, EXAM_STATUS[status].label)}${icon('chevron')}</summary>
    <div class="fold-body">
      <dl class="detail-list"><div><dt>Fecha de entrega</dt><dd>${escapeHtml(date(submission.created_at, true))}</dd></div><div><dt>Nota</dt><dd>${escapeHtml(score)}</dd></div><div><dt>Estado</dt><dd>${escapeHtml(EXAM_STATUS[status].label)}</dd></div><div><dt>Origen</dt><dd>${escapeHtml(submission.source_filename || 'Texto')}</dd></div></dl>
      ${submission.answer_text ? `<blockquote class="answer-excerpt">${escapeHtml(submission.answer_text)}${submission.answer_text.length >= 300 ? '…' : ''}</blockquote>` : ''}
      <div class="fold-footer">${correction ? btn('Abrir devolución', 'open-correction', `data-id="${escapeHtml(correction.id)}"`, 'primary') : ''}${btn(correction ? 'Ver entrega' : 'Abrir entrega', 'open-submission', `data-id="${escapeHtml(submission.id)}"`, correction ? 'secondary' : 'primary')}</div>
    </div>
  </details>`;
}

export function renderStudentDetail() {
  const student = state.data.students.find(item => String(item.id) === String(state.selectedStudent));
  if (!student) { state.view = 'students'; return renderStudents(); }
  const exams = state.data.submissions.filter(item => String(item.student) === String(student.id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const courses = state.data.enrollments.filter(item => String(item.student) === String(student.id) && item.status === 'active')
    .map(item => state.data.courses.find(row => String(row.id) === String(item.course))).filter(Boolean);
  const counts = Object.keys(EXAM_STATUS).reduce((acc, key) => ({ ...acc, [key]: exams.filter(item => examStatus(item) === key).length }), {});
  const chips = exams.length >= 4 ? chipGroup('Filtrar exámenes por estado', 'student-exams', [{ value: 'all', label: 'Todos', count: exams.length, active: true }, ...Object.entries(EXAM_STATUS).filter(([key]) => counts[key]).map(([value, meta]) => ({ value, label: meta.plural, count: counts[value], active: false }))], { idPrefix: `student-exams-${student.id}` }) : '';

  const meta = `<span class="avatar avatar-lg" aria-hidden="true">${escapeHtml(initials(student.name))}</span>`;
  return `${heading(student.name, [student.email, student.external_code].filter(Boolean).join(' · ') || 'Sin datos de contacto', `${btn('Volver a estudiantes', 'navigate', 'data-view="students"')}${btn('Editar', 'edit-student', `data-id="${escapeHtml(student.id)}"`)}`)}
    <section class="panel student-summary"><div class="panel-body student-summary-body">${meta}<div><p class="eyebrow">Cursos</p><p>${courses.length ? courses.map(course => `<button type="button" class="inline-entity-link" data-action="open-course" data-id="${escapeHtml(course.id)}">${escapeHtml(course.name)}</button>`).join('') : '<span class="muted">Sin curso activo</span>'}</p></div><dl class="entity-metrics"><div><dt>exámenes</dt><dd>${exams.length}</dd></div><div><dt>aprobados</dt><dd>${counts.approved}</dd></div><div class="${counts.review ? 'is-pending' : ''}"><dt>por revisar</dt><dd>${counts.review}</dd></div><div><dt>pendientes</dt><dd>${counts.pending}</dd></div></dl></div></section>
    ${resourceError('submissions', 'las entregas')}
    <section class="panel"><div class="panel-head"><div><h2>Exámenes</h2><p>Cada examen se abre para ver nota, estado y la devolución.</p></div></div><div class="panel-body">
      ${exams.length ? `${chips}<div class="fold-list" data-filter-scope="student-exams" data-filter-attr="status">${exams.map(examFold).join('')}</div>` : emptyState('Todavía no hay exámenes', 'Cuando cargues una entrega de este estudiante, va a aparecer acá.', btn('Ir al espacio de trabajo', 'navigate', 'data-view="workspace"', 'primary'))}
    </div></section>`;
}
