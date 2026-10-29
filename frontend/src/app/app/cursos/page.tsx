"use client";

import AppSidebar from "@/components/AppSidebar";
import Link from "next/link";
import { type SubmitEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Course = { id: number; name: string; subject: string; level: string; academic_year: string; description: string; active: boolean; student_count: number; assessment_count: number };

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("Terciario / Universitario");
  const [academicYear, setAcademicYear] = useState(String(new Date().getFullYear()));
  const [description, setDescription] = useState("");
  const [createFormOpen, setCreateFormOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [editName, setEditName] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editLevel, setEditLevel] = useState("");
  const [editYear, setEditYear] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
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
      const result = await api<Course[]>("/courses/", { signal: controller.signal });
      if (!controller.signal.aborted && sequence === loadSequence.current) {
        const nextCourses = Array.isArray(result) ? result : [];
        setCourses(nextCourses);
        setCreateFormOpen(!nextCourses.some(course => course.active) || (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("new") === "1"));
      }
    } catch (caught) {
      if (!controller.signal.aborted && sequence === loadSequence.current) setError(caught instanceof Error ? caught.message : "No se pudieron cargar los cursos.");
    } finally {
      if (!controller.signal.aborted && sequence === loadSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      loadSequence.current += 1;
      loadController.current?.abort();
    };
  }, [load]);

  async function createCourse(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      await api<Course>("/courses/", { method: "POST", body: JSON.stringify({ name, subject, level, academic_year: academicYear, description, active: true }) });
      setName(""); setSubject(""); setDescription("");
      setMessage("Curso creado. Ahora podés vincular estudiantes y preparar evaluaciones.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear el curso."); }
    finally { mutationLock.current = false; setBusy(false); }
  }

  function editCourse(course: Course) {
    setEditingCourse(course);
    setEditName(course.name || "");
    setEditSubject(course.subject || "");
    setEditLevel(course.level || "");
    setEditYear(course.academic_year || "");
    setEditDescription(course.description || "");
    setError("");
    setMessage("");
  }

  async function saveCourseEdits(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingCourse || mutationLock.current) return;
    const cleanName = editName.trim().replace(/\s+/g, " ");
    if (cleanName.length < 2) {
      setError("El nombre del curso debe contener al menos dos caracteres.");
      return;
    }
    mutationLock.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/courses/${editingCourse.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ name: cleanName, subject: editSubject.trim(), level: editLevel.trim(), academic_year: editYear.trim(), description: editDescription.trim() }),
      });
      setEditingCourse(null);
      setMessage("Datos del curso actualizados.");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo actualizar el curso.");
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }

  async function archiveCourse(course: Course) {
    if (mutationLock.current) return;
    if (!window.confirm(`¿Archivar “${course.name}”? Se conservarán sus evaluaciones e historial.`)) return;
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true); setError("");
    try { await api(`/courses/${course.id}/`, { method: "DELETE" }); setMessage("Curso archivado; el historial se conserva."); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo archivar el curso."); }
    finally { mutationLock.current = false; setBusy(false); }
  }

  return <div className="app-shell">
    <AppSidebar />
    <main className="app-main narrow-main" id="main-content" tabIndex={-1}>
      <Link href="/app" className="back-link">← Volver al resumen</Link><span className="eyebrow">ORGANIZACIÓN DOCENTE</span><h1>Materias y cursos</h1>
      <p className="page-intro">Separá tus espacios de trabajo por materia, nivel o comisión. Cada curso organiza estudiantes y evaluaciones sin mezclar información de otros cursos.</p>
      {error && <p className="error-message" role="alert">{error}</p>}{message && <p className="success-message" role="status">{message}</p>}
      <details className="course-create-disclosure" open={createFormOpen} onToggle={event => setCreateFormOpen(event.currentTarget.open)}>
        <summary><span>＋ Crear materia o curso</span><small>Un espacio para organizar estudiantes, evaluaciones y devoluciones.</small></summary>
        <section className="form-card course-create-form"><h2>Datos del curso</h2><form onSubmit={createCourse}>
          <label htmlFor="course-name">Nombre del curso o comisión <span>*</span></label><input id="course-name" value={name} onChange={e=>setName(e.target.value)} maxLength={160} required placeholder="Ej. Biología · 3.º año · Turno mañana" />
          <div className="form-two"><div><label htmlFor="course-subject">Materia o área</label><input id="course-subject" value={subject} onChange={e=>setSubject(e.target.value)} maxLength={120} placeholder="Ej. Biología" /></div><div><label htmlFor="course-level">Nivel educativo</label><select id="course-level" value={level} onChange={e=>setLevel(e.target.value)}><option>Primario</option><option>Secundario</option><option>Terciario / Universitario</option><option>Formación profesional</option><option>Otro</option></select></div></div>
          <label htmlFor="course-year">Año lectivo</label><input id="course-year" value={academicYear} onChange={e=>setAcademicYear(e.target.value)} maxLength={20} />
          <details className="advanced-course-fields"><summary>Agregar una descripción (opcional)</summary><label htmlFor="course-description">Contexto o notas para organizarte</label><textarea id="course-description" value={description} onChange={e=>setDescription(e.target.value)} rows={3} maxLength={2000} placeholder="Contenidos, comisión u observaciones." /></details>
          <button className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Crear curso"}</button>
        </form></section>
      </details>
      {editingCourse && <section className="form-card course-edit-panel" id="course-edit-form" aria-labelledby="course-edit-title">
        <div className="section-row"><div><h2 id="course-edit-title">Editar curso</h2><p>Los cambios solo actualizan los datos de organización; no modifican matrículas ni evaluaciones.</p></div><button type="button" className="button button-quiet button-small" onClick={() => setEditingCourse(null)} disabled={busy}>Cancelar</button></div>
        <form onSubmit={saveCourseEdits}>
          <label htmlFor="edit-course-name">Nombre del curso o comisión <span>*</span></label><input id="edit-course-name" value={editName} onChange={event => setEditName(event.target.value)} maxLength={160} required disabled={busy} />
          <div className="form-two"><div><label htmlFor="edit-course-subject">Materia o área</label><input id="edit-course-subject" value={editSubject} onChange={event => setEditSubject(event.target.value)} maxLength={120} disabled={busy} /></div><div><label htmlFor="edit-course-level">Nivel educativo</label><input id="edit-course-level" value={editLevel} onChange={event => setEditLevel(event.target.value)} maxLength={120} disabled={busy} /></div></div>
          <label htmlFor="edit-course-year">Año lectivo</label><input id="edit-course-year" value={editYear} onChange={event => setEditYear(event.target.value)} maxLength={20} disabled={busy} />
          <details className="advanced-course-fields"><summary>Editar descripción</summary><label htmlFor="edit-course-description">Descripción</label><textarea id="edit-course-description" value={editDescription} onChange={event => setEditDescription(event.target.value)} rows={3} maxLength={2000} disabled={busy} /></details>
          <button className="button button-primary" type="submit" disabled={busy || editName.trim().length < 2}>{busy ? "Guardando…" : "Guardar cambios"}</button>
        </form>
      </section>}
      <section className="list-section"><div className="section-row"><div><h2>Tus cursos <span className="count">{courses.length}</span></h2><p>Los datos pertenecen a tu cuenta y no son visibles para otros docentes.</p></div></div>
        {loading ? <div className="empty-state">Cargando cursos…</div> : courses.length === 0 ? <div className="empty-state"><div className="empty-icon">▣</div><h3>Creá tu primer espacio</h3><p>Un curso permite agrupar estudiantes y mantener las evaluaciones organizadas.</p></div> : <div className="assessment-list">{courses.map(course => <article className="assessment-row" key={course.id}><div className="assessment-icon">▣</div><div className="assessment-info"><h3><Link href={`/app/cursos/${course.id}`}>{course.name}</Link></h3><p>{[course.subject, course.level, course.academic_year].filter(Boolean).join(" · ")}</p><small>{course.student_count} estudiantes · {course.assessment_count} evaluaciones</small></div><span className={`status-pill ${course.active ? "" : "muted"}`}>{course.active ? "Activo" : "Archivado"}</span>{course.active && <><button className="button button-quiet button-small" type="button" onClick={()=>void editCourse(course)} disabled={busy}>Editar</button><button className="text-link" type="button" onClick={()=>archiveCourse(course)} disabled={busy} aria-label={`Archivar ${course.name}`}>Archivar</button></>}</article>)}</div>}
      </section>
    </main>
  </div>;
}
