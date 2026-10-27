"use client";

import AppSidebar from "@/components/AppSidebar";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api, API_URL } from "@/lib/api";
import { supabase } from "@/lib/supabase";

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
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [students, availableCourses] = await Promise.all([
        api<Student[]>("/students/"),
        api<Course[]>("/courses/"),
      ]);
      setItems(Array.isArray(students) ? students : []);
      const activeCourses = (Array.isArray(availableCourses) ? availableCourses : []).filter(course => course.active);
      setCourses(activeCourses);
      setCourseId(current => activeCourses.some(course => String(course.id) === current) ? current : String(activeCourses[0]?.id ?? ""));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron cargar los alumnos y los cursos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function createStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setBusy(false);
    }
  }

  async function editStudent(student: Student) {
    const nextName = window.prompt("Nombre y apellido", student.name);
    if (nextName === null) return;
    const nextEmail = window.prompt("Correo electrónico", student.email || "");
    if (nextEmail === null) return;
    const nextPhone = window.prompt("Teléfono", student.phone || "");
    if (nextPhone === null) return;
    const nextCode = window.prompt("Legajo o identificador", student.external_code || "");
    if (nextCode === null) return;
    if (!nextName.trim()) { setError("El nombre del estudiante no puede quedar vacío."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/students/${student.id}/`, { method: "PATCH", body: JSON.stringify({ name: nextName.trim(), email: nextEmail.trim(), phone: nextPhone.trim(), external_code: nextCode.trim() }) });
      setMessage("Datos del estudiante actualizados."); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo actualizar el estudiante."); }
    finally { setBusy(false); }
  }

  async function importCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !courseId) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const session = await supabase?.auth.getSession();
      const token = session?.data.session?.access_token;
      if (!API_URL) throw new Error("Configurá NEXT_PUBLIC_API_URL para habilitar la importación.");
      const body = new FormData();
      body.append("file", file);
      body.append("course", courseId);
      const response = await fetch(`${API_URL}/students/import-csv/`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body,
        credentials: "omit",
        cache: "no-store",
      });
      const result = await response.json() as ImportResult | { detail?: string; file?: string; course?: string };
      if (!response.ok) {
        const errorResult = result as { detail?: string; file?: string; course?: string };
        throw new Error(errorResult.detail || errorResult.file || errorResult.course || "No se pudo importar el CSV.");
      }
      const success = result as ImportResult;
      setMessage(`Importación terminada: ${success.created} creados y asignados al curso, ${success.skipped} omitidos.${success.errors?.length ? ` Se informaron ${success.errors.length} observaciones.` : ""}`);
      setFile(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo importar el archivo.");
    } finally {
      setBusy(false);
    }
  }

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

        <section className="list-section">
          <div className="section-row"><h2>Tu listado <span className="count">{items.length}</span></h2></div>
          {loading ? <div className="empty-state" role="status">Cargando estudiantes…</div> : items.length === 0 ? (
            <div className="empty-state"><h3>Sin estudiantes todavía</h3><p>Creá un curso y agregá el primer estudiante.</p></div>
          ) : (
            <div className="assessment-list">
              {items.map(student => {
                const activeCourses = (student.enrollments || []).filter(enrollment => enrollment.status === "active").map(enrollment => enrollment.course_name);
                return <article className="assessment-row" key={student.id}>
                  <div className="avatar" aria-hidden="true">{student.name.slice(0, 1).toLocaleUpperCase("es-AR")}</div>
                  <div className="assessment-info">
                    <h3>{student.name}</h3>
                    <p>{[student.external_code, student.email].filter(Boolean).join(" · ") || "Sin datos adicionales"}</p>
                    <small>{activeCourses.length ? `Cursos: ${activeCourses.join(", ")}` : "Sin curso activo asignado; revisá su matrícula."}</small>
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
