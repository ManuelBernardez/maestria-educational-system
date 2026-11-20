import { state, modal } from '../core/state.js';
import { escapeHtml, formatNumber, toneOf, statusPill, btn, date, heading, emptyState, resourceError, formField, textField, selectField, courseIdForCorrection, courseIdForSubmission, assessmentInCourse, assessmentCourseNames, knownSubjects, shiftLabel, SHIFT_OPTIONS, icon, searchField, chipGroup, toolbarSelect, resultCount, filteredEmpty } from '../core/utils.js';
import { openModal, modalForm } from '../core/ui.js';

/** La vista por defecto de «Mis materias» es la lista compacta. */
export const COURSE_FILTER_DEFAULTS = Object.freeze({ status: 'active', subject: 'all', cycle: 'all', sort: 'pending', layout: 'list' });
const ROW_FILTER_THRESHOLD = 4;
/** Tono fijo por sección del curso: cada plegable (y su paso del recorrido) se distingue por color. */
const FOLD_TONES = Object.freeze({ students: 0, assessments: 3, submissions: 2, corrections: 1 });

/** Métricas de un curso a partir de las listas cargadas (con respaldo en los contadores del resumen). */
function courseMetrics(course) {
  const enrollments = state.data.enrollments.filter(item => String(item.course) === String(course.id) && item.status === 'active');
  const assessments = state.data.assessments.filter(item => assessmentInCourse(item, course.id));
  const submissions = state.data.submissions.filter(item => String(courseIdForSubmission(item) ?? '') === String(course.id));
  const pending = state.data.corrections.filter(item => item.status === 'pending_review' && String(courseIdForCorrection(item) ?? '') === String(course.id)).length;
  return {
    students: state.data.enrollments.length ? enrollments.length : Number(course.student_count || 0),
    assessments: state.data.assessments.length ? assessments.length : Number(course.assessment_count || 0),
    submissions: submissions.length,
    pending
  };
}

const SORTERS = Object.freeze({
  pending: (a, b) => b.metrics.pending - a.metrics.pending || String(a.course.name).localeCompare(String(b.course.name), 'es-AR'),
  students: (a, b) => b.metrics.students - a.metrics.students || String(a.course.name).localeCompare(String(b.course.name), 'es-AR'),
  name: (a, b) => String(a.course.name).localeCompare(String(b.course.name), 'es-AR')
});

/** Botón discreto de sólo ícono (con nombre accesible y tooltip). */
const toolButton = (glyph, label, action, id) => `<button type="button" class="icon-button icon-button--quiet" data-action="${action}" data-id="${escapeHtml(id)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon(glyph)}</button>`;

function courseCard(course, metrics) {
  const id = escapeHtml(course.id);
  // Sólo se marca lo excepcional (archivado); «Activo» en cada fila era ruido visual.
  const archived = course.active ? '' : statusPill('archived', 'Archivado');
  return `<article class="entity-card course-card${course.active ? '' : ' is-archived'}" data-tone="${toneOf(course.id)}">
    <div class="entity-card-main"><span class="entity-symbol" aria-hidden="true">${icon('book')}</span><div class="entity-card-copy"><button class="entity-link entity-link--title" type="button" data-action="open-course" data-id="${id}">${escapeHtml(course.name)}</button><p>${escapeHtml([shiftLabel(course.shift) && `Turno ${shiftLabel(course.shift).toLocaleLowerCase('es-AR')}`, course.academic_year, course.level].filter(Boolean).join(' · ') || 'Curso o comisión')}</p></div>${archived}</div>
    <dl class="entity-metrics"><div><dt>estudiantes</dt><dd>${metrics.students}</dd></div><div><dt>evaluaciones</dt><dd>${metrics.assessments}</dd></div><div class="${metrics.pending ? 'is-pending' : ''}"><dt>por revisar</dt><dd>${metrics.pending}</dd></div></dl>
    <footer class="entity-actions"><button type="button" class="btn btn-secondary btn-small" data-action="open-course" data-id="${id}">Abrir</button>${toolButton('pencil', `Editar ${course.name}`, 'edit-course', course.id)}${toolButton('archive', `${course.active ? 'Archivar' : 'Reactivar'} ${course.name}`, 'toggle-course', course.id)}</footer>
  </article>`;
}

export function renderCourses() {
  const filters = state.courseFilters;
  const query = state.search.trim().toLocaleLowerCase('es-AR');
  const all = state.data.courses.map(course => ({ course, metrics: courseMetrics(course) }));
  const matchesQuery = ({ course }) => !query || `${course.name || ''} ${course.subject || ''} ${course.level || ''} ${course.academic_year || ''}`.toLocaleLowerCase('es-AR').includes(query);
  const matchesCycle = ({ course }) => filters.cycle === 'all' || String(course.academic_year || '') === filters.cycle;
  const matchesStatus = ({ course }) => filters.status === 'all' || (filters.status === 'active' ? course.active : !course.active);

  // Los contadores de cada chip ignoran el propio filtro de estado.
  const base = all.filter(item => matchesQuery(item) && matchesCycle(item));
  const counts = { active: base.filter(item => item.course.active).length, archived: base.filter(item => !item.course.active).length, all: base.length };
  const items = base.filter(matchesStatus).sort(SORTERS[filters.sort] || SORTERS.pending);
  const cycles = [...new Set(state.data.courses.map(item => String(item.academic_year || '')).filter(Boolean))].sort((a, b) => b.localeCompare(a, 'es-AR'));
  const filtered = query || Object.keys(COURSE_FILTER_DEFAULTS).some(key => key !== 'layout' && filters[key] !== COURSE_FILTER_DEFAULTS[key]);

  const toolbar = `<div class="toolbar" role="search">
    ${searchField('Buscar cursos', state.search, 'Buscar por nombre, materia o nivel', 'data-search="courses" id="course-search"')}
    ${chipGroup('Estado del curso', 'course-status', [
      { value: 'active', label: 'Activos', count: counts.active, active: filters.status === 'active' },
      { value: 'archived', label: 'Archivados', count: counts.archived, active: filters.status === 'archived' },
      { value: 'all', label: 'Todos', count: counts.all, active: filters.status === 'all' }
    ])}
    ${knownSubjects().length > 1 ? toolbarSelect('Filtrar por materia', 'data-filter="course-subject" id="course-subject"', [{ value: 'all', label: 'Todas las materias' }, ...knownSubjects().map(item => ({ value: String(item.id), label: item.name }))], filters.subject || 'all') : ''}
    ${cycles.length > 1 ? toolbarSelect('Filtrar por ciclo lectivo', 'data-filter="course-cycle" id="course-cycle"', [{ value: 'all', label: 'Todos los ciclos' }, ...cycles.map(value => ({ value, label: value }))], filters.cycle) : ''}
    ${toolbarSelect('Ordenar cursos', 'data-filter="course-sort" id="course-sort"', [{ value: 'pending', label: 'Con más pendientes' }, { value: 'students', label: 'Más estudiantes' }, { value: 'name', label: 'Nombre A–Z' }], filters.sort)}
    <div class="segmented" role="group" aria-label="Vista del listado">${[['cards', 'grid', 'Ver como tarjetas'], ['list', 'list', 'Ver como lista compacta']].map(([value, glyph, label]) => `<button type="button" class="chip" id="course-layout-${value}" data-chip-group="course-layout" data-chip-value="${value}" aria-pressed="${filters.layout === value}" aria-label="${label}" title="${label}">${icon(glyph)}</button>`).join('')}</div>
    ${resultCount(`${items.length} ${items.length === 1 ? 'curso' : 'cursos'}`, filtered ? 'clear-course-filters' : '')}
  </div>`;

  // Agrupado por materia: cada materia muestra sus cursos o comisiones.
  const grid = rows => `<div class="entity-grid${filters.layout === 'list' ? ' is-list' : ''}">${rows.map(({ course, metrics }) => courseCard(course, metrics)).join('')}</div>`;
  const groups = new Map();
  items.forEach(item => {
    const key = item.course.subject_id == null ? 'none' : String(item.course.subject_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  const subjectFilter = filters.subject || 'all';
  const allSubjects = knownSubjects();
  const subjects = allSubjects
    .filter(subject => subjectFilter === 'all' || String(subject.id) === subjectFilter)
    .filter(subject => groups.has(String(subject.id)) || (!filtered && subject.active !== false && !subject.course_count));
  // Cada materia es un plegable independiente (abierto por defecto; se recuerda tras re-render por su id).
  const subjectSection = subject => {
    const rows = groups.get(String(subject.id)) || [];
    const pending = rows.reduce((sum, item) => sum + item.metrics.pending, 0);
    const meta = [subject.level, `${rows.length} ${rows.length === 1 ? 'comisión' : 'comisiones'}`].filter(Boolean).join(' · ');
    return `<details class="subject-group" id="subject-group-${escapeHtml(subject.id)}" data-independent data-tone="${toneOf(subject.id)}" open>
      <summary class="subject-group-head">
        <span class="subject-group-title">${icon('chevron')}<span><strong>${escapeHtml(subject.name)}</strong><small>${escapeHtml(meta)}</small></span></span>
        ${pending ? `<span class="subject-pending">${pending} por revisar</span>` : ''}
        <span class="subject-group-actions"><button type="button" class="btn btn-ghost btn-small" data-action="new-course" data-subject="${escapeHtml(subject.id)}">${icon('plus')} Comisión</button>${toolButton('pencil', `Editar la materia ${subject.name}`, 'edit-subject', subject.id)}${toolButton('archive', `Archivar la materia ${subject.name}`, 'archive-subject', subject.id)}</span>
      </summary>
      <div class="subject-group-body">${rows.length ? grid(rows) : '<p class="muted subject-empty">Todavía no tiene cursos ni comisiones. Creá la primera para cargar estudiantes y asignarle evaluaciones.</p>'}</div>
    </details>`;
  };
  const orphan = subjectFilter === 'all' ? groups.get('none') || [] : [];
  const sections = [...subjects.map(subjectSection), orphan.length ? `<details class="subject-group" id="subject-group-none" data-independent open><summary class="subject-group-head"><span class="subject-group-title">${icon('chevron')}<span><strong>Sin materia asignada</strong><small>Editá cada curso para elegir su materia.</small></span></span></summary><div class="subject-group-body">${grid(orphan)}</div></details>` : ''].join('');

  const list = sections
    ? `<div class="subject-groups">${sections}</div>`
    : state.data.courses.length
      ? filteredEmpty('cursos', 'clear-course-filters')
      : emptyState('Todavía no hay materias', 'Creá una materia (por ejemplo, Programación I) y dentro de ella sus cursos o comisiones.', btn('Crear primera materia', 'new-subject', '', 'primary'));

  return `${heading('Materias y comisiones', 'Cada materia agrupa sus cursos o comisiones; las evaluaciones se crean una vez y se asignan a las comisiones que correspondan.', btn('Nueva materia', 'new-subject', '', 'primary'))}${resourceError('subjects', 'las materias')}${resourceError('courses', 'los cursos')}${toolbar}${list}`;
}

/** Fila de lista de trabajo; `status` alimenta el filtro en el cliente. */
const record = (main, meta, actions, status = '') => `<article class="work-row" data-row${status ? ` data-status="${escapeHtml(status)}"` : ''}><div class="work-row-main">${main}</div><div class="work-row-meta">${meta}</div><div class="work-row-actions">${actions}</div></article>`;

/** Chips de estado sobre las filas de un plegable (sólo con 4 o más filas). */
function rowFilter(group, rows, labels) {
  if (rows.length < ROW_FILTER_THRESHOLD) return '';
  const counts = rows.reduce((acc, item) => { acc[item] = (acc[item] || 0) + 1; return acc; }, {});
  const chips = [{ value: 'all', label: 'Todas', count: rows.length, active: true }, ...Object.entries(counts).map(([value, count]) => ({ value, label: labels[value] || value, count, active: false }))];
  return chipGroup('Filtrar por estado', group, chips, { idPrefix: `${group}-${state.selectedCourse}` });
}

export function renderCourseDetail() {
  const course = state.data.courses.find(item => String(item.id) === String(state.selectedCourse));
  if (!course) { state.view = 'courses'; return renderCourses(); }
  const enrollments = state.data.enrollments.filter(item => String(item.course) === String(course.id));
  const activeEnrollments = enrollments.filter(item => item.status === 'active');
  const assessments = state.data.assessments.filter(item => assessmentInCourse(item, course.id));
  // Entregas de esta comisión (una evaluación de la materia puede tener varias comisiones).
  const submissions = state.data.submissions.filter(item => String(courseIdForSubmission(item) ?? '') === String(course.id));
  const corrections = state.data.corrections.filter(item => String(courseIdForCorrection(item) ?? '') === String(course.id));
  const pendingCorrections = corrections.filter(item => item.status === 'pending_review');

  const studentRows = enrollments.map(enrollment => {
    const student = state.data.students.find(item => String(item.id) === String(enrollment.student));
    const name = enrollment.student_name || student?.name || 'Estudiante';
    const email = enrollment.student_email || student?.email || '';
    return record(`<button type="button" class="entity-link" data-action="open-student" data-id="${escapeHtml(enrollment.student)}">${escapeHtml(name)}</button><small>${escapeHtml(email || enrollment.student_external_code || 'Sin datos de contacto')}</small>`, statusPill(enrollment.status), `${btn('Ver / editar', 'edit-student', `data-id="${escapeHtml(enrollment.student)}"`)}${enrollment.status === 'active' ? btn('Desmatricular', 'deactivate-enrollment', `data-id="${escapeHtml(enrollment.id)}"`) : ''}`, enrollment.status);
  });

  const assessmentRows = assessments.map(item => record(`<button type="button" class="entity-link" data-action="open-assessment" data-id="${escapeHtml(item.id)}">${escapeHtml(item.title)}</button><small>${escapeHtml(`Comisiones: ${assessmentCourseNames(item) || '—'}`)} · Actualizada ${date(item.updated_at)}</small>`, statusPill(item.status), `${btn('Abrir', 'open-assessment', `data-id="${escapeHtml(item.id)}"`, 'primary')}${btn('Editar', 'edit-assessment', `data-id="${escapeHtml(item.id)}"`)}`, item.status));

  const submissionStatuses = [];
  const submissionRows = submissions.map(item => {
    const correction = state.data.corrections.find(row => String(row.submission) === String(item.id));
    submissionStatuses.push(item.status);
    return record(`<button type="button" class="entity-link" data-action="open-submission" data-id="${escapeHtml(item.id)}">${escapeHtml(item.student_display_name || item.student_name || 'Estudiante sin identificar')}</button><small>${escapeHtml(item.submission_title || item.assessment_title || assessments.find(row => String(row.id) === String(item.assessment))?.title || 'Evaluación')} · ${date(item.created_at, true)}</small>`, `${statusPill(item.status)} ${correction ? statusPill(correction.status) : ''}`, btn(correction ? 'Revisar devolución' : 'Abrir entrega', 'open-submission', `data-id="${escapeHtml(item.id)}"`, correction ? 'primary' : 'secondary'), item.status);
  });

  const correctionRows = corrections.map(item => record(`<button type="button" class="entity-link" data-action="open-correction" data-id="${escapeHtml(item.id)}">${escapeHtml(item.submission_title || 'Evaluación')}</button><small>${escapeHtml(item.student_name || 'Estudiante')} · ${date(item.created_at, true)}</small>`, `${statusPill(item.status)}<strong class="score-value">${escapeHtml(formatNumber(item.total_score))}</strong>`, btn('Abrir devolución', 'open-correction', `data-id="${escapeHtml(item.id)}"`, 'primary'), item.status));

  const statusLabels = { active: 'Activas', inactive: 'Inactivas', draft: 'Borradores', ready: 'Listas', archived: 'Archivadas', pending: 'Pendientes', processing: 'Procesando', review: 'A revisar', approved: 'Aprobadas', pending_review: 'Por revisar', rejected: 'Rechazadas' };
  const fold = (key, title, detail, rows, statuses, emptyText, action = '') => `<details class="fold" id="course-fold-${key}" data-fold="${key}" data-tone="${FOLD_TONES[key]}"><summary><span class="fold-copy"><strong>${title}</strong><small>${detail}</small></span><span class="fold-count">${rows.length}</span>${icon('chevron')}</summary><div class="fold-body">${rows.length ? `${rowFilter(`course-${key}`, statuses, statusLabels)}<div class="work-list" data-filter-scope="course-${key}" data-filter-attr="status">${rows.join('')}</div>` : `<p class="muted">${emptyText}</p>`}${action ? `<div class="fold-footer">${action}</div>` : ''}</div></details>`;
  const studentActions = `${btn('Agregar estudiante', 'new-student', `data-course="${course.id}"`, 'primary')}${btn('Vincular existentes', 'enroll-student', `data-course="${course.id}"`)}${btn('Ver lista completa', 'manage-course-students', `data-course="${course.id}"`)}`;

  const withCourse = `data-course="${course.id}"`;
  const nextStep = !activeEnrollments.length
    ? { text: 'Empezá sumando a los estudiantes del curso.', label: 'Agregar estudiante', action: 'new-student', attrs: withCourse }
    : !assessments.length
      ? { text: 'Creá la primera evaluación para este curso.', label: 'Crear evaluación', action: 'new-assessment', attrs: withCourse }
      : pendingCorrections.length
        ? { text: `${pendingCorrections.length} ${pendingCorrections.length === 1 ? 'devolución espera' : 'devoluciones esperan'} tu revisión.`, label: 'Ver correcciones', action: 'open-fold', attrs: 'data-fold="corrections"' }
        : !submissions.length
          ? { text: 'Cargá las entregas para generar propuestas de corrección.', label: 'Cargar entrega', action: 'new-submission', attrs: withCourse }
          : null;
  // El círculo de cada paso muestra cuántos elementos tiene su plegable (el mismo número que la lista).
  const steps = [['students', 'Estudiantes', enrollments.length, 0], ['assessments', 'Evaluaciones', assessments.length, 0], ['submissions', 'Entregas', submissions.length, 0], ['corrections', 'Correcciones', corrections.length, pendingCorrections.length]];
  const pipeline = `<nav class="pipeline" aria-label="Recorrido del curso">${steps.map(([key, label, count, pending], index) => `${index ? '<span class="pipeline-sep" aria-hidden="true">›</span>' : ''}<button type="button" class="pipeline-step${pending ? ' has-pending' : ''}" data-action="open-fold" data-fold="${key}" data-tone="${FOLD_TONES[key]}" aria-controls="course-fold-${key}" title="Ver ${label.toLocaleLowerCase('es-AR')}"><span class="pipeline-dot">${count}</span><span class="pipeline-label">${label}</span>${pending ? `<span class="pipeline-pending">${pending} por revisar</span>` : ''}</button>`).join('')}</nav>
    ${nextStep ? `<div class="next-step" role="status"><span class="next-step-mark" aria-hidden="true">✳</span><p>${nextStep.text}</p>${btn(nextStep.label, nextStep.action, nextStep.attrs, 'primary')}</div>` : '<p class="margin-note"><strong>Todo al día en este curso.</strong></p>'}`;

  const subtitle = [course.subject || 'Sin materia', shiftLabel(course.shift) && `Turno ${shiftLabel(course.shift).toLocaleLowerCase('es-AR')}`, course.level || 'Nivel no indicado', course.academic_year || 'Ciclo no indicado'].filter(Boolean).join(' · ');
  return `<div class="course-view" data-tone="${toneOf(course.id)}">${heading(course.name, subtitle, `${btn('Volver a materias', 'navigate', 'data-view="courses"')}${btn('Exportar notas (CSV)', 'export-course-grades', `data-id="${course.id}" title="Nota aprobada de cada estudiante en cada evaluación, lista para Excel"`)}${btn('Editar curso', 'edit-course', `data-id="${course.id}"`)}`)}
    ${course.description ? `<p class="course-description">${escapeHtml(course.description)}</p>` : ''}
    ${pipeline}
    <section class="fold-list" aria-label="Información del curso">
      ${fold('students', 'Estudiantes', 'Personas matriculadas en este curso', studentRows, enrollments.map(item => item.status), 'Todavía no hay estudiantes matriculados.', studentActions)}
      ${fold('assessments', 'Evaluaciones', 'Consignas, materiales y rúbricas del curso', assessmentRows, assessments.map(item => item.status), 'Todavía no hay evaluaciones para este curso.', btn('Crear evaluación', 'new-assessment', `data-course="${course.id}"`, 'primary'))}
      ${fold('submissions', 'Entregas', 'Respuestas recibidas y su estado de procesamiento', submissionRows, submissionStatuses, 'Todavía no hay entregas asociadas a las evaluaciones de este curso.', btn('Cargar entrega', 'new-submission', `data-course="${course.id}"`, 'primary'))}
      ${fold('corrections', 'Correcciones y devoluciones', 'Propuestas pendientes de revisión y resultados aprobados', correctionRows, corrections.map(item => item.status), 'Todavía no hay correcciones para este curso.')}
    </section>
    <p class="margin-note">El curso es el contexto de trabajo: cada entrega se vincula a una evaluación, cada corrección a una entrega y la aprobación final siempre queda a cargo del docente.</p></div>`;
}

/** Valor del selector de materia que habilita escribir una materia nueva. */
export const NEW_SUBJECT = '__new';

/** Curso o comisión dentro de una materia (existente o nueva, escrita en el mismo formulario). */
export function courseForm(course = null, defaultSubject = '') {
  const subjects = knownSubjects().filter(item => item.active !== false || String(item.id) === String(course?.subject_id));
  const selected = String(course?.subject_id ?? defaultSubject ?? '') || (subjects.length ? '' : NEW_SUBJECT);
  const subjectOptions = [{ value: '', label: 'Elegí la materia' }, ...subjects.map(item => ({ value: String(item.id), label: item.name })), { value: NEW_SUBJECT, label: '+ Nueva materia…' }];
  const fields = `${selectField('Materia', 'subject_id', subjectOptions, selected, true)}
    <div class="form-field full" data-new-subject ${selected === NEW_SUBJECT ? '' : 'hidden'}><label for="f-new-subject">Nombre de la materia nueva</label><input id="f-new-subject" name="new_subject" type="text" maxlength="160" placeholder="Programación I"></div>
    ${formField('Curso o comisión', 'name', course?.name || '', 'text', 'maxlength="160" placeholder="1K1, 5.º A, Comisión 2…"', true)}${selectField('Turno', 'shift', SHIFT_OPTIONS, course?.shift || '')}${formField('Ciclo lectivo', 'academic_year', course?.academic_year || '', 'text', 'maxlength="20" placeholder="2026"')}${formField('Nivel', 'level', course?.level || '', 'text', 'maxlength="120"')}${textField('Descripción', 'description', course?.description || '')}`;
  openModal(course ? 'Editar curso o comisión' : 'Nuevo curso o comisión', modalForm(fields), course ? 'edit-course' : 'new-course', true);
  modal.dataset.recordId = course?.id || '';
}

export function subjectForm(subject = null) {
  const fields = `${formField('Nombre de la materia', 'name', subject?.name || '', 'text', 'maxlength="160" placeholder="Programación I"', true)}${formField('Nivel', 'level', subject?.level || '', 'text', 'maxlength="120" placeholder="Universitario · 1.er año"')}${textField('Descripción', 'description', subject?.description || '')}`;
  openModal(subject ? 'Editar materia' : 'Nueva materia', modalForm(fields, 'Guardar materia', subject ? '' : '<p class="muted">Después vas a poder crear dentro de la materia todos sus cursos, comisiones o turnos.</p>'), subject ? 'edit-subject' : 'new-subject');
  modal.dataset.recordId = subject?.id || '';
}
