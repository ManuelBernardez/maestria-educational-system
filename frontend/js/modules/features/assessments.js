import { state } from '../core/state.js';
import { formField, selectField, textField, optionRows } from '../core/utils.js';
import { escapeHtml, formatNumber, btn, heading, table, statusPill, statusLabel, date, panel, resourceError, emptyState } from '../core/utils.js';


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

export function renderAssessments() {
  const query = state.search.trim().toLowerCase();
  const statusFilter = state.assessmentStatusFilter;
  const items = state.data.assessments.filter(item => (!query || `${item.title} ${item.subject} ${item.course_name}`.toLowerCase().includes(query)) && (statusFilter === 'all' || item.status === statusFilter) && (state.assessmentCourseFilter === 'all' || String(item.course ?? 'unassigned') === state.assessmentCourseFilter));
  const rows = items.map(item => `<tr><td><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.subject || '')}</small></td><td>${escapeHtml(item.course_name || 'Sin curso')}</td><td>${escapeHtml(item.level || '—')}</td><td>${statusPill(item.status)}</td><td>${date(item.updated_at)}</td><td>${btn('Abrir', 'open-assessment', `data-id="${item.id}"`)} ${btn('Editar', 'edit-assessment', `data-id="${item.id}"`)}</td></tr>`);
  return `${heading('Evaluaciones', 'Diseñá propuestas, consignas y materiales para tus cursos.', `${btn('Crear evaluación', 'navigate', 'data-view="assessment-new"', 'primary')}`)}${resourceError('assessments', 'las evaluaciones')}<div class="toolbar"><input class="search-input" type="search" placeholder="Buscar evaluación o curso" aria-label="Buscar evaluaciones" value="${escapeHtml(state.search)}" data-search="assessments"><select class="filter-select" data-filter="assessment-course" aria-label="Filtrar por curso"><option value="all" ${state.assessmentCourseFilter === 'all' ? 'selected' : ''}>Todos los cursos</option>${state.data.courses.map(course => `<option value="${course.id}" ${String(course.id) === String(state.assessmentCourseFilter) ? 'selected' : ''}>${escapeHtml(course.name)}</option>`).join('')}<option value="unassigned" ${state.assessmentCourseFilter === 'unassigned' ? 'selected' : ''}>Sin curso</option></select><select class="filter-select" data-filter="assessment-status" aria-label="Filtrar por estado"><option value="all" ${statusFilter === 'all' ? 'selected' : ''}>Todos</option>${['draft', 'ready', 'archived'].map(value => `<option value="${value}" ${value === statusFilter ? 'selected' : ''}>${statusLabel(value)}</option>`).join('')}</select><span class="filter-result-count">${items.length} evaluaciones</span></div>${table(['Evaluación', 'Curso', 'Nivel', 'Estado', 'Actualizada', 'Acciones'], rows, 'No hay evaluaciones que coincidan con los filtros.')}`;
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
