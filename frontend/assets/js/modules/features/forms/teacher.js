import { state, modal } from '../../core/state.js';
import { escapeHtml, formField, textField, selectField, optionRows } from '../../core/utils.js';
import { openModal, modalForm, toast } from '../../core/ui.js';

export function studentForm(student = null, defaultCourse = '') {
  const courses = state.data.courses.filter(item => item.active).map(item => ({ value: item.id, label: item.name }));
  const fields = `${formField('Nombre y apellido', 'name', student?.name || '', 'text', 'maxlength="180"', true)}${formField('Correo electrónico', 'email', student?.email || '', 'email', 'maxlength="254"')}${formField('Teléfono', 'phone', student?.phone || '', 'tel', 'maxlength="60"')}${formField('Código externo', 'external_code', student?.external_code || '', 'text', 'maxlength="100"')}${student ? selectField('Estado', 'active', [{ value: 'true', label: 'Activo' }, { value: 'false', label: 'Inactivo' }], String(student.active !== false)) : selectField('Curso inicial', 'course', courses, defaultCourse || '', true)}`;
  openModal(student ? 'Editar estudiante' : 'Agregar estudiante', modalForm(fields), student ? 'edit-student' : 'new-student');
  modal.dataset.recordId = student?.id || '';
}

export function assessmentForm(assessment = null, defaultCourse = '') {
  const courses = optionRows(state.data.courses.filter(item => item.active), item => item.name, true);
  const fields = `${formField('Título', 'title', assessment?.title || '', 'text', 'maxlength="180"', true)}${selectField('Curso', 'course', courses, assessment?.course || defaultCourse || '', false)}${formField('Materia', 'subject', assessment?.subject || '', 'text', 'maxlength="120"')}${formField('Nivel', 'level', assessment?.level || '', 'text', 'maxlength="120"')}${selectField('Estado', 'status', [{ value: 'draft', label: 'Borrador' }, { value: 'ready', label: 'Lista' }, { value: 'archived', label: 'Archivada' }], assessment?.status || 'draft')}${textField('Objetivos', 'objectives', assessment?.objectives || '')}${textField('Instrucciones generales', 'instructions', assessment?.instructions || '')}${textField('Material de referencia', 'reference_material', assessment?.reference_material || '', 'maxlength="50000"')}`;
  openModal(assessment ? 'Editar evaluación' : 'Crear evaluación', modalForm(fields), assessment ? 'edit-assessment' : 'new-assessment', true);
  modal.dataset.recordId = assessment?.id || '';
}

export function questionForm(question = null, assessmentId = state.selectedAssessment) {
  const rubrics = optionRows(state.data.rubrics, item => item.title, true);
  const fields = `${textField('Consigna', 'prompt', question?.prompt || '', 'maxlength="8000"', true)}${textField('Respuesta esperada / referencia', 'expected_answer', question?.expected_answer || '')}${selectField('Tipo', 'question_type', [{ value: 'open', label: 'Respuesta abierta' }, { value: 'short', label: 'Respuesta breve' }, { value: 'case', label: 'Caso' }], question?.question_type || 'open')}${formField('Puntaje máximo', 'max_score', question?.max_score || '10', 'number', 'min="0.01" max="1000" step="0.01"', true)}${formField('Orden', 'position', question?.position || '1', 'number', 'min="0" step="1"')}${selectField('Rúbrica', 'rubric', rubrics, question?.rubric || '', false)}<input type="hidden" name="assessment" value="${escapeHtml(question?.assessment || assessmentId)}">`;
  openModal(question ? 'Editar consigna' : 'Agregar consigna', modalForm(fields), question ? 'edit-question' : 'new-question', true);
  modal.dataset.recordId = question?.id || '';
}

export function rubricForm(rubric = null) {
  const fields = `${formField('Título', 'title', rubric?.title || '', 'text', 'maxlength="180"', true)}${selectField('Tipo de escala', 'scale_type', [{ value: 'numeric', label: 'Numérica' }, { value: 'levels', label: 'Niveles' }, { value: 'both', label: 'Numérica y niveles' }], rubric?.scale_type || 'both')}${textField('Descripción', 'description', rubric?.description || '')}${textField('Criterios (uno por línea)', 'criteria_text', (rubric?.criteria || []).map(item => item.name).join('\n'), 'placeholder="Comprensión conceptual&#10;Argumentación y evidencia"')}`;
  openModal(rubric ? 'Editar rúbrica' : 'Crear rúbrica', modalForm(fields, 'Guardar rúbrica', '<p class="muted">Para crear una rúbrica nueva se requieren entre 2 y 20 criterios. Se proponen cuatro niveles por criterio cuando la escala los incluye.</p>'), rubric ? 'edit-rubric' : 'new-rubric', true);
  modal.dataset.recordId = rubric?.id || '';
}

export function importStudentsForm(defaultCourse = '') {
  const courses = optionRows(state.data.courses.filter(item => item.active), item => item.name, false);
  openModal('Importar estudiantes', modalForm(`${selectField('Curso', 'course', courses, defaultCourse || '', true)}<div class="form-field full"><label for="f-file">Archivo CSV</label><input id="f-file" name="file" type="file" accept=".csv,text/csv" required><small>Hasta 2 MB y 500 filas.</small></div>`, 'Importar', '<p class="muted"><a href="../plantilla-estudiantes.csv" download>Descargar plantilla CSV</a></p>'), 'import-students');
}

export function enrollmentForm(courseId) {
  const already = state.data.enrollments.filter(item => String(item.course) === String(courseId) && item.status === 'active').map(item => String(item.student));
  const students = state.data.students.filter(item => item.active && !already.includes(String(item.id))).map(item => ({ value: item.id, label: item.name }));
  if (!students.length) { toast('No hay estudiantes activos disponibles para matricular.', 'error'); return; }
  openModal('Matricular estudiante', modalForm(`${selectField('Estudiante', 'student', students, '', true)}${textField('Notas', 'notes', '')}`), 'enroll-student');
  modal.dataset.courseId = courseId;
}

export function submissionForm(courseId = state.selectedCourse || '') {
  const assessments = optionRows(state.data.assessments.filter(item => item.status !== 'archived' && (!courseId || String(item.course ?? item.course_id ?? '') === String(courseId))), item => item.title);
  const enrolledStudentIds = courseId ? new Set(state.data.enrollments.filter(item => String(item.course) === String(courseId) && item.status === 'active').map(item => String(item.student))) : null;
  const students = optionRows(state.data.students.filter(item => item.active && (!enrolledStudentIds || enrolledStudentIds.has(String(item.id)))), item => item.name, true);
  const fields = `${selectField('Evaluación', 'assessment', assessments, '', true)}${selectField('Consigna', 'question', [{ value: '', label: 'Sin asociar a una consigna' }], '', false)}${selectField('Estudiante', 'student', students, '', false)}${formField('Nombre si no está registrado', 'student_name', '', 'text', 'maxlength="180"')}${textField('Respuesta en texto', 'answer_text', '', 'maxlength="50000"')}<div class="form-field full"><label for="f-file">O cargar archivo (PDF, DOCX, TXT o MD)</label><input id="f-file" name="file" type="file" accept=".pdf,.docx,.txt,.md"><small>Máximo 5 MB. Se extrae el texto; no se conserva el archivo original.</small></div>`;
  openModal('Registrar entrega', modalForm(fields, 'Guardar entrega'), 'new-submission', true);
}

export function generateQuestionsForm(id) {
  openModal('Proponer consignas con IA', modalForm(`${formField('Cantidad de consignas', 'count', '3', 'number', 'min="1" max="5"', true)}`, 'Generar propuesta'), 'generate-questions');
  modal.dataset.recordId = id;
}

export function importReferenceForm(id) {
  openModal('Importar material de referencia', modalForm(`${selectField('Acción', 'mode', [{ value: 'replace', label: 'Reemplazar material actual' }, { value: 'append', label: 'Agregar al material actual' }], 'replace')}<div class="form-field full"><label for="f-file">Archivo de referencia</label><input id="f-file" name="file" type="file" accept=".pdf,.docx,.txt,.md" required></div>`, 'Importar'), 'import-reference');
  modal.dataset.recordId = id;
}

export function newRubricCriterionForm(rubricId) {
  openModal('Agregar criterio', modalForm(`${formField('Nombre', 'name', '', 'text', 'maxlength="180"', true)}${formField('Puntaje máximo', 'max_score', '10', 'number', 'min="0.01" max="1000" step="0.01"', true)}${formField('Ponderación (%)', 'weight', '1', 'number', 'min="0" max="100" step="0.01"')}${textField('Descripción', 'description', '')}`), 'new-criterion');
  modal.dataset.rubricId = rubricId;
}

export function editCriterionForm(criterion) {
  openModal('Editar criterio', modalForm(`${formField('Nombre', 'name', criterion.name, 'text', 'maxlength="180"', true)}${formField('Puntaje máximo', 'max_score', criterion.max_score, 'number', 'min="0.01" max="1000" step="0.01"', true)}${formField('Ponderación (%)', 'weight', criterion.weight, 'number', 'min="0" max="100" step="0.01"')}${textField('Descripción', 'description', criterion.description || '')}`), 'edit-criterion');
  modal.dataset.recordId = criterion.id;
}

export function editLevelForm(level) {
  openModal('Editar nivel', modalForm(`${formField('Nombre', 'name', level.name, 'text', 'maxlength="120"', true)}${formField('Puntaje', 'score', level.score, 'number', 'min="0" max="1000" step="0.01"', true)}${textField('Descripción', 'description', level.description || '')}`), 'edit-level');
  modal.dataset.recordId = level.id;
}

export function newLevelForm(criterionId, maxScore) {
  openModal('Agregar nivel', modalForm(`${formField('Nombre', 'name', '', 'text', 'maxlength="120"', true)}${formField('Puntaje', 'score', '0', 'number', `min="0" max="${Number(maxScore)}" step="0.01"`, true)}${textField('Descripción', 'description', '')}`), 'new-level');
  modal.dataset.criterionId = criterionId;
}

