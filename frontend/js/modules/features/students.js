import { state } from '../core/state.js';
import { escapeHtml, btn, heading, table, statusPill, resourceError, emptyState } from '../core/utils.js';

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
    return `<tr><td><button type="button" class="entity-link" data-action="edit-student" data-id="${escapeHtml(student.id)}">${escapeHtml(student.name)}</button><small>${escapeHtml(student.email || 'Sin correo')}</small></td><td>${escapeHtml(student.external_code || '—')}</td><td>${courseLinks || '<span class="muted">Sin curso activo</span>'}</td><td>${statusPill(student.active ? 'active' : 'inactive')}</td><td><div class="table-actions">${btn('Editar', 'edit-student', `data-id="${student.id}"`)}${btn(student.active ? 'Desactivar' : 'Activar', 'toggle-student', `data-id="${student.id}"`)}</div></td></tr>`;
  });
  const courseOptions = state.data.courses.map(course => `<option value="${course.id}" ${String(course.id) === String(state.studentCourseFilter) ? 'selected' : ''}>${escapeHtml(course.name)}</option>`).join('');
  return `${heading('Estudiantes', 'Administrá los datos de las personas y sus matrículas. Para ver entregas y correcciones, abrí el curso correspondiente.', `${btn('Importar CSV', 'import-students')}${btn('Agregar estudiante', 'new-student', '', 'primary')}`)}${resourceError('students', 'los estudiantes')}
    <div class="toolbar"><label class="search-control"><span class="search-control-icon" aria-hidden="true">⌕</span><input class="search-input" type="search" placeholder="Buscar nombre, correo o código" aria-label="Buscar estudiantes" value="${escapeHtml(state.search)}" data-search="students"></label><select class="filter-select" data-filter="student-course" aria-label="Filtrar por curso"><option value="all" ${state.studentCourseFilter === 'all' ? 'selected' : ''}>Todos los cursos</option>${courseOptions}<option value="unassigned" ${state.studentCourseFilter === 'unassigned' ? 'selected' : ''}>Sin curso activo</option></select><select class="filter-select" data-filter="student-status" aria-label="Filtrar por estado"><option value="active" ${state.studentStatusFilter === 'active' ? 'selected' : ''}>Activos</option><option value="inactive" ${state.studentStatusFilter === 'inactive' ? 'selected' : ''}>Inactivos</option><option value="all" ${state.studentStatusFilter === 'all' ? 'selected' : ''}>Todos</option></select><span class="filter-result-count">${items.length} estudiantes</span></div>${table(['Estudiante', 'Código externo', 'Cursos', 'Estado', 'Acciones'], rows, 'No hay estudiantes que coincidan con los filtros.')}`;
}
