"use client";

import "../styles/panel-inicio-docente.css";

import AppSidebar from "@/components/AppSidebar";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import { readPreference, writePreference } from "@/lib/preferences";
import QuickStartTour from "@/components/QuickStartTour";

type Assessment = { id: number | string; title: string; subject: string; level: string; status: string; updated_at: string };
type Activity = { id: number; event_type: string; object_type: string; object_id: string; detail: Record<string, unknown>; created_at: string };
type Summary = { courses: number; assessments: number; students: number; submissions: number; pending_corrections: number; approved_corrections: number; recent_activity: Activity[] };

function activityHref(event: Activity) {
  if (event.object_type === "assessment" && event.object_id) return `/app/evaluaciones/${event.object_id}`;
  if (event.object_type === "course" && event.object_id) return `/app/cursos/${event.object_id}`;
  if (event.object_type === "student") return "/app/alumnos";
  if (event.object_type === "submission") return "/app/entregas";
  if (event.object_type === "correction") return "/app/correcciones";
  return "/app";
}

function activityLabel(event: Activity) {
  const labels: Record<string, string> = {
    "correction.proposed": "Propuesta de corrección generada",
    "correction.approved": "Corrección aprobada",
    "students.imported": "Importación de alumnos",
    "submission.imported": "Respuesta cargada",
    "questions.proposed": "Preguntas propuestas",
    "assessment.created": "Evaluación creada",
  };
  return labels[event.event_type] || "Actividad registrada";
}

export default function AppHome() {
  const [items, setItems] = useState<Assessment[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("Docente");
  const [feedbackStyle, setFeedbackStyle] = useState("constructivo");
  const [seedingDemo, setSeedingDemo] = useState(false);
  const [demoMessage, setDemoMessage] = useState("");
  const [demoError, setDemoError] = useState("");
  const router = useRouter();

  async function openPracticeExample() {
    setSeedingDemo(true);
    setDemoMessage("");
    setDemoError("");
    try {
      const workspace = await api<{ ai_provider?: string }>("/correction-workspace/");
      if (!workspace.ai_provider || workspace.ai_provider === "mock") {
        throw new Error("La IA está en modo MOCK, que solo genera resultados simulados. Para probar el flujo real, configurá un proveedor de IA en el servidor (por ejemplo Gemini), habilitá el procesamiento externo de forma consciente y volvé a intentarlo.");
      }
      const result = await api<{ assessment_id: number; message: string }>("/demo/seed/", { method: "POST", body: JSON.stringify({}) });
      setDemoMessage(result.message || "El ejemplo está listo.");
      router.push(`/app/espacio-correccion?assessment=${result.assessment_id}`);
    } catch (caught) {
      setDemoError(caught instanceof Error ? caught.message : "No se pudo preparar el ejemplo de práctica.");
    } finally {
      setSeedingDemo(false);
    }
  }

  useEffect(() => {
    setFeedbackStyle(readPreference("maestria-feedback-style", "constructivo"));
    let active = true;
    (async () => {
      const session = await supabase?.auth.getSession();
      if (!session?.data.session) {
        router.replace("/login");
        return;
      }
      const user = session.data.session.user;
      const metadata = user.user_metadata ?? {};
      const fullName = typeof metadata.full_name === "string" ? metadata.full_name.trim() : "";
      const savedStyle = metadata.maestria_feedback_style;
      if (active) {
        setName(fullName || user.email?.split("@")[0] || "Docente");
        if (savedStyle === "formal" || savedStyle === "constructivo" || savedStyle === "motivador") {
          setFeedbackStyle(savedStyle);
          writePreference("maestria-feedback-style", savedStyle);
        }
      }
      try {
        const [assessments, stats] = await Promise.all([
          api<Assessment[]>("/assessments/"),
          api<Summary>("/dashboard/summary/"),
        ]);
        if (active) {
          setItems(Array.isArray(assessments) ? assessments : []);
          setSummary(stats);
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "No se pudieron cargar los datos del espacio docente.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);



  const metrics = [
    { label: "Evaluaciones", count: summary?.assessments ?? items.length, detail: "Diseños y consignas", href: "/app/evaluaciones", action: "Gestionar evaluaciones" },
    { label: "En revisión", count: summary?.pending_corrections ?? "—", detail: "Propuestas por aprobar", href: "/app/correcciones", action: "Revisar propuestas" },
    { label: "Cursos", count: summary?.courses ?? "—", detail: "Espacios de trabajo", href: "/app/cursos", action: "Organizar cursos" },
    { label: "Alumnos", count: summary?.students ?? "—", detail: "En tu listado activo", href: "/app/alumnos", action: "Gestionar alumnos" },
    { label: "Entregas", count: summary?.submissions ?? "—", detail: "Respuestas recibidas", href: "/app/entregas", action: "Ver entregas" },
  ];

  return (
    <div className="app-shell">
      <AppSidebar />

      <main className="app-main" id="main-content" tabIndex={-1}>
        <header className="app-header">
          <div><span className="eyebrow">TU ESPACIO DE TRABAJO</span><h1>Hola, {name}.</h1><p>Un buen día para preparar algo que valga la pena aprender.</p></div>
          <div className="dashboard-header-actions"><button type="button" className="button button-quiet" onClick={() => void openPracticeExample()} disabled={seedingDemo}>{seedingDemo ? "Preparando ejemplo…" : "Probar con ejemplo"}</button><Link href="/app/espacio-correccion" className="button button-quiet">✳ Corregir entrega</Link><Link href="/app/evaluaciones/nueva" className="button button-primary">＋ Nueva evaluación</Link></div>
        </header>

        <section className="teacher-tools form-card">
          <div><span className="eyebrow">TU ESTILO DOCENTE</span><h2>¿Cómo querés que suene la devolución?</h2><p className="muted">Esta preferencia se aplica a las próximas propuestas de IA. Siempre podés editar el texto.</p></div>
          <label htmlFor="feedback-style">Tono de retroalimentación<select id="feedback-style" value={feedbackStyle} onChange={event => { setFeedbackStyle(event.target.value); writePreference("maestria-feedback-style", event.target.value); }}><option value="formal">Formal / académico</option><option value="constructivo">Constructivo / orientador</option><option value="motivador">Motivador / empático</option></select></label>
          <Link href="/app/perfil" className="text-link">Perfil y preferencias →</Link>
        </section>

        <QuickStartTour />
        {demoError && <div className="notice" role="alert"><b>No pudimos preparar el ejemplo.</b><p>{demoError}</p><button className="button button-quiet" type="button" onClick={() => void openPracticeExample()} disabled={seedingDemo}>Intentar nuevamente</button></div>}
        {demoMessage && <p className="success-message" role="status">{demoMessage}</p>}
        <details className="practice-help-card"><summary><span aria-hidden="true">ⓘ</span> ¿Qué pasa cuando probás el ejemplo?</summary><ol><li>Se prepara un curso de práctica con nombres y respuestas completamente ficticios, dentro de tu cuenta.</li><li>Al generar una corrección, se llama al proveedor de IA configurado en el servidor; no se muestran puntuaciones simuladas como si fueran reales.</li><li>Podés revisar la evidencia, editar puntajes y comentarios, explicar cambios, aprobar el resultado, imprimirlo/guardarlo como PDF o exportarlo en Markdown.</li><li>Si el servidor está en modo MOCK o falta la clave del proveedor, la aplicación te lo indicará y no presentará una corrección ficticia como una real.</li></ol><p className="field-hint">Consejo: usá el conjunto de práctica antes de cargar datos personales de estudiantes.</p></details>

        <section className="metric-grid" aria-label="Resumen de actividad">
          {metrics.map(metric => <Link className="metric-card metric-card-link" href={metric.href} key={metric.label} aria-label={`${metric.label}: ${metric.count}. ${metric.action}`}><span>{metric.label}</span><strong>{metric.count}</strong><small>{metric.detail}</small><span className="metric-link-hint">{metric.action} <span aria-hidden="true">→</span></span></Link>)}
        </section>

        <section className="list-section">
          <div className="section-row"><div><h2>Tus evaluaciones</h2><p>Elegí una para editar preguntas, preparar su rúbrica o cargar respuestas.</p></div><Link href="/app/evaluaciones" className="text-link">Ver todas →</Link></div>
          {loading ? <div className="empty-state" role="status" aria-live="polite">Cargando tus evaluaciones…</div> : error ? <div className="notice" role="alert"><b>No pudimos cargar el resumen.</b><p>{error}</p><p>Tu sesión no se cierra por este error. Verificá la API e intentá nuevamente.</p><button className="button button-quiet" type="button" onClick={() => window.location.reload()}>Intentar nuevamente</button></div> : items.length === 0 ? <div className="empty-state"><div className="empty-icon" aria-hidden="true">✳</div><h3>Tu espacio empieza acá</h3><p>Creá una evaluación para ordenar preguntas, criterios y futuras correcciones.</p><Link className="button button-primary" href="/app/evaluaciones/nueva">Crear primera evaluación</Link></div> : <div className="assessment-list">{items.slice(0, 5).map(item => <Link className="assessment-row assessment-row-link" href={`/app/evaluaciones/${item.id}`} key={item.id}><span className="assessment-icon" aria-hidden="true">▤</span><span className="assessment-info"><strong>{item.title}</strong><span>{[item.subject, item.level].filter(Boolean).join(" · ") || "Sin materia o nivel indicado"}</span></span><span className="status-pill">{item.status === "draft" ? "Borrador" : item.status === "ready" ? "Lista" : item.status === "archived" ? "Archivada" : item.status}</span><span className="row-arrow" aria-hidden="true">→</span></Link>)}</div>}
        </section>

        <section className="list-section">
          <div className="section-row"><div><h2>Actividad reciente</h2><p>Un registro breve de acciones importantes.</p></div><div className="section-tools"><button className="button button-quiet" type="button" onClick={() => window.print()}>Imprimir resumen / PDF</button></div></div>
          {!summary?.recent_activity?.length ? <div className="empty-state"><div className="empty-icon" aria-hidden="true">✎</div><h3>Tu historial aparecerá acá</h3><p>Al generar o aprobar correcciones, MaestrIA registra acciones importantes sin guardar el contenido de las respuestas en los logs.</p></div> : <div className="activity-list">{summary.recent_activity.map(event => <Link className="activity-link" href={activityHref(event)} key={event.id}><span className="activity-dot" aria-hidden="true"/><span className="activity-copy"><b>{activityLabel(event)}</b><small>{new Date(event.created_at).toLocaleString("es-AR")} · {event.detail?.demo ? "Modo demostración" : "Registro de actividad"}</small></span><span className="row-arrow" aria-hidden="true">→</span></Link>)}</div>}
        </section>
        <p className="app-disclaimer">Las propuestas de IA son asistencias revisables. La decisión final de calificación siempre corresponde al docente.</p>
      </main>
    </div>
  );
}
