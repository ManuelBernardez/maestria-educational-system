(() => {
  'use strict';

  const api = window.MAESTRIA_API;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const content = $('#app-content');
  const modal = $('#modal-layer');
  const modalContent = $('#modal-content');
  const toastRegion = $('#toast-region');

  if (!api || !content) return;

  const state = {
    profile: null,
    view: 'dashboard',
    selectedCourse: null,
    selectedAssessment: null,
    selectedSubmission: null,
    selectedCorrection: null,
    currentCorrection: null,
    correctionOrigin: 'submissions',
    correctionDetailLoading: false,
    rubricProposal: null,
    questionProposal: null,
    search: '',
    studentCourseFilter: 'all',
    studentStatusFilter: 'active',
    assessmentStatusFilter: 'all',
    assessmentCourseFilter: 'all',
    submissionStatusFilter: 'all',
    submissionCourseFilter: 'all',
    correctionsStatusFilter: 'all',
    correctionsCourseFilter: 'all',
    feedbackStyle: 'constructivo',
    selectedInstitution: null,
    adminMessageSearch: '',
    adminMessageStatus: '',
    adminTab: 'users',
    data: {
      overview: null, courses: [], students: [], enrollments: [], assessments: [],
      rubrics: [], submissions: [], corrections: [],
      admin: { users: [], institutions: [], memberships: [], messages: [], audit: [], providers: [] }
    },
    errors: {},
    modalKind: null,
    modalBusy: false,
    loading: true
  };

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
  const initials = (value) => String(value || 'MaestrIA').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || 'M';
  const date = (value, includeTime = false) => {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return new Intl.DateTimeFormat('es-AR', includeTime
      ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { day: '2-digit', month: 'short', year: 'numeric' }).format(parsed);
  };
  const statusLabel = (value) => ({
    active: 'Activo', inactive: 'Inactivo', draft: 'Borrador', ready: 'Lista', archived: 'Archivada',
    pending: 'Pendiente', processing: 'Procesando', review: 'A revisar', approved: 'Aprobada',
    pending_review: 'A revisar', rejected: 'Rechazada', new: 'Nuevo', in_progress: 'En gestión',
    handled: 'Atendido', spam: 'Spam', suspended: 'Suspendida', deleted: 'Eliminada', invited: 'Invitada'
  })[value] || value || '—';
  const statusClass = (value) => ({
    active: 'green', ready: 'green', approved: 'green', handled: 'green',
    pending: 'yellow', processing: 'yellow', review: 'yellow', pending_review: 'yellow', in_progress: 'yellow', draft: 'gray',
    archived: 'gray', inactive: 'gray', suspended: 'coral', rejected: 'coral', spam: 'coral', deleted: 'coral'
  })[value] || 'gray';
  const statusPill = (value) => `<span class="status status-${statusClass(value)}">${escapeHtml(statusLabel(value))}</span>`;
  const btn = (label, action, attrs = '', kind = 'secondary') => `<button class="btn btn-${kind} btn-small" type="button" data-action="${action}" ${attrs}>${label}</button>`;
  const iconBtn = (label, action, attrs = '') => `<button class="icon-action" type="button" data-action="${action}" ${attrs} aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${label}</button>`;
  const formField = (label, name, value = '', type = 'text', extra = '', required = false) => `<div class="form-field"><label for="f-${name}">${label}${required ? ' <span aria-hidden="true">*</span>' : ''}</label><input id="f-${name}" name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? 'required' : ''} ${extra}></div>`;
  const textField = (label, name, value = '', extra = '', required = false) => `<div class="form-field full"><label for="f-${name}">${label}${required ? ' <span aria-hidden="true">*</span>' : ''}</label><textarea id="f-${name}" name="${name}" ${required ? 'required' : ''} ${extra}>${escapeHtml(value)}</textarea></div>`;
  const selectField = (label, name, options, selected = '', required = false) => `<div class="form-field"><label for="f-${name}">${label}${required ? ' <span aria-hidden="true">*</span>' : ''}</label><select id="f-${name}" name="${name}" ${required ? 'required' : ''}>${options.map(option => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(selected) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select></div>`;
  const optionRows = (items, label, includeAll = false) => [ ...(includeAll ? [{ value: '', label: 'Sin asignar' }] : []), ...items.map(item => ({ value: item.id, label: label(item) })) ];
  const listFrom = (payload) => Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : [];
  const formValues = (form) => Object.fromEntries(new FormData(form).entries());
  const errorText = (error) => error?.message || 'No se pudo completar la operación.';

  function toast(message, type = 'success') {
    if (!toastRegion) return;
    const node = document.createElement('div');
    node.className = `toast toast-${type}`;
    node.textContent = message;
    node.setAttribute('role', 'status');
    toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), 5200);
  }

  function openModal(title, body, kind, wide = false) {
    $('#modal-title').textContent = title;
    modalContent.innerHTML = body;
    state.modalKind = kind;
    state.modalBusy = false;
    $('.modal-dialog').classList.toggle('modal-wide', wide);
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => $('#modal-content input:not([type="hidden"]), #modal-content select, #modal-content textarea')?.focus(), 60);
  }

  function closeModal(force = false) {
    if (!modal || modal.hidden || (state.modalBusy && !force)) return;
    modal.hidden = true;
    document.body.style.overflow = '';
    state.modalKind = null;
    state.modalBusy = false;
    modalContent.innerHTML = '';
  }

  function modalForm(fields, submitLabel = 'Guardar', extra = '') {
    return `<form id="workspace-modal-form" novalidate><div class="form-grid">${fields}</div><p class="form-error" id="modal-error" role="alert"></p><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-modal>Cancelar</button><button class="btn btn-primary" type="submit">${submitLabel}</button></div>${extra}</form>`;
  }

  function setModalError(message) {
    const error = $('#modal-error');
    if (error) error.textContent = message || '';
  }

  async function withBusy(button, operation) {
    if (button?.disabled) return;
    const original = button?.textContent;
    if (button) { button.disabled = true; button.textContent = 'Procesando…'; }
    try { return await operation(); }
    finally { if (button) { button.disabled = false; button.textContent = original; } }
  }

  async function refreshCore() {
    const resources = [
      ['overview', 'dashboard/overview/'], ['courses', 'courses/'], ['students', 'students/'],
      ['enrollments', 'enrollments/'], ['assessments', 'assessments/'], ['rubrics', 'rubrics/'],
      ['submissions', 'submissions/'], ['corrections', 'corrections/?summary=1']
    ];
    const results = await Promise.allSettled(resources.map(([, path]) => api.get(path)));
    state.errors = Object.fromEntries(Object.entries(state.errors).filter(([key]) => key.startsWith('admin_') || key.startsWith('institution_')));
    results.forEach((result, index) => {
      const [key] = resources[index];
      if (result.status === 'fulfilled') {
        if (key === 'overview') state.data.overview = result.value;
        else state.data[key] = listFrom(result.value);
      } else {
        state.errors[key] = errorText(result.reason);
        if (key === 'overview') state.data.overview = null;
      }
    });
    state.loading = false;
    updateChrome();
  }

  async function refreshAdmin() {
    const resources = [
      ['users', 'admin/users/'], ['institutions', 'admin/institutions/'],
      ['memberships', 'admin/institution-memberships/'], ['messages', 'admin/contact-messages/'],
      ['audit', 'admin/audit-events/'], ['providers', 'admin/ai-providers/']
    ];
    const results = await Promise.allSettled(resources.map(([, path]) => api.get(path)));
    results.forEach((result, index) => {
      const [key] = resources[index];
      if (result.status === 'fulfilled') state.data.admin[key] = listFrom(result.value);
      else state.errors[`admin_${key}`] = errorText(result.reason);
    });
  }

  async function refreshInstitutionScope() {
    const memberships = (state.profile?.memberships || []).filter(item => item.status === 'active' && ['institution_admin', 'department_admin'].includes(item.role));
    if (!memberships.length || ['admin', 'superadmin'].includes(state.profile?.role)) return;
    const results = await Promise.allSettled([api.get('admin/institutions/'), api.get('admin/institution-memberships/')]);
    if (results[0].status === 'fulfilled') state.data.admin.institutions = listFrom(results[0].value);
    else state.errors.institution_scope = errorText(results[0].reason);
    if (results[1].status === 'fulfilled') state.data.admin.memberships = listFrom(results[1].value);
    else state.errors.institution_memberships = errorText(results[1].reason);
  }

  async function loadProfile() {
    const session = await api.validSession();
    if (!session) { window.location.replace('../acceso.html'); return false; }
    try {
      state.profile = await api.get('me/');
    } catch (error) {
      // A valid Supabase identity without a profile can still be a teacher;
      // other API failures remain visible and must not silently grant admin.
      state.profile = {
        user_id: session.user?.id || '', email: session.user?.email || '',
        full_name: session.user?.user_metadata?.full_name || '', role: 'teacher', status: 'active', memberships: []
      };
      if (/401|403/.test(error.message || '')) {
        api.clearSession(); window.location.replace('../acceso.html'); return false;
      }
      toast(`No se pudo cargar el perfil completo: ${errorText(error)}`, 'error');
    }
    const metadataName = String(session.user?.user_metadata?.full_name || '').trim();
    if (metadataName) state.profile = { ...state.profile, full_name: metadataName };
    state.feedbackStyle = ['formal', 'constructivo', 'motivador'].includes(session.user?.user_metadata?.maestria_feedback_style)
      ? session.user.user_metadata.maestria_feedback_style : 'constructivo';
    if (state.profile?.role === 'student') {
      content.innerHTML = `<section class="panel"><div class="panel-body"><div class="empty-state"><div class="empty-icon">!</div><h3>Acceso docente no disponible</h3><p>Esta cuenta no tiene permisos para ingresar al espacio docente.</p><a class="btn btn-secondary" href="../index.html">Volver al sitio</a></div></div></section>`;
      return false;
    }
    return true;
  }

  function updateChrome() {
    const name = state.profile?.full_name || state.profile?.email?.split('@')[0] || 'Docente';
    const email = state.profile?.email || '';
    const role = state.profile?.role || 'teacher';
    const initialsText = initials(name);
    ['#workspace-avatar', '#profile-avatar', '#top-profile'].forEach(selector => { const node = $(selector); if (node) node.textContent = initialsText; });
    if ($('#profile-name')) $('#profile-name').textContent = name;
    if ($('#profile-email')) $('#profile-email').textContent = email;
    if ($('#workspace-role')) { const institutionalRole = (state.profile?.memberships || []).find(item => item.status === 'active' && ['institution_admin', 'department_admin'].includes(item.role))?.role; $('#workspace-role').textContent = role === 'superadmin' ? 'Superadministración' : role === 'admin' ? 'Administración global' : institutionalRole === 'institution_admin' ? 'Administración institucional' : institutionalRole === 'department_admin' ? 'Administración de departamento' : 'Docencia · Personal'; }
    if ($('#course-count')) $('#course-count').textContent = String(state.data.courses.filter(item => item.active).length);
    if ($('#pending-count')) $('#pending-count').textContent = String(state.data.corrections.filter(item => item.status === 'pending_review').length);
    if ($('#submission-count')) $('#submission-count').textContent = String(state.data.submissions.length);
    const shortcuts = $('#sidebar-course-shortcuts');
    if (shortcuts) {
      const activeCourses = state.data.courses.filter(item => item.active).slice(0, 5);
      shortcuts.innerHTML = activeCourses.length ? `<p class="side-label">ACCESOS RÁPIDOS</p>${activeCourses.map(course => `<button class="side-link side-link--course" type="button" data-open-course="${escapeHtml(course.id)}" title="${escapeHtml(course.name)}"><span class="side-icon" aria-hidden="true">${escapeHtml(initials(course.name))}</span><span class="side-text">${escapeHtml(course.name)}</span></button>`).join('')}` : '';
    }
    const isAdmin = ['admin', 'superadmin'].includes(role);
    const memberships = (state.profile?.memberships || []).filter(item => item.status === 'active');
    const canManageInstitution = memberships.some(item => ['institution_admin', 'department_admin'].includes(item.role));
    if ($('#admin-nav')) $('#admin-nav').hidden = !isAdmin;
    if ($('#institution-nav')) $('#institution-nav').hidden = isAdmin || !canManageInstitution;
    const today = $('#today-label');
    if (today) today.textContent = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    const navName = ({ dashboard: 'Resumen', courses: 'Cursos', course: 'Cursos', students: 'Estudiantes', assessments: 'Evaluaciones', assessment: 'Evaluaciones', rubrics: 'Rúbricas', submissions: 'Entregas', corrections: 'Correcciones', correction: 'Correcciones', admin: 'Administración', institution: 'Mi institución', 'institution-memberships': 'Mi institución', profile: 'Mi perfil' })[state.view] || 'Resumen';
    if ($('#breadcrumb-current')) $('#breadcrumb-current').textContent = navName;
  }

  function heading(title, description, actions = '') {
    const dashboard = title === 'Tu espacio docente';
    const modifier = dashboard ? ' view-header--dashboard' : '';
    return `<header class="view-header${modifier}"><div class="view-heading-copy"><p class="view-kicker">ESPACIO DOCENTE</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><div class="view-actions">${actions}</div></header>`;
  }

  function panel(title, description, body, actions = '') {
    return `<section class="panel"><div class="panel-head"><div><h2>${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ''}</div>${actions}</div><div class="panel-body">${body}</div></section>`;
  }

  function emptyState(title, description, action = '') {
    return `<div class="empty-state"><div class="empty-icon" aria-hidden="true">✳</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${action}</div>`;
  }

  function resourceError(key, label) {
    return state.errors[key] ? `<div class="notice notice-error" role="alert"><strong>No se pudo cargar ${escapeHtml(label)}.</strong><br>${escapeHtml(state.errors[key])} ${btn('Reintentar', 'refresh-resource', `data-resource="${escapeHtml(key)}"`)}</div>` : '';
  }

  function table(headers, rows, emptyText = 'No hay registros para mostrar.') {
    return rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(item => `<th scope="col">${item}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : emptyState('Todavía no hay registros', emptyText);
  }

  function renderDashboard() {
    const summary = state.data.overview?.summary || {};
    const cards = [
      ['Cursos activos', summary.courses ?? state.data.courses.filter(item => item.active).length, 'auto_stories'],
      ['Estudiantes', summary.students ?? state.data.students.filter(item => item.active).length, 'groups'],
      ['Evaluaciones', summary.assessments ?? state.data.assessments.length, 'edit_note'],
      ['Pendientes de revisión', summary.pending_corrections ?? state.data.corrections.filter(item => item.status === 'pending_review').length, 'grading']
    ];
    const courseRows = state.data.courses.filter(item => item.active).slice(0, 5).map(course => `<tr><td><strong>${escapeHtml(course.name)}</strong><small>${escapeHtml(course.subject || 'Sin área')}</small></td><td>${Number(course.student_count || 0)}</td><td>${Number(course.assessment_count || 0)}</td><td>${statusPill('active')}</td><td>${btn('Abrir', 'open-course', `data-id="${course.id}"`)}</td></tr>`);
    const activity = summary.recent_activity || [];
    const activityRows = activity.slice(0, 6).map(event => `<div class="list-row"><span class="list-dot">◷</span><div class="list-main"><strong>${escapeHtml(String(event.event_type || '').replaceAll('.', ' '))}</strong><small>${escapeHtml(event.object_type || 'Actividad')} · ${escapeHtml(event.object_id || '')}</small></div><small class="muted">${date(event.created_at, true)}</small></div>`);
    return `${heading('Tu espacio docente', 'Un lugar para organizar cursos, preparar evaluaciones y acompañar los procesos de aprendizaje.', `${btn('Probar con ejemplo', 'seed-demo') }<button class="btn btn-primary" data-action="new-course">＋ Crear curso</button>`)}
      ${Object.keys(state.errors).length ? resourceError('overview', 'el resumen') : ''}
      <div class="stats-grid">${cards.map(([label, value, icon]) => `<article class="stat-card"><div class="stat-top">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}</div><div class="stat-foot">Datos de tu cuenta</div></article>`).join('')}</div>
      <div class="dashboard-grid">${panel('Cursos recientes', 'Acceso rápido a tus espacios de trabajo', table(['Curso', 'Estudiantes', 'Evaluaciones', 'Estado', ''], courseRows, 'Creá un curso para comenzar a organizar tu espacio.'), btn('Ver cursos', 'navigate', 'data-view="courses"'))}
      ${panel('Actividad reciente', 'Acciones registradas en tu cuenta', activityRows.length ? activityRows.join('') : emptyState('Sin actividad reciente', 'Las acciones importantes aparecerán aquí.'))}</div>
      <div class="dashboard-grid">${panel('Próximos pasos', 'Flujo de trabajo sugerido', `<div class="list-row"><span class="list-dot">1</span><div class="list-main"><strong>Organizá tus cursos</strong><small>Registrá estudiantes y matrículas.</small></div>${btn('Ir a cursos', 'navigate', 'data-view="courses"')}</div><div class="list-row"><span class="list-dot">2</span><div class="list-main"><strong>Prepará una evaluación</strong><small>Definí consignas, objetivos y material.</small></div>${btn('Crear evaluación', 'new-assessment')}</div><div class="list-row"><span class="list-dot">3</span><div class="list-main"><strong>Revisá las entregas</strong><small>La IA propone; la decisión final es docente.</small></div>${btn('Ver entregas', 'navigate', 'data-view="submissions"')}</div>`)}
      ${panel('Criterio pedagógico', 'La decisión final siempre queda en manos docentes', `<p>Las herramientas de IA generan propuestas editables. Revisá las evidencias, ajustá la devolución y aprobá únicamente cuando el contenido sea adecuado.</p>`)}</div>`;
  }

  function renderCourses() {
    const rows = state.data.courses.map(course => `<tr><td><strong>${escapeHtml(course.name)}</strong><small>${escapeHtml(course.subject || 'Sin área')} · ${escapeHtml(course.level || 'Nivel no indicado')}</small></td><td>${escapeHtml(course.academic_year || '—')}</td><td>${Number(course.student_count || 0)}</td><td>${Number(course.assessment_count || 0)}</td><td>${statusPill(course.active ? 'active' : 'inactive')}</td><td><div class="table-actions">${btn('Abrir', 'open-course', `data-id="${course.id}"`)}${btn('Editar', 'edit-course', `data-id="${course.id}"`)}${btn(course.active ? 'Archivar' : 'Reactivar', 'toggle-course', `data-id="${course.id}"`, 'secondary')}</div></td></tr>`);
    return `${heading('Cursos', 'Administrá tus espacios curriculares y las personas matriculadas.', `${btn('Importar estudiantes', 'import-students')}${btn('Crear curso', 'new-course', '', 'primary')}`)}${resourceError('courses', 'los cursos')}${table(['Curso', 'Ciclo lectivo', 'Estudiantes', 'Evaluaciones', 'Estado', 'Acciones'], rows, 'Todavía no creaste cursos.')}`;
  }

  function renderCourseDetail() {
    const course = state.data.courses.find(item => String(item.id) === String(state.selectedCourse));
    if (!course) { state.view = 'courses'; return renderCourses(); }
    const enrollments = state.data.enrollments.filter(item => String(item.course) === String(course.id));
    const assessments = state.data.assessments.filter(item => String(item.course) === String(course.id));
    const studentRows = enrollments.map(enrollment => `<tr><td><strong>${escapeHtml(enrollment.student_name || state.data.students.find(s => String(s.id) === String(enrollment.student))?.name || 'Estudiante')}</strong><small>${escapeHtml(enrollment.student_email || '')}</small></td><td>${escapeHtml(enrollment.student_external_code || '')}</td><td>${statusPill(enrollment.status)}</td><td>${btn('Desmatricular', 'deactivate-enrollment', `data-id="${enrollment.id}"`)}</td></tr>`);
    const assessmentRows = assessments.map(item => `<tr><td><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.subject || '')}</small></td><td>${statusPill(item.status)}</td><td>${date(item.updated_at)}</td><td>${btn('Abrir', 'open-assessment', `data-id="${item.id}"`)}</td></tr>`);
    return `${heading(course.name, `${course.subject || 'Curso'} · ${course.level || 'Nivel no indicado'} · ${course.academic_year || 'Ciclo no indicado'}`, `${btn('Volver a cursos', 'navigate', 'data-view="courses"')}${btn('Editar curso', 'edit-course', `data-id="${course.id}"`)}`)}
      <div class="stats-grid"><article class="stat-card"><div class="stat-top">Estudiantes matriculados</div><div class="stat-value">${enrollments.filter(item => item.status === 'active').length}</div></article><article class="stat-card"><div class="stat-top">Evaluaciones</div><div class="stat-value">${assessments.length}</div></article><article class="stat-card"><div class="stat-top">Estado</div><div class="stat-value" style="font-size:1.25rem">${course.active ? 'Activo' : 'Archivado'}</div></article></div>
      ${course.description ? panel('Descripción', '', `<p>${escapeHtml(course.description)}</p>`) : ''}
      ${panel('Estudiantes', 'Matrículas asociadas a este curso', table(['Estudiante', 'Código', 'Estado', 'Acciones'], studentRows, 'Todavía no hay estudiantes matriculados.'), btn('Matricular estudiante', 'enroll-student', `data-course="${course.id}"`, 'primary'))}
      ${panel('Evaluaciones', 'Actividades y evaluaciones de este curso', table(['Evaluación', 'Estado', 'Actualizada', ''], assessmentRows, 'Todavía no hay evaluaciones para este curso.'), btn('Crear evaluación', 'new-assessment', `data-course="${course.id}"`, 'primary'))}
      ${panel('Historial de correcciones', 'Devoluciones asociadas a las evaluaciones de este curso.', table(['Estudiante', 'Evaluación', 'Estado', 'Puntaje', 'Acción'], state.data.corrections.filter(item => String(item.course_id) === String(course.id)).map(item => `<tr><td>${escapeHtml(item.student_name || 'Estudiante')}</td><td>${escapeHtml(item.submission_title || 'Evaluación')}</td><td>${statusPill(item.status)}</td><td>${escapeHtml(item.total_score ?? '—')}</td><td>${btn('Abrir', 'open-correction', `data-id="${item.id}"`)}</td></tr>`), 'Todavía no hay devoluciones para este curso.'), btn('Ver historial completo', 'open-course-corrections', `data-id="${course.id}"`))}`;
  }

  function renderStudents() {
    const query = state.search.trim().toLowerCase();
    const courseId = state.studentCourseFilter;
    const items = state.data.students.filter(student => {
      const activeEnrollments = state.data.enrollments.filter(item => String(item.student) === String(student.id) && item.status === 'active');
      const matchesCourse = courseId === 'all' || (courseId === 'unassigned' ? activeEnrollments.length === 0 : activeEnrollments.some(item => String(item.course) === String(courseId)));
      const matchesStatus = state.studentStatusFilter === 'all' || (state.studentStatusFilter === 'active' ? student.active : !student.active);
      return matchesCourse && matchesStatus && (!query || `${student.name} ${student.email} ${student.external_code}`.toLowerCase().includes(query));
    });
    const rows = items.map(student => `<tr><td><strong>${escapeHtml(student.name)}</strong><small>${escapeHtml(student.email || 'Sin correo')}</small></td><td>${escapeHtml(student.external_code || '—')}</td><td>${(student.enrollments || []).map(item => escapeHtml(item.course_name)).join(', ') || '—'}</td><td>${statusPill(student.active ? 'active' : 'inactive')}</td><td><div class="table-actions">${btn('Editar', 'edit-student', `data-id="${student.id}"`)}${btn(student.active ? 'Desactivar' : 'Activar', 'toggle-student', `data-id="${student.id}"`)}</div></td></tr>`);
    return `${heading('Estudiantes', 'Mantené actualizados los datos y las matrículas de tus estudiantes.', `${btn('Importar CSV', 'import-students')}${btn('Agregar estudiante', 'new-student', '', 'primary')}`)}${resourceError('students', 'los estudiantes')}<div class="toolbar"><input class="search-input" type="search" placeholder="Buscar por nombre, correo o código" aria-label="Buscar estudiantes" value="${escapeHtml(state.search)}" data-search="students"><select class="filter-select" data-filter="student-course" aria-label="Filtrar por curso"><option value="all" ${state.studentCourseFilter === 'all' ? 'selected' : ''}>Todos los cursos</option>${state.data.courses.map(course => `<option value="${course.id}" ${String(course.id) === String(state.studentCourseFilter) ? 'selected' : ''}>${escapeHtml(course.name)}</option>`).join('')}<option value="unassigned" ${state.studentCourseFilter === 'unassigned' ? 'selected' : ''}>Sin curso activo</option></select><select class="filter-select" data-filter="student-status" aria-label="Filtrar por estado"><option value="active" ${state.studentStatusFilter === 'active' ? 'selected' : ''}>Activos</option><option value="inactive" ${state.studentStatusFilter === 'inactive' ? 'selected' : ''}>Inactivos</option><option value="all" ${state.studentStatusFilter === 'all' ? 'selected' : ''}>Todos</option></select><span class="filter-result-count">${items.length} estudiantes</span></div>${table(['Estudiante', 'Código externo', 'Cursos', 'Estado', 'Acciones'], rows, 'No hay estudiantes que coincidan con los filtros.')}`;
  }

  function renderAssessments() {
    const query = state.search.trim().toLowerCase();
    const statusFilter = state.assessmentStatusFilter;
    const items = state.data.assessments.filter(item => (!query || `${item.title} ${item.subject} ${item.course_name}`.toLowerCase().includes(query)) && (statusFilter === 'all' || item.status === statusFilter) && (state.assessmentCourseFilter === 'all' || String(item.course ?? 'unassigned') === state.assessmentCourseFilter));
    const rows = items.map(item => `<tr><td><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.subject || '')}</small></td><td>${escapeHtml(item.course_name || 'Sin curso')}</td><td>${escapeHtml(item.level || '—')}</td><td>${statusPill(item.status)}</td><td>${date(item.updated_at)}</td><td>${btn('Abrir', 'open-assessment', `data-id="${item.id}"`)} ${btn('Editar', 'edit-assessment', `data-id="${item.id}"`)}</td></tr>`);
    return `${heading('Evaluaciones', 'Diseñá propuestas, consignas y materiales para tus cursos.', `${btn('Crear evaluación', 'new-assessment', '', 'primary')}`)}${resourceError('assessments', 'las evaluaciones')}<div class="toolbar"><input class="search-input" type="search" placeholder="Buscar evaluación o curso" aria-label="Buscar evaluaciones" value="${escapeHtml(state.search)}" data-search="assessments"><select class="filter-select" data-filter="assessment-course" aria-label="Filtrar por curso"><option value="all" ${state.assessmentCourseFilter === 'all' ? 'selected' : ''}>Todos los cursos</option>${state.data.courses.map(course => `<option value="${course.id}" ${String(course.id) === String(state.assessmentCourseFilter) ? 'selected' : ''}>${escapeHtml(course.name)}</option>`).join('')}<option value="unassigned" ${state.assessmentCourseFilter === 'unassigned' ? 'selected' : ''}>Sin curso</option></select><select class="filter-select" data-filter="assessment-status" aria-label="Filtrar por estado"><option value="all" ${statusFilter === 'all' ? 'selected' : ''}>Todos</option>${['draft','ready','archived'].map(value => `<option value="${value}" ${value === statusFilter ? 'selected' : ''}>${statusLabel(value)}</option>`).join('')}</select><span class="filter-result-count">${items.length} evaluaciones</span></div>${table(['Evaluación', 'Curso', 'Nivel', 'Estado', 'Actualizada', 'Acciones'], rows, 'No hay evaluaciones que coincidan con los filtros.')}`;
  }

  async function loadAssessmentEditor(id) {
    const payload = await api.get(`assessments/${id}/editor/`);
    state.assessmentEditor = payload;
    return payload;
  }

  function renderAssessmentDetail() {
    const base = state.data.assessments.find(item => String(item.id) === String(state.selectedAssessment));
    if (!base) { state.view = 'assessments'; return renderAssessments(); }
    const editor = state.assessmentEditor?.assessment?.id === base.id ? state.assessmentEditor : null;
    const assessment = editor?.assessment || base;
    const questions = editor?.questions || [];
    const rows = questions.map(question => `<tr><td><strong>${escapeHtml(question.prompt)}</strong><small>${escapeHtml(question.question_type || 'open')} · Máximo ${escapeHtml(question.max_score)}</small></td><td>${Number(question.position || 0)}</td><td>${question.rubric ? escapeHtml(state.data.rubrics.find(item => String(item.id) === String(question.rubric))?.title || 'Asignada') : 'Sin rúbrica'}</td><td><div class="table-actions">${btn('Editar', 'edit-question', `data-id="${question.id}"`)}${btn('Eliminar', 'delete-question', `data-id="${question.id}"`)}</div></td></tr>`);
    const rubrics = state.data.rubrics.map(item => `<option value="${item.id}">${escapeHtml(item.title)}</option>`).join('');
    return `${heading(assessment.title, `${assessment.course_name || base.course_name || 'Sin curso'} · ${assessment.subject || 'Evaluación'} · ${statusLabel(assessment.status)}`, `${btn('Volver', 'navigate', 'data-view="assessments"')}${btn('Editar evaluación', 'edit-assessment', `data-id="${base.id}"`)}`)}
      ${panel('Propósito y consignas generales', '', `<p>${escapeHtml(assessment.objectives || 'Sin objetivos registrados.')}</p><p>${escapeHtml(assessment.instructions || 'Sin instrucciones generales.')}</p><details><summary>Material de referencia</summary><p>${escapeHtml(assessment.reference_material || 'No se cargó material de referencia.')}</p></details>`)}
      ${panel('Consignas', 'Las preguntas propuestas por IA deben revisarse antes de incorporarse.', table(['Consigna', 'Orden', 'Rúbrica', 'Acciones'], rows, 'Esta evaluación todavía no tiene consignas.'), `<div class="view-actions">${btn('Agregar consigna', 'new-question', `data-assessment="${base.id}"`)}${btn('Proponer con IA', 'generate-questions', `data-id="${base.id}"`)}${btn('Importar material', 'import-reference', `data-id="${base.id}"`)}</div>`)}
      ${panel('Rúbrica de la evaluación', 'Podés proponer una rúbrica con el contexto, los objetivos y las consignas de esta evaluación; después revisá criterios, puntajes y ponderaciones.', `<p>Rúbricas disponibles: ${state.data.rubrics.length}. La asociación final se realiza desde la edición de cada consigna.</p>${rubrics ? `<ul class="plain-list">${state.data.rubrics.slice(0, 5).map(item => `<li>${escapeHtml(item.title)} · ${item.criteria?.length || 0} criterios</li>`).join('')}</ul>` : 'Todavía no hay rúbricas creadas.'}`, btn('Proponer rúbrica para esta evaluación', 'generate-assessment-rubric', `data-id="${base.id}"`, 'primary'))}`;
  }

  function renderRubrics() {
    const rows = state.data.rubrics.map(rubric => `<tr><td><strong>${escapeHtml(rubric.title)}</strong><small>${escapeHtml(rubric.description || '')}</small></td><td>${escapeHtml(rubric.scale_type || 'both')}</td><td>${(rubric.criteria || []).length}</td><td>${(rubric.criteria || []).reduce((sum, criterion) => sum + (criterion.levels || []).length, 0)}</td><td>${date(rubric.updated_at)}</td><td><div class="table-actions">${btn('Ver', 'open-rubric', `data-id="${rubric.id}"`)}${btn('Editar', 'edit-rubric', `data-id="${rubric.id}"`)}</div></td></tr>`);
    return `${heading('Rúbricas', 'Definí criterios, ponderaciones y niveles para orientar la evaluación.', `${btn('Proponer con IA', 'generate-rubric')}${btn('Crear rúbrica', 'new-rubric', '', 'primary')}`)}${resourceError('rubrics', 'las rúbricas')}${table(['Rúbrica', 'Escala', 'Criterios', 'Niveles', 'Actualizada', 'Acciones'], rows, 'Todavía no creaste rúbricas.')}`;
  }

  function renderRubricDetail() {
    const rubric = state.data.rubrics.find(item => String(item.id) === String(state.selectedRubric));
    if (!rubric) { state.view = 'rubrics'; return renderRubrics(); }
    const criteria = (rubric.criteria || []).map(criterion => `<article class="criterion-card"><div class="panel-head"><div><h3>${escapeHtml(criterion.name)}</h3><p>${escapeHtml(criterion.description || 'Sin descripción')} · Máximo ${escapeHtml(criterion.max_score)} · Ponderación ${escapeHtml(criterion.weight)}%</p></div>${btn('Agregar nivel', 'add-level', `data-criterion="${criterion.id}"`)}${btn('Editar criterio', 'edit-criterion', `data-id="${criterion.id}"`)}</div><div class="panel-body">${(criterion.levels || []).length ? (criterion.levels || []).map(level => `<div class="list-row"><div class="list-main"><strong>${escapeHtml(level.name)}</strong><small>${escapeHtml(level.description || '')}</small></div><span>${escapeHtml(level.score)} puntos</span>${btn('Editar', 'edit-level', `data-id="${level.id}"`)}</div>`).join('') : '<p>Sin niveles definidos.</p>'}</div></article>`).join('');
    return `${heading(rubric.title, `${rubric.description || 'Sin descripción'} · Escala ${rubric.scale_type}`, `${btn('Volver a rúbricas', 'navigate', 'data-view="rubrics"')}${btn('Agregar criterio', 'new-criterion', `data-rubric="${rubric.id}"`, 'primary')}`)}${criteria || emptyState('Sin criterios', 'Agregá al menos dos criterios para poder usar esta rúbrica.')}`;
  }

  function submissionWorkflowStatus(submission) {
    const correction = state.data.corrections.find(item => String(item.submission) === String(submission.id));
    if (correction?.status === 'approved' || submission.status === 'approved') return 'approved';
    if (correction?.status === 'rejected') return 'rejected';
    if (correction || ['review', 'processing'].includes(submission.status)) return 'review';
    return 'pending';
  }

  function renderSubmissions() {
    const query = state.search.trim().toLowerCase();
    const all = state.data.submissions;
    const counts = {
      all: all.length,
      pending: all.filter(item => submissionWorkflowStatus(item) === 'pending').length,
      review: all.filter(item => submissionWorkflowStatus(item) === 'review').length,
      approved: all.filter(item => submissionWorkflowStatus(item) === 'approved').length
    };
    const filtered = all.filter(item => {
      const assessment = state.data.assessments.find(row => String(row.id) === String(item.assessment));
      const matchesQuery = !query || `${item.student_display_name || item.student_name || ''} ${item.submission_title || item.assessment_title || assessment?.title || ''} ${item.answer_text || ''}`.toLowerCase().includes(query);
      const matchesCourse = state.submissionCourseFilter === 'all' || String(assessment?.course ?? 'unassigned') === state.submissionCourseFilter;
      const matchesStatus = state.submissionStatusFilter === 'all' || submissionWorkflowStatus(item) === state.submissionStatusFilter;
      return matchesQuery && matchesCourse && matchesStatus;
    });
    const rows = filtered.map(item => {
      const assessment = state.data.assessments.find(row => String(row.id) === String(item.assessment));
      const correction = state.data.corrections.find(row => String(row.submission) === String(item.id));
      const workflowStatus = submissionWorkflowStatus(item);
      return `<tr><td><strong>${escapeHtml(item.student_display_name || item.student_name || 'Estudiante sin identificar')}</strong><small>${escapeHtml(item.source_filename || item.source_type || 'Texto')}</small></td><td>${escapeHtml(assessment?.title || item.submission_title || 'Evaluación')}</td><td><span class="answer-preview">${escapeHtml(item.answer_text || 'Sin vista previa')}</span></td><td>${statusPill(item.status)}</td><td>${correction ? statusPill(correction.status) : statusPill(workflowStatus)}</td><td>${btn(correction ? 'Revisar devolución' : 'Abrir entrega', 'open-submission', `data-id="${item.id}"`)}</td></tr>`;
    });
    const statusCards = [
      ['all', 'Todas las entregas', counts.all, 'Ver el listado completo'],
      ['pending', 'Pendientes', counts.pending, 'Sin propuesta generada'],
      ['review', 'Para revisar', counts.review, 'Propuestas pendientes'],
      ['approved', 'Aprobadas', counts.approved, 'Resultado confirmado']
    ].map(([key, label, value, hint]) => `<button type="button" class="submission-status-card ${state.submissionStatusFilter === key ? 'is-selected' : ''}" data-submission-status="${key}" aria-pressed="${state.submissionStatusFilter === key}"><span>${label}</span><strong>${value}</strong><small>${hint}</small></button>`).join('');
    return `${heading('Entregas', 'Encontrá cada respuesta y continuá directamente con su revisión.', `${btn('Historial de correcciones', 'navigate', 'data-view="corrections"')}${btn('Ver evaluaciones', 'navigate', 'data-view="assessments"')}${btn('Nueva entrega', 'new-submission', '', 'primary')}`)}${resourceError('submissions', 'las entregas')}${resourceError('corrections', 'las correcciones')}<section class="submission-summary-grid" aria-label="Estados de entrega">${statusCards}</section><div class="toolbar"><input class="search-input" type="search" placeholder="Buscar estudiante, evaluación o respuesta" aria-label="Buscar entregas" value="${escapeHtml(state.search)}" data-search="submissions"><select class="filter-select" data-filter="submission-course" aria-label="Filtrar por curso"><option value="all" ${state.submissionCourseFilter === 'all' ? 'selected' : ''}>Todos los cursos</option>${state.data.courses.map(course => `<option value="${course.id}" ${String(course.id) === String(state.submissionCourseFilter) ? 'selected' : ''}>${escapeHtml(course.name)}</option>`).join('')}<option value="unassigned" ${state.submissionCourseFilter === 'unassigned' ? 'selected' : ''}>Sin curso asignado</option></select><span class="filter-result-count">${filtered.length} de ${all.length} entregas</span></div>${table(['Estudiante', 'Evaluación', 'Respuesta', 'Entrega', 'Corrección', 'Acciones'], rows, 'No hay entregas que coincidan con los filtros.')}`;
  }

  function renderCorrections() {
    const courses = new Map(state.data.courses.map(item => [String(item.id), item.name]));
    const courseOptions = [...courses.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es-AR'));
    const query = state.search.trim().toLocaleLowerCase('es-AR');
    const filtered = state.data.corrections.filter(item => {
      const matchesQuery = !query || [item.student_name, item.submission_title, item.course_name, item.subject].filter(Boolean).join(' ').toLocaleLowerCase('es-AR').includes(query);
      const courseId = item.course_id == null ? 'unassigned' : String(item.course_id);
      const matchesCourse = state.correctionsCourseFilter === 'all' || state.correctionsCourseFilter === courseId;
      const matchesStatus = state.correctionsStatusFilter === 'all' || item.status === state.correctionsStatusFilter;
      return matchesQuery && matchesCourse && matchesStatus;
    });
    const grouped = new Map();
    filtered.forEach(item => {
      const key = item.course_id == null ? 'unassigned' : String(item.course_id);
      const name = item.course_name || courses.get(key) || 'Sin curso asignado';
      if (!grouped.has(key)) grouped.set(key, { name, items: [] });
      grouped.get(key).items.push(item);
    });
    const groups = [...grouped.entries()].map(([key, group]) => `<section class="panel correction-course-group"><header class="panel-head"><div><h2>${escapeHtml(group.name)}</h2><p>${group.items.length} ${group.items.length === 1 ? 'devolución' : 'devoluciones'}</p></div></header><div class="panel-body correction-history-list">${group.items.map(item => {
      const approved = item.status === 'approved';
      return `<article class="correction-history-item"><div class="correction-history-main"><div class="correction-history-title"><strong>${escapeHtml(item.submission_title || 'Evaluación')}</strong>${statusPill(item.status)}</div><p>${escapeHtml(item.student_name || 'Estudiante sin identificar')} · ${escapeHtml(item.subject || 'Sin materia')}</p><small>${date(item.created_at, true)} · ${escapeHtml(item.provider || 'Proveedor no informado')}</small></div><div class="correction-history-score"><strong>${escapeHtml(item.total_score ?? '—')}</strong><small>puntaje</small></div><div class="table-actions">${btn('Ver devolución', 'open-correction', `data-id="${item.id}"`, 'primary')}${approved ? btn('Exportar', 'export-correction', `data-id="${item.id}"`) : ''}</div></article>`;
    }).join('')}</div></section>`).join('');
    return `${heading('Correcciones', 'Historial de devoluciones agrupado por curso. Abrí cada detalle cuando necesites revisar, compartir o exportar.', `${btn('Ir a entregas', 'navigate', 'data-view="submissions"', 'primary')}`)}${resourceError('corrections', 'el historial de correcciones')}<div class="toolbar correction-filters"><input class="search-input" type="search" placeholder="Estudiante, evaluación o materia…" aria-label="Buscar correcciones" value="${escapeHtml(state.search)}" data-search="corrections"><select class="filter-select" data-filter="corrections-course" aria-label="Filtrar por curso"><option value="all">Todos los cursos</option>${courseOptions.map(([id, name]) => `<option value="${escapeHtml(id)}" ${state.correctionsCourseFilter === id ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}${state.data.corrections.some(item => item.course_id == null) ? `<option value="unassigned" ${state.correctionsCourseFilter === 'unassigned' ? 'selected' : ''}>Sin curso asignado</option>` : ''}</select><select class="filter-select" data-filter="corrections-status" aria-label="Filtrar por estado"><option value="all" ${state.correctionsStatusFilter === 'all' ? 'selected' : ''}>Todos los estados</option><option value="pending_review" ${state.correctionsStatusFilter === 'pending_review' ? 'selected' : ''}>Pendientes</option><option value="approved" ${state.correctionsStatusFilter === 'approved' ? 'selected' : ''}>Aprobadas</option><option value="rejected" ${state.correctionsStatusFilter === 'rejected' ? 'selected' : ''}>Rechazadas</option></select></div>${groups || emptyState('No hay correcciones para mostrar', 'Probá modificar los filtros o generá una nueva propuesta desde Entregas.')}`;
  }

  function renderSubmissionDetail() {
    const submission = state.currentSubmission;
    if (!submission) return emptyState('No se encontró la entrega', 'Volvé al listado e intentá abrirla nuevamente.', btn('Volver', 'navigate', 'data-view="submissions"'));
    const assessment = state.data.assessments.find(item => String(item.id) === String(submission.assessment));
    const correction = state.data.corrections.find(item => String(item.submission) === String(submission.id));
    const rubricOptions = optionRows(state.data.rubrics, item => item.title, true);
    const answers = Array.isArray(submission.answers) ? submission.answers : [];
    const questions = state.assessmentEditor?.questions || [];
    const alreadyAnswered = new Set(answers.map(item => String(item.question)));
    if (submission.question) alreadyAnswered.add(String(submission.question));
    const availableQuestions = questions.filter(item => !alreadyAnswered.has(String(item.id)));
    const answerRows = answers.map(answer => `<article class="list-row"><div class="list-main"><strong>${escapeHtml(answer.question_prompt || questions.find(question => String(question.id) === String(answer.question))?.prompt || 'Consigna')}</strong><small>${escapeHtml(answer.source_filename || 'Respuesta en texto')}</small><p class="answer-full">${escapeHtml(answer.answer_text || '')}</p></div><small class="muted">${date(answer.created_at, true)}</small></article>`).join('');
    const canAddAnswers = !correction && !['processing', 'approved'].includes(submission.status);
    const addAnswer = canAddAnswers && availableQuestions.length ? `<form id="add-submission-answer-form" class="panel-body"><div class="form-grid">${selectField('Consigna','question',availableQuestions.map(item=>({value:item.id,label:item.prompt})), '', true)}${textField('Respuesta','answer_text','','maxlength="50000"',true)}</div><div class="modal-actions"><button class="btn btn-primary" type="submit">Agregar respuesta</button></div></form>` : `<p class="muted">${correction ? 'La entrega ya tiene una corrección asociada. Para mantener la trazabilidad, no se agregan respuestas después de generar la propuesta.' : submission.status === 'processing' ? 'No se pueden modificar respuestas mientras se procesa la corrección.' : questions.length ? 'Todas las consignas disponibles ya tienen una respuesta asociada.' : 'Esta evaluación todavía no tiene consignas.'}</p>`;
    return `${heading('Detalle de entrega', `${submission.student_display_name || submission.student_name || 'Estudiante'} · ${assessment?.title || 'Evaluación'}`, `${btn('Volver a entregas', 'navigate', 'data-view="submissions"')}`)}
      ${panel('Respuesta general', '', `<p class="answer-full">${escapeHtml(submission.answer_text || 'La entrega no contiene una respuesta general. Revisá las respuestas asociadas a cada consigna.')}</p><small class="muted">${escapeHtml(submission.source_filename || submission.source_type || 'Texto')} · ${date(submission.created_at, true)}</small>`)}
      ${panel('Respuestas por consigna', 'Podés agregar respuestas adicionales mientras la entrega no esté en procesamiento.', `${answerRows || '<p class="muted">Todavía no hay respuestas individuales.</p>'}${addAnswer}`)}
      ${correction ? panel('Corrección existente', 'Hay una propuesta o resultado asociado a esta entrega.', `<div class="list-row"><div class="list-main"><strong>${escapeHtml(correction.provider || 'Proveedor')} · ${statusLabel(correction.status)}</strong><small>${date(correction.created_at, true)}</small></div>${btn('Revisar corrección', 'open-correction', `data-id="${correction.id}"`, 'primary')}</div>`) : panel('Generar propuesta', 'La IA utiliza el material de la evaluación y la rúbrica elegida. Revisá siempre la propuesta.', `<form id="generate-correction-form"><div class="form-grid">${selectField('Rúbrica','rubric_id',rubricOptions,'',false)}${selectField('Estilo de devolución','feedback_style',[{value:'constructivo',label:'Constructivo'},{value:'formal',label:'Formal'},{value:'motivador',label:'Motivador'}],state.feedbackStyle || 'constructivo')}</div><div class="modal-actions"><button type="submit" class="btn btn-primary">Generar propuesta de corrección</button></div><p class="muted">La generación puede tardar y está sujeta a límites y configuración del proveedor IA.</p></form>`)}
    `;
  }

  function renderCorrection() {
    const correction = state.currentCorrection;
    const submission = state.currentSubmission;
    if (!correction || !submission) return emptyState('No hay una corrección seleccionada', 'Elegí una entrega desde el listado.');
    const proposal = correction.status === 'approved' ? correction.final_result : correction.proposal;
    const criteria = Array.isArray(proposal?.criteria) ? proposal.criteria : [];
    const readonly = correction.status === 'approved' || Boolean(proposal?.demo);
    const warning = proposal?.demo ? `<div class="notice notice-warning"><strong>Propuesta demostrativa.</strong> El proveedor está en modo MOCK. No se puede aprobar ni utilizar como calificación real.</div>` : '';
    const backLabel = state.correctionOrigin === 'corrections' ? 'Volver al historial' : 'Volver a la entrega';
    const sharingActions = correction.status === 'approved'
      ? btn('Compartir / guardar', 'share-correction', '', 'primary')
      : `${btn('Copiar borrador', 'copy-correction')}${btn('Imprimir', 'print-correction')}`;
    return `${heading('Revisión pedagógica', `${submission.student_display_name || submission.student_name || 'Estudiante'} · ${correction.submission_title || 'Evaluación'}`, `${btn(backLabel, 'return-submission', `data-id="${submission.id}"`)}${sharingActions}`)}${warning}
      ${panel('Síntesis propuesta', '', `<p>${escapeHtml(proposal?.summary || 'La IA no incluyó una síntesis.')}</p><div class="notice">Proveedor: ${escapeHtml(correction.provider || '—')} · Puntaje propuesto: ${escapeHtml(correction.total_score || criteria.reduce((sum,item)=>sum + Number(item.score || 0),0))}</div>`)}
      ${panel('Criterios y evidencias', 'Revisá puntajes, justificaciones y citas literales. Los cambios de puntaje requieren explicar el motivo.', `<form id="approve-correction-form">${criteria.map((item, index) => `<fieldset class="criterion-review"><legend>${escapeHtml(item.criterion || `Criterio ${index + 1}`)}</legend><div class="form-grid"><div class="form-field"><label for="score-${index}">Puntaje (máx. ${escapeHtml(item.max_score)})</label><input id="score-${index}" name="score-${index}" type="number" min="0" max="${Number(item.max_score || 0)}" step="0.01" value="${escapeHtml(item.score)}" ${readonly ? 'disabled' : ''} required></div><div class="form-field"><label for="level-${index}">Nivel</label><input id="level-${index}" name="level-${index}" value="${escapeHtml(item.level || '')}" ${readonly ? 'disabled' : ''}></div>${textField('Justificación', `justification-${index}`, item.justification || '', readonly ? 'disabled' : '')}${textField('Evidencia textual (cita exacta)', `evidence-${index}`, item.evidence || '', readonly ? 'disabled' : '')}</div></fieldset>`).join('')}
      ${textField('Devolución general al estudiante', 'teacher_feedback', correction.teacher_feedback || proposal?.feedback || '', readonly ? 'disabled' : '')}
      ${correction.status === 'approved' ? `<div class="notice notice-success">Esta devolución fue aprobada el ${date(correction.approved_at, true)}. El historial permanece inmutable.</div>` : ''}
      ${proposal?.demo ? '<p class="form-error">Las propuestas MOCK no pueden aprobarse.</p>' : ''}
      ${correction.status !== 'approved' && !proposal?.demo ? `<div class="form-grid">${textField('Motivo del ajuste de puntaje (obligatorio si modificás algún puntaje)','change_reason','','',false)}</div><div class="modal-actions">${btn('Exportar Markdown', 'export-correction', `data-id="${correction.id}"`)}<button class="btn btn-primary" type="submit">Aprobar devolución</button></div>` : `${btn('Exportar Markdown', 'export-correction', `data-id="${correction.id}"`)}`}</form>`)}`;
  }

  function renderAdmin() {
    if (!['admin', 'superadmin'].includes(state.profile?.role)) return emptyState('Administración no disponible', 'Tu rol no tiene permisos globales para esta sección.');
    const data = state.data.admin;
    const rows = data.users.map(user => `<tr><td><strong>${escapeHtml(user.full_name || 'Sin nombre')}</strong><small>${escapeHtml(user.email)}</small></td><td><code>${escapeHtml(user.user_id)}</code></td><td>${escapeHtml(user.role)}</td><td>${statusPill(user.status)}</td><td>${btn('Editar', 'edit-admin-user', `data-id="${user.id}"`)}</td></tr>`);
    const institutionRows = data.institutions.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.slug)}</small></td><td>${escapeHtml(item.contact_email || '—')}</td><td>${statusPill(item.status)}</td><td>${btn('Editar', 'edit-institution', `data-id="${item.id}"`)} ${btn('Miembros', 'view-memberships', `data-id="${item.id}"`)}</td></tr>`);
    const messageRows = data.messages.map(item => `<tr><td><strong>${escapeHtml(item.subject)}</strong><small>${escapeHtml(item.name)} · ${escapeHtml(item.email)}</small></td><td>${escapeHtml(item.category)}</td><td>${statusPill(item.status)}</td><td>${date(item.created_at)}</td><td>${btn('Gestionar', 'edit-message', `data-id="${item.id}"`)}</td></tr>`);
    const providerRows = data.providers.map(item => `<tr><td><strong>${escapeHtml(item.provider)}</strong></td><td>${escapeHtml(item.model_name || 'Predeterminado')}</td><td>${item.enabled ? statusPill('active') : statusPill('inactive')}</td><td>${item.priority}</td><td>${item.timeout_seconds}s</td><td>${btn('Editar', 'edit-provider', `data-id="${item.id}"`)}</td></tr>`);
    const auditQuery = state.search.trim().toLowerCase();
    const auditRows = data.audit.filter(event => !auditQuery || `${event.event_type} ${event.object_type} ${event.object_id}`.toLowerCase().includes(auditQuery)).slice(0, 50).map(event => `<tr><td>${date(event.created_at, true)}</td><td>${escapeHtml(event.event_type)}</td><td>${escapeHtml(event.object_type)} · ${escapeHtml(event.object_id)}</td><td><code>${escapeHtml(event.actor_user_id || event.owner_id || '—')}</code></td></tr>`);
    return `${heading('Administración', 'Gestión global de perfiles, instituciones, mensajes, proveedores y auditoría.', `${btn('Crear institución', 'new-institution', '', 'primary')}`)}
      <div class="admin-tabs"><button class="admin-tab ${state.adminTab === 'users' ? 'active' : ''}" data-admin-tab="users">Usuarios</button><button class="admin-tab ${state.adminTab === 'institutions' ? 'active' : ''}" data-admin-tab="institutions">Instituciones</button><button class="admin-tab ${state.adminTab === 'messages' ? 'active' : ''}" data-admin-tab="messages">Contacto</button><button class="admin-tab ${state.adminTab === 'providers' ? 'active' : ''}" data-admin-tab="providers">Proveedores IA</button><button class="admin-tab ${state.adminTab === 'audit' ? 'active' : ''}" data-admin-tab="audit">Auditoría</button></div>
      <section class="admin-section" data-admin-section="users" ${state.adminTab === 'users' ? '' : 'hidden'}>${panel('Perfiles de usuario', 'Los perfiles corresponden a identidades ya existentes en Supabase Auth. Esta API no invita ni crea credenciales.', table(['Persona', 'Identidad Auth', 'Rol global', 'Estado', 'Acción'], rows, 'No hay perfiles registrados.'), btn('Crear perfil existente', 'new-admin-user'))}<p class="notice">Para invitar una identidad nueva se necesita integrar Supabase Auth Admin desde el servidor. No se crea un usuario de Auth desde este formulario.</p>${resourceError('admin_users','los perfiles')}</section>
      <section class="admin-section" data-admin-section="institutions" ${state.adminTab === 'institutions' ? '' : 'hidden'}>${panel('Instituciones', 'Organizaciones y su estado operativo.', table(['Institución', 'Contacto', 'Estado', 'Acciones'], institutionRows, 'No hay instituciones registradas.'), btn('Crear institución', 'new-institution', '', 'primary'))}${panel('Membresías institucionales', 'Altas y bajas de usuarios existentes.', table(['Institución', 'Usuario', 'Rol', 'Estado', 'Acciones'], data.memberships.map(item => `<tr><td>${escapeHtml(item.institution_name || item.institution)}</td><td><code>${escapeHtml(item.user_id)}</code></td><td>${escapeHtml(item.role)}</td><td>${statusPill(item.status)}</td><td>${btn('Editar', 'edit-membership', `data-id="${item.id}"`)}</td></tr>`), 'No hay membresías.') , btn('Agregar membresía', 'new-membership'))}${resourceError('admin_institutions','las instituciones')}</section>
      <section class="admin-section" data-admin-section="messages" ${state.adminTab === 'messages' ? '' : 'hidden'}>${panel('Bandeja de contacto', 'Las notas internas sólo están disponibles para administradores globales.', `<div class="toolbar"><input class="search-input" type="search" placeholder="Buscar remitente, correo o asunto" data-admin-filter="messages" aria-label="Buscar mensajes" value="${escapeHtml(state.adminMessageSearch)}"><select class="filter-select" data-admin-status="messages"><option value="">Todos los estados</option>${['new','in_progress','handled','spam'].map(value => `<option value="${value}" ${state.adminMessageStatus === value ? 'selected' : ''}>${statusLabel(value)}</option>`).join('')}</select></div>${table(['Asunto / remitente', 'Categoría', 'Estado', 'Creado', 'Acción'], messageRows, 'No hay mensajes de contacto.')}`)}${resourceError('admin_messages','los mensajes')}</section>
      <section class="admin-section" data-admin-section="providers" ${state.adminTab === 'providers' ? '' : 'hidden'}>${panel('Configuración de proveedores', 'Los secretos y claves API se configuran exclusivamente en el entorno seguro del backend.', table(['Proveedor', 'Modelo', 'Habilitado', 'Prioridad', 'Timeout', 'Acción'], providerRows, 'No hay proveedores configurados.'), btn('Agregar proveedor', 'new-provider', '', 'primary'))}${resourceError('admin_providers','los proveedores')}</section>
      <section class="admin-section" data-admin-section="audit" ${state.adminTab === 'audit' ? '' : 'hidden'}>${panel('Registro de auditoría', 'Eventos administrativos globales. Los datos sensibles no deben almacenarse en el detalle.', `<div class="toolbar"><input class="search-input" type="search" placeholder="Filtrar por evento" data-search="audit" aria-label="Filtrar auditoría" value="${escapeHtml(state.search)}"></div>${table(['Fecha', 'Evento', 'Recurso', 'Actor'], auditRows, 'No hay eventos auditables.')}`)}${resourceError('admin_audit','la auditoría')}</section>`;
  }

  function renderInstitutionScope() {
    const memberships = (state.profile?.memberships || []).filter(item => item.status === 'active' && ['institution_admin', 'department_admin'].includes(item.role));
    if (!memberships.length && !['admin', 'superadmin'].includes(state.profile?.role)) return emptyState('Sin administración institucional', 'Tu cuenta no tiene una membresía administrativa activa.');
    const institutions = state.data.admin.institutions || [];
    const rows = institutions.map(item => { const manager = memberships.find(member => String(member.institution_id) === String(item.id)); return `<tr><td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.slug || '')}</small></td><td>${escapeHtml(item.contact_email || '—')}</td><td>${statusPill(item.status)}</td><td>${btn(manager?.role === 'department_admin' ? 'Ver mi membresía' : 'Ver integrantes', 'manage-institution', `data-id="${item.id}"`)}${manager?.role === 'institution_admin' ? btn('Editar institución', 'edit-institution-scope', `data-id="${item.id}"`) : ''}</td></tr>`; });
    const selected = institutions.find(item => String(item.id) === String(state.selectedInstitution));
    if (state.view === 'institution-memberships' && selected) {
      const manageable = memberships.some(item => String(item.institution_id) === String(selected.id) && item.role === 'institution_admin');
      const scopedMemberships = (state.data.admin.memberships || []).filter(item => String(item.institution) === String(selected.id));
      const memberRows = scopedMemberships.map(item => `<tr><td><code>${escapeHtml(item.user_id)}</code></td><td>${escapeHtml(item.role)}</td><td>${statusPill(item.status)}</td><td>${manageable && item.role !== 'institution_admin' && String(item.user_id) !== String(state.profile.user_id) ? `${btn('Editar', 'edit-membership', `data-id="${item.id}"`)}${btn('Suspender', 'suspend-membership', `data-id="${item.id}"`)}` : '—'}</td></tr>`);
      return `${heading(selected.name, `Membresías institucionales · ${selected.contact_email || 'Sin correo de contacto'}`, `${btn('Volver a instituciones', 'navigate', 'data-view="institution"')}${manageable ? btn('Agregar integrante', 'new-membership', `data-institution="${selected.id}"`, 'primary') : ''}`)}${resourceError('institution_memberships', 'las membresías')}${table(['Identidad Supabase', 'Rol institucional', 'Estado', 'Acciones'], memberRows, 'No hay otras membresías visibles en esta institución.')}`;
    }
    return `${heading('Mi institución', 'Acceso acotado a las instituciones donde tenés una membresía administrativa activa.')}${resourceError('institution_scope', 'tus instituciones')}${table(['Institución', 'Contacto', 'Estado', 'Acciones'], rows, 'No hay instituciones dentro de tu ámbito.')}`;
  }

  function renderProfile() {
    const profile = state.profile || {};
    const memberships = profile.memberships || [];
    const style = state.feedbackStyle || 'constructivo';
    return `${heading('Mi perfil', 'Personalizá los datos visibles y las preferencias pedagógicas asociadas a tu cuenta.', btn('Cerrar sesión', 'logout', '', 'secondary'))}
      <form id="profile-settings-form" class="panel profile-settings-panel" style="max-width:820px"><div class="panel-body">
        <div class="entity-cell profile-summary"><span class="profile-avatar">${escapeHtml(initials(profile.full_name || profile.email))}</span><div><strong>${escapeHtml(profile.full_name || 'Docente')}</strong><small>${escapeHtml(profile.email || '')}</small></div></div>
        <h2>Datos del perfil</h2><div class="form-grid">
          <div class="form-field"><label for="profile-display-name">Nombre y apellido</label><input id="profile-display-name" name="display_name" value="${escapeHtml(profile.full_name || '')}" maxlength="100" minlength="2" required></div>
          <div class="form-field"><label for="profile-email-readonly">Correo electrónico</label><input id="profile-email-readonly" value="${escapeHtml(profile.email || '')}" disabled readonly><small class="field-hint">El correo se administra desde Supabase Auth.</small></div>
          <div class="form-field"><label>Rol global</label><input value="${escapeHtml(profile.role || 'teacher')}" disabled></div>
          <div class="form-field"><label>Estado de cuenta</label><input value="${escapeHtml(statusLabel(profile.status))}" disabled></div>
        </div>
        <h2 class="profile-section-title">Preferencias pedagógicas</h2><div class="form-grid"><div class="form-field full"><label for="profile-feedback-style">Tono predeterminado de las devoluciones</label><select id="profile-feedback-style" name="feedback_style"><option value="formal" ${style === 'formal' ? 'selected' : ''}>Formal / académico</option><option value="constructivo" ${style === 'constructivo' ? 'selected' : ''}>Constructivo / orientador</option><option value="motivador" ${style === 'motivador' ? 'selected' : ''}>Motivador / empático</option></select><small class="field-hint">Se propone para nuevas correcciones. Cada devolución puede revisarse antes de aprobarla.</small></div></div>
        <section class="profile-appearance"><div><h2>Apariencia</h2><p>Elegí el tema que te resulte más cómodo para trabajar.</p></div><button class="btn btn-secondary" type="button" id="theme-toggle-profile"><span aria-hidden="true">◐</span> <span id="theme-label-profile">${document.documentElement.dataset.theme === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro'}</span></button></section>
        <div class="notice" style="margin-top:18px">La autenticación y las credenciales se administran mediante Supabase Auth. Las preferencias de perfil se guardan en los metadatos de tu cuenta.</div>
        <h2 class="profile-section-title">Membresías institucionales</h2>${memberships.length ? memberships.map(item => `<div class="list-row"><div class="list-main"><strong>${escapeHtml(item.institution__name || 'Institución')}</strong><small>${escapeHtml(item.role)} · ${escapeHtml(item.status)}</small></div>${statusPill(item.status)}</div>`).join('') : '<p class="muted">No tenés membresías institucionales activas.</p>'}
        <p class="form-error" id="profile-error" role="alert"></p><p class="form-success" id="profile-success" role="status"></p>
        <div class="modal-actions"><button class="btn btn-primary" type="submit">Guardar preferencias</button></div>
      </div></form>
      ${panel('Compartir devoluciones', 'Las devoluciones aprobadas se preparan desde el espacio de corrección.', '<p>Podés copiar el texto, abrir un correo o WhatsApp y guardar una copia mediante la impresión del navegador. MaestrIA no envía mensajes automáticamente ni almacena credenciales de esos servicios.</p>')}`;
  }

  function render() {
    updateChrome();
    const renderers = {
      dashboard: renderDashboard, courses: renderCourses, course: renderCourseDetail,
      students: renderStudents, assessments: renderAssessments, assessment: renderAssessmentDetail,
      rubrics: renderRubrics, rubric: renderRubricDetail, submissions: renderSubmissions,
      submission: renderSubmissionDetail, corrections: renderCorrections, correction: renderCorrection, admin: renderAdmin, institution: renderInstitutionScope, 'institution-memberships': renderInstitutionScope, profile: renderProfile
    };
    content.innerHTML = (renderers[state.view] || renderDashboard)();
    $$('.side-link').forEach(link => {
      const active = link.dataset.view === state.view || (state.view === 'course' && link.dataset.view === 'courses') || (state.view === 'assessment' && link.dataset.view === 'assessments') || (state.view === 'submission' && link.dataset.view === 'submissions') || (state.view === 'correction' && link.dataset.view === 'corrections') || (state.view === 'rubric' && link.dataset.view === 'rubrics') || (state.view === 'institution-memberships' && link.dataset.view === 'institution');
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    content.focus({ preventScroll: true });
  }

  function navigate(view) {
    if (view === 'admin' && !['admin', 'superadmin'].includes(state.profile?.role)) { toast('Tu cuenta no tiene permisos de administración global.', 'error'); return; }
    const canInstitution = (state.profile?.memberships || []).some(item => item.status === 'active' && ['institution_admin', 'department_admin'].includes(item.role));
    if (['institution', 'institution-memberships'].includes(view) && !canInstitution && !['admin', 'superadmin'].includes(state.profile?.role)) { toast('No tenés permisos para administrar instituciones.', 'error'); return; }
    state.view = view; state.search = '';
    closeSidebar(); render();
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  const SIDEBAR_PREFERENCE_KEY = 'maestria.workspace.sidebar.collapsed.v1';

  function setSidebarCollapsed(collapsed, persist = true) {
    const layout = $('.app-layout');
    const sidebar = $('#sidebar');
    const button = $('#sidebar-collapse');
    if (!layout || !sidebar || !button) return;
    layout.classList.toggle('is-sidebar-collapsed', collapsed);
    sidebar.classList.toggle('is-collapsed', collapsed);
    button.setAttribute('aria-expanded', String(!collapsed));
    const label = collapsed ? 'Expandir menú' : 'Contraer menú';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    if (persist) {
      try { sessionStorage.setItem(SIDEBAR_PREFERENCE_KEY, collapsed ? '1' : '0'); } catch { /* La preferencia no es esencial. */ }
    }
  }

  function restoreSidebarPreference() {
    let collapsed = false;
    try { collapsed = sessionStorage.getItem(SIDEBAR_PREFERENCE_KEY) === '1'; } catch { /* Se usa el estado expandido por defecto. */ }
    setSidebarCollapsed(collapsed, false);
  }

  function openSidebar() {
    $('#sidebar')?.classList.add('is-open');
    $('.sidebar-scrim')?.classList.add('is-open');
    $('#mobile-menu-button')?.setAttribute('aria-expanded', 'true');
  }
  function closeSidebar() {
    $('#sidebar')?.classList.remove('is-open');
    $('.sidebar-scrim')?.classList.remove('is-open');
    $('#mobile-menu-button')?.setAttribute('aria-expanded', 'false');
  }

  function courseForm(course = null) {
    const fields = `${formField('Nombre del curso','name',course?.name || '', 'text','maxlength="180"',true)}${formField('Materia / área','subject',course?.subject || '', 'text','maxlength="120"')}${formField('Nivel','level',course?.level || '', 'text','maxlength="120"')}${formField('Ciclo lectivo','academic_year',course?.academic_year || '', 'text','maxlength="80"')}${textField('Descripción','description',course?.description || '')}${selectField('Estado','active',[{value:'true',label:'Activo'},{value:'false',label:'Archivado'}],String(course?.active !== false))}`;
    openModal(course ? 'Editar curso' : 'Crear curso', modalForm(fields), course ? 'edit-course' : 'new-course', true);
    modal.dataset.recordId = course?.id || '';
  }

  function studentForm(student = null) {
    const courses = state.data.courses.filter(item => item.active).map(item => ({ value: item.id, label: item.name }));
    const fields = `${formField('Nombre y apellido','name',student?.name || '', 'text','maxlength="180"',true)}${formField('Correo electrónico','email',student?.email || '', 'email','maxlength="254"')}${formField('Teléfono','phone',student?.phone || '', 'tel','maxlength="60"')}${formField('Código externo','external_code',student?.external_code || '', 'text','maxlength="100"')}${student ? selectField('Estado','active',[{value:'true',label:'Activo'},{value:'false',label:'Inactivo'}],String(student.active !== false)) : selectField('Curso inicial','course',courses,'',true)}`;
    openModal(student ? 'Editar estudiante' : 'Agregar estudiante', modalForm(fields), student ? 'edit-student' : 'new-student');
    modal.dataset.recordId = student?.id || '';
  }

  function assessmentForm(assessment = null, defaultCourse = '') {
    const courses = optionRows(state.data.courses.filter(item => item.active), item => item.name, true);
    const fields = `${formField('Título','title',assessment?.title || '', 'text','maxlength="180"',true)}${selectField('Curso','course',courses,assessment?.course || defaultCourse || '',false)}${formField('Materia','subject',assessment?.subject || '', 'text','maxlength="120"')}${formField('Nivel','level',assessment?.level || '', 'text','maxlength="120"')}${selectField('Estado','status',[{value:'draft',label:'Borrador'},{value:'ready',label:'Lista'},{value:'archived',label:'Archivada'}],assessment?.status || 'draft')}${textField('Objetivos','objectives',assessment?.objectives || '')}${textField('Instrucciones generales','instructions',assessment?.instructions || '')}${textField('Material de referencia','reference_material',assessment?.reference_material || '', 'maxlength="50000"')}`;
    openModal(assessment ? 'Editar evaluación' : 'Crear evaluación', modalForm(fields), assessment ? 'edit-assessment' : 'new-assessment', true);
    modal.dataset.recordId = assessment?.id || '';
  }

  function questionForm(question = null, assessmentId = state.selectedAssessment) {
    const rubrics = optionRows(state.data.rubrics, item => item.title, true);
    const fields = `${textField('Consigna','prompt',question?.prompt || '', 'maxlength="8000"', true)}${textField('Respuesta esperada / referencia','expected_answer',question?.expected_answer || '')}${selectField('Tipo','question_type',[{value:'open',label:'Respuesta abierta'},{value:'short',label:'Respuesta breve'},{value:'case',label:'Caso'}],question?.question_type || 'open')}${formField('Puntaje máximo','max_score',question?.max_score || '10','number','min="0.01" max="1000" step="0.01"',true)}${formField('Orden','position',question?.position || '1','number','min="0" step="1"')}${selectField('Rúbrica','rubric',rubrics,question?.rubric || '',false)}<input type="hidden" name="assessment" value="${escapeHtml(question?.assessment || assessmentId)}">`;
    openModal(question ? 'Editar consigna' : 'Agregar consigna', modalForm(fields), question ? 'edit-question' : 'new-question', true);
    modal.dataset.recordId = question?.id || '';
  }

  function rubricForm(rubric = null) {
    const fields = `${formField('Título','title',rubric?.title || '', 'text','maxlength="180"',true)}${selectField('Tipo de escala','scale_type',[{value:'numeric',label:'Numérica'},{value:'levels',label:'Niveles'},{value:'both',label:'Numérica y niveles'}],rubric?.scale_type || 'both')}${textField('Descripción','description',rubric?.description || '')}${textField('Criterios (uno por línea)','criteria_text',(rubric?.criteria || []).map(item => item.name).join('\n'),'placeholder="Comprensión conceptual&#10;Argumentación y evidencia"')}`;
    openModal(rubric ? 'Editar rúbrica' : 'Crear rúbrica', modalForm(fields, 'Guardar rúbrica', '<p class="muted">Para crear una rúbrica nueva se requieren entre 2 y 20 criterios. Se proponen cuatro niveles por criterio cuando la escala los incluye.</p>'), rubric ? 'edit-rubric' : 'new-rubric', true);
    modal.dataset.recordId = rubric?.id || '';
  }

  function importStudentsForm() {
    const courses = optionRows(state.data.courses.filter(item => item.active), item => item.name, false);
    openModal('Importar estudiantes', modalForm(`${selectField('Curso','course',courses,'',true)}<div class="form-field full"><label for="f-file">Archivo CSV</label><input id="f-file" name="file" type="file" accept=".csv,text/csv" required><small>Hasta 2 MB y 500 filas. El CSV debe incluir nombre; correo, teléfono y código externo son opcionales.</small></div>`, 'Importar', '<p class="muted"><a href="../plantilla-estudiantes.csv" download>Descargar plantilla CSV</a></p>'), 'import-students');
  }

  function enrollmentForm(courseId) {
    const already = state.data.enrollments.filter(item => String(item.course) === String(courseId) && item.status === 'active').map(item => String(item.student));
    const students = state.data.students.filter(item => item.active && !already.includes(String(item.id))).map(item => ({ value: item.id, label: item.name }));
    if (!students.length) { toast('No hay estudiantes activos disponibles para matricular.', 'error'); return; }
    openModal('Matricular estudiante', modalForm(`${selectField('Estudiante','student',students,'',true)}${textField('Notas','notes','')}`), 'enroll-student');
    modal.dataset.courseId = courseId;
  }

  function submissionForm() {
    const assessments = optionRows(state.data.assessments.filter(item => item.status !== 'archived'), item => item.title);
    const students = optionRows(state.data.students.filter(item => item.active), item => item.name, true);
    const fields = `${selectField('Evaluación','assessment',assessments,'',true)}${selectField('Consigna','question',[{value:'',label:'Sin asociar a una consigna'}],'',false)}${selectField('Estudiante','student',students,'',false)}${formField('Nombre si no está registrado','student_name','','text','maxlength="180"')}${textField('Respuesta en texto','answer_text','','maxlength="50000"') }<div class="form-field full"><label for="f-file">O cargar archivo (PDF, DOCX, TXT o MD)</label><input id="f-file" name="file" type="file" accept=".pdf,.docx,.txt,.md"><small>Máximo 5 MB. Se extrae el texto; no se conserva el archivo original.</small></div>`;
    openModal('Registrar entrega', modalForm(fields, 'Guardar entrega'), 'new-submission', true);
  }

  function generateQuestionsForm(id) {
    openModal('Proponer consignas con IA', modalForm(`${formField('Cantidad de consignas','count','3','number','min="1" max="5"',true)}`,'Generar propuesta'), 'generate-questions');
    modal.dataset.recordId = id;
  }

  function importReferenceForm(id) {
    openModal('Importar material de referencia', modalForm(`${selectField('Acción','mode',[{value:'replace',label:'Reemplazar material actual'},{value:'append',label:'Agregar al material actual'}],'replace') }<div class="form-field full"><label for="f-file">Archivo de referencia</label><input id="f-file" name="file" type="file" accept=".pdf,.docx,.txt,.md" required></div>`,'Importar'), 'import-reference');
    modal.dataset.recordId = id;
  }

  function newRubricCriterionForm(rubricId) {
    openModal('Agregar criterio', modalForm(`${formField('Nombre','name','','text','maxlength="180"',true)}${formField('Puntaje máximo','max_score','10','number','min="0.01" max="1000" step="0.01"',true)}${formField('Ponderación (%)','weight','1','number','min="0" max="100" step="0.01"')}${textField('Descripción','description','')}`), 'new-criterion');
    modal.dataset.rubricId = rubricId;
  }

  function editCriterionForm(criterion) {
    openModal('Editar criterio', modalForm(`${formField('Nombre','name',criterion.name,'text','maxlength="180"',true)}${formField('Puntaje máximo','max_score',criterion.max_score,'number','min="0.01" max="1000" step="0.01"',true)}${formField('Ponderación (%)','weight',criterion.weight,'number','min="0" max="100" step="0.01"')}${textField('Descripción','description',criterion.description || '')}`), 'edit-criterion');
    modal.dataset.recordId = criterion.id;
  }

  function editLevelForm(level) {
    openModal('Editar nivel', modalForm(`${formField('Nombre','name',level.name,'text','maxlength="120"',true)}${formField('Puntaje','score',level.score,'number','min="0" max="1000" step="0.01"',true)}${textField('Descripción','description',level.description || '')}`), 'edit-level');
    modal.dataset.recordId = level.id;
  }

  function newLevelForm(criterionId, maxScore) {
    openModal('Agregar nivel', modalForm(`${formField('Nombre','name','','text','maxlength="120"',true)}${formField('Puntaje','score','0','number',`min="0" max="${Number(maxScore)}" step="0.01"`,true)}${textField('Descripción','description','')}`), 'new-level');
    modal.dataset.criterionId = criterionId;
  }

  async function loadCorrectionForSubmission(submissionId) {
    const summary = state.data.corrections.find(item => String(item.submission) === String(submissionId));
    if (!summary) return null;
    return api.get(`corrections/${summary.id}/`);
  }

  async function openSubmission(id) {
    const submission = await api.get(`submissions/${id}/`);
    state.currentSubmission = submission;
    try { state.assessmentEditor = await loadAssessmentEditor(submission.assessment); } catch { state.assessmentEditor = null; }
    state.selectedSubmission = id;
    state.correctionOrigin = 'submissions';
    const correction = await loadCorrectionForSubmission(id);
    if (correction) {
      state.currentCorrection = correction;
      state.selectedCorrection = correction.id;
      state.view = 'correction';
    } else {
      state.currentCorrection = null;
      state.view = 'submission';
    }
    render();
  }

  async function openCorrection(id) {
    state.correctionOrigin = state.view === 'corrections' ? 'corrections' : 'submissions';
    const correction = await api.get(`corrections/${id}/`);
    state.currentCorrection = correction;
    state.selectedCorrection = id;
    if (!state.currentSubmission || String(state.currentSubmission.id) !== String(correction.submission)) {
      state.currentSubmission = await api.get(`submissions/${correction.submission}/`);
      state.selectedSubmission = correction.submission;
    }
    state.view = 'correction'; render();
  }

  async function afterWrite(message, keys = []) {
    toast(message);
    await refreshCore();
    if (state.profile && ['admin', 'superadmin'].includes(state.profile.role) && (keys.includes('admin') || state.view === 'admin')) await refreshAdmin();
    else if (['institution', 'institution-memberships'].includes(state.view)) await refreshInstitutionScope();
    if (state.view === 'course') state.view = 'course';
    if (state.view === 'assessment') {
      try { state.assessmentEditor = await loadAssessmentEditor(state.selectedAssessment); } catch (error) { toast(errorText(error), 'error'); }
    }
    if (state.view === 'correction' && state.selectedCorrection) {
      try { state.currentCorrection = await api.get(`corrections/${state.selectedCorrection}/`); } catch (error) { toast(errorText(error), 'error'); }
    }
    render();
  }

  async function handleModalSubmit(form, button) {
    if (state.modalBusy || !form.reportValidity()) return;
    const kind = state.modalKind;
    const values = formValues(form);
    try {
      state.modalBusy = true;
      if (button) { button.disabled = true; button.textContent = 'Guardando…'; }
      setModalError('');
      if (kind === 'new-course' || kind === 'edit-course') {
        const payload = { name: values.name.trim(), subject: values.subject.trim(), level: values.level.trim(), academic_year: values.academic_year.trim(), description: values.description.trim(), active: values.active === 'true' };
        if (kind === 'new-course') await api.post('courses/', payload);
        else await api.patch(`courses/${modal.dataset.recordId}/`, payload);
        closeModal(true); await afterWrite(kind === 'new-course' ? 'Curso creado.' : 'Curso actualizado.');
      } else if (kind === 'new-student' || kind === 'edit-student') {
        const payload = { name: values.name.trim(), email: values.email.trim(), phone: values.phone.trim(), external_code: values.external_code.trim() };
        if (kind === 'new-student') { payload.course = Number(values.course); await api.post('students/', payload); }
        else { payload.active = values.active === 'true'; await api.patch(`students/${modal.dataset.recordId}/`, payload); }
        closeModal(true); await afterWrite(kind === 'new-student' ? 'Estudiante agregado y matriculado.' : 'Estudiante actualizado.');
      } else if (kind === 'new-assessment' || kind === 'edit-assessment') {
        const payload = { title: values.title.trim(), course: values.course ? Number(values.course) : null, subject: values.subject.trim(), level: values.level.trim(), status: values.status, objectives: values.objectives.trim(), instructions: values.instructions.trim(), reference_material: values.reference_material.trim() };
        if (kind === 'new-assessment') await api.post('assessments/', payload);
        else await api.patch(`assessments/${modal.dataset.recordId}/`, payload);
        closeModal(true); await afterWrite(kind === 'new-assessment' ? 'Evaluación creada.' : 'Evaluación actualizada.');
      } else if (kind === 'new-question' || kind === 'edit-question') {
        const payload = { prompt: values.prompt.trim(), expected_answer: values.expected_answer.trim(), question_type: values.question_type, max_score: Number(values.max_score), position: Number(values.position || 0), assessment: Number(values.assessment), rubric: values.rubric ? Number(values.rubric) : null };
        if (kind === 'new-question') await api.post('questions/', payload);
        else await api.patch(`questions/${modal.dataset.recordId}/`, payload);
        closeModal(true); state.assessmentEditor = await loadAssessmentEditor(payload.assessment); await afterWrite(kind === 'new-question' ? 'Consigna creada.' : 'Consigna actualizada.');
      } else if (kind === 'new-rubric' || kind === 'edit-rubric') {
        const payload = { title: values.title.trim(), description: values.description.trim(), scale_type: values.scale_type };
        if (kind === 'edit-rubric') {
          await api.patch(`rubrics/${modal.dataset.recordId}/`, payload);
        } else {
          const names = values.criteria_text.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
          if (names.length < 2 || names.length > 20) throw new Error('Ingresá entre 2 y 20 criterios, uno por línea.');
          payload.criteria = names.map(name => ({ name, description: '', max_score: 10, weight: Math.round(100 / names.length * 100) / 100 }));
          await api.post('rubrics/create-with-criteria/', payload);
        }
        closeModal(true); await afterWrite(kind === 'new-rubric' ? 'Rúbrica creada.' : 'Rúbrica actualizada.');
      } else if (kind === 'import-students') {
        const file = form.querySelector('[name="file"]')?.files?.[0];
        if (!file) throw new Error('Seleccioná un archivo CSV.');
        const payload = new FormData(); payload.append('file', file); payload.append('course', values.course);
        const result = await api.upload('students/import-csv/', payload);
        closeModal(true); await afterWrite(`Importación finalizada: ${result.created ?? result.created_count ?? 'registros procesados'}.`);
      } else if (kind === 'enroll-student') {
        await api.post('enrollments/', { course: Number(modal.dataset.courseId), student: Number(values.student), status: 'active', notes: values.notes.trim() });
        closeModal(true); await afterWrite('Estudiante matriculado.');
      } else if (kind === 'new-submission') {
        const file = form.querySelector('[name="file"]')?.files?.[0];
        if (file) {
          const payload = new FormData(); payload.append('file', file); payload.append('assessment', values.assessment);
          if (values.student) payload.append('student', values.student);
          if (values.student_name.trim()) payload.append('student_name', values.student_name.trim());
          if (values.question) payload.append('question', values.question);
          await api.upload('submissions/import-file/', payload);
        } else {
          if (!values.answer_text.trim()) throw new Error('Ingresá una respuesta o seleccioná un archivo.');
          await api.post('submissions/', { assessment: Number(values.assessment), question: values.question ? Number(values.question) : null, student: values.student ? Number(values.student) : null, student_name: values.student_name.trim(), answer_text: values.answer_text.trim(), source_type: 'text' });
        }
        closeModal(true); await afterWrite('Entrega registrada.');
      } else if (kind === 'generate-questions') {
        const result = await api.post(`assessments/${modal.dataset.recordId}/generate-questions/`, { count: Number(values.count) });
        state.questionProposal = { assessmentId: Number(modal.dataset.recordId), result };
        closeModal(true); showQuestionProposal(result, Number(modal.dataset.recordId));
      } else if (kind === 'import-reference') {
        const file = form.querySelector('[name="file"]')?.files?.[0];
        if (!file) throw new Error('Seleccioná un archivo.');
        const payload = new FormData(); payload.append('file', file); payload.append('mode', values.mode);
        const result = await api.upload(`assessments/${modal.dataset.recordId}/import-reference/`, payload);
        closeModal(true); toast(`Material importado: ${result.chars} caracteres extraídos.`); state.assessmentEditor = await loadAssessmentEditor(Number(modal.dataset.recordId)); render();
      } else if (kind === 'generate-rubric') {
        const result = await api.post('rubrics/generate/', {
          title: values.title.trim(), subject: values.subject.trim(), level: values.level.trim(),
          count: Number(values.count), objectives: values.objectives.trim(), instructions: values.instructions.trim(),
          question_prompts: values.question_prompts.split(/\r?\n/).map(item => item.trim()).filter(Boolean).slice(0, 10),
          reference_material: values.reference_material.trim()
        }, { timeoutMs: 180000 });
        closeModal(true); showRubricProposal(result);
      } else if (kind === 'save-rubric-proposal') {
        const criteriaCount = Number(modal.dataset.criteriaCount || 0);
        const proposal = state.rubricProposal;
        const criteria = (proposal?.criteria || []).slice(0, criteriaCount).map((item, index) => ({
          name: String(form.querySelector(`[name=\"criterion-${index}\"]`)?.value || item.name || '').trim(),
          description: String(form.querySelector(`[name="criterion-description-${index}"]`)?.value ?? item.description ?? '').trim(), max_score: Number(form.querySelector(`[name="criterion-score-${index}"]`)?.value ?? item.max_score ?? 10), weight: Number(form.querySelector(`[name="criterion-weight-${index}"]`)?.value ?? item.weight ?? 1)
        })).filter(item => item.name);
        if (criteria.length < 2) throw new Error('La rúbrica debe contener al menos dos criterios.');
        if (criteria.some(item => !Number.isFinite(item.max_score) || item.max_score < 0.5 || item.max_score > 1000 || !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 100)) throw new Error('Revisá los puntajes máximos y las ponderaciones de los criterios.');
        await api.post('rubrics/create-with-criteria/', {
          title: values.title.trim(), description: values.description.trim(), scale_type: values.scale_type || 'both', criteria
        });
        closeModal(true); await afterWrite('Rúbrica propuesta guardada.');
      } else if (kind === 'new-criterion') {
        const existingRubric = state.data.rubrics.find(item => String(item.id) === String(modal.dataset.rubricId));
        await api.post('rubric-criteria/', { rubric: Number(modal.dataset.rubricId), name: values.name.trim(), max_score: Number(values.max_score), weight: Number(values.weight || 1), description: values.description.trim(), position: (existingRubric?.criteria?.length || 0) + 1 });
        closeModal(true); await afterWrite('Criterio agregado.');
      } else if (kind === 'edit-criterion') {
        await api.patch(`rubric-criteria/${modal.dataset.recordId}/`, { name: values.name.trim(), max_score: Number(values.max_score), weight: Number(values.weight || 0), description: values.description.trim() });
        closeModal(true); await afterWrite('Criterio actualizado.');
      } else if (kind === 'new-level') {
        await api.post('rubric-levels/', { criterion: Number(modal.dataset.criterionId), name: values.name.trim(), score: Number(values.score), description: values.description.trim(), position: 1 });
        closeModal(true); await afterWrite('Nivel agregado.');
      } else if (kind === 'edit-level') {
        await api.patch(`rubric-levels/${modal.dataset.recordId}/`, { name: values.name.trim(), score: Number(values.score), description: values.description.trim() });
        closeModal(true); await afterWrite('Nivel actualizado.');
      } else if (kind === 'new-admin-user' || kind === 'edit-admin-user') {
        const payload = { email: values.email.trim(), full_name: values.full_name.trim(), role: values.role, status: values.status, suspension_reason: values.suspension_reason.trim() };
        if (kind === 'new-admin-user') { payload.user_id = values.user_id.trim(); await api.post('admin/users/', payload); }
        else await api.patch(`admin/users/${modal.dataset.recordId}/`, payload);
        closeModal(true); await afterWrite('Perfil actualizado.', ['admin']);
      } else if (kind === 'new-institution' || kind === 'edit-institution' || kind === 'edit-institution-scope') {
        const payload = kind === 'edit-institution-scope'
          ? { name: values.name.trim(), contact_email: values.contact_email.trim() }
          : { name: values.name.trim(), slug: values.slug.trim(), contact_email: values.contact_email.trim(), status: values.status };
        if (kind === 'new-institution') await api.post('admin/institutions/', payload);
        else await api.patch(`admin/institutions/${modal.dataset.recordId}/`, payload);
        closeModal(true); await afterWrite('Institución guardada.', ['admin']);
      } else if (kind === 'new-membership' || kind === 'edit-membership') {
        if (kind === 'new-membership') {
          await api.post('admin/institution-memberships/', { institution: Number(values.institution), user_id: values.user_id.trim(), role: values.role, status: values.status });
        } else {
          await api.patch(`admin/institution-memberships/${modal.dataset.recordId}/`, { role: values.role, status: values.status });
        }
        closeModal(true); await afterWrite('Membresía guardada.', ['admin']);
      } else if (kind === 'edit-message') {
        const payload = { status: values.status, assigned_to: values.assigned_to || null, internal_notes: values.internal_notes.trim() };
        await api.patch(`admin/contact-messages/${modal.dataset.recordId}/`, payload);
        closeModal(true); await afterWrite('Mensaje actualizado.', ['admin']);
      } else if (kind === 'new-provider' || kind === 'edit-provider') {
        const payload = { provider: values.provider, model_name: values.model_name.trim(), enabled: values.enabled === 'true', priority: Number(values.priority), timeout_seconds: Number(values.timeout_seconds), input_usd_per_1k_tokens: values.input_usd_per_1k_tokens === '' ? null : Number(values.input_usd_per_1k_tokens), output_usd_per_1k_tokens: values.output_usd_per_1k_tokens === '' ? null : Number(values.output_usd_per_1k_tokens) };
        if (kind === 'new-provider') await api.post('admin/ai-providers/', payload);
        else await api.patch(`admin/ai-providers/${modal.dataset.recordId}/`, payload);
        closeModal(true); await afterWrite('Configuración de proveedor guardada.', ['admin']);
      } else {
        throw new Error('La acción solicitada no está disponible.');
      }
    } catch (error) {
      setModalError(errorText(error));
      state.modalBusy = false;
      if (button) { button.disabled = false; button.textContent = 'Guardar'; }
    }
  }

  function showQuestionProposal(result, assessmentId) {
    const questions = Array.isArray(result?.questions) ? result.questions : [];
    if (!questions.length) { toast('El proveedor no devolvió consignas para revisar.', 'error'); return; }
    const items = questions.map((question, index) => `<label class="proposal-item"><input type="checkbox" name="selected" value="${index}" checked><span><strong>Consigna ${index + 1}</strong><br>${escapeHtml(question.prompt || question.question || '')}</span></label>`).join('');
    openModal('Revisar consignas propuestas', `<form id="proposal-questions-form"><p>${result.demo ? 'La propuesta proviene del modo MOCK; revisala cuidadosamente antes de incorporarla.' : 'Seleccioná las consignas que querés incorporar a la evaluación.'}</p>${items}<div class="form-error" id="modal-error" role="alert"></div><div class="modal-actions"><button type="button" class="btn btn-secondary" data-close-modal>Descartar</button><button type="submit" class="btn btn-primary">Guardar consignas seleccionadas</button></div></form>`, 'save-question-proposal', true);
    modal.dataset.assessmentId = assessmentId;
    state.questionProposal = { assessmentId, result };
  }

  async function handleQuestionProposal(form, button) {
    const selected = new FormData(form).getAll('selected').map(Number);
    const result = state.questionProposal?.result;
    const questions = (result?.questions || []).filter((_, index) => selected.includes(index));
    if (!questions.length) { setModalError('Seleccioná al menos una consigna.'); return; }
    try {
      button.disabled = true;
      for (let index = 0; index < questions.length; index += 1) {
        const item = questions[index];
        await api.post('questions/', {
          assessment: Number(state.questionProposal.assessmentId), prompt: String(item.prompt || item.question || '').trim(),
          expected_answer: String(item.expected_answer || ''), question_type: ['open','short','case'].includes(item.question_type) ? item.question_type : 'open',
          max_score: Number(item.max_score || 10), position: Number(item.position || index + 1), rubric: item.rubric_id ? Number(item.rubric_id) : null
        });
      }
      const id = state.questionProposal.assessmentId;
      closeModal(true); state.assessmentEditor = await loadAssessmentEditor(id); await refreshCore(); state.view = 'assessment'; state.selectedAssessment = id; render(); toast('Consignas seleccionadas guardadas.');
    } catch (error) { setModalError(errorText(error)); button.disabled = false; }
  }

  function showRubricProposal(result) {
    const criteria = Array.isArray(result?.criteria) ? result.criteria : [];
    if (!criteria.length) { toast('El proveedor no devolvió criterios.', 'error'); return; }
    state.rubricProposal = result;
    const fields = `${formField('Título','title',result.rubric_title || 'Rúbrica sugerida','text','maxlength="180"',true)}${selectField('Tipo de escala','scale_type',[{value:'numeric',label:'Numérica'},{value:'levels',label:'Niveles'},{value:'both',label:'Numérica y niveles'}],'both')}${textField('Descripción','description',result.description || '')}<div class="form-field full"><label>Criterios sugeridos (podés editarlos antes de guardar)</label>${criteria.map((item, index) => `<fieldset class="proposal-criterion"><legend>Criterio ${index + 1}</legend><div class="form-grid"><div class="form-field full"><label for="criterion-name-${index}">Nombre</label><input id="criterion-name-${index}" type="text" name="criterion-${index}" value="${escapeHtml(item.name || '')}" required maxlength="180"></div><div class="form-field full"><label for="criterion-description-${index}">Descripción</label><textarea id="criterion-description-${index}" name="criterion-description-${index}">${escapeHtml(item.description || '')}</textarea></div><div class="form-field"><label for="criterion-score-${index}">Puntaje máximo</label><input id="criterion-score-${index}" type="number" name="criterion-score-${index}" min="0.5" max="1000" step="0.5" value="${escapeHtml(item.max_score ?? 10)}" required></div><div class="form-field"><label for="criterion-weight-${index}">Ponderación (%)</label><input id="criterion-weight-${index}" type="number" name="criterion-weight-${index}" min="0" max="100" step="0.1" value="${escapeHtml(item.weight ?? 1)}" required></div></div></fieldset>`).join('')}</div>`;
    openModal('Revisar rúbrica propuesta', modalForm(fields, 'Guardar rúbrica'), 'save-rubric-proposal', true);
    modal.dataset.criteriaCount = String(criteria.length);
    const notice = document.createElement('p'); notice.className = 'notice'; notice.textContent = result.demo ? 'Modo MOCK: esta propuesta es orientativa y debe adaptarse antes de usarla.' : 'Revisá y adaptá los criterios antes de guardarlos.';
    modalContent.querySelector('form')?.prepend(notice);
  }

  async function generateRubric(assessmentId = null) {
    let assessment = null;
    let questions = [];
    if (assessmentId) {
      const payload = state.assessmentEditor?.assessment?.id === Number(assessmentId) ? state.assessmentEditor : await loadAssessmentEditor(assessmentId);
      assessment = payload?.assessment || state.data.assessments.find(item => String(item.id) === String(assessmentId));
      questions = payload?.questions || [];
    }
    const fields = `${formField('Título de la rúbrica','title',assessment ? `${assessment.title} · Rúbrica` : '','text','maxlength="180"',true)}${formField('Materia','subject',assessment?.subject || assessment?.course_name || '','text','maxlength="120"')}${formField('Nivel','level',assessment?.level || '','text','maxlength="120"')}${formField('Cantidad de criterios','count','4','number','min="2" max="6"',true)}${textField('Objetivos','objectives',assessment?.objectives || '')}${textField('Instrucciones','instructions',assessment?.instructions || '')}${textField('Consignas relacionadas (una por línea)','question_prompts',questions.slice(0, 10).map(item => item.prompt).join('\n'))}${textField('Material de referencia','reference_material',assessment?.reference_material || '')}`;
    openModal(assessment ? 'Proponer rúbrica para la evaluación' : 'Generar una rúbrica', modalForm(fields, 'Generar propuesta'), 'generate-rubric', true);
  }

  async function handleGenerateCorrection(form, button) {
    const values = formValues(form);
    try {
      button.disabled = true; button.textContent = 'Generando…';
      const result = await api.post(`submissions/${state.currentSubmission.id}/generate-correction/`, { rubric_id: values.rubric_id ? Number(values.rubric_id) : null, feedback_style: values.feedback_style || state.feedbackStyle || 'constructivo' }, { timeoutMs: 180000 });
      state.currentCorrection = result; state.selectedCorrection = result.id; state.view = 'correction';
      await refreshCore(); render();
      toast(result.proposal?.demo ? 'Se generó una propuesta de demostración. No puede aprobarse como calificación.' : 'Propuesta generada. Revisá todos sus criterios.');
    } catch (error) { toast(errorText(error), 'error'); button.disabled = false; button.textContent = 'Generar propuesta de corrección'; }
  }

  async function handleApproveCorrection(form, button) {
    const correction = state.currentCorrection;
    const proposal = correction?.proposal;
    if (!correction || proposal?.demo) return;
    const criteria = Array.isArray(proposal?.criteria) ? proposal.criteria : [];
    const finalCriteria = criteria.map((item, index) => ({
      ...item,
      score: Number(form.querySelector(`[name="score-${index}"]`)?.value),
      level: form.querySelector(`[name="level-${index}"]`)?.value || '',
      justification: form.querySelector(`[name="justification-${index}"]`)?.value || '',
      evidence: form.querySelector(`[name="evidence-${index}"]`)?.value || ''
    }));
    const changed = finalCriteria.some((item, index) => Number(item.score) !== Number(criteria[index].score));
    const changeReason = form.querySelector('[name="change_reason"]')?.value?.trim() || '';
    if (changed && changeReason.length < 8) { toast('Explicá el motivo del cambio de puntaje (al menos 8 caracteres).', 'error'); return; }
    if (!window.confirm('¿Confirmás la aprobación de esta devolución? La operación registra una revisión y no se puede deshacer desde esta pantalla.')) return;
    try {
      button.disabled = true; button.textContent = 'Aprobando…';
      const result = await api.post(`corrections/${correction.id}/approve/`, { final_result: { ...proposal, criteria: finalCriteria }, teacher_feedback: form.querySelector('[name="teacher_feedback"]')?.value || '', change_reason: changeReason }, { timeoutMs: 90000 });
      state.currentCorrection = result; await refreshCore(); state.currentCorrection = await api.get(`corrections/${correction.id}/`); render(); toast('Devolución aprobada y registrada.');
    } catch (error) { toast(errorText(error), 'error'); button.disabled = false; button.textContent = 'Aprobar devolución'; }
  }

  function adminUserForm(user = null) {
    const fields = `${user ? '' : formField('UUID de usuario existente en Supabase Auth','user_id','','text','required placeholder="UUID de auth.users"',true)}${formField('Correo','email',user?.email || '', 'email','maxlength="254"',true)}${formField('Nombre completo','full_name',user?.full_name || '', 'text','maxlength="180"',true)}${selectField('Rol global','role',[{value:'teacher',label:'Docente'},{value:'student',label:'Estudiante'},{value:'admin',label:'Administrador'},{value:'superadmin',label:'Superadministrador'}],user?.role || 'teacher')}${selectField('Estado','status',[{value:'active',label:'Activo'},{value:'suspended',label:'Suspendido'},{value:'deleted',label:'Eliminado'}],user?.status || 'active')}${textField('Motivo de suspensión','suspension_reason',user?.suspension_reason || '')}`;
    openModal(user ? 'Editar perfil' : 'Crear perfil de identidad existente', modalForm(fields), user ? 'edit-admin-user' : 'new-admin-user', true);
    modal.dataset.recordId = user?.id || '';
  }

  function institutionForm(item = null, scoped = false) {
    const fields = scoped
      ? `${formField('Nombre','name',item?.name || '', 'text','maxlength="180"',true)}${formField('Correo de contacto','contact_email',item?.contact_email || '', 'email','maxlength="254"')}`
      : `${formField('Nombre','name',item?.name || '', 'text','maxlength="180"',true)}${formField('Slug','slug',item?.slug || '', 'text','maxlength="120"',true)}${formField('Correo de contacto','contact_email',item?.contact_email || '', 'email','maxlength="254"')}${selectField('Estado','status',[{value:'active',label:'Activa'},{value:'suspended',label:'Suspendida'},{value:'archived',label:'Archivada'}],item?.status || 'active')}`;
    openModal(item ? 'Editar institución' : 'Crear institución', modalForm(fields), scoped ? 'edit-institution-scope' : item ? 'edit-institution' : 'new-institution');
    modal.dataset.recordId = item?.id || '';
  }

  function membershipForm(item = null, defaultInstitution = '') {
    const institutions = optionRows(state.data.admin.institutions.filter(row => row.status === 'active'), row => row.name);
    const globalAdmin = ['admin', 'superadmin'].includes(state.profile?.role);
    const roles = [{value:'teacher',label:'Docente'},{value:'department_admin',label:'Administrador de departamento'}, ...(globalAdmin ? [{value:'institution_admin',label:'Administrador institucional'}] : [])];
    const fields = `${selectField('Institución','institution',institutions,item?.institution || defaultInstitution || '',true)}${formField('UUID de usuario existente','user_id',item?.user_id || '', 'text',`placeholder="UUID auth.users" ${item ? 'disabled' : ''}`,true)}${selectField('Rol institucional','role',roles,item?.role || 'teacher')}${selectField('Estado','status',[{value:'invited',label:'Invitada'},{value:'active',label:'Activa'},{value:'suspended',label:'Suspendida'}],item?.status || 'active')}`;
    openModal(item ? 'Editar membresía' : 'Agregar membresía', modalForm(fields), item ? 'edit-membership' : 'new-membership');
    modal.dataset.recordId = item?.id || '';
  }

  function messageForm(item) {
    const admins = state.data.admin.users.filter(user => ['admin','superadmin'].includes(user.role) && user.status === 'active').map(user => ({ value: user.user_id, label: `${user.full_name || user.email} (${user.email})` }));
    openModal('Gestionar mensaje de contacto', modalForm(`${formField('Remitente','name',item.name,'text','disabled')}${formField('Correo','email',item.email,'email','disabled')}${formField('Asunto','subject',item.subject,'text','disabled')}${textField('Mensaje','message',item.message,'disabled')}${selectField('Estado','status',[{value:'new',label:'Nuevo'},{value:'in_progress',label:'En gestión'},{value:'handled',label:'Atendido'},{value:'spam',label:'Spam'}],item.status)}${selectField('Responsable','assigned_to',optionRows(admins, user => user.label, true),item.assigned_to || '')}${textField('Notas internas (sólo administración)','internal_notes',item.internal_notes || '')}`), 'edit-message', true);
    modal.dataset.recordId = item.id;
  }

  function providerForm(item = null) {
    const fields = `${selectField('Proveedor','provider',[{value:'mock',label:'Mock'},{value:'gemini',label:'Gemini'},{value:'openai',label:'OpenAI'},{value:'ollama',label:'Ollama'}],item?.provider || 'mock')}${formField('Modelo','model_name',item?.model_name || '', 'text','maxlength="120"')}${selectField('Habilitado','enabled',[{value:'true',label:'Sí'},{value:'false',label:'No'}],String(Boolean(item?.enabled)))}${formField('Prioridad','priority',item?.priority ?? 10,'number','min="-32768" max="32767" step="1"')}${formField('Timeout (segundos)','timeout_seconds',item?.timeout_seconds ?? 45,'number','min="5" max="90" step="1"')}${formField('Costo entrada USD / 1k tokens','input_usd_per_1k_tokens',item?.input_usd_per_1k_tokens ?? '', 'number','min="0" step="0.000001"')}${formField('Costo salida USD / 1k tokens','output_usd_per_1k_tokens',item?.output_usd_per_1k_tokens ?? '', 'number','min="0" step="0.000001"')}`;
    openModal(item ? 'Editar proveedor IA' : 'Configurar proveedor IA', modalForm(fields, 'Guardar proveedor'), item ? 'edit-provider' : 'new-provider', true);
    modal.dataset.recordId = item?.id || '';
  }

  async function handleAddSubmissionAnswer(form) {
    if (!form.reportValidity()) return;
    const values = formValues(form);
    const button = form.querySelector('[type="submit"]');
    if (button?.disabled) return;
    if (button) { button.disabled = true; button.textContent = 'Guardando…'; }
    try {
      await api.post('submission-answers/', { submission: Number(state.currentSubmission.id), question: Number(values.question), answer_text: values.answer_text.trim() });
      state.currentSubmission = await api.get(`submissions/${state.currentSubmission.id}/`);
      await refreshCore(); render(); toast('Respuesta agregada a la entrega.');
    } catch (error) { toast(errorText(error), 'error'); if (button) { button.disabled = false; button.textContent = 'Agregar respuesta'; } }
  }

  function correctionShareText() {
    const correction = state.currentCorrection;
    if (!correction) return '';
    const result = correction.status === 'approved' ? correction.final_result : correction.proposal;
    const lines = [
      `Devolución — ${correction.submission_title || 'Evaluación'}`,
      `Estudiante: ${state.currentSubmission?.student_display_name || state.currentSubmission?.student_name || 'Estudiante'}`,
      `Estado: ${statusLabel(correction.status)}`,
      '', result?.summary || '', '',
      ...(result?.criteria || []).map(item => `${item.criterion}: ${item.score}/${item.max_score}\n${item.justification || ''}${item.evidence ? `\nEvidencia: ${item.evidence}` : ''}`),
      '', correction.teacher_feedback || result?.feedback || ''
    ];
    return lines.join('\n').trim();
  }

  async function copyCorrection() {
    const text = correctionShareText();
    if (!text) return;
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const input = document.createElement('textarea'); input.value = text; document.body.appendChild(input); input.select();
      const copied = document.execCommand('copy'); input.remove(); if (!copied) throw new Error('El navegador no permitió copiar el texto.');
    }
    toast('Devolución copiada. Revisala antes de compartirla.');
  }

  function correctionShareData() {
    const correction = state.currentCorrection;
    if (!correction || correction.status !== 'approved') return null;
    const proposal = correction.final_result || correction.proposal || {};
    const criteria = Array.isArray(proposal.criteria) ? proposal.criteria : [];
    const maxScore = criteria.reduce((sum, item) => sum + Number(item.max_score || 0), 0);
    const totalScore = Number.isFinite(Number(correction.total_score))
      ? Number(correction.total_score) : criteria.reduce((sum, item) => sum + Number(item.score || 0), 0);
    return { correction, proposal, criteria, maxScore, totalScore,
      studentName: state.currentSubmission?.student_display_name || state.currentSubmission?.student_name || 'Estudiante sin identificar',
      studentEmail: correction.student_email || state.currentSubmission?.student_email || '' };
  }

  function approvedCorrectionShareText() {
    const data = correctionShareData();
    if (!data) return '';
    const { correction, proposal, criteria, maxScore, totalScore, studentName } = data;
    const formatScore = value => Number(value).toLocaleString('es-AR', { maximumFractionDigits: 2 });
    const lines = [
      'Devolución de MaestrIA',
      `Evaluación: ${correction.submission_title || 'Evaluación'}`,
      `Estudiante: ${studentName}`,
      `Puntaje final: ${formatScore(totalScore)} / ${formatScore(maxScore)} puntos`,
      '', 'Resumen', proposal.summary?.trim() || 'Sin resumen adicional.', '', 'Criterios de evaluación',
      ...criteria.flatMap(item => [
        `• ${item.criterion || 'Criterio'}: ${formatScore(item.score || 0)} / ${formatScore(item.max_score || 0)} puntos${item.level ? ` · ${item.level}` : ''}`,
        ...(item.justification?.trim() ? [`  ${item.justification.trim()}`] : [])
      ])
    ];
    if (Array.isArray(proposal.strengths) && proposal.strengths.length) lines.push('', 'Fortalezas observadas', ...proposal.strengths.map(item => `• ${item}`));
    if (Array.isArray(proposal.improvement_suggestions) && proposal.improvement_suggestions.length) lines.push('', 'Próximos pasos sugeridos', ...proposal.improvement_suggestions.map(item => `• ${item}`));
    const feedback = correction.teacher_feedback?.trim() || proposal.feedback?.trim();
    if (feedback) lines.push('', 'Retroalimentación', feedback);
    lines.push('', 'La calificación final fue revisada y aprobada por el docente.');
    return lines.join('\n');
  }

  function openCorrectionShareModal() {
    const data = correctionShareData();
    if (!data) { toast('Sólo se pueden compartir devoluciones aprobadas.', 'error'); return; }
    const possibleScore = data.maxScore.toLocaleString('es-AR', { maximumFractionDigits: 2 });
    const totalScore = data.totalScore.toLocaleString('es-AR', { maximumFractionDigits: 2 });
    const body = `<div class="correction-share-content"><p class="eyebrow">DEVOLUCIÓN APROBADA</p><h3>${escapeHtml(data.studentName)} · ${escapeHtml(data.correction.submission_title || 'Evaluación')}</h3><div class="correction-share-score"><span>Puntaje final</span><strong>${escapeHtml(totalScore)} <small>/ ${escapeHtml(possibleScore)} puntos</small></strong></div><p class="muted">MaestrIA prepara el contenido, pero no envía mensajes automáticamente.</p><div class="form-field full"><label for="correction-share-email">Correo del estudiante (opcional)</label><input id="correction-share-email" type="email" autocomplete="email" value="${escapeHtml(data.studentEmail)}" placeholder="estudiante@ejemplo.com"></div><p id="correction-share-error" class="form-error" role="alert"></p><p id="correction-share-notice" class="form-success" role="status" aria-live="polite"></p><div class="modal-actions correction-share-actions"><button class="btn btn-primary" type="button" data-share-action="email">Preparar correo</button><button class="btn btn-secondary" type="button" data-share-action="whatsapp">Abrir WhatsApp</button><button class="btn btn-secondary" type="button" data-share-action="print">Imprimir / PDF</button><button class="btn btn-secondary" type="button" data-share-action="copy">Copiar devolución</button></div><p class="field-hint">Verificá el destinatario y el contenido antes de confirmar el envío desde tu aplicación.</p></div>`;
    openModal('Compartir o guardar', body, 'share-correction', true);
    window.setTimeout(() => $('#correction-share-email')?.focus(), 50);
  }

  async function handleShareAction(action) {
    const errorNode = $('#correction-share-error'); const notice = $('#correction-share-notice');
    if (errorNode) errorNode.textContent = ''; if (notice) notice.textContent = '';
    const data = correctionShareData(); const text = approvedCorrectionShareText();
    if (!data || !text) { if (errorNode) errorNode.textContent = 'La devolución ya no está disponible para compartir.'; return; }
    if (action === 'email') {
      const email = String($('#correction-share-email')?.value || '').trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { if (errorNode) errorNode.textContent = 'Revisá el correo ingresado o dejalo vacío para completar el destinatario en tu aplicación.'; return; }
      const recipient = email ? email.split('@').map((part, index) => index === 0 ? encodeURIComponent(part) : encodeURIComponent(part)).join('@') : '';
      window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(`Devolución de evaluación: ${data.correction.submission_title || 'MaestrIA'}`)}&body=${encodeURIComponent(text)}`;
      if (notice) notice.textContent = 'Se solicitó abrir un borrador de correo. Revisá el destinatario y confirmá el envío desde tu aplicación.';
    } else if (action === 'whatsapp') {
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
      if (notice) notice.textContent = 'WhatsApp se abrió con el texto preparado. Elegí el destinatario y confirmá el envío allí.';
    } else if (action === 'copy') {
      try { await navigator.clipboard.writeText(text); if (notice) notice.textContent = 'Devolución copiada.'; }
      catch { if (errorNode) errorNode.textContent = 'El navegador no permitió copiar automáticamente. Habilitá el permiso del portapapeles o usá correo/WhatsApp.'; }
    } else if (action === 'print') {
      closeModal(true); window.print();
    }
  }

  async function clickAction(button) {
    const action = button.dataset.action;
    const id = button.dataset.id;
    try {
      switch (action) {
        case 'navigate': navigate(button.dataset.view); break;
        case 'seed-demo': {
          if (!window.confirm('Se creará un conjunto de práctica con datos ficticios, claramente identificados y sin información de estudiantes reales. ¿Continuar?')) break;
          const result = await api.post('demo/seed/', {}); await refreshCore(); state.selectedCourse = result.course_id; state.selectedAssessment = result.assessment_id; state.view = 'assessment'; state.assessmentEditor = await loadAssessmentEditor(result.assessment_id); render(); toast(result.message || 'Ejemplo de práctica disponible.'); break;
        }
        case 'new-course': courseForm(); break;
        case 'edit-course': courseForm(state.data.courses.find(item => String(item.id) === String(id))); break;
        case 'open-course': state.selectedCourse = id; navigate('course'); break;
        case 'open-course-corrections': state.correctionsCourseFilter = id; state.correctionsStatusFilter = 'all'; navigate('corrections'); break;
        case 'toggle-course': {
          const item = state.data.courses.find(row => String(row.id) === String(id));
          if (!item || !window.confirm(item.active ? '¿Archivar este curso? Se conservarán sus registros.' : '¿Reactivar este curso?')) break;
          await api.patch(`courses/${id}/`, { active: !item.active }); await afterWrite(item.active ? 'Curso archivado.' : 'Curso reactivado.'); break;
        }
        case 'new-student': studentForm(); break;
        case 'edit-student': studentForm(state.data.students.find(item => String(item.id) === String(id))); break;
        case 'toggle-student': {
          const item = state.data.students.find(row => String(row.id) === String(id));
          if (!item || !window.confirm(item.active ? '¿Desactivar a este estudiante?' : '¿Reactivar a este estudiante?')) break;
          await api.patch(`students/${id}/`, { active: !item.active }); await afterWrite(item.active ? 'Estudiante desactivado.' : 'Estudiante reactivado.'); break;
        }
        case 'import-students': importStudentsForm(); break;
        case 'enroll-student': enrollmentForm(button.dataset.course); break;
        case 'deactivate-enrollment': if (window.confirm('¿Desmatricular a este estudiante?')) { await api.patch(`enrollments/${id}/`, { status: 'inactive' }); await afterWrite('Matrícula desactivada.'); } break;
        case 'new-assessment': state.selectedAssessment = null; assessmentForm(null, button.dataset.course || ''); break;
        case 'edit-assessment': {
          const assessment = state.data.assessments.find(item => String(item.id) === String(id));
          const full = await api.get(`assessments/${id}/editor/`); assessmentForm({ ...assessment, ...full.assessment }); break;
        }
        case 'open-assessment': state.selectedAssessment = id; state.assessmentEditor = await loadAssessmentEditor(id); state.view = 'assessment'; render(); break;
        case 'new-question': questionForm(null, button.dataset.assessment); break;
        case 'edit-question': {
          const question = state.assessmentEditor?.questions?.find(item => String(item.id) === String(id));
          if (question) questionForm(question); break;
        }
        case 'delete-question': if (window.confirm('¿Eliminar esta consigna?')) { await api.delete(`questions/${id}/`); state.assessmentEditor = await loadAssessmentEditor(state.selectedAssessment); await refreshCore(); state.view = 'assessment'; render(); toast('Consigna eliminada.'); } break;
        case 'generate-questions': generateQuestionsForm(id); break;
        case 'import-reference': importReferenceForm(id); break;
        case 'new-rubric': rubricForm(); break;
        case 'edit-rubric': rubricForm(state.data.rubrics.find(item => String(item.id) === String(id))); break;
        case 'open-rubric': state.selectedRubric = id; navigate('rubric'); break;
        case 'generate-rubric': await generateRubric(); break;
        case 'generate-assessment-rubric': await generateRubric(id); break;
        case 'new-criterion': newRubricCriterionForm(button.dataset.rubric); break;
        case 'edit-criterion': {
          const criterion = state.data.rubrics.flatMap(item => item.criteria || []).find(item => String(item.id) === String(id)); if (criterion) editCriterionForm(criterion); break;
        }
        case 'edit-level': {
          const level = state.data.rubrics.flatMap(item => item.criteria || []).flatMap(item => item.levels || []).find(item => String(item.id) === String(id)); if (level) editLevelForm(level); break;
        }
        case 'add-level': {
          const criterion = state.data.rubrics.flatMap(item => item.criteria || []).find(item => String(item.id) === String(button.dataset.criterion)); if (criterion) newLevelForm(criterion.id, criterion.max_score); break;
        }
        case 'new-submission': submissionForm(); break;
        case 'open-submission': await openSubmission(id); break;
        case 'return-submission': state.view = state.correctionOrigin === 'corrections' ? 'corrections' : 'submission'; render(); break;
        case 'open-correction': await openCorrection(id); break;
        case 'export-correction': await api.download(`corrections/${id}/export/`, `devolucion-maestria-${id}.md`); break;
        case 'copy-correction': await copyCorrection(); break;
        case 'share-correction': openCorrectionShareModal(); break;
        case 'email-correction': openCorrectionShareModal(); break;
        case 'whatsapp-correction': openCorrectionShareModal(); break;
        case 'print-correction': window.print(); break;
        case 'new-admin-user': adminUserForm(); break;
        case 'edit-admin-user': adminUserForm(state.data.admin.users.find(item => String(item.id) === String(id))); break;
        case 'new-institution': institutionForm(); break;
        case 'edit-institution': institutionForm(state.data.admin.institutions.find(item => String(item.id) === String(id))); break;
        case 'edit-institution-scope': institutionForm(state.data.admin.institutions.find(item => String(item.id) === String(id)), true); break;
        case 'manage-institution': state.selectedInstitution = id; state.view = 'institution-memberships'; render(); break;
        case 'new-membership': membershipForm(null, button.dataset.institution || state.selectedInstitution || ''); break;
        case 'edit-membership': membershipForm(state.data.admin.memberships.find(item => String(item.id) === String(id))); break;
        case 'suspend-membership': if (window.confirm('¿Suspender esta membresía?')) { await api.delete(`admin/institution-memberships/${id}/`); await afterWrite('Membresía suspendida.'); } break;
        case 'view-memberships': {
          const tab = $('#app-content [data-admin-tab="institutions"]'); tab?.click();
          break;
        }
        case 'edit-message': messageForm(state.data.admin.messages.find(item => String(item.id) === String(id))); break;
        case 'new-provider': providerForm(); break;
        case 'edit-provider': providerForm(state.data.admin.providers.find(item => String(item.id) === String(id))); break;
        case 'logout':
          api.clearSession(); closeModal(); window.location.replace('../acceso.html'); break;
        case 'refresh-resource':
          await refreshCore(); if (button.dataset.resource?.startsWith('admin_')) await refreshAdmin(); render(); break;
        case 'help': openQuickStart(); break;
        default: break;
      }
    } catch (error) { toast(errorText(error), 'error'); }
  }

  content?.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (button) { event.preventDefault(); clickAction(button); }
    const submissionStatus = event.target.closest('[data-submission-status]');
    if (submissionStatus) { state.submissionStatusFilter = submissionStatus.dataset.submissionStatus; render(); return; }
    const adminTab = event.target.closest('[data-admin-tab]');
    if (adminTab) {
      state.adminTab = adminTab.dataset.adminTab;
      $$('.admin-tab', content).forEach(tab => tab.classList.toggle('active', tab === adminTab));
      $$('[data-admin-section]', content).forEach(section => { section.hidden = section.dataset.adminSection !== adminTab.dataset.adminTab; });
    }
  });

  content?.addEventListener('input', event => {
    if (event.target.matches('[data-search]')) {
      state.search = event.target.value;
      const position = event.target.selectionStart;
      render();
      const next = $('[data-search]'); next?.focus(); next?.setSelectionRange(position, position);
    }
  });

  content?.addEventListener('change', async event => {
    if (event.target.matches('[data-filter="student-course"]')) { state.studentCourseFilter = event.target.value; render(); return; }
    if (event.target.matches('[data-filter="student-status"]')) { state.studentStatusFilter = event.target.value; render(); return; }
    if (event.target.matches('[data-filter="assessment-course"]')) { state.assessmentCourseFilter = event.target.value; render(); return; }
    if (event.target.matches('[data-filter="submission-course"]')) { state.submissionCourseFilter = event.target.value; render(); return; }
    if (event.target.matches('[data-filter="corrections-course"]')) { state.correctionsCourseFilter = event.target.value; render(); return; }
    if (event.target.matches('[data-filter="corrections-status"]')) { state.correctionsStatusFilter = event.target.value; render(); return; }
    if (event.target.matches('[data-filter="assessment-status"]')) { state.assessmentStatusFilter = event.target.value; render(); return; }
    if (event.target.matches('[data-admin-status="messages"], [data-admin-filter="messages"]')) {
      try {
        state.adminMessageStatus = $('[data-admin-status="messages"]')?.value || '';
        state.adminMessageSearch = $('[data-admin-filter="messages"]')?.value || '';
        const status = state.adminMessageStatus;
        const q = state.adminMessageSearch;
        const query = new URLSearchParams(); if (status) query.set('status', status); if (q.trim()) query.set('q', q.trim());
        state.data.admin.messages = await api.list(`admin/contact-messages/?${query.toString()}`);
        render();
        $('[data-admin-tab="messages"]')?.click();
      } catch (error) { toast(errorText(error), 'error'); }
    }
  });

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (form.id === 'workspace-modal-form') { event.preventDefault(); await handleModalSubmit(form, form.querySelector('[type="submit"]')); }
    else if (form.id === 'proposal-questions-form') { event.preventDefault(); await handleQuestionProposal(form, form.querySelector('[type="submit"]')); }
    else if (form.id === 'add-submission-answer-form') { event.preventDefault(); await handleAddSubmissionAnswer(form); }
    else if (form.id === 'generate-correction-form') { event.preventDefault(); await handleGenerateCorrection(form, form.querySelector('[type="submit"]')); }
    else if (form.id === 'approve-correction-form') { event.preventDefault(); await handleApproveCorrection(form, form.querySelector('[type="submit"]')); }
    else if (form.id === 'generate-rubric-form') { event.preventDefault(); }
    else if (form.id === 'profile-settings-form') { event.preventDefault(); await saveProfilePreferences(form); }
  });

  modal?.addEventListener('change', async event => {
    if (!event.target.matches('[name=\"assessment\"]')) return;
    const form = event.target.closest('form');
    if (!form || form.id !== 'workspace-modal-form') return;
    const assessmentId = event.target.value;
    const questionSelect = form.querySelector('[name=\"question\"]');
    const studentSelect = form.querySelector('[name=\"student\"]');
    if (!assessmentId) return;
    try {
      const workspace = await api.get(`correction-workspace/?assessment=${encodeURIComponent(assessmentId)}&summary=1`);
      if (questionSelect) {
        questionSelect.innerHTML = `<option value=\"\">Sin asociar a una consigna</option>${(workspace.questions || []).map(item => `<option value=\"${item.id}\">${escapeHtml(item.prompt)}</option>`).join('')}`;
      }
      if (studentSelect && Array.isArray(workspace.students)) {
        studentSelect.innerHTML = `<option value=\"\">Sin estudiante asignado</option>${workspace.students.map(item => `<option value=\"${item.id}\">${escapeHtml(item.name)}</option>`).join('')}`;
      }
    } catch (error) { toast(`No se pudieron cargar consignas/estudiantes: ${errorText(error)}`, 'error'); }
  });

  document.addEventListener('click', event => {
    const sideLink = event.target.closest('.side-link[data-view]');
    if (sideLink) { event.preventDefault(); navigate(sideLink.dataset.view); return; }
    if (event.target.closest('[data-close-modal]') || event.target.id === 'modal-close') closeModal();
    const shareAction = event.target.closest('[data-share-action]')?.dataset.shareAction;
    if (shareAction) { event.preventDefault(); handleShareAction(shareAction).catch(error => toast(errorText(error), 'error')); return; }
    const profileButton = event.target.closest('#profile-trigger, #top-profile');
    if (profileButton) $('#profile-menu').hidden = !$('#profile-menu').hidden;
    const profileAction = event.target.closest('[data-profile-action]');
    if (profileAction?.dataset.profileAction === 'profile') { $('#profile-menu').hidden = true; navigate('profile'); }
    if (profileAction?.dataset.profileAction === 'logout') { api.clearSession(); window.location.replace('../acceso.html'); }
    if (profileAction?.dataset.profileAction === 'guide') { $('#profile-menu').hidden = true; openQuickStart(); }
    if (event.target.closest('#theme-toggle, #theme-toggle-profile')) toggleTheme();
    const courseShortcut = event.target.closest('[data-open-course]');
    if (courseShortcut) { state.selectedCourse = courseShortcut.dataset.openCourse; navigate('course'); }
    if (event.target.closest('#mobile-menu-button')) openSidebar();
    if (event.target.closest('#sidebar-close') || event.target.closest('#sidebar-scrim')) closeSidebar();
    if (event.target.closest('#sidebar-collapse')) {
      const collapsed = $('.app-layout')?.classList.contains('is-sidebar-collapsed') || false;
      setSidebarCollapsed(!collapsed);
    }
    if (event.target.closest('#help-button')) openQuickStart();
  });

  document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeModal(); closeSidebar(); $('#profile-menu').hidden = true; if ($('#quickstart-root')?.innerHTML) closeQuickStart(true); } });
  window.addEventListener('maestria:session-expired', () => { api.clearSession(); window.location.replace('../acceso.html'); });
  window.addEventListener('online', () => toast('Conexión restablecida. Actualizá la vista para recuperar datos recientes.'));
  window.addEventListener('offline', () => toast('Sin conexión. Las operaciones no se guardarán hasta recuperar la conexión.', 'error'));

  const THEME_KEY = 'maestria-theme';
  function applyTheme(theme, persist = true) {
    const resolved = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = resolved;
    if (persist) { try { sessionStorage.setItem(THEME_KEY, resolved); } catch { /* Preferencia no crítica. */ } }
    const label = resolved === 'dark' ? 'Usar tema claro' : 'Usar tema oscuro';
    ['#theme-toggle', '#theme-toggle-profile'].forEach(selector => {
      const button = $(selector); if (!button) return;
      button.setAttribute('aria-pressed', String(resolved === 'dark'));
      button.setAttribute('aria-label', label);
      if (selector === '#theme-toggle-profile') { const text = $('#theme-label-profile'); if (text) text.textContent = label; }
    });
    window.dispatchEvent(new CustomEvent('maestria-theme-change', { detail: { theme: resolved } }));
  }
  function toggleTheme() { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); }

  async function saveProfilePreferences(form) {
    const errorNode = $('#profile-error'); const successNode = $('#profile-success');
    if (errorNode) errorNode.textContent = ''; if (successNode) successNode.textContent = '';
    const values = formValues(form); const cleanName = String(values.display_name || '').trim().replace(/\s+/g, ' ');
    if (cleanName.length < 2 || cleanName.length > 100) { if (errorNode) errorNode.textContent = 'Ingresá un nombre de entre 2 y 100 caracteres.'; return; }
    const feedbackStyle = ['formal', 'constructivo', 'motivador'].includes(values.feedback_style) ? values.feedback_style : 'constructivo';
    const button = form.querySelector('[type="submit"]');
    if (button) { button.disabled = true; button.textContent = 'Guardando…'; }
    try {
      const session = await api.validSession();
      if (!session?.access_token) throw new Error('La sesión expiró. Volvé a iniciar sesión.');
      const updatedUser = await api.authUserRequest('PUT', { data: { ...(session.user?.user_metadata || {}), full_name: cleanName, maestria_feedback_style: feedbackStyle } }, session.access_token);
      if (updatedUser?.id) api.setSession({ ...session, user: updatedUser });
      else api.setSession({ ...session, user: { ...(session.user || {}), user_metadata: { ...(session.user?.user_metadata || {}), full_name: cleanName, maestria_feedback_style: feedbackStyle } } });
      state.profile = { ...state.profile, full_name: cleanName };
      state.feedbackStyle = feedbackStyle;
      updateChrome();
      if (successNode) successNode.textContent = 'Preferencias guardadas en tu cuenta.';
      toast('Perfil actualizado.');
    } catch (error) {
      if (errorNode) errorNode.textContent = `No se pudieron guardar las preferencias: ${errorText(error)}`;
    } finally { if (button) { button.disabled = false; button.textContent = 'Guardar preferencias'; } }
  }

  const GUIDE_STEPS = [
    { title: 'Organizá tus cursos', body: 'Creá una materia o comisión y agregá los estudiantes correspondientes. Así mantenés organizadas las evaluaciones y entregas.', action: 'Ir a cursos', view: 'courses', tip: 'Podés importar estudiantes desde un archivo CSV.' },
    { title: 'Prepará una evaluación', body: 'Definí el objetivo, agregá consignas y guardá los cambios. Podés volver a editarla cuando lo necesites.', action: 'Ir a evaluaciones', view: 'assessments', tip: 'Las consignas propuestas por IA siempre se revisan antes de incorporarlas.' },
    { title: 'Revisá las entregas', body: 'Cargá una respuesta, elegí una rúbrica y generá una propuesta de corrección explicada.', action: 'Ir a entregas', view: 'submissions', tip: 'La IA propone; la decisión pedagógica y la aprobación son docentes.' },
    { title: 'Consultá tu historial', body: 'Encontrá las devoluciones por curso, revisá su estado y exportá las que necesites.', action: 'Ver correcciones', view: 'corrections', tip: 'Las devoluciones aprobadas se pueden compartir desde su detalle.' }
  ];
  let guideStep = 0;
  function guidePreferenceKey() { return `maestria-quickstart-complete:${state.profile?.user_id || state.profile?.email || 'teacher'}`; }
  function renderQuickStart() {
    const root = $('#quickstart-root'); if (!root) return;
    const step = GUIDE_STEPS[guideStep];
    root.innerHTML = `<div class="quickstart-backdrop" role="presentation"><section class="quickstart-dialog" role="dialog" aria-modal="true" aria-labelledby="quickstart-title" aria-describedby="quickstart-description"><div class="quickstart-topline"><span class="eyebrow">PRIMEROS PASOS CON MAESTRIA</span><button type="button" class="quickstart-close" data-guide-action="close" aria-label="Cerrar guía">×</button></div><div class="quickstart-progress" aria-label="Paso ${guideStep + 1} de ${GUIDE_STEPS.length}">${GUIDE_STEPS.map((item, index) => `<span class="${index <= guideStep ? 'is-current' : ''}"></span>`).join('')}</div><div class="quickstart-icon" aria-hidden="true">${['▣','▤','✓','≡'][guideStep]}</div><span class="quickstart-step-label">PASO ${guideStep + 1} DE ${GUIDE_STEPS.length}</span><h2 id="quickstart-title">${escapeHtml(step.title)}</h2><p id="quickstart-description">${escapeHtml(step.body)}</p><div class="quickstart-tip"><strong>Una idea útil</strong><span>${escapeHtml(step.tip)}</span></div><div class="quickstart-footer"><button type="button" class="btn btn-secondary" data-guide-action="close">Lo veo después</button><div>${guideStep > 0 ? '<button type="button" class="btn btn-secondary" data-guide-action="previous">Anterior</button>' : ''}${guideStep < GUIDE_STEPS.length - 1 ? '<button type="button" class="btn btn-primary" data-guide-action="next">Siguiente</button>' : `<button type="button" class="btn btn-primary" data-guide-action="go">${escapeHtml(step.action)}</button>`}</div></div><p class="quickstart-link-row">La guía está disponible desde el botón de ayuda.</p></section></div>`;
    root.querySelector('.quickstart-close')?.focus();
  }
  function openQuickStart() { guideStep = 0; renderQuickStart(); }
  function closeQuickStart(completed = true) {
    const root = $('#quickstart-root'); if (root) root.innerHTML = '';
    if (completed) { try { sessionStorage.setItem(guidePreferenceKey(), 'true'); } catch { /* La guía puede cerrarse aunque el navegador no guarde preferencias. */ } }
  }
  function maybeOpenQuickStart() {
    try { if (sessionStorage.getItem(guidePreferenceKey()) !== 'true') openQuickStart(); } catch { /* Sin almacenamiento, no forzamos una guía en cada render. */ }
  }

  document.addEventListener('click', event => {
    const action = event.target.closest('[data-guide-action]')?.dataset.guideAction;
    if (!action) return;
    event.preventDefault();
    if (action === 'close') closeQuickStart(true);
    if (action === 'next') { guideStep = Math.min(GUIDE_STEPS.length - 1, guideStep + 1); renderQuickStart(); }
    if (action === 'previous') { guideStep = Math.max(0, guideStep - 1); renderQuickStart(); }
    if (action === 'go') { const view = GUIDE_STEPS[guideStep].view; closeQuickStart(true); navigate(view); }
  });
  window.addEventListener('maestria:open-guide', openQuickStart);

  async function init() {
    restoreSidebarPreference();
    applyTheme(document.documentElement.dataset.theme || 'light', false);
    content.innerHTML = `<section class="panel"><div class="panel-body"><p>Conectando con MaestrIA…</p></div></section>`;
    const ok = await loadProfile();
    if (!ok) return;
    await refreshCore();
    if (['admin', 'superadmin'].includes(state.profile?.role)) await refreshAdmin();
    else await refreshInstitutionScope();
    state.loading = false;
    render();
    if (window.location.hash === '#contacto') navigate('profile');
    maybeOpenQuickStart();
  }

  init().catch(error => {
    content.innerHTML = `<section class="panel"><div class="panel-body">${emptyState('No se pudo iniciar el espacio docente', errorText(error), '<a class="btn btn-secondary" href="../acceso.html">Volver al acceso</a>')}</div></section>`;
  });
})();
