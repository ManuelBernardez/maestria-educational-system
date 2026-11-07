import { state } from '../core/state.js';
import { formField, selectField, textField, optionRows } from '../core/utils.js';
import { escapeHtml, formatNumber, btn, heading, table, statusPill, statusLabel, date, panel, resourceError, emptyState, toneOf, icon, searchField, chipGroup, toolbarSelect, resultCount, filteredEmpty, showMore } from '../core/utils.js';
import { EXAM_STATUS, examStatus, examCorrection } from './exam-status.js';

const EXAM_FILTER_DEFAULTS = Object.freeze({ course: 'all', status: 'all' });

function examRow(submission) {
  const status = examStatus(submission);
  const correction = examCorrection(submission);
  const name = submission.student_display_name || submission.student_name || 'Estudiante sin identificar';
  const nameMarkup = submission.student
    ? `<button type="button" class="entity-link" data-action="open-student" data-id="${escapeHtml(submission.student)}">${escapeHtml(name)}</button>`
    : `<strong>${escapeHtml(name)}</strong>`;
  const action = correction
    ? btn(status === 'review' ? 'Revisar' : 'Ver devolución', 'open-correction', `data-id="${escapeHtml(correction.id)}"`, status === 'review' ? 'primary' : 'secondary')
    : btn('Abrir entrega', 'open-submission', `data-id="${escapeHtml(submission.id)}"`);
  return `<article class="work-row" data-row data-status="${status}"><div class="work-row-main">${nameMarkup}<small>Entregado el ${escapeHtml(date(submission.created_at))}</small></div><div class="work-row-meta"><span class="score-value" title="Nota"><span class="visually-hidden">Nota: </span>${correction ? escapeHtml(formatNumber(correction.total_score)) : '—'}</span>${statusPill(EXAM_STATUS[status].pill, EXAM_STATUS[status].label)}</div><div class="work-row-actions">${action}</div></article>`;
}

/**
 * Evaluaciones: todas las evaluaciones del docente con sus exámenes.
 * Filtros en memoria: búsqueda (evaluación o estudiante), materia/curso y estado del examen.
 */
export function renderAssessments() {
  const filters = state.examFilters;
  const query = state.search.trim().toLocaleLowerCase('es-AR');
  const examsByAssessment = new Map();
  state.data.submissions.forEach(item => {
    const key = String(item.assessment);
    if (!examsByAssessment.has(key)) examsByAssessment.set(key, []);
    examsByAssessment.get(key).push(item);
  });

  const inCourse = (assessment) => filters.course === 'all' || String(assessment.course ?? assessment.course_id ?? 'unassigned') === filters.course;
  const groups = state.data.assessments.filter(inCourse).map(assessment => {
    const exams = (examsByAssessment.get(String(assessment.id)) || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const titleMatches = !query || `${assessment.title} ${assessment.subject || ''} ${assessment.course_name || ''}`.toLocaleLowerCase('es-AR').includes(query);
    const searched = titleMatches ? exams : exams.filter(item => `${item.student_display_name || item.student_name || ''}`.toLocaleLowerCase('es-AR').includes(query));
    return { assessment, exams: searched, visible: titleMatches || searched.length > 0 };
  }).filter(group => group.visible);

  // Contadores por estado sobre el conjunto sin filtrar por estado.
  const counts = { all: 0, pending: 0, review: 0, approved: 0, rejected: 0 };
  groups.forEach(group => group.exams.forEach(item => { counts.all += 1; counts[examStatus(item)] += 1; }));

  const visibleGroups = groups.map(group => ({ ...group, exams: filters.status === 'all' ? group.exams : group.exams.filter(item => examStatus(item) === filters.status) }))
    .filter(group => filters.status === 'all' || group.exams.length)
    .sort((a, b) => b.exams.filter(item => examStatus(item) === 'review').length - a.exams.filter(item => examStatus(item) === 'review').length || new Date(b.assessment.updated_at) - new Date(a.assessment.updated_at));
  const shown = visibleGroups.slice(0, filters.limit);
  const filtered = Boolean(query) || Object.keys(EXAM_FILTER_DEFAULTS).some(key => filters[key] !== EXAM_FILTER_DEFAULTS[key]);
  const examTotal = visibleGroups.reduce((sum, group) => sum + group.exams.length, 0);

  const courseOptions = [{ value: 'all', label: 'Todas las materias' }, ...state.data.courses.map(course => ({ value: String(course.id), label: course.name })), ...(state.data.assessments.some(item => item.course == null && item.course_id == null) ? [{ value: 'unassigned', label: 'Sin curso' }] : [])];
  const toolbar = `<div class="toolbar" role="search">
    ${searchField('Buscar evaluaciones', state.search, 'Buscar evaluación o estudiante', 'data-search="assessments" id="exam-search"')}
    ${chipGroup('Estado del examen', 'exam-status', [{ value: 'all', label: 'Todas', count: counts.all, active: filters.status === 'all' }, ...Object.entries(EXAM_STATUS).map(([value, meta]) => ({ value, label: meta.plural, count: counts[value], active: filters.status === value }))])}
    ${toolbarSelect('Filtrar por materia o curso', 'data-filter="exam-course" id="exam-course"', courseOptions, filters.course)}
    ${resultCount(`${visibleGroups.length} ${visibleGroups.length === 1 ? 'evaluación' : 'evaluaciones'} · ${examTotal} ${examTotal === 1 ? 'examen' : 'exámenes'}`, filtered ? 'clear-exam-filters' : '')}
  </div>`;

  const fold = ({ assessment, exams }) => {
    const reviewCount = exams.filter(item => examStatus(item) === 'review').length;
    const courseId = assessment.course ?? assessment.course_id;
    return `<details class="fold" data-ui-key="assessment-${escapeHtml(assessment.id)}" data-tone="${toneOf(courseId ?? 'none')}" ${filtered && exams.length ? 'open' : ''}>
      <summary><span class="fold-copy"><strong>${escapeHtml(assessment.title)}</strong><small>${escapeHtml(assessment.course_name || 'Sin curso')} · Actualizada ${escapeHtml(date(assessment.updated_at))}</small></span>${statusPill(assessment.status)}${reviewCount ? `<span class="count-badge" title="${reviewCount} por revisar"><span class="visually-hidden">Por revisar: </span>${reviewCount}</span>` : ''}<span class="fold-count">${exams.length}<span class="visually-hidden"> exámenes</span></span>${icon('chevron')}</summary>
      <div class="fold-body">${exams.length ? `<div class="work-list">${exams.map(examRow).join('')}</div>` : '<p class="muted">Todavía no hay exámenes cargados para esta evaluación.</p>'}<div class="fold-footer">${btn('Trabajar en el espacio', 'open-in-workspace', `data-id="${escapeHtml(assessment.id)}"`, 'primary')}${btn('Editar', 'edit-assessment', `data-id="${escapeHtml(assessment.id)}"`)}</div></div>
    </details>`;
  };

  const list = shown.length
    ? `<div class="fold-list">${shown.map(fold).join('')}</div>${showMore(shown.length, visibleGroups.length, 'show-more-exams')}`
    : state.data.assessments.length
      ? filteredEmpty('evaluaciones', 'clear-exam-filters')
      : emptyState('Todavía no hay evaluaciones', 'Creá una evaluación para empezar a recibir entregas.', btn('Crear evaluación', 'navigate', 'data-view="assessment-new"', 'primary'));

  return `${heading('Evaluaciones', 'Todas tus evaluaciones y los exámenes de cada estudiante, en un solo lugar.', btn('Crear evaluación', 'navigate', 'data-view="assessment-new"', 'primary'))}${resourceError('assessments', 'las evaluaciones')}${resourceError('submissions', 'las entregas')}${toolbar}${list}`;
}


export function renderNewAssessment() {
  const courses = state.data.courses.filter(item => item.active);
  const requested = new URLSearchParams(window.location.search).get('course') || state.selectedCourse || '';
  const preferred = courses.find(item => String(item.id) === String(requested)) || (courses.length === 1 ? courses[0] : null);
  const courseOptions = [{ value: '', label: 'Seleccionar curso…' }, ...optionRows(courses, item => item.name)];
  const subject = preferred?.subject || '';
  const level = preferred?.level || '';
  return `${heading('Crear evaluación', 'Empezá con lo esencial. Después vas a poder sumar materiales, elegir criterios y cargar una entrega.', btn('Volver a evaluaciones', 'navigate', 'data-view="assessments"'))}
    ${courses.length ? `<section class="panel quick-assessment-panel"><div class="panel-head"><div><h2>Tu evaluación</h2><p>Solo necesitamos saber qué vas a preparar y en qué curso.</p></div></div><div class="panel-body"><form id="assessment-create-page-form" class="form-grid">
      ${selectField('Curso', 'course', courseOptions, preferred?.id || '', true)}
      ${formField('Nombre de la evaluación', 'title', '', 'text', 'maxlength="180" placeholder="Ej. Ecosistemas y relaciones tróficas"', true)}
      ${formField('Materia o área (opcional)', 'subject', subject, 'text', 'maxlength="120" placeholder="Ciencias Naturales"')}
      ${formField('Nivel / año (opcional)', 'level', level, 'text', 'maxlength="120" placeholder="2.º año de secundaria"')}
      <details class="form-field full"><summary>Agregar objetivos y consigna ahora <span class="muted">(podés hacerlo después)</span></summary>
        ${textField('Objetivos de aprendizaje', 'objectives', '', 'rows="3" maxlength="5000" placeholder="¿Qué deberían comprender o demostrar los estudiantes?"')}
        ${textField('Consigna general / indicaciones', 'instructions', '', 'rows="4" maxlength="8000" placeholder="Consigna, contenidos, dificultad esperada o instrucciones para la corrección…"')}
      </details>
      <div class="form-field full notice"><strong>¿Qué sigue?</strong><p>Vas a entrar en el espacio guiado para agregar materiales, criterios y respuestas de estudiantes.</p></div>
      <div class="form-actions full"><button class="btn btn-secondary" type="button" data-action="navigate" data-view="assessments">Cancelar</button><button class="btn btn-primary" type="submit">Crear y preparar corrección →</button></div>
    </form></div></section>` : emptyState('Primero creá un curso', 'Necesitás un curso para mantener estudiantes y evaluaciones organizados.', btn('Crear curso', 'new-course', '', 'primary'))}`;
}


export function renderAssessmentDetail() {
  const base = state.data.assessments.find(item => String(item.id) === String(state.selectedAssessment));
  if (!base) return ''; // Handled by router
  const editor = state.assessmentEditor?.assessment?.id === base.id ? state.assessmentEditor : null;
  const assessment = editor?.assessment || base;
  const questions = editor?.questions || [];
  const rows = questions.map(question => `<tr><td><strong>${escapeHtml(question.prompt)}</strong><small>${escapeHtml(question.question_type || 'open')} · Máximo ${escapeHtml(formatNumber(question.max_score))}</small></td><td>${Number(question.position || 0)}</td><td>${question.rubric ? escapeHtml(state.data.rubrics.find(item => String(item.id) === String(question.rubric))?.title || 'Asignada') : 'Sin rúbrica'}</td><td><div class="table-actions">${btn('Editar', 'edit-question', `data-id="${question.id}"`)}${btn('Eliminar', 'delete-question', `data-id="${question.id}"`)}</div></td></tr>`);
  const rubrics = state.data.rubrics.map(item => `<option value="${item.id}">${escapeHtml(item.title)}</option>`).join('');
  return `${heading(assessment.title, `${assessment.course_name || base.course_name || 'Sin curso'} · ${assessment.subject || 'Evaluación'} · ${statusLabel(assessment.status)}`, `${btn('Volver al curso', 'return-assessment')}${btn('Editar evaluación', 'edit-assessment', `data-id="${base.id}"`)}`)}
    ${panel('Propósito y consignas generales', '', `<p>${escapeHtml(assessment.objectives || 'Sin objetivos registrados.')}</p><p>${escapeHtml(assessment.instructions || 'Sin instrucciones generales.')}</p><details><summary>Material de referencia</summary><p>${escapeHtml(assessment.reference_material || 'No se cargó material de referencia.')}</p></details>`)}
    ${panel('Consignas', 'Las preguntas propuestas por IA deben revisarse antes de incorporarse.', table(['Consigna', 'Orden', 'Rúbrica', 'Acciones'], rows, 'Esta evaluación todavía no tiene consignas.'), `<div class="view-actions">${btn('Agregar consigna', 'new-question', `data-assessment="${base.id}"`)}${btn('Proponer con IA', 'generate-questions', `data-id="${base.id}"`)}${btn('Importar material', 'import-reference', `data-id="${base.id}"`)}</div>`)}
    ${panel('Rúbrica de la evaluación', 'Podés proponer una rúbrica con el contexto, los objetivos y las consignas de esta evaluación; después revisá criterios, puntajes y ponderaciones.', `<p>Rúbricas disponibles: ${state.data.rubrics.length}. La asociación final se realiza desde la edición de cada consigna.</p>${rubrics ? `<ul class="plain-list">${state.data.rubrics.slice(0, 5).map(item => `<li>${escapeHtml(item.title)} · ${item.criteria?.length || 0} criterios</li>`).join('')}</ul>` : 'Todavía no hay rúbricas creadas.'}`, btn('Proponer rúbrica para esta evaluación', 'generate-assessment-rubric', `data-id="${base.id}"`, 'primary'))}`;
}
