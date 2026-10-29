"use client";

import AppSidebar from "@/components/AppSidebar";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SubmitEvent,
} from "react";
import { api } from "@/lib/api";

type Course = {
  id: number;
  name: string;
  subject: string;
  level: string;
  academic_year: string;
  description: string;
  active: boolean;
};
type Student = {
  id: number;
  name: string;
  email: string;
  external_code: string;
  active: boolean;
};
type Enrollment = {
  id: number;
  course: number;
  student: number;
  status: "active" | "inactive";
  student_name: string;
  student_email: string;
  student_external_code?: string;
  course_name: string;
};
type AssessmentSummary = { id: number | string; title: string; subject?: string; status?: string; course?: number | null; course_name?: string | null };
type CorrectionSummary = {
  id: number;
  submission: number;
  submission_assessment_id: number | string;
  submission_title: string;
  student_name: string;
  status: string;
  total_score?: string | number;
  course_id?: number | null;
  course_name?: string | null;
  created_at?: string;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export default function CourseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const validCourseId = /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0;

  const [course, setCourse] = useState<Course | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [assessments, setAssessments] = useState<AssessmentSummary[]>([]);
  const [corrections, setCorrections] = useState<CorrectionSummary[]>([]);
  const [studentId, setStudentId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [courseError, setCourseError] = useState("");
  const [studentsError, setStudentsError] = useState("");
  const [enrollmentsError, setEnrollmentsError] = useState("");
  const [assessmentsError, setAssessmentsError] = useState("");
  const [correctionsError, setCorrectionsError] = useState("");
  const [message, setMessage] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const operationInProgress = useRef(false);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setCourseError("");
    setStudentsError("");
    setEnrollmentsError("");
    setAssessmentsError("");
    setCorrectionsError("");

    if (!validCourseId) {
      setCourse(null);
      setCourseError("El identificador del curso no es válido.");
      setLoading(false);
      return;
    }

    const [courseResult, studentsResult, enrollmentsResult, assessmentsResult, correctionsResult] = await Promise.allSettled([
      api<Course>(`/courses/${id}/`, { signal }),
      api<Student[]>("/students/", { signal }),
      api<Enrollment[]>(`/enrollments/?course=${encodeURIComponent(id)}`, { signal }),
      api<AssessmentSummary[]>("/assessments/", { signal }),
      api<CorrectionSummary[]>("/corrections/?summary=1", { signal }),
    ]);

    if (signal.aborted) return;

    if (courseResult.status === "fulfilled") {
      setCourse(courseResult.value);
    } else {
      setCourse(null);
      setCourseError(errorMessage(courseResult.reason, "No se pudo cargar el curso."));
    }

    if (studentsResult.status === "fulfilled") {
      setStudents(Array.isArray(studentsResult.value) ? studentsResult.value : []);
    } else {
      setStudentsError(errorMessage(studentsResult.reason, "No se pudieron cargar los estudiantes."));
    }

    if (enrollmentsResult.status === "fulfilled") {
      setEnrollments(Array.isArray(enrollmentsResult.value) ? enrollmentsResult.value : []);
    } else {
      setEnrollmentsError(errorMessage(enrollmentsResult.reason, "No se pudieron cargar las matrículas."));
    }
    if (assessmentsResult.status === "fulfilled") {
      setAssessments(Array.isArray(assessmentsResult.value) ? assessmentsResult.value : []);
    } else {
      setAssessmentsError(errorMessage(assessmentsResult.reason, "No se pudieron cargar las evaluaciones del curso."));
    }
    if (correctionsResult.status === "fulfilled") {
      setCorrections(Array.isArray(correctionsResult.value) ? correctionsResult.value : []);
    } else {
      setCorrectionsError(errorMessage(correctionsResult.reason, "No se pudieron cargar las correcciones del curso."));
    }
    setLoading(false);
  }, [id, validCourseId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, loadAttempt]);

  const activeEnrollments = useMemo(
    () => enrollments.filter((enrollment) => enrollment.status === "active"),
    [enrollments],
  );
  const inactiveEnrollments = useMemo(
    () => enrollments.filter((enrollment) => enrollment.status === "inactive"),
    [enrollments],
  );
  const alreadyEnrolledStudentIds = useMemo(
    () => new Set(enrollments.map((enrollment) => enrollment.student)),
    [enrollments],
  );
  const availableStudents = useMemo(
    () => students.filter((student) => student.active && !alreadyEnrolledStudentIds.has(student.id)),
    [students, alreadyEnrolledStudentIds],
  );
  const courseAssessments = useMemo(
    () => assessments.filter((assessment) => String(assessment.course ?? "") === String(id)),
    [assessments, id],
  );
  const courseCorrections = useMemo(
    () => corrections.filter((correction) => String(correction.course_id ?? "") === String(id)),
    [corrections, id],
  );
  const pendingCorrections = courseCorrections.filter((correction) => correction.status === "pending_review").length;

  const refreshStudents = useCallback(async () => {
    try {
      const result = await api<Student[]>("/students/");
      setStudents(Array.isArray(result) ? result : []);
      setStudentsError("");
    } catch (cause) {
      setStudentsError(errorMessage(cause, "No se pudieron actualizar los estudiantes."));
    }
  }, []);

  const refreshEnrollments = useCallback(async () => {
    try {
      const result = await api<Enrollment[]>(`/enrollments/?course=${encodeURIComponent(id)}`);
      setEnrollments(Array.isArray(result) ? result : []);
      setEnrollmentsError("");
    } catch (cause) {
      setEnrollmentsError(errorMessage(cause, "No se pudieron actualizar las matrículas."));
    }
  }, [id]);

  async function runMutation(fallback: string, operation: () => Promise<void>): Promise<void> {
    if (operationInProgress.current) return;
    operationInProgress.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (cause) {
      setError(errorMessage(cause, fallback));
    } finally {
      operationInProgress.current = false;
      setBusy(false);
    }
  }

  async function enroll(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!studentId || !Number.isSafeInteger(Number(studentId)) || Number(studentId) <= 0) {
      setError("Seleccioná un estudiante válido.");
      return;
    }

    await runMutation("No se pudo vincular al estudiante.", async () => {
      await api("/enrollments/", {
        method: "POST",
        body: JSON.stringify({ course: Number(id), student: Number(studentId), status: "active" }),
      });
      setStudentId("");
      setMessage("Estudiante vinculado al curso.");
      await refreshEnrollments();
    });
  }

  async function createAndEnroll(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim().replace(/\s+/g, " ");
    if (cleanName.length < 2) {
      setError("Ingresá el nombre y apellido del estudiante.");
      return;
    }

    await runMutation("No se pudo crear el estudiante.", async () => {
      await api<Student>("/students/", {
        method: "POST",
        body: JSON.stringify({
          name: cleanName,
          email: email.trim(),
          external_code: code.trim(),
          active: true,
          course: Number(id),
        }),
      });
      setName("");
      setEmail("");
      setCode("");
      setMessage("Estudiante creado y matriculado en el curso.");
      await Promise.all([refreshStudents(), refreshEnrollments()]);
    });
  }

  async function remove(enrollment: Enrollment) {
    if (!window.confirm(`¿Desvincular a ${enrollment.student_name} de este curso? Se conservan sus datos e historial.`)) return;
    await runMutation("No se pudo modificar la matrícula.", async () => {
      await api(`/enrollments/${enrollment.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ status: "inactive" }),
      });
      setMessage("Matrícula desactivada; el historial se conserva.");
      await refreshEnrollments();
    });
  }

  async function reactivate(enrollment: Enrollment) {
    const student = students.find((item) => item.id === enrollment.student);
    if (!student?.active) {
      setError("El estudiante está inactivo. Revisá su estado antes de reactivar la matrícula.");
      return;
    }
    await runMutation("No se pudo reactivar la matrícula.", async () => {
      await api(`/enrollments/${enrollment.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ status: "active" }),
      });
      setMessage("Matrícula reactivada.");
      await refreshEnrollments();
    });
  }

  if (loading) {
    return (
      <main className="simple-page" id="main-content" tabIndex={-1} aria-busy="true" aria-live="polite">
        Cargando curso…
      </main>
    );
  }

  if (!course) {
    return (
      <main className="simple-page" id="main-content" tabIndex={-1}>
        <Link href="/app/cursos">← Cursos</Link>
        <h1>Curso no disponible</h1>
        <p className="error-message" role="alert">{courseError || "No se pudo cargar el curso."}</p>
        <button className="button button-primary" type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
          Reintentar
        </button>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="app-main" id="main-content" tabIndex={-1}>
        <Link href="/app/cursos" className="back-link">← Todas las materias</Link>
        <header className="app-header course-hub-header">
          <div><span className="eyebrow">ESPACIO DE LA MATERIA</span><h1>{course.name}</h1><p>{[course.subject, course.level, course.academic_year].filter(Boolean).join(" · ") || "Curso o comisión"}</p>{course.description && <p className="course-description">{course.description}</p>}</div>
          <span className={`status-pill ${course.active ? "delivery-status-approved" : "delivery-status-rejected"}`}>{course.active ? "Curso activo" : "Curso archivado"}</span>
        </header>

        {error && <p className="error-message" role="alert">{error}</p>}
        {message && <p className="success-message" role="status" aria-live="polite">{message}</p>}

        <section className="course-hub-metrics" aria-label="Resumen de la materia">
          <div className="course-hub-metric"><strong>{enrollmentsError ? "—" : activeEnrollments.length}</strong><span>Estudiantes activos</span></div>
          <div className="course-hub-metric"><strong>{assessmentsError ? "—" : courseAssessments.length}</strong><span>Evaluaciones</span></div>
          <div className="course-hub-metric"><strong>{correctionsError ? "—" : pendingCorrections}</strong><span>Correcciones por revisar</span></div>
        </section>

        <div className="course-hub-deliveries-action">
          <Link className="button button-quiet button-small" href={`/app/entregas?course=${id}`}>📥 Abrir entregas de la materia <span aria-hidden="true">→</span></Link>
        </div>

        <details className="course-add-details">
          <summary>Agregar estudiantes a esta materia</summary>
          <div className="course-add-grid">
            <section aria-busy={busy}>
              <h3>Vincular estudiante existente</h3>
              <p>Usá esta opción si ya está registrado en MaestrIA.</p>
              {studentsError ? <><p className="error-message" role="alert">{studentsError}</p><button className="button button-quiet" type="button" disabled={busy} onClick={() => void refreshStudents()}>Reintentar</button></> : availableStudents.length === 0 ? <p className="muted">No hay estudiantes disponibles para vincular.</p> : (
                <form onSubmit={enroll}>
                  <label htmlFor="student-existing">Estudiante</label>
                  <select id="student-existing" value={studentId} onChange={(event) => setStudentId(event.target.value)} required disabled={busy}>
                    <option value="">Seleccionar…</option>{availableStudents.map((student) => <option key={student.id} value={student.id}>{student.name}{student.email ? ` · ${student.email}` : ""}</option>)}
                  </select>
                  <button className="button button-primary" type="submit" disabled={busy || !studentId}>{busy ? "Guardando…" : "Vincular estudiante"}</button>
                </form>
              )}
            </section>
            <section aria-busy={busy}>
              <h3>Crear estudiante nuevo</h3>
              <p>Se creará y quedará matriculado en esta materia.</p>
              <form onSubmit={createAndEnroll}>
                <label htmlFor="new-student-name">Nombre y apellido <span>*</span></label>
                <input id="new-student-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={180} autoComplete="name" required disabled={busy} />
                <label htmlFor="new-student-email">Correo electrónico (opcional)</label>
                <input id="new-student-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} autoComplete="email" disabled={busy} />
                <label htmlFor="new-student-code">Legajo o código (opcional)</label>
                <input id="new-student-code" value={code} onChange={(event) => setCode(event.target.value)} maxLength={80} disabled={busy} />
                <button className="button button-quiet" type="submit" disabled={busy || name.trim().length < 2}>{busy ? "Guardando…" : "Crear y matricular"}</button>
              </form>
            </section>
          </div>
        </details>

        <details className="course-hub-section" id="course-students" open>
          <summary className="course-hub-section-summary"><div><h2 id="course-students-title">Estudiantes <span className="count">{enrollmentsError ? "—" : activeEnrollments.length}</span></h2><p>Solo se muestran las matrículas de esta materia.</p></div><span className="course-section-chevron" aria-hidden="true">⌄</span></summary>
          <div className="course-hub-section-body"><div className="section-row"><div><h3>Lista de estudiantes</h3><p>Administrá las matrículas y consultá los datos identificatorios.</p></div><Link href={`/app/alumnos?course=${id}`} className="text-link">Gestionar estudiantes →</Link></div>
          {enrollmentsError && <div className="error-message" role="alert"><p>{enrollmentsError}</p><button className="button button-quiet" type="button" disabled={busy} onClick={() => void refreshEnrollments()}>Reintentar carga</button></div>}
          {activeEnrollments.length > 0 ? <div className="course-hub-small-list">{activeEnrollments.map((enrollment) => <article className="course-hub-small-row" key={enrollment.id}><div className="course-hub-student-details"><strong>{enrollment.student_name}</strong><small>{enrollment.student_email || "Sin correo informado"}</small><small><b>Legajo:</b> {enrollment.student_external_code?.trim() || "Sin legajo informado"}</small></div><button className="button button-quiet button-small" type="button" onClick={() => void remove(enrollment)} disabled={busy} aria-label={`Desvincular a ${enrollment.student_name}`}>Desvincular</button></article>)}</div> : !enrollmentsError ? <div className="empty-state"><h3>Esta materia todavía no tiene estudiantes</h3><p>Podés agregar uno desde “Agregar estudiantes a esta materia”.</p></div> : null}
          {inactiveEnrollments.length > 0 && <details className="course-add-details"><summary>Historial de matrículas inactivas ({inactiveEnrollments.length})</summary><div className="course-hub-small-list">{inactiveEnrollments.map((enrollment) => { const studentIsActive = students.some((student) => student.id === enrollment.student && student.active); return <article className="course-hub-small-row" key={enrollment.id}><div className="course-hub-student-details"><strong>{enrollment.student_name}</strong><small>{enrollment.student_email || "Sin correo informado"}</small><small><b>Legajo:</b> {enrollment.student_external_code?.trim() || "Sin legajo informado"}</small></div><button className="button button-quiet button-small" type="button" disabled={busy || !studentIsActive} onClick={() => void reactivate(enrollment)}>{studentIsActive ? "Reactivar" : "Estudiante inactivo"}</button></article>;})}</div></details>}
          </div>
        </details>

        <details className="course-hub-section" id="course-assessments" open>
          <summary className="course-hub-section-summary"><div><h2 id="course-assessments-title">Evaluaciones <span className="count">{assessmentsError ? "—" : courseAssessments.length}</span></h2><p>Consignas y criterios pertenecientes a esta materia.</p></div><span className="course-section-chevron" aria-hidden="true">⌄</span></summary>
          <div className="course-hub-section-body"><div className="section-row"><div><h3>Evaluaciones de la materia</h3></div><Link className="button button-primary button-small" href={`/app/evaluaciones/nueva?course=${id}`}>＋ Nueva evaluación</Link></div>
          {assessmentsError ? <p className="error-message" role="alert">{assessmentsError}</p> : courseAssessments.length > 0 ? <div className="assessment-list">{courseAssessments.map((assessment) => <Link className="assessment-row assessment-row-link" href={`/app/evaluaciones/${assessment.id}`} key={assessment.id}><span className="assessment-icon" aria-hidden="true">▤</span><span className="assessment-info"><strong>{assessment.title}</strong><span>{assessment.subject || course.subject || "Sin materia adicional"}</span></span><span className={`status-pill ${assessment.status === "ready" ? "delivery-status-approved" : assessment.status === "archived" ? "delivery-status-rejected" : "delivery-status-review"}`}>{assessment.status === "ready" ? "Lista" : assessment.status === "archived" ? "Archivada" : "Borrador"}</span><span className="row-arrow" aria-hidden="true">→</span></Link>)}</div> : <div className="empty-state"><h3>Sin evaluaciones para esta materia</h3><p>Creá la primera para asociar consignas, entregas y correcciones a este curso.</p><Link className="button button-primary" href={`/app/evaluaciones/nueva?course=${id}`}>Crear evaluación</Link></div>}
          </div>
        </details>

        <details className="course-hub-section" id="course-corrections" open>
          <summary className="course-hub-section-summary"><div><h2 id="course-corrections-title">Correcciones <span className="count">{correctionsError ? "—" : courseCorrections.length}</span></h2><p>Historial de devoluciones de las evaluaciones de esta materia.</p></div><span className="course-section-chevron" aria-hidden="true">⌄</span></summary>
          <div className="course-hub-section-body"><div className="section-row"><div><h3>Historial de correcciones</h3></div><Link href={`/app/correcciones?course=${id}`} className="text-link">Ver historial →</Link></div>
          {correctionsError ? <p className="error-message" role="alert">{correctionsError}</p> : courseCorrections.length > 0 ? <div className="assessment-list">{courseCorrections.map((correction) => {
            const hasScore = correction.total_score !== undefined && correction.total_score !== null && String(correction.total_score).trim() !== "" && Number.isFinite(Number(correction.total_score));
            return <article className="course-hub-small-row" key={correction.id}>
              <div><strong>{correction.student_name || "Estudiante sin identificar"}</strong><small>{correction.submission_title}</small></div>
              <span className="course-correction-score">{hasScore ? `${Number(correction.total_score).toLocaleString("es-AR", { maximumFractionDigits: 2 })} pts` : "Sin nota"}</span>
              <span className={`status-pill ${correction.status === "approved" ? "delivery-status-approved" : correction.status === "rejected" ? "delivery-status-rejected" : "delivery-status-review"}`}>{correction.status === "approved" ? "Aprobada" : correction.status === "rejected" ? "Rechazada" : "Pendiente"}</span>
              <Link className="button button-quiet button-small" href={`/app/espacio-correccion?assessment=${encodeURIComponent(String(correction.submission_assessment_id))}&submission=${correction.submission}`}>Abrir</Link>
            </article>;
          })}</div> : <div className="empty-state"><h3>Todavía no hay correcciones</h3><p>Cuando generes una propuesta para una entrega de esta materia, aparecerá acá.</p><Link className="button button-quiet" href={`/app/entregas?course=${id}`}>Ver entregas</Link></div>}
          </div>
        </details>
        <p className="app-disclaimer">La evaluación, los estudiantes y las devoluciones de esta página pertenecen a este curso. La decisión final de cada nota siempre es docente.</p>
      </main>
    </div>
  );
}
