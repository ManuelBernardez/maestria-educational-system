"use client";

import AppSidebar from "@/components/AppSidebar";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";

type Course = { id: number; name: string; subject?: string; active: boolean };
type Assessment = {
  id: number | string;
  title: string;
  subject?: string;
  level?: string;
  status?: string;
  updated_at?: string;
  course?: number | null;
  course_name?: string | null;
};

function statusLabel(status?: string) {
  if (!status || status === "draft") return "Borrador";
  if (status === "ready") return "Lista para usar";
  if (status === "archived") return "Archivada";
  return status;
}

export default function AssessmentsPage() {
  const requestController = useRef<AbortController | null>(null);
  const [items, setItems] = useState<Assessment[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [courseFilter, setCourseFilter] = useState("all");

  const loadAssessments = useCallback(async () => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setError("");
    try {
      const [assessments, courseRows] = await Promise.all([
        api<Assessment[]>("/assessments/", { signal: controller.signal }),
        api<Course[]>("/courses/", { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      setItems(Array.isArray(assessments) ? assessments : []);
      setCourses(Array.isArray(courseRows) ? courseRows : []);
    } catch (caught) {
      if (controller.signal.aborted || (caught instanceof Error && caught.name === "AbortError")) return;
      setError(caught instanceof Error ? caught.message : "No pudimos cargar tus evaluaciones.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const courseFromUrl = new URLSearchParams(window.location.search).get("course");
    if (courseFromUrl && /^\d+$/.test(courseFromUrl)) setCourseFilter(courseFromUrl);
    void loadAssessments();
    return () => requestController.current?.abort();
  }, [loadAssessments]);

  const filteredItems = useMemo(() => items.filter((item) => {
    const status = item.status || "draft";
    const matchesStatus = statusFilter === "all" || status === statusFilter;
    const matchesCourse = courseFilter === "all" || String(item.course ?? "unassigned") === courseFilter;
    const text = `${item.title} ${item.subject || ""} ${item.level || ""} ${item.course_name || ""}`.toLocaleLowerCase("es-AR");
    return matchesStatus && matchesCourse && text.includes(query.trim().toLocaleLowerCase("es-AR"));
  }), [items, statusFilter, courseFilter, query]);

  const groupedItems = useMemo(() => {
    const groups = new Map<string, { name: string; rows: Assessment[] }>();
    for (const item of filteredItems) {
      const key = item.course == null ? "unassigned" : String(item.course);
      const groupName = item.course_name?.trim() || courses.find((course) => String(course.id) === String(item.course))?.name || "Sin curso asignado";
      if (!groups.has(key)) groups.set(key, { name: groupName, rows: [] });
      groups.get(key)!.rows.push(item);
    }
    return Array.from(groups.entries()).map(([id, group]) => ({ id, ...group }));
  }, [filteredItems, courses]);

  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="app-main" id="main-content" tabIndex={-1}>
        <header className="app-header">
          <div><span className="eyebrow">PLANIFICACIÓN</span><h1>Evaluaciones</h1><p>Consignas y criterios organizados por materia o curso.</p></div>
          <Link className="button button-primary" href="/app/evaluaciones/nueva">＋ Nueva evaluación</Link>
        </header>

        {!loading && !error && items.length > 0 && <section className="ux-filter-bar" aria-label="Filtros de evaluaciones">
          <label htmlFor="assessment-search">Buscar<input id="assessment-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Título, materia o nivel…" /></label>
          <label htmlFor="assessment-course">Materia o curso<select id="assessment-course" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="all">Todos los cursos</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}{items.some((item) => item.course == null) && <option value="unassigned">Sin curso asignado</option>}</select></label>
          <label htmlFor="assessment-status">Estado<select id="assessment-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos</option><option value="draft">Borradores</option><option value="ready">Listas</option><option value="archived">Archivadas</option></select></label>
          <span className="ux-filter-count">{filteredItems.length} de {items.length}</span>
        </section>}

        {loading ? <div className="empty-state" role="status" aria-live="polite"><div className="loading-bar" aria-hidden="true"><span /></div><p>Estamos cargando tus evaluaciones…</p></div> : error ? (
          <section className="app-load-error" role="alert"><span className="app-load-error-icon" aria-hidden="true">!</span><div><h2>No pudimos cargar las evaluaciones</h2><p>{error}</p><div className="hero-actions"><button type="button" className="button button-primary" onClick={() => void loadAssessments()}>Intentar nuevamente</button><Link href="/app" className="button button-quiet">Volver al espacio docente</Link></div></div></section>
        ) : items.length === 0 ? (
          <section className="empty-state"><div className="empty-icon" aria-hidden="true">▤</div><h2>Todavía no creaste evaluaciones</h2><p>Creá una evaluación dentro de una materia para mantener juntas sus consignas, entregas y correcciones.</p><Link className="button button-primary" href="/app/evaluaciones/nueva">Crear primera evaluación</Link></section>
        ) : filteredItems.length === 0 ? (
          <div className="empty-state"><h2>No encontramos evaluaciones</h2><p>Probá con otra búsqueda o cambiá los filtros.</p><button type="button" className="button button-quiet" onClick={() => { setQuery(""); setStatusFilter("all"); setCourseFilter("all"); }}>Limpiar filtros</button></div>
        ) : (
          <div className="course-section-list">
            {groupedItems.map((group) => <section className="course-list-group" key={group.id} aria-labelledby={`assessments-course-${group.id}`}>
              <header className="course-group-heading"><div><span className="course-group-mark" aria-hidden="true">▤</span><div><h2 id={`assessments-course-${group.id}`}>{group.name}</h2><p>{group.rows.length} {group.rows.length === 1 ? "evaluación" : "evaluaciones"}</p></div></div>{group.id !== "unassigned" && <Link href={`/app/cursos/${group.id}`} className="text-link">Abrir curso →</Link>}</header>
              <div className="assessment-list" aria-label={`Evaluaciones de ${group.name}`}>
                {group.rows.map((item) => <Link className="assessment-row assessment-row-link" href={`/app/evaluaciones/${item.id}`} key={item.id}>
                  <span className="assessment-icon" aria-hidden="true">▤</span><span className="assessment-info"><strong>{item.title}</strong><span>{[item.subject, item.level].filter(Boolean).join(" · ") || "Sin materia o nivel adicional"}</span></span>
                  <span className={`status-pill ${item.status === "ready" ? "delivery-status-approved" : item.status === "archived" ? "delivery-status-rejected" : "delivery-status-review"}`}>{statusLabel(item.status)}</span><span className="row-arrow" aria-hidden="true">→</span>
                </Link>)}
              </div>
            </section>)}
          </div>
        )}
        <p className="app-disclaimer">Las propuestas de IA son asistencias revisables. La decisión final de calificación siempre corresponde al docente.</p>
      </main>
    </div>
  );
}
