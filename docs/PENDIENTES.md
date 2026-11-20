# Pendientes y próximas fases

Estado al 2026-11-20, al cerrar la **Fase 1** (rama `feat/fase1-consolidacion`): correcciones de consistencia, IA (consignas sin repetición, observaciones de contexto, devoluciones por criterio), tipografía y Materias/Comisiones. Ordenado por prioridad.

## 1. Despliegue de la Fase 1 (bloqueante, en este orden)

1. Revisar la rama y fusionarla a `main`.
2. **Antes o junto con el deploy**, aplicar en producción `backend/database/migrations/20261120120000_maestria_subjects_and_sections.sql`. El usuario autorizó aplicarla con el MCP de Supabase (`apply_migration`) en ese momento. Después:
   - `apply_migration` asigna la versión con la hora actual: renombrar el archivo del repo a esa versión.
   - Verificar con lecturas: cantidad de `subject` creadas, ningún `course` con `subject_id` nulo, `assessment_course` = evaluaciones con `course_id`, `submission.course_id` completo donde la evaluación tenía curso.
   - `python manage.py verify_public_schema` contra producción.
3. **Importante:** el `runserver` local usa la base de producción (`backend/.env`). Con el código nuevo y la migración sin aplicar, `/api/` responde 500 (columnas `subject_id`, `shift`, `course_id` inexistentes).
4. `frontend/html/plantilla-estudiantes.csv` está borrado en el árbol de trabajo (cambio del usuario, sin commitear). El enlace «Descargar plantilla CSV» del modal de importación apunta a ese archivo y el test `test_frontend_file_view_is_confined_to_html_directory` falla. Restaurarlo o actualizar el enlace y el test.
5. Opcional: `AI_GEMINI_THINKING_LEVEL=low` en Render si las propuestas de Gemini se truncan (ver `backend/.env.example`).

## 2. Portales nuevos (planes separados, ya acordados)

- **Portal de alumnos:** el rol `student` existe pero no tiene vistas, y `student.account_user_id` nunca se completa. Hay que resolver:
  - invitación o vinculación de la cuenta con el estudiante (por correo o código);
  - ver devoluciones aprobadas y notas por comisión;
  - permisos de solo lectura con aislamiento por `account_user_id`.
- **Portal de instituciones:** existen `institution` e `institution_membership` (con rol `institution_admin`/`department_admin`), pero ningún dato de negocio referencia a la institución. Agregar `subject.institution_id` (o una tabla de vínculo) y vistas de coordinación.
- **Integraciones:** Moodle (Web Services / LTI 1.3), Google Classroom, SIU Guaraní / CSV y Google Drive para materiales. La tabla `external_link` ya está creada para guardar los identificadores externos de materias, comisiones, estudiantes, evaluaciones, entregas y rúbricas.

## 3. Estadísticas por tipo de usuario (pedido nuevo)

Prioridad: docentes y superadministrador; después estudiantes e instituciones. Todo se puede calcular con los datos actuales (`correction`, `submission`, `ai_generation`, `audit_event`) salvo lo indicado.

**Docente** (por materia y por comisión, con filtro de ciclo lectivo):
- Distribución de notas aprobadas (histograma 1–10), promedio, mediana y porcentaje de aprobados (≥ 4 o ≥ 6, configurable), comparando comisiones de la misma materia.
- Rendimiento por criterio de rúbrica (logro medio por criterio): muestra qué contenidos cuestan más y orienta la reenseñanza.
- Rendimiento por consigna, para detectar consignas demasiado difíciles o ambiguas.
- Progreso por estudiante a lo largo de las evaluaciones; alerta temprana de quienes bajan o no entregan.
- Carga de trabajo: entregas pendientes y en revisión, tiempo medio entre la entrega y la aprobación.
- Uso de la IA: cuánto se ajustan los puntajes propuestos (diferencia propuesta–aprobada, desde `correction_revision`) y criterios con más ajustes. Es una señal de calidad del prompt o de la rúbrica.
- Devoluciones enviadas por canal (eventos `correction.delivery`).

**Superadministrador:**
- Usuarios activos por rol y por período, altas y suspensiones.
- Uso de la IA: generaciones por tarea y proveedor, tasa de error por `error_code`, latencia (p50/p95), tokens y costo estimado (`ai_generation`), cuota diaria consumida.
- Adopción: materias, comisiones, evaluaciones, entregas y correcciones aprobadas por semana.
- Salud: errores 5xx (si se agrega su registro), mensajes de contacto pendientes, instituciones y membresías.

**Estudiante** (requiere el portal):
- Notas por materia y evaluación, evolución en el tiempo y logro por criterio, para que vea en qué mejorar.
- Próximos pasos acumulados (las `improvement_suggestions` de sus devoluciones).

**Institución** (requiere el vínculo de las materias con la institución):
- Aprobación y promedio por materia, comisión y docente; comparación entre turnos.
- Volumen de evaluaciones y tiempos de devolución por departamento.
- Uso de la IA y porcentaje de propuestas aprobadas sin cambios.

## 4. Mejoras detectadas que quedaron fuera de la Fase 1

- **Validaciones duplicadas en serializer y vista** (nombre de curso, `external_code`, matrícula): se mantuvieron a propósito. La de la vista corre con el perfil bloqueado (`lock_owner_profile`) y evita carreras; la del serializer da el error temprano. Si se unifican, que quede la que corre con bloqueo.
- **Ampliar `fixtures/ai_eval_cases.json` y `evaluate_ai`** con controles de especificidad: cada criterio con `student_feedback` y la devolución con citas de la respuesta.
- **CSS público:** `styles.css`, `public-enhancements.css` y `responsive-refinements.css` redefinen los mismos selectores (`!important`, media queries repetidas). La Fase 1 sólo agregó tokens `--fs-*` y un bloque final de pisos de legibilidad; queda consolidar en una sola hoja.
- **Frontend:**
  - re-render completo con `innerHTML` y estado global mutable;
  - `workspace-feature.js` (~1200 líneas) para dividir;
  - `finalHint` y `finalScoreHint` casi duplicados.
- **Columnas heredadas** `course.subject`, `assessment.subject`/`level` y `assessment.course_id`: eliminarlas en una migración posterior, cuando la Fase 1 esté estable en producción.
- **Cuota de IA:** una corrección con varias consignas cuenta como una sola generación, y los intentos fallidos también consumen cuota (`ai_guard.py`).
- **Guard rails académicos** para la IA (que sólo acepte temas académicos): pendiente desde antes.
