"use client";

import AppSidebar from "@/components/AppSidebar";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

type Course = { id: number; name: string; subject: string; level: string; active: boolean };

export default function NewAssessment() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState("");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [level, setLevel] = useState("");
  const [objectives, setObjectives] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [error, setError] = useState("");
  const router = useRouter();
  const loadController = useRef<AbortController | null>(null);
  const submitLock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    loadController.current = controller;
    const requestedCourse = new URLSearchParams(window.location.search).get("course");
    const validRequestedCourse = requestedCourse && /^\d+$/.test(requestedCourse) ? requestedCourse : "";
    void api<Course[]>("/courses/", { signal: controller.signal })
      .then(items => {
        if (controller.signal.aborted) return;
        const active = items.filter(item => item.active);
        setCourses(active);
        const preferred = active.find(item => String(item.id) === validRequestedCourse)
          || (active.length === 1 ? active[0] : null);
        if (preferred) {
          setCourseId(String(preferred.id));
          setSubject(preferred.subject);
          setLevel(preferred.level);
        }
      })
      .catch(caught => {
        if (controller.signal.aborted || (caught instanceof Error && caught.name === "AbortError")) return;
        setError(caught instanceof Error ? caught.message : "No se pudieron cargar los cursos.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingCourses(false);
      });
    return () => controller.abort();
  }, []);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || loadingCourses || courses.length === 0) return;
    submitLock.current = true;
    setBusy(true); setError("");
    try {
      const item = await api<{ id: string | number }>("/assessments/", { method: "POST", body: JSON.stringify({ title: title.trim(), course: Number(courseId), subject: subject.trim(), level: level.trim(), objectives: objectives.trim(), instructions: instructions.trim(), reference_material: "", status: "draft" }) });
      router.push(`/app/espacio-correccion?assessment=${item.id}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo guardar la evaluación."); }
    finally { submitLock.current = false; setBusy(false); }
  }

  return <div className="app-shell"><AppSidebar />
    <main className="app-main narrow-main" id="main-content" tabIndex={-1}><Link href="/app/evaluaciones" className="back-link">← Volver a evaluaciones</Link><span className="eyebrow">UN PRIMER PASO SENCILLO</span><h1>Crear evaluación</h1><p className="page-intro">Empezá con lo esencial. Después, en el espacio de corrección, vas a poder sumar materiales, elegir criterios y cargar una entrega.</p>
      {courses.length === 0 && !loadingCourses && <div className="notice" role="status">Primero creá un curso para mantener estudiantes y evaluaciones organizados. <Link href="/app/cursos">Crear curso →</Link></div>}
      <form className="form-card quick-assessment-form" onSubmit={submit}><div className="quick-form-intro"><span className="quick-form-icon" aria-hidden="true">✳</span><div><h2>Tu evaluación</h2><p>Solo necesitamos saber qué vas a preparar y en qué curso.</p></div></div>
        <label htmlFor="course">Curso <span>*</span></label><select id="course" value={courseId} onChange={event => { setCourseId(event.target.value); const selected = courses.find(item => String(item.id) === event.target.value); if (selected) { setSubject(selected.subject); setLevel(selected.level); } }} required disabled={loadingCourses || courses.length === 0}><option value="">Seleccionar curso…</option>{courses.map(course => <option key={course.id} value={course.id}>{course.name}</option>)}</select>
        <label htmlFor="title">Nombre de la evaluación <span>*</span></label><input id="title" value={title} onChange={event => setTitle(event.target.value)} required maxLength={180} placeholder="Ej. Ecosistemas y relaciones tróficas" autoFocus />
        <div className="form-two"><div><label htmlFor="subject">Materia o área <span className="muted">(opcional)</span></label><input id="subject" value={subject} onChange={event => setSubject(event.target.value)} maxLength={120} placeholder="Ciencias Naturales" /></div><div><label htmlFor="level">Nivel / año <span className="muted">(opcional)</span></label><input id="level" value={level} onChange={event => setLevel(event.target.value)} maxLength={120} placeholder="2.º año de secundaria" /></div></div>
        <details className="advanced-assessment-fields"><summary>Agregar objetivos y consigna ahora <span>(podés hacerlo después)</span></summary><label htmlFor="objectives">Objetivos de aprendizaje</label><textarea id="objectives" value={objectives} onChange={event => setObjectives(event.target.value)} rows={3} maxLength={5000} placeholder="¿Qué deberían comprender o demostrar los estudiantes?" /><label htmlFor="instructions">Consigna general / indicaciones</label><textarea id="instructions" value={instructions} onChange={event => setInstructions(event.target.value)} rows={4} maxLength={8000} placeholder="Consigna, contenidos, dificultad esperada o instrucciones para la corrección…" /></details>
        <div className="quick-form-next"><div><b>¿Qué sigue?</b><p>Vas a entrar en un espacio guiado para agregar materiales, criterios y la respuesta del estudiante.</p></div><span aria-hidden="true">→</span></div>
        {error && <p className="error-message" role="alert">{error}</p>}<div className="form-actions"><Link href="/app/evaluaciones" className="button button-quiet">Cancelar</Link><button className="button button-primary" disabled={busy || loadingCourses || courses.length === 0}>{busy ? "Creando…" : "Crear y preparar corrección →"}</button></div>
      </form>
    </main></div>;
}
