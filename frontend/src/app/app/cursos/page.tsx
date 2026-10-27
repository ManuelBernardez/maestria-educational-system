"use client";

import AppSidebar from "@/components/AppSidebar";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Course = { id: number; name: string; subject: string; level: string; academic_year: string; description: string; active: boolean; student_count: number; assessment_count: number };

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("Terciario / Universitario");
  const [academicYear, setAcademicYear] = useState(String(new Date().getFullYear()));
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function load() {
    try { setCourses(await api<Course[]>("/courses/")); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudieron cargar los cursos."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function createCourse(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      await api<Course>("/courses/", { method: "POST", body: JSON.stringify({ name, subject, level, academic_year: academicYear, description, active: true }) });
      setName(""); setSubject(""); setDescription("");
      setMessage("Curso creado. Ahora podés vincular estudiantes y preparar evaluaciones.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear el curso."); }
    finally { setBusy(false); }
  }

  async function editCourse(course: Course) {
    const nextName = window.prompt("Nombre del curso o comisión", course.name);
    if (nextName === null) return;
    const nextSubject = window.prompt("Materia o área", course.subject || "");
    if (nextSubject === null) return;
    const nextLevel = window.prompt("Nivel educativo", course.level || "");
    if (nextLevel === null) return;
    const nextYear = window.prompt("Año lectivo", course.academic_year || "");
    if (nextYear === null) return;
    const nextDescription = window.prompt("Descripción", course.description || "");
    if (nextDescription === null) return;
    if (!nextName.trim()) { setError("El nombre del curso no puede quedar vacío."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/courses/${course.id}/`, { method: "PATCH", body: JSON.stringify({ name: nextName.trim(), subject: nextSubject.trim(), level: nextLevel.trim(), academic_year: nextYear.trim(), description: nextDescription }) });
      setMessage("Datos del curso actualizados."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo actualizar el curso."); }
    finally { setBusy(false); }
  }

  async function archiveCourse(course: Course) {
    if (!window.confirm(`¿Archivar “${course.name}”? Se conservarán sus evaluaciones e historial.`)) return;
    setBusy(true); setError("");
    try { await api(`/courses/${course.id}/`, { method: "DELETE" }); setMessage("Curso archivado; el historial se conserva."); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo archivar el curso."); }
    finally { setBusy(false); }
  }

  return <div className="app-shell">
    <AppSidebar />
    <main className="app-main narrow-main" id="main-content" tabIndex={-1}>
      <Link href="/app" className="back-link">← Volver al resumen</Link><span className="eyebrow">ORGANIZACIÓN DOCENTE</span><h1>Materias y cursos</h1>
      <p className="page-intro">Separá tus espacios de trabajo por materia, nivel o comisión. Cada curso organiza estudiantes y evaluaciones sin mezclar información de otros cursos.</p>
      {error && <p className="error-message" role="alert">{error}</p>}{message && <p className="success-message" role="status">{message}</p>}
      <section className="form-card"><span className="eyebrow">NUEVO ESPACIO</span><h2>Crear curso</h2><form onSubmit={createCourse}>
        <label htmlFor="course-name">Nombre del curso o comisión <span>*</span></label><input id="course-name" value={name} onChange={e=>setName(e.target.value)} maxLength={160} required placeholder="Ej. Biología · 3.º año · Turno mañana" />
        <div className="form-two"><div><label htmlFor="course-subject">Materia o área</label><input id="course-subject" value={subject} onChange={e=>setSubject(e.target.value)} maxLength={120} placeholder="Ej. Biología" /></div><div><label htmlFor="course-level">Nivel educativo</label><select id="course-level" value={level} onChange={e=>setLevel(e.target.value)}><option>Primario</option><option>Secundario</option><option>Terciario / Universitario</option><option>Formación profesional</option><option>Otro</option></select></div></div>
        <label htmlFor="course-year">Año lectivo</label><input id="course-year" value={academicYear} onChange={e=>setAcademicYear(e.target.value)} maxLength={20} />
        <label htmlFor="course-description">Descripción (opcional)</label><textarea id="course-description" value={description} onChange={e=>setDescription(e.target.value)} rows={3} maxLength={2000} placeholder="Contexto, contenidos o notas para organizarte." />
        <button className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Crear curso"}</button>
      </form></section>
      <section className="list-section"><div className="section-row"><div><h2>Tus cursos <span className="count">{courses.length}</span></h2><p>Los datos pertenecen a tu cuenta y no son visibles para otros docentes.</p></div></div>
        {loading ? <div className="empty-state">Cargando cursos…</div> : courses.length === 0 ? <div className="empty-state"><div className="empty-icon">▣</div><h3>Creá tu primer espacio</h3><p>Un curso permite agrupar estudiantes y mantener las evaluaciones organizadas.</p></div> : <div className="assessment-list">{courses.map(course => <article className="assessment-row" key={course.id}><div className="assessment-icon">▣</div><div className="assessment-info"><h3><Link href={`/app/cursos/${course.id}`}>{course.name}</Link></h3><p>{[course.subject, course.level, course.academic_year].filter(Boolean).join(" · ")}</p><small>{course.student_count} estudiantes · {course.assessment_count} evaluaciones</small></div><span className={`status-pill ${course.active ? "" : "muted"}`}>{course.active ? "Activo" : "Archivado"}</span>{course.active && <><button className="button button-quiet button-small" type="button" onClick={()=>void editCourse(course)} disabled={busy}>Editar</button><button className="text-link" type="button" onClick={()=>archiveCourse(course)} disabled={busy} aria-label={`Archivar ${course.name}`}>Archivar</button></>}</article>)}</div>}
      </section>
    </main>
  </div>;
}
