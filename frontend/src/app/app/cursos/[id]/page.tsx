"use client";

import AppSidebar from "@/components/AppSidebar";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";

type Course = { id: number; name: string; subject: string; level: string; academic_year: string; description: string; active: boolean };
type Student = { id: number; name: string; email: string; external_code: string; active: boolean };
type Enrollment = { id: number; course: number; student: number; status: string; student_name: string; student_email: string; course_name: string };

export default function CourseDetailPage() {
  const params = useParams<{ id: string }>(); const id = params.id;
  const [course, setCourse] = useState<Course | null>(null); const [students, setStudents] = useState<Student[]>([]); const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [studentId, setStudentId] = useState(""); const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");

  async function load() {
    try { const [c, s, e] = await Promise.all([api<Course>(`/courses/${id}/`), api<Student[]>("/students/"), api<Enrollment[]>(`/enrollments/?course=${id}`)]); setCourse(c); setStudents(s.filter(x=>x.active)); setEnrollments(e); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo abrir el curso."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [id]);

  async function enroll(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { await api("/enrollments/", { method: "POST", body: JSON.stringify({ course: Number(id), student: Number(studentId), status: "active" }) }); setStudentId(""); setMessage("Estudiante vinculado al curso."); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo vincular al estudiante."); }
    finally { setBusy(false); }
  }
  async function createAndEnroll(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    try { await api<Student>("/students/", { method: "POST", body: JSON.stringify({ name, email, external_code: code, active: true, course: Number(id) }) }); setName(""); setEmail(""); setCode(""); setMessage("Estudiante creado y matriculado en el curso."); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo crear el estudiante."); }
    finally { setBusy(false); }
  }
  async function remove(enrollment: Enrollment) {
    if (!window.confirm(`¿Desvincular a ${enrollment.student_name} de este curso? Se conservan sus datos e historial.`)) return;
    setBusy(true); setError("");
    try { await api(`/enrollments/${enrollment.id}/`, { method: "PATCH", body: JSON.stringify({ status: "inactive" }) }); setMessage("Matrícula desactivada; el historial se conserva."); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo modificar la matrícula."); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="simple-page" id="main-content" tabIndex={-1}>Cargando curso…</main>;
  if (!course) return <main className="simple-page" id="main-content" tabIndex={-1}><Link href="/app/cursos">← Cursos</Link><h1>Curso no disponible</h1><p role="alert">{error}</p></main>;
  const enrolled = new Set(enrollments.map(x=>x.student)); const available = students.filter(s=>!enrolled.has(s.id));
  return <div className="app-shell"><AppSidebar />
    <main className="app-main narrow-main" id="main-content" tabIndex={-1}><Link href="/app/cursos" className="back-link">← Volver a cursos</Link><span className="eyebrow">CURSO</span><h1>{course.name}</h1><p className="page-intro">{[course.subject, course.level, course.academic_year].filter(Boolean).join(" · ")}</p>{course.description && <p>{course.description}</p>}{error&&<p className="error-message" role="alert">{error}</p>}{message&&<p className="success-message" role="status">{message}</p>}
      <section className="form-card"><h2>Vincular estudiante existente</h2>{available.length===0 ? <p className="muted">No hay estudiantes disponibles. Podés crear uno en el formulario siguiente.</p> : <form onSubmit={enroll}><label htmlFor="student-existing">Estudiante</label><select id="student-existing" value={studentId} onChange={e=>setStudentId(e.target.value)} required><option value="">Seleccionar…</option>{available.map(s=><option key={s.id} value={s.id}>{s.name}{s.email?` · ${s.email}`:""}</option>)}</select><button className="button button-primary" disabled={busy||!studentId}>Vincular al curso</button></form>}</section>
      <section className="form-card"><h2>Crear estudiante y matricular</h2><p className="muted">Guardá solo los datos necesarios. El correo no se envía al proveedor de IA; se utilizará únicamente para comunicaciones que el docente solicite.</p><form onSubmit={createAndEnroll}><label htmlFor="new-student-name">Nombre y apellido <span>*</span></label><input id="new-student-name" value={name} onChange={e=>setName(e.target.value)} maxLength={180} required/><label htmlFor="new-student-email">Correo electrónico (opcional)</label><input id="new-student-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} maxLength={254}/><label htmlFor="new-student-code">Legajo o código (opcional)</label><input id="new-student-code" value={code} onChange={e=>setCode(e.target.value)} maxLength={80}/><button className="button button-quiet" disabled={busy}>Crear y matricular</button></form></section>
      <section className="list-section"><div className="section-row"><div><h2>Estudiantes del curso <span className="count">{enrollments.filter(e=>e.status==="active").length}</span></h2><p>Las matrículas se pueden desactivar sin borrar el historial de entregas.</p></div></div>{enrollments.filter(e=>e.status==="active").length===0 ? <div className="empty-state"><h3>El curso todavía no tiene estudiantes</h3><p>Vinculá estudiantes existentes o crealos desde esta pantalla.</p></div> : <div className="assessment-list">{enrollments.filter(e=>e.status==="active").map(e=><article className="assessment-row" key={e.id}><div className="avatar">{e.student_name.slice(0,1).toUpperCase()}</div><div className="assessment-info"><h3>{e.student_name}</h3><p>{e.student_email || "Sin correo informado"}</p></div><button className="text-link" type="button" onClick={()=>remove(e)} disabled={busy}>Desvincular</button></article>)}</div>}</section>
    </main></div>;
}
