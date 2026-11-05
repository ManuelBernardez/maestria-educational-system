import { state, modal } from '../core/state.js';
import { escapeHtml, formatNumber, toneOf, statusPill, btn, date, heading, emptyState, resourceError, formField, textField, courseIdForCorrection } from '../core/utils.js';
import { openModal, modalForm } from '../core/ui.js';

export function renderCourses() {
  const query = state.search.trim().toLocaleLowerCase('es-AR');
  const courses = [...state.data.courses].filter(course => !query || `${course.name || ''} ${course.subject || ''} ${course.level || ''} ${course.academic_year || ''}`.toLocaleLowerCase('es-AR').includes(query)).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es-AR'));
  const cards = courses.map(course => {
    const enrollments = state.data.enrollments.filter(item => String(item.course) === String(course.id) && item.status === 'active');
    const assessments = state.data.assessments.filter(item => String(item.course ?? item.course_id ?? '') === String(course.id));
    const assessmentIds = new Set(assessments.map(item => String(item.id)));
    const submissions = state.data.submissions.filter(item => assessmentIds.has(String(item.assessment)));
    const corrections = state.data.corrections.filter(item => String(courseIdForCorrection(item) ?? '') === String(course.id));
    const pending = corrections.filter(item => item.status === 'pending_review').length;
    return `<article class="course-list-card ${course.active ? '' : 'is-archived'}" data-tone="${toneOf(course.id)}">
      <div class="course-list-card-main"><div class="course-list-symbol" aria-hidden="true">▤</div><div class="course-list-copy"><button class="entity-link entity-link--title" type="button" data-action="open-course" data-id="${escapeHtml(course.id)}">${escapeHtml(course.name)}</button><p>${escapeHtml([course.subject, course.level, course.academic_year].filter(Boolean).join(' · ') || 'Materia o comisión')}</p><small>${course.active ? 'Curso activo' : 'Curso archivado'}</small></div>${statusPill(course.active ? 'active' : 'archived')}</div>
      <div class="course-list-metrics"><span><strong>${enrollments.length}</strong> estudiantes</span><span><strong>${assessments.length}</strong> evaluaciones</span><span><strong>${submissions.length}</strong> entregas</span><span class="${pending ? 'is-pending' : ''}"><strong>${pending}</strong> por revisar</span></div>
      <footer class="course-list-actions"><button type="button" class="btn btn-primary btn-small" data-action="open-course" data-id="${escapeHtml(course.id)}">Abrir curso</button><button type="button" class="btn btn-secondary btn-small" data-action="edit-course" data-id="${escapeHtml(course.id)}">Editar</button><button type="button" class="btn btn-secondary btn-small" data-action="toggle-course" data-id="${escapeHtml(course.id)}">${course.active ? 'Archivar' : 'Reactivar'}</button></footer>
    </article>`;
  }).join('');
  return `${heading('Cursos', 'Cada curso reúne estudiantes, evaluaciones, entregas y correcciones en un único espacio.', btn('Crear curso', 'new-course', '', 'primary'))}${resourceError('courses', 'los cursos')}
    <div class="toolbar course-toolbar"><label class="search-control"><span class="search-control-icon" aria-hidden="true">⌕</span><input class="search-input" type="search" data-search="courses" aria-label="Buscar cursos" placeholder="Buscar por nombre, materia o nivel" value="${escapeHtml(state.search)}"></label><span class="filter-result-count">${courses.filter(course => `${course.name} ${course.subject || ''} ${course.level || ''}`.toLowerCase().includes(state.search.trim().toLowerCase())).length} cursos</span></div>
    ${cards ? `<div class="course-list-grid">${cards}</div>` : emptyState('Todavía no hay cursos', 'Creá un curso para empezar a organizar estudiantes, evaluaciones y correcciones.', btn('Crear primer curso', 'new-course', '', 'primary'))}`;
}

export function renderCourseDetail() {
  const course = state.data.courses.find(item => String(item.id) === String(state.selectedCourse));
  if (!course) { state.view = 'courses'; return renderCourses(); }
  const enrollments = state.data.enrollments.filter(item => String(item.course) === String(course.id));
  const activeEnrollments = enrollments.filter(item => item.status === 'active');
  const assessments = state.data.assessments.filter(item => String(item.course ?? item.course_id ?? '') === String(course.id));
  const assessmentIds = new Set(assessments.map(item => String(item.id)));
  const submissions = state.data.submissions.filter(item => assessmentIds.has(String(item.assessment)));
  const corrections = state.data.corrections.filter(item => String(courseIdForCorrection(item) ?? '') === String(course.id));
  const pendingCorrections = corrections.filter(item => item.status === 'pending_review');

  const studentRows = enrollments.map(enrollment => {
    const student = state.data.students.find(item => String(item.id) === String(enrollment.student));
    const name = enrollment.student_name || student?.name || 'Estudiante';
    const email = enrollment.student_email || student?.email || '';
    return `<article class="course-record"><div class="course-record-main"><button type="button" class="entity-link" data-action="edit-student" data-id="${escapeHtml(enrollment.student)}">${escapeHtml(name)}</button><small>${escapeHtml(email || enrollment.student_external_code || 'Sin datos de contacto')}</small></div><div class="course-record-meta">${statusPill(enrollment.status)}</div><div class="course-record-actions">${btn('Ver / editar', 'edit-student', `data-id="${escapeHtml(enrollment.student)}"`)}${enrollment.status === 'active' ? btn('Desmatricular', 'deactivate-enrollment', `data-id="${escapeHtml(enrollment.id)}"`) : ''}</div></article>`;
  }).join('');

  const assessmentRows = assessments.map(item => `<article class="course-record"><div class="course-record-main"><button type="button" class="entity-link" data-action="open-assessment" data-id="${escapeHtml(item.id)}">${escapeHtml(item.title)}</button><small>${escapeHtml(item.subject || 'Evaluación')} · Actualizada ${date(item.updated_at)}</small></div><div class="course-record-meta">${statusPill(item.status)}</div><div class="course-record-actions">${btn('Abrir', 'open-assessment', `data-id="${escapeHtml(item.id)}"`, 'primary')}${btn('Editar', 'edit-assessment', `data-id="${escapeHtml(item.id)}"`)}</div></article>`).join('');

  const submissionRows = submissions.map(item => {
    const correction = state.data.corrections.find(row => String(row.submission) === String(item.id));
    return `<article class="course-record"><div class="course-record-main"><button type="button" class="entity-link" data-action="open-submission" data-id="${escapeHtml(item.id)}">${escapeHtml(item.student_display_name || item.student_name || 'Estudiante sin identificar')}</button><small>${escapeHtml(item.submission_title || item.assessment_title || assessments.find(row => String(row.id) === String(item.assessment))?.title || 'Evaluación')} · ${date(item.created_at, true)}</small></div><div class="course-record-meta">${statusPill(item.status)} ${correction ? statusPill(correction.status) : ''}</div><div class="course-record-actions">${btn(correction ? 'Revisar devolución' : 'Abrir entrega', 'open-submission', `data-id="${escapeHtml(item.id)}"`, correction ? 'primary' : 'secondary')}</div></article>`;
  }).join('');

  const correctionRows = corrections.map(item => `<article class="course-record"><div class="course-record-main"><button type="button" class="entity-link" data-action="open-correction" data-id="${escapeHtml(item.id)}">${escapeHtml(item.submission_title || 'Evaluación')}</button><small>${escapeHtml(item.student_name || 'Estudiante')} · ${date(item.created_at, true)}</small></div><div class="course-record-meta">${statusPill(item.status)}<strong class="course-score">${escapeHtml(formatNumber(item.total_score))}</strong></div><div class="course-record-actions">${btn('Abrir devolución', 'open-correction', `data-id="${escapeHtml(item.id)}"`, 'primary')}</div></article>`).join('');

  const fold = (key, title, detail, count, body, action = '') => `<details class="course-fold" data-fold="${key}"><summary><span class="course-fold-copy"><strong>${title}</strong><small>${detail}</small></span><span class="course-fold-count">${count}</span><span class="course-card-chevron" aria-hidden="true">⌄</span></summary><div class="course-fold-body">${body}${action ? `<div class="course-fold-footer">${action}</div>` : ''}</div></details>`;
  const studentActions = `<div class="course-action-group">${btn('Agregar estudiante', 'new-student', `data-course="${course.id}"`, 'primary')}${btn('Vincular existente', 'enroll-student', `data-course="${course.id}"`)}${btn('Ver lista completa', 'manage-course-students', `data-course="${course.id}"`)}</div>`;

  const withCourse = `data-course="${course.id}"`;
  const nextStep = !activeEnrollments.length
    ? { text: 'Empezá sumando a los estudiantes del curso.', label: 'Agregar estudiante', action: 'new-student', attrs: withCourse }
    : !assessments.length
      ? { text: 'Creá la primera evaluación para este curso.', label: 'Crear evaluación', action: 'new-assessment', attrs: withCourse }
      : pendingCorrections.length
        ? { text: `${pendingCorrections.length} ${pendingCorrections.length === 1 ? 'devolución espera' : 'devoluciones esperan'} tu revisión.`, label: 'Ver correcciones', action: 'open-fold', attrs: 'data-fold="corrections"' }
        : !submissions.length
          ? { text: 'Cargá las entregas para generar propuestas de corrección.', label: 'Cargar entrega', action: 'new-submission', attrs: withCourse }
          : { text: 'Todo al día en este curso.' };
  const steps = [['students', 'Estudiantes', activeEnrollments.length], ['assessments', 'Evaluaciones', assessments.length], ['submissions', 'Entregas', submissions.length], ['corrections', 'Correcciones', corrections.length]];
  const pipeline = `<nav class="course-pipeline" aria-label="Recorrido del curso">${steps.map(([key, label, count], index) => `<button type="button" class="pipeline-step${key === 'corrections' && pendingCorrections.length ? ' has-pending' : ''}" data-action="open-fold" data-fold="${key}"><span class="pipeline-dot">${index + 1}</span><span class="pipeline-label">${label}</span><strong>${count}</strong></button>`).join('')}</nav>
    <div class="course-next"><span aria-hidden="true">✳</span><p>${nextStep.text}</p>${nextStep.action ? btn(nextStep.label, nextStep.action, nextStep.attrs, 'primary') : ''}</div>`;

  return `<div class="course-view" data-tone="${toneOf(course.id)}">${heading(course.name, `${course.subject || 'Curso'} · ${course.level || 'Nivel no indicado'} · ${course.academic_year || 'Ciclo no indicado'}`, `${btn('Volver a cursos', 'navigate', 'data-view="courses"')}${btn('Editar curso', 'edit-course', `data-id="${course.id}"`)}`)}
    ${pipeline}
    <details class="course-context-details"><summary><span class="course-context-trigger-copy"><strong>Resumen del curso</strong><small>Indicadores, descripción y actividad de esta materia</small></span><span class="course-card-chevron" aria-hidden="true">⌄</span></summary><div class="course-context-summary"><div><span class="eyebrow">INFORMACIÓN GENERAL</span><p>${escapeHtml(course.description || 'Este espacio concentra la información académica y el proceso de corrección de esta materia.')}</p></div><div class="course-context-stats"><article><strong>${activeEnrollments.length}</strong><span>Estudiantes activos</span></article><article><strong>${assessments.length}</strong><span>Evaluaciones</span></article><article><strong>${submissions.length}</strong><span>Entregas</span></article><article><strong>${pendingCorrections.length}</strong><span>Por revisar</span></article></div></div></details>
    <section class="course-workflow-list" aria-label="Información del curso">
      ${fold('students', 'Estudiantes', 'Personas matriculadas en este curso', activeEnrollments.length, studentRows || '<p class="muted">Todavía no hay estudiantes matriculados.</p>', studentActions)}
      ${fold('assessments', 'Evaluaciones', 'Consignas, materiales y rúbricas del curso', assessments.length, assessmentRows || '<p class="muted">Todavía no hay evaluaciones para este curso.</p>', btn('Crear evaluación', 'new-assessment', `data-course="${course.id}"`, 'primary'))}
      ${fold('submissions', 'Entregas', 'Respuestas recibidas y su estado de procesamiento', submissions.length, submissionRows || '<p class="muted">Todavía no hay entregas asociadas a las evaluaciones de este curso.</p>', btn('Cargar entrega', 'new-submission', `data-course="${course.id}"`, 'primary'))}
      ${fold('corrections', 'Correcciones y devoluciones', 'Propuestas pendientes de revisión y resultados aprobados', corrections.length, correctionRows || '<p class="muted">Todavía no hay correcciones para este curso.</p>')}
    </section>
    <p class="app-disclaimer">El curso es el contexto de trabajo: cada entrega se vincula a una evaluación, cada corrección a una entrega y la aprobación final siempre queda a cargo del docente.</p></div>`;
}

export function courseForm(course = null) {
  const fields = `${formField('Nombre del curso', 'name', course?.name || '', 'text', 'maxlength="180"', true)}${formField('Materia / área', 'subject', course?.subject || '', 'text', 'maxlength="120"')}${formField('Nivel', 'level', course?.level || '', 'text', 'maxlength="120"')}${formField('Ciclo lectivo', 'academic_year', course?.academic_year || '', 'text', 'maxlength="80"')}${textField('Descripción', 'description', course?.description || '')}`;
  openModal(course ? 'Editar curso' : 'Crear curso', modalForm(fields), course ? 'edit-course' : 'new-course', true);
  modal.dataset.recordId = course?.id || '';
}
