"use client";

import AppSidebar from "@/components/AppSidebar";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";

type Assessment = { id: number | string; title: string; subject?: string; level?: string };
type Submission = {
  id: number;
  assessment: number | string;
  question: number | null;
  student?: number | null;
  student_display_name?: string;
  student_name?: string;
  answer_text: string;
  source_filename?: string;
  source_type?: string;
  status: "pending" | "processing" | "review" | "approved" | string;
  created_at?: string;
};
type Correction = { id: number; submission: number; status: string; provider: string; proposal?: { demo?: boolean } };
type Filter = "all" | "pending" | "review" | "approved";

const statusText: Record<string, string> = {
  pending: "Pendiente de corrección",
  processing: "Procesando",
  review: "Lista para revisar",
  approved: "Corrección aprobada",
};

export default function DeliveriesPage() {
  const router = useRouter();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const session = await supabase?.auth.getSession();
      if (!session?.data.session) { router.replace("/login"); return; }
      const [received, exams, proposed] = await Promise.all([
        api<Submission[]>("/submissions/"),
        api<Assessment[]>("/assessments/"),
        api<Correction[]>("/corrections/"),
      ]);
      setSubmissions(Array.isArray(received) ? received : []);
      setAssessments(Array.isArray(exams) ? exams : []);
      setCorrections(Array.isArray(proposed) ? proposed : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron cargar las entregas.");
    } finally { setLoading(false); }
  }, [router]);

  useEffect(() => { void load(); }, [load]);

  const assessmentById = useMemo(() => new Map(assessments.map(item => [String(item.id), item] as const)), [assessments]);
  const correctionBySubmission = useMemo(() => {
    const latest = new Map<number, Correction>();
    // The API orders corrections newest-first; keep the first record for each submission.
    corrections.forEach(item => { if (!latest.has(item.submission)) latest.set(item.submission, item); });
    return latest;
  }, [corrections]);
  const filtered = useMemo(() => submissions.filter(item => {
    const correction = correctionBySubmission.get(item.id);
    const approved = correction?.status === "approved" || item.status === "approved";
    const needsReview = !!correction && correction.status !== "approved" || item.status === "review";
    const matchesFilter = filter === "all" || filter === "approved" && approved || filter === "review" && needsReview || filter === "pending" && !approved && !needsReview;
    const title = assessmentById.get(String(item.assessment))?.title || "";
    const student = item.student_display_name || item.student_name || "Estudiante sin identificar";
    const haystack = `${title} ${student} ${item.answer_text || ""} ${item.source_filename || ""}`.toLocaleLowerCase("es-AR");
    return matchesFilter && haystack.includes(query.trim().toLocaleLowerCase("es-AR"));
  }), [submissions, correctionBySubmission, assessmentById, filter, query]);

  const counts = useMemo(() => ({
    all: submissions.length,
    pending: submissions.filter(item => item.status === "pending" && !correctionBySubmission.has(item.id)).length,
    review: submissions.filter(item => item.status === "review" || (correctionBySubmission.has(item.id) && correctionBySubmission.get(item.id)?.status !== "approved")).length,
    approved: submissions.filter(item => item.status === "approved" || correctionBySubmission.get(item.id)?.status === "approved").length,
  }), [submissions, correctionBySubmission]);

  return <div className="app-shell">
    <AppSidebar />
    <main className="app-main" id="main-content" tabIndex={-1}>
      <div className="app-header">
        <div><span className="eyebrow">TRABAJO RECIBIDO</span><h1>Entregas</h1><p>Encontrá cada respuesta y continuá directamente con su revisión.</p></div>
        <div className="delivery-header-actions"><Link className="button button-quiet" href="/app/correcciones">Historial de correcciones</Link><Link className="button button-primary" href="/app/evaluaciones">Ver evaluaciones</Link></div>
      </div>
      <section className="delivery-summary metric-grid" aria-label="Estados de entrega">
        <button type="button" className={`metric-card metric-card-link ${filter === "all" ? "metric-selected" : ""}`} onClick={() => setFilter("all")}><span>Todas las entregas</span><strong>{counts.all}</strong><small>Ver el listado completo</small></button>
        <button type="button" className={`metric-card metric-card-link ${filter === "pending" ? "metric-selected" : ""}`} onClick={() => setFilter("pending")}><span>Pendientes</span><strong>{counts.pending}</strong><small>Sin propuesta generada</small></button>
        <button type="button" className={`metric-card metric-card-link ${filter === "review" ? "metric-selected" : ""}`} onClick={() => setFilter("review")}><span>Para revisar</span><strong>{counts.review}</strong><small>Propuestas pendientes</small></button>
        <button type="button" className={`metric-card metric-card-link ${filter === "approved" ? "metric-selected" : ""}`} onClick={() => setFilter("approved")}><span>Aprobadas</span><strong>{counts.approved}</strong><small>Resultado confirmado</small></button>
      </section>
      <section className="list-section">
        <div className="section-row"><div><h2>Respuestas recibidas</h2><p>Seleccioná una entrega para abrir la evaluación y seguir con su corrección.</p></div><label className="delivery-search">Buscar<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Alumno, evaluación o texto…" /></label></div>
        {error && <div className="app-load-error" role="alert"><b>No pudimos cargar las entregas.</b><p>{error}</p><button className="button button-primary" type="button" onClick={() => void load()}>Intentar nuevamente</button></div>}
        {loading ? <div className="empty-state" role="status" aria-live="polite">Cargando entregas…</div> : !error && filtered.length === 0 ? <div className="empty-state"><div className="empty-icon" aria-hidden="true">⇧</div><h2>{submissions.length ? "No encontramos entregas con esos filtros" : "Todavía no hay entregas"}</h2><p>{submissions.length ? "Probá con otra búsqueda o elegí otro estado." : "Cargá una respuesta desde el detalle de una evaluación. Las respuestas aparecerán acá."}</p>{!submissions.length && <Link className="button button-primary" href="/app/evaluaciones">Ir a evaluaciones</Link>}</div> : !error && <div className="delivery-list">{filtered.map(item => {
          const assessment = assessmentById.get(String(item.assessment));
          const correction = correctionBySubmission.get(item.id);
          const state = correction?.status === "approved" || item.status === "approved" ? "approved" : correction || item.status === "review" ? "review" : item.status;
          return <Link className="delivery-row" href={`/app/espacio-correccion?assessment=${encodeURIComponent(String(item.assessment))}&submission=${item.id}`} key={item.id}>
            <span className="delivery-file-icon" aria-hidden="true">{state === "approved" ? "✓" : state === "review" ? "◷" : "⇧"}</span>
            <span className="delivery-row-main"><strong>{item.student_display_name || item.student_name || "Estudiante sin identificar"}</strong><span>{assessment?.title || `Evaluación #${item.assessment}`}{item.source_filename ? ` · ${item.source_filename}` : ""}</span><small>{(item.answer_text || "Documento importado").slice(0, 150)}{(item.answer_text || "").length > 150 ? "…" : ""}</small></span>
            <span className={`status-pill delivery-status ${state === "approved" ? "delivery-status-approved" : state === "review" ? "delivery-status-review" : ""}`}>{statusText[state] || "Pendiente"}</span><span className="row-arrow" aria-hidden="true">→</span>
          </Link>;
        })}</div>}
      </section>
      <p className="app-disclaimer">Las propuestas de IA son asistencias revisables. La decisión final de calificación siempre corresponde al docente.</p>
    </main>
  </div>;
}
