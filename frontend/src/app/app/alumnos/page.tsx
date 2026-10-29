"use client";

import AppSidebar from "@/components/AppSidebar";
import Link from "next/link";
import { type SubmitEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

type Course = { id: number; name: string; subject: string; active: boolean };
type StudentEnrollment = { id: number; course_id: number; course_name: string; status: "active" | "inactive" };
type Student = {
  id: number;
  name: string;
  email: string;
  phone: string;
  external_code: string;
  active: boolean;
  enrollments: StudentEnrollment[];
};
type ImportResult = { created: number; skipped: number; errors?: { row: number; reason: string }[] };

export default function StudentsPage() {
  const [items, setItems] = useState<Student[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [courseId, setCourseId] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [search, setSearch] = useState("");
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editCode, setEditCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const requestedCourseRef = useRef<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadController = useRef<AbortController | null>(null);
  const loadSequence = useRef(0);
  const mutationLock = useRef(false);

  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const [students, availableCourses] = await Promise.all([
        api<Student[]>("/students/", { signal: controller.signal }),
        api<Course[]>("/courses/", { signal: controller.signal }),
      ]);
      if (controller.signal.aborted || sequence !== loadSequence.current) return;
      setItems(Array.isArray(students) ? students : []);
      const activeCourses = (Array.isArray(availableCourses) ? availableCourses : []).filter(course => course.active);
      setCourses(activeCourses);
      setCourseId(current => {
        const requested = requestedCourseRef.current;
        if (requested && activeCourses.some(course => String(course.id) === requested)) return requested;
        return activeCourses.some(course => String(course.id) === current) ? current : String(activeCourses[0]?.id ?? "");
      });
    } catch (caught) {
      if (controller.signal.aborted || sequence !== loadSequence.current) return;
      setError(caught instanceof Error ? caught.message : "No se pudieron cargar los alumnos y los cursos.");
    } finally {
      if (!controller.signal.aborted && sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("course");
    if (requested && /^\d+$/.test(requested)) {
      requestedCourseRef.current = requested;
      setCourseFilter(requested);
    }
    void load();
    return () => {
      loadSequence.current += 1;
      loadController.current?.abort();
    };
  }, [load]);

  async function createStudent(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationLock.current || !courseId || !name.trim()) return;
    mutationLock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api<Student>("/students/", {
        method: "POST",
        body: JSON.stringify({ name, email, phone, external_code: code, active: true, course: Number(courseId) }),
      });
      setName(""); setEmail(""); setPhone(""); setCode("");
      setMessage("Alumno agregado y asignado al curso seleccionado.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar al alumno.");
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }

  function editStudent(student: Student) {
    setEditingStudent(student);
    setEditName(student.name || "");
    setEditEmail(student.email || "");
    setEditPhone(student.phone || "");
    setEditCode(student.external_code || "");
    setError("");
    setMessage("");
  }

  async function saveStudentEdits(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingStudent || mutationLock.current) return;
    const cleanName = editName.trim().replace(/\s+/g, " ");
    if (cleanName.length < 2) {
      setError("El nombre debe contener al menos dos caracteres.");
      return;
    }
    mutationLock.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/students/${editingStudent.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ name: cleanName, email: editEmail.trim(), phone: editPhone.trim(), external_code: editCode.trim() }),
      });
      setEditingStudent(null);
      setMessage("Datos del estudiante actualizados.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo actualizar el estudiante.");
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }

  async function importCsv(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !courseId || mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("course", courseId);
      const success = await api<ImportResult>("/students/import-csv/", {
        method: "POST",
        body,
        timeoutMs: 120_000,
      });
      setMessage(`Importación terminada: ${success.created} creados y asignados al curso, ${success.skipped} omitidos.${success.errors?.length ? ` Se informaron ${success.errors.length} observaciones.` : ""}`);
      setFile(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo importar el archivo.");
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es-AR");
    return items.filter(student => {
      const enrollments = student.enrollments || [];
      const activeEnrollments = enrollments.filter(enrollment => enrollment.status === "active");
      const matchesCourse = courseFilter === "all"
        || courseFilter === "unassigned" && activeEnrollments.length === 0
        || activeEnrollments.some(enrollment => String(enrollment.course_id) === courseFilter);
      const matchesStatus = statusFilter === "all"
        || statusFilter === "active" && student.active
        || statusFilter === "inactive" && !student.active;
      const haystack = [student.name, student.email, student.phone, student.external_code,
        ...enrollments.map(enrollment => enrollment.course_name)].filter(Boolean).join(" ").toLocaleLowerCase("es-AR");
      return matchesCourse && matchesStatus && (!needle || haystack.includes(needle));
    });
  }, [items, search, courseFilter, statusFilter]);

  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="app-main narrow-main" id="main-content" tabIndex={-1}>
        <Link href="/app" className="back-link">← Volver al resumen</Link>
        <span className="eyebrow">ORGANIZACIÓN</span>
        <h1>Estudiantes</h1>
        <p className="page-intro">Cada estudiante queda asignado al menos a un curso. Podés agregarlo a otros cursos desde la organización de matrículas cuando lo necesites. No necesita una cuenta propia en esta versión.</p>

        {error && <p className="error-message" role="alert">{error}</p>}
        {message && <p className="success-message" role="status">{message}</p>}

        {courses.length === 0 && !loading ? (
          <section className="empty-state">
            <div className="empty-icon" aria-hidden="true">▣</div>
            <h2>Primero creá una materia o curso</h2>
            <p>Así cada estudiante queda vinculado al espacio donde vas a gestionar sus evaluaciones y respuestas.</p>
            <Link className="button button-primary" href="/app/cursos">Crear curso</Link>
          </section>
        ) : (
          <>
            <section className="form-card">
              <h2>Agregar estudiante</h2>
              <p className="muted">La asignación al curso elegido se guarda junto con el estudiante.</p>
              <form onSubmit={createStudent}>
                <label htmlFor="student-course">Materia o curso <span>*</span></label>
                <select id="student-course" value={courseId} onChange={event => setCourseId(event.target.value)} required disabled={busy || courses.length === 0}>
                  <option value="" disabled>Elegí un curso</option>
                  {courses.map(course => <option key={course.id} value={course.id}>{course.name}{course.subject ? ` · ${course.subject}` : ""}</option>)}
                </select>
                <label htmlFor="student-name">Nombre y apellido <span>*</span></label>
                <input id="student-name" value={name} onChange={event => setName(event.target.value)} required maxLength={180} autoComplete="off" placeholder="Ej. Julia Pérez" />
                <div className="form-two">
                  <div><label htmlFor="student-email">Correo (opcional)</label><input id="student-email" type="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} /></div>
                  <div><label htmlFor="student-phone">Teléfono (opcional)</label><input id="student-phone" value={phone} onChange={event => setPhone(event.target.value)} maxLength={32} placeholder="Solo si necesitás enviar una devolución" /></div>
                </div>
                <label htmlFor="student-code">Legajo o identificador (opcional)</label>
                <input id="student-code" value={code} onChange={event => setCode(event.target.value)} maxLength={80} placeholder="Código de uso interno" />
                <button className="button button-primary" disabled={busy || !courseId}>{busy ? "Guardando…" : "Guardar estudiante y asignar al curso"}</button>
              </form>
            </section>

            <section className="form-card student-import">
              <h2>Importar desde CSV</h2>
              <p className="muted">UTF-8, máximo 2 MB y 500 filas. Columnas: <code>name</code> (obligatoria), <code>email</code>, <code>phone</code>, <code>external_code</code>. Todos los estudiantes nuevos se asignarán al curso seleccionado.</p>
              <form onSubmit={importCsv}>
                <label htmlFor="csv-course">Asignar las filas importadas a</label>
                <select id="csv-course" value={courseId} onChange={event => setCourseId(event.target.value)} required disabled={busy || courses.length === 0}>
                  {courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}
                </select>
                <label htmlFor="student-csv">Archivo CSV</label>
                <input id="student-csv" type="file" accept=".csv,text/csv" onChange={event => setFile(event.target.files?.[0] || null)} />
                <button className="button button-quiet" disabled={busy || !file || !courseId}>{busy ? "Procesando…" : "Importar y asignar"}</button>
              </form>
            </section>
          </>
        )}

        {editingStudent && <section className="form-card student-edit-panel" id="student-edit-form" aria-labelledby="student-edit-title">
          <div className="section-row"><div><h2 id="student-edit-title">Editar estudiante</h2><p>Actualizá los datos de {editingStudent.name}. Los cambios no alteran sus matrículas ni su historial.</p></div><button type="button" className="button button-quiet button-small" onClick={() => setEditingStudent(null)} disabled={busy}>Cancelar</button></div>
          <form onSubmit={saveStudentEdits}>
            <label htmlFor="edit-student-name">Nombre y apellido <span>*</span></label>
            <input id="edit-student-name" value={editName} onChange={event => setEditName(event.target.value)} required maxLength={180} autoComplete="name" disabled={busy} />
            <div className="form-two"><div><label htmlFor="edit-student-email">Correo electrónico</label><input id="edit-student-email" type="email" value={editEmail} onChange={event => setEditEmail(event.target.value)} maxLength={254} disabled={busy} /></div><div><label htmlFor="edit-student-phone">Teléfono</label><input id="edit-student-phone" value={editPhone} onChange={event => setEditPhone(event.target.value)} maxLength={32} disabled={busy} /></div></div>
            <label htmlFor="edit-student-code">Legajo o identificador</label><input id="edit-student-code" value={editCode} onChange={event => setEditCode(event.target.value)} maxLength={80} disabled={busy} />
            <button className="button button-primary" type="submit" disabled={busy || editName.trim().length < 2}>{busy ? "Guardando…" : "Guardar cambios"}</button>
          </form>
        </section>}

        <section className="list-section">
          <div className="section-row"><div><h2>Estudiantes <span className="count">{loading ? "—" : filteredItems.length}</span></h2><p>{courseFilter !== "all" && courseFilter !== "unassigned" ? `Mostrando estudiantes de ${courses.find(course => String(course.id) === courseFilter)?.name || "la materia seleccionada"}.` : "Buscá y filtrá el listado sin perder el contexto de cada materia."}</p></div></div>
          {!loading && items.length > 0 && <section className="ux-filter-bar student-filter-bar" aria-label="Filtros de estudiantes">
            <label htmlFor="students-search">Buscar<input id="students-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre, correo, legajo…" /></label>
            <label htmlFor="students-course-filter">Materia o curso<select id="students-course-filter" value={courseFilter} onChange={event => setCourseFilter(event.target.value)}><option value="all">Todos los cursos</option>{courses.map(course => <option key={course.id} value={String(course.id)}>{course.name}</option>)}<option value="unassigned">Sin curso activo</option></select></label>
            <label htmlFor="students-status-filter">Estado<select id="students-status-filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="active">Activos</option><option value="inactive">Inactivos</option><option value="all">Todos</option></select></label>
            <span className="ux-filter-count">{filteredItems.length} de {items.length}</span>
          </section>}
          {loading ? <div className="empty-state" role="status" aria-live="polite">Cargando estudiantes…</div> : items.length === 0 ? (
            <div className="empty-state"><h3>Sin estudiantes todavía</h3><p>Creá un curso y agregá el primer estudiante.</p></div>
          ) : filteredItems.length === 0 ? (
            <div className="empty-state"><h3>No hay estudiantes que coincidan</h3><p>Probá otra búsqueda o elegí otra materia o estado.</p><button type="button" className="button button-quiet" onClick={() => { setSearch(""); setCourseFilter("all"); setStatusFilter("active"); }}>Limpiar filtros</button></div>
          ) : (
            <div className="assessment-list">
              {filteredItems.map(student => {
                const activeCourses = (student.enrollments || []).filter(enrollment => enrollment.status === "active");
                return <article className="assessment-row" key={student.id}>
                  <div className="avatar" aria-hidden="true">{student.name.slice(0, 1).toLocaleUpperCase("es-AR")}</div>
                  <div className="assessment-info">
                    <h3>{student.name}</h3>
                    <p>{[student.external_code, student.email].filter(Boolean).join(" · ") || "Sin datos adicionales"}</p>
                    <small>{activeCourses.length ? <>Materias: {activeCourses.map((enrollment, index) => <span key={enrollment.course_id}>{index > 0 ? ", " : ""}<Link href={`/app/cursos/${enrollment.course_id}`}>{enrollment.course_name}</Link></span>)}</> : "Sin curso activo asignado; revisá su matrícula."}</small>
                  </div>
                  <span className={`status-pill ${student.active ? "" : "muted"}`}>{student.active ? "Activo" : "Inactivo"}</span>
                  <button className="button button-quiet button-small" type="button" disabled={busy} onClick={() => void editStudent(student)}>Editar datos</button>
                </article>;
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
