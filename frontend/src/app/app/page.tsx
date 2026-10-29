"use client";

import "../styles/panel-inicio-docente.css";
import AppSidebar from "@/components/AppSidebar";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";

type Assessment = {
  id: number | string;
  title: string;
  subject: string;
  level: string;
  status: string;
  updated_at: string;
  course?: number | null;
  course_name?: string | null;
};
type Activity = { id: number; event_type: string; object_type: string; object_id: string; detail: Record<string, unknown>; created_at: string };
type Summary = { courses: number; assessments: number; students: number; submissions: number; pending_corrections: number; approved_corrections: number; recent_activity: Activity[] };
type Course = { id: number; name: string; subject?: string; level?: string; academic_year?: string; active: boolean; student_count: number; assessment_count: number };
type CorrectionSummary = { id: number; submission: number; status: string; course_id?: number | null; course_name?: string | null; submission_title?: string; student_name?: string };
type CourseOverview = Course & { pending: number; approved: number; recentAssessments: Assessment[] };

function activityHref(event: Activity) {
  if (event.object_type === "assessment" && event.object_id) return `/app/evaluaciones/${event.object_id}`;
  if (event.object_type === "course" && event.object_id) return `/app/cursos/${event.object_id}`;
  if (event.object_type === "student") return "/app/alumnos";
  if (event.object_type === "submission" || event.object_type === "correction") return "/app/espacio-correccion";
  return "/app";
}

function activityLabel(event: Activity) {
  const labels: Record<string, string> = {
    "correction.proposed": "Nueva propuesta de corrección",
    "correction.approved": "Corrección aprobada",
    "students.imported": "Estudiantes importados",
    "submission.imported": "Entrega cargada",
    "questions.proposed": "Consignas propuestas",
    "assessment.created": "Evaluación creada",
  };
  return labels[event.event_type] || "Actividad registrada";
}

function statusLabel(status: string) {
  if (status === "draft" || !status) return "Borrador";
  if (status === "ready") return "Lista para usar";
  if (status === "archived") return "Archivada";
  return status;
}

export default function AppHome() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [corrections, setCorrections] = useState<CorrectionSummary[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [demoError, setDemoError] = useState("");
  const router = useRouter();
  const demoActionLock = useRef(false);
  const loadController = useRef<AbortController | null>(null);

  const loadDashboard = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError("");
    try {
      const session = await supabase?.auth.getSession();
      if (controller.signal.aborted) return;
      if (!session?.data.session) {
        router.replace("/login");
        return;
      }

      const [coursesResult, assessmentsResult, correctionsResult, summaryResult] = await Promise.allSettled([
        api<Course[]>("/courses/", { signal: controller.signal }),
        api<Assessment[]>("/assessments/", { signal: controller.signal }),
        api<CorrectionSummary[]>("/corrections/?summary=1", { signal: controller.signal }),
        api<Summary>("/dashboard/summary/", { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      const errors: string[] = [];
      if (coursesResult.status === "fulfilled") setCourses(Array.isArray(coursesResult.value) ? coursesResult.value : []);
      else errors.push("No se pudieron cargar las materias.");
      if (assessmentsResult.status === "fulfilled") setAssessments(Array.isArray(assessmentsResult.value) ? assessmentsResult.value : []);
      else errors.push("No se pudieron cargar las evaluaciones.");
      if (correctionsResult.status === "fulfilled") setCorrections(Array.isArray(correctionsResult.value) ? correctionsResult.value : []);
      else errors.push("No se pudo cargar el estado de las correcciones.");
      if (summaryResult.status === "fulfilled") setSummary(summaryResult.value);
      else errors.push("No se pudo cargar el resumen general.");
      setError(errors.join(" "));
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "No se pudo cargar el espacio docente.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadDashboard();
    return () => loadController.current?.abort();
  }, [loadDashboard]);

  async function openPracticeExample() {
    if (demoActionLock.current) return;
    demoActionLock.current = true;
    setSeedingDemo(true);
    setDemoError("");
    try {
      const workspace = await api<{ ai_provider?: string }>("/correction-workspace/");
      if (!workspace.ai_provider || workspace.ai_provider === "mock") {
        throw new Error("El entorno está configurado con propuestas simuladas. Para probar una corrección real, el administrador debe configurar el proveedor y autorizar el procesamiento externo en el servidor.");
      }
      const result = await api<{ assessment_id: number; message: string }>("/demo/seed/", { method: "POST", body: JSON.stringify({}) });
      router.push(`/app/espacio-correccion?assessment=${result.assessment_id}`);
    } catch (caught) {
      setDemoError(caught instanceof Error ? caught.message : "No se pudo preparar el ejemplo de práctica.");
    } finally {
      demoActionLock.current = false;
      setSeedingDemo(false);
    }
  }

  const courseOverviews = useMemo<CourseOverview[]>(() => courses
    .filter((course) => course.active)
    .map((course) => {
      const courseCorrections = corrections.filter((item) => String(item.course_id ?? "") === String(course.id));
      return {
        ...course,
        pending: courseCorrections.filter((item) => item.status === "pending_review").length,
        approved: courseCorrections.filter((item) => item.status === "approved").length,
        recentAssessments: assessments.filter((item) => String(item.course ?? "") === String(course.id)).slice(0, 2),
      };
    }), [courses, corrections, assessments]);

  const unassignedAssessments = useMemo(() => assessments.filter((item) => !item.course), [assessments]);
  const approvedCount = summary?.approved_corrections ?? corrections.filter((item) => item.status === "approved").length;
  // Heuristic only: not a measured user outcome. Keep the estimate explicit in the UI.
  const estimatedSavedMinutes = approvedCount * 8;
  const estimatedSavedTime = estimatedSavedMinutes >= 60
    ? `${(estimatedSavedMinutes / 60).toLocaleString("es-AR", { maximumFractionDigits: 1 })} h`
    : `${estimatedSavedMinutes} min`;
  const metrics = [
    { label: "Por revisar", count: summary?.pending_corrections ?? corrections.filter((item) => item.status === "pending_review").length, detail: "Propuestas que esperan tu decisión", tone: "pending" },
    { label: "Revisadas", count: approvedCount, detail: "Devoluciones aprobadas por vos", tone: "reviewed" },
    { label: "Tiempo ahorrado estimado", count: estimatedSavedTime, detail: "Estimación orientativa · 8 min por devolución aprobada", tone: "saved" },
  ];

  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="app-main" id="main-content" tabIndex={-1}>
        <header className="app-header dashboard-welcome">
          <div><span className="eyebrow">MI ESPACIO</span><h1>Panel docente</h1><p>Un vistazo a tus materias y a las entregas que necesitan tu revisión.</p></div>
          <div className="dashboard-header-actions">
            <Link href="/app/espacio-correccion" className="button button-quiet">Espacio de trabajo</Link>
            <Link href="/app/cursos?new=1" className="button button-primary">＋ Agregar materia</Link>
          </div>
        </header>

        {demoError && <div className="notice dashboard-notice" role="alert"><b>No pudimos preparar el ejemplo.</b><p>{demoError}</p><button className="button button-quiet" type="button" onClick={() => void openPracticeExample()} disabled={seedingDemo}>Intentar nuevamente</button></div>}
        {error && <div className="app-load-error dashboard-notice" role="alert"><div className="app-load-error-icon" aria-hidden="true">!</div><div><h2>Algunos datos no se pudieron cargar</h2><p>{error}</p><button className="button button-primary" type="button" onClick={() => void loadDashboard()}>Actualizar resumen</button></div></div>}

        <section className="metric-grid dashboard-metrics" aria-label="Resumen de actividad">
          {metrics.map((metric) => <article className={`metric-card metric-${metric.tone}`} key={metric.label}><span>{metric.label}</span><strong>{loading ? "—" : metric.count}</strong><small>{metric.detail}</small></article>)}
        </section>

        <div className="dashboard-workspace-grid">
        <section className="list-section course-dashboard-section" aria-labelledby="my-courses-title">
          <div className="section-row"><div><h2 id="my-courses-title">Tus materias y cursos</h2><p>Las evaluaciones, estudiantes y correcciones se organizan dentro de cada espacio.</p></div><Link href="/app/cursos" className="button button-quiet button-small">Ver todos</Link></div>
          {loading ? <div className="empty-state" role="status" aria-live="polite">Cargando tus materias…</div> : courseOverviews.length === 0 ? (
            <div className="empty-state"><div className="empty-icon" aria-hidden="true">▣</div><h3>Creá tu primer curso</h3><p>Un curso reúne estudiantes, evaluaciones, entregas y devoluciones para que puedas trabajar sin mezclar materias.</p><Link className="button button-primary" href="/app/cursos">Crear curso</Link></div>
          ) : (
            <div className="course-dashboard-grid">
              {courseOverviews.map((course) => (
                <details className="course-dashboard-card" key={course.id} open>
                  <summary className="course-dashboard-card-head"><span className="course-dashboard-icon" aria-hidden="true">▣</span><div><h3>{course.name}</h3><p>{[course.subject, course.level, course.academic_year].filter(Boolean).join(" · ") || "Materia o comisión"}</p></div><span className="course-card-chevron" aria-hidden="true">⌄</span></summary>
                  <div className="course-dashboard-card-body"><div className="course-dashboard-counts"><span><strong>{course.student_count ?? 0}</strong> estudiantes</span><span><strong>{course.assessment_count ?? 0}</strong> evaluaciones</span><span><strong>{course.pending}</strong> por revisar</span></div>
                  {course.recentAssessments.length > 0 ? <div className="course-recent-assessments"><span className="course-section-label">Evaluaciones recientes</span>{course.recentAssessments.map((assessment) => <Link href={`/app/evaluaciones/${assessment.id}`} key={assessment.id} className="course-assessment-link"><span>{assessment.title}</span><span className={`status-pill ${assessment.status === "ready" ? "delivery-status-approved" : assessment.status === "archived" ? "delivery-status-rejected" : "delivery-status-review"}`}>{statusLabel(assessment.status)}</span></Link>)}</div> : <p className="course-empty-hint">Todavía no hay evaluaciones en esta materia.</p>}
                  <footer className="course-dashboard-actions"><Link href={`/app/cursos/${course.id}`}>Abrir espacio →</Link><Link href={`/app/correcciones?course=${course.id}`}>Correcciones{course.pending > 0 ? ` (${course.pending})` : ""}</Link></footer></div>
                </details>
              ))}
            </div>
          )}
          {!loading && unassignedAssessments.length > 0 && <details className="unassigned-assessments"><summary>Evaluaciones sin curso asignado ({unassignedAssessments.length})</summary><div>{unassignedAssessments.map((assessment) => <Link href={`/app/evaluaciones/${assessment.id}`} key={assessment.id}>{assessment.title}<span>{[assessment.subject, assessment.level].filter(Boolean).join(" · ") || "Sin materia"}</span></Link>)}</div><p>Podés asignarlas a un curso desde el editor de cada evaluación.</p></details>}
        </section>

        <details className="list-section dashboard-activity-section dashboard-foldable-section" open>
          <summary className="section-row"><div><h2 id="recent-activity-title">Actividad reciente</h2><p>Los últimos movimientos de tus materias.</p></div><span className="course-card-chevron" aria-hidden="true">⌄</span></summary>
          {summary?.recent_activity?.length ? <div className="activity-list">{summary.recent_activity.slice(0, 5).map((event) => <Link className="activity-link" href={activityHref(event)} key={event.id}><span className="activity-dot" aria-hidden="true"/><span className="activity-copy"><b>{activityLabel(event)}</b><small>{new Date(event.created_at).toLocaleString("es-AR")} · {event.detail?.demo ? "Práctica" : "Registro de actividad"}</small></span><span className="row-arrow" aria-hidden="true">→</span></Link>)}</div> : <div className="dashboard-activity-empty">Todavía no hay movimientos registrados. Cuando corrijas o recibas entregas, vas a ver la actividad acá.</div>}
        </details>
        </div>
        <p className="app-disclaimer">MaestrIA propone correcciones; la decisión final sobre cada nota siempre es tuya.</p>
      </main>
    </div>
  );
}
