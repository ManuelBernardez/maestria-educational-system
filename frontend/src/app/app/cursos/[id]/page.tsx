"use client";

import AppSidebar from "@/components/AppSidebar";
import { api } from "@/lib/api";
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
  course_name: string;
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

export default function CourseDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const validCourseId =
    /^\d+$/.test(id) &&
    Number.isSafeInteger(Number(id)) &&
    Number(id) > 0;

  const [course, setCourse] = useState<Course | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);

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
  const [message, setMessage] = useState("");

  const [loadAttempt, setLoadAttempt] = useState(0);

  // Evita que dos acciones de escritura se ejecuten simultáneamente.
  // La ref cambia sin esperar al siguiente render.
  const operationInProgress = useRef(false);

  // Carga inicial: las tres solicitudes son independientes y concurrentes.
  // Promise.allSettled permite mostrar el curso aunque falle otra sección.
  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setError("");
    setCourseError("");
    setStudentsError("");
    setEnrollmentsError("");

    if (!validCourseId) {
      setCourse(null);
      setCourseError("El identificador del curso no es válido.");
      setLoading(false);
      return;
    }

    try {
      const [courseResult, studentsResult, enrollmentsResult] =
        await Promise.allSettled([
          api<Course>(`/courses/${id}/`, { signal }),
          api<Student[]>("/students/", { signal }),
          api<Enrollment[]>(`/enrollments/?course=${id}`, { signal }),
        ]);

      // Ignoramos resultados de una carga cancelada o de una ruta anterior.
      if (signal.aborted) return;

      if (courseResult.status === "fulfilled") {
        setCourse(courseResult.value);
      } else {
        setCourse(null);
        setCourseError(
          errorMessage(
            courseResult.reason,
            "No se pudo cargar el curso."
          )
        );
      }

      if (studentsResult.status === "fulfilled") {
        setStudents(studentsResult.value.filter((student) => student.active));
      } else {
        setStudentsError(
          errorMessage(
            studentsResult.reason,
            "No se pudieron cargar los estudiantes."
          )
        );
      }

      if (enrollmentsResult.status === "fulfilled") {
        setEnrollments(enrollmentsResult.value);
      } else {
        setEnrollmentsError(
          errorMessage(
            enrollmentsResult.reason,
            "No se pudieron cargar las matrículas."
          )
        );
      }
    } finally {
      if (!signal.aborted) {
        setLoading(false);
      }
    }
  }, [id, validCourseId]);

  // Cancela las solicitudes de lectura al abandonar el curso o cambiar de ID.
  useEffect(() => {
    const controller = new AbortController();

    void load(controller.signal);

    return () => {
      controller.abort();
    };
  }, [load, loadAttempt]);

  const activeEnrollments = useMemo(
    () => enrollments.filter((enrollment) => enrollment.status === "active"),
    [enrollments]
  );

  const inactiveEnrollments = useMemo(
    () => enrollments.filter((enrollment) => enrollment.status === "inactive"),
    [enrollments]
  );

  // Una matrícula inactiva sigue existiendo en la base de datos.
  // Esos estudiantes deben reactivarse, no volver a crearse o matricularse.
  const previouslyEnrolledStudentIds = useMemo(
    () => new Set(enrollments.map((enrollment) => enrollment.student)),
    [enrollments]
  );

  const availableStudents = useMemo(
    () =>
      students.filter(
        (student) => !previouslyEnrolledStudentIds.has(student.id)
      ),
    [students, previouslyEnrolledStudentIds]
  );

  async function runMutation(
    fallback: string,
    operation: () => Promise<void>
  ): Promise<void> {
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

  // Recargamos solamente los datos que cambiaron.
  // Los errores de actualización se informan por sección.
  const refreshStudents = useCallback(async () => {
    try {
      const result = await api<Student[]>("/students/");

      setStudents(result.filter((student) => student.active));
      setStudentsError("");
    } catch (cause) {
      setStudentsError(
        errorMessage(cause, "No se pudieron actualizar los estudiantes.")
      );
    }
  }, []);

  const refreshEnrollments = useCallback(async () => {
    try {
      const result = await api<Enrollment[]>(
        `/enrollments/?course=${id}`
      );

      setEnrollments(result);
      setEnrollmentsError("");
    } catch (cause) {
      setEnrollmentsError(
        errorMessage(cause, "No se pudieron actualizar las matrículas.")
      );
    }
  }, [id]);

  async function enroll(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!studentId) {
      setError("Seleccioná un estudiante.");
      return;
    }

    await runMutation(
      "No se pudo vincular al estudiante.",
      async () => {
        await api("/enrollments/", {
          method: "POST",
          body: JSON.stringify({
            course: Number(id),
            student: Number(studentId),
            status: "active",
          }),
        });

        setStudentId("");
        setMessage("Estudiante vinculado al curso.");

        await refreshEnrollments();
      }
    );
  }

  async function createAndEnroll(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanName = name.trim();

    if (!cleanName) {
      setError("Ingresá el nombre y apellido del estudiante.");
      return;
    }

    await runMutation(
      "No se pudo crear el estudiante.",
      async () => {
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

        await Promise.all([
          refreshStudents(),
          refreshEnrollments(),
        ]);
      }
    );
  }

  async function remove(enrollment: Enrollment) {
    const confirmed = window.confirm(
      `¿Desvincular a ${enrollment.student_name} de este curso? ` +
      "Se conservan sus datos e historial."
    );

    if (!confirmed) return;

    await runMutation(
      "No se pudo modificar la matrícula.",
      async () => {
        await api(`/enrollments/${enrollment.id}/`, {
          method: "PATCH",
          body: JSON.stringify({ status: "inactive" }),
        });

        setMessage(
          "Matrícula desactivada; el historial se conserva."
        );

        await refreshEnrollments();
      }
    );
  }

  async function reactivate(enrollment: Enrollment) {
    // Solo permitimos reactivar si el estudiante sigue activo.
    if (!students.some((student) => student.id === enrollment.student)) {
      setError(
        "El estudiante está inactivo. Revisá su estado antes de reactivar la matrícula."
      );
      return;
    }

    await runMutation(
      "No se pudo reactivar la matrícula.",
      async () => {
        await api(`/enrollments/${enrollment.id}/`, {
          method: "PATCH",
          body: JSON.stringify({ status: "active" }),
        });

        setMessage("Matrícula reactivada.");
        await refreshEnrollments();
      }
    );
  }

  if (loading) {
    return (
      <main
        className="simple-page"
        id="main-content"
        tabIndex={-1}
        aria-busy="true"
        aria-live="polite"
      >
        Cargando curso…
      </main>
    );
  }

  if (!course) {
    return (
      <main className="simple-page" id="main-content" tabIndex={-1}>
        <Link href="/app/cursos">← Cursos</Link>
        <h1>Curso no disponible</h1>
        <p className="error-message" role="alert">
          {courseError || "No se pudo cargar el curso."}
        </p>
        <button
          className="button button-primary"
          type="button"
          onClick={() => setLoadAttempt((attempt) => attempt + 1)}
        >
          Reintentar
        </button>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <AppSidebar />

      <main
        className="app-main narrow-main"
        id="main-content"
        tabIndex={-1}
      >
        <Link href="/app/cursos" className="back-link">
          ← Volver a cursos
        </Link>

        <span className="eyebrow">CURSO</span>
        <h1>{course.name}</h1>

        <p className="page-intro">
          {[course.subject, course.level, course.academic_year]
            .filter(Boolean)
            .join(" · ")}
        </p>

        {course.description && <p>{course.description}</p>}

        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}

        {message && (
          <p className="success-message" role="status" aria-live="polite">
            {message}
          </p>
        )}

        <section className="form-card" aria-busy={busy}>
          <h2>Vincular estudiante existente</h2>

          {studentsError ? (
            <>
              <p className="error-message" role="alert">
                {studentsError}
              </p>
              <button
                className="button button-quiet"
                type="button"
                disabled={busy}
                onClick={() => void refreshStudents()}
              >
                Reintentar carga de estudiantes
              </button>
            </>
          ) : availableStudents.length === 0 ? (
            <p className="muted">
              No hay estudiantes disponibles para vincular.
              Si el estudiante ya tuvo una matrícula en este curso,
              revisá el historial para reactivarla.
            </p>
          ) : (
            <form onSubmit={enroll}>
              <label htmlFor="student-existing">Estudiante</label>

              <select
                id="student-existing"
                value={studentId}
                onChange={(event) => setStudentId(event.target.value)}
                required
                disabled={busy}
              >
                <option value="">Seleccionar…</option>
                {availableStudents.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.name}
                    {student.email ? ` · ${student.email}` : ""}
                  </option>
                ))}
              </select>

              <button
                className="button button-primary"
                type="submit"
                disabled={busy || !studentId}
              >
                {busy ? "Guardando…" : "Vincular al curso"}
              </button>
            </form>
          )}
        </section>

        <section className="form-card" aria-busy={busy}>
          <h2>Crear estudiante y matricular</h2>

          <p className="muted">
            Guardá solo los datos necesarios. El correo no se envía
            al proveedor de IA; se utiliza únicamente para las
            comunicaciones que el docente solicite.
          </p>

          <form onSubmit={createAndEnroll}>
            <label htmlFor="new-student-name">
              Nombre y apellido <span>*</span>
            </label>
            <input
              id="new-student-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={180}
              autoComplete="name"
              required
              disabled={busy}
            />

            <label htmlFor="new-student-email">
              Correo electrónico (opcional)
            </label>
            <input
              id="new-student-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              maxLength={254}
              autoComplete="email"
              disabled={busy}
            />

            <label htmlFor="new-student-code">
              Legajo o código (opcional)
            </label>
            <input
              id="new-student-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={80}
              disabled={busy}
            />

            <button
              className="button button-quiet"
              type="submit"
              disabled={busy || !name.trim()}
            >
              {busy ? "Guardando…" : "Crear y matricular"}
            </button>
          </form>
        </section>

        <section className="list-section">
          <div className="section-row">
            <div>
              <h2>
                Estudiantes del curso{" "}
                <span className="count">{activeEnrollments.length}</span>
              </h2>
              <p>
                Las matrículas se pueden desactivar sin borrar
                el historial de entregas.
              </p>
            </div>
          </div>

          {enrollmentsError && (
            <div className="error-message" role="alert">
              <p>{enrollmentsError}</p>
              <button
                className="button button-quiet"
                type="button"
                disabled={busy}
                onClick={() => void refreshEnrollments()}
              >
                Reintentar carga de matrículas
              </button>
            </div>
          )}

          {activeEnrollments.length === 0 ? (
            <div className="empty-state">
              <h3>El curso todavía no tiene estudiantes activos</h3>
              <p>
                Vinculá estudiantes existentes o crealos desde
                los formularios anteriores.
              </p>
            </div>
          ) : (
            <div className="assessment-list">
              {activeEnrollments.map((enrollment) => (
                <article className="assessment-row" key={enrollment.id}>
                  <div className="avatar">
                    {enrollment.student_name.slice(0, 1).toUpperCase()}
                  </div>

                  <div className="assessment-info">
                    <h3>{enrollment.student_name}</h3>
                    <p>
                      {enrollment.student_email || "Sin correo informado"}
                    </p>
                  </div>

                  <button
                    className="text-link"
                    type="button"
                    onClick={() => void remove(enrollment)}
                    disabled={busy}
                    aria-label={`Desvincular a ${enrollment.student_name}`}
                  >
                    Desvincular
                  </button>
                </article>
              ))}
            </div>
          )}

          {inactiveEnrollments.length > 0 && (
            <div className="list-section">
              <h3>Historial de matrículas inactivas</h3>
              <p className="muted">
                Podés reactivar una matrícula sin crear un registro duplicado.
              </p>

              <div className="assessment-list">
                {inactiveEnrollments.map((enrollment) => {
                  const studentIsActive = students.some(
                    (student) => student.id === enrollment.student
                  );

                  return (
                    <article
                      className="assessment-row"
                      key={enrollment.id}
                    >
                      <div className="avatar">
                        {enrollment.student_name.slice(0, 1).toUpperCase()}
                      </div>

                      <div className="assessment-info">
                        <h3>{enrollment.student_name}</h3>
                        <p>
                          {enrollment.student_email || "Sin correo informado"}
                        </p>
                      </div>

                      <button
                        className="text-link"
                        type="button"
                        disabled={busy || !studentIsActive}
                        onClick={() => void reactivate(enrollment)}
                        aria-label={`Reactivar matrícula de ${enrollment.student_name}`}
                      >
                        {studentIsActive
                          ? "Reactivar matrícula"
                          : "Estudiante inactivo"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}