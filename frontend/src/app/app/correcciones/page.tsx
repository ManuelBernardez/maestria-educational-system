"use client";

import "../../styles/espacio-correccion.css";
import AppSidebar from "@/components/AppSidebar";
import CorrectionShareModal, { type CorrectionShareData, type ShareableProposal } from "@/components/CorrectionShareModal";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, downloadApiFile } from "@/lib/api";

type Criterion = {
  criterion: string;
  score: number;
  max_score: number;
  justification: string;
  evidence: string;
  level?: string;
  question_prompt?: string;
};
type CorrectionProposal = Omit<ShareableProposal, "criteria"> & {
  criteria: Criterion[];
  warnings?: string[];
  demo?: boolean;
};
type Correction = {
  id: number;
  submission: number;
  submission_assessment_id: number | string;
  status: string;
  proposal: CorrectionProposal | null;
  final_result: CorrectionProposal | null;
  teacher_feedback: string;
  total_score: string;
  submission_title: string;
  student_name: string;
  student_email?: string;
  course_id?: number | null;
  course_name?: string | null;
  subject?: string;
  created_at: string;
};
type StatusFilter = "all" | "pending_review" | "approved" | "rejected";
type CourseOption = { id: number; name: string; active: boolean };

function getVisibleProposal(correction: Correction): CorrectionProposal {
  const source = correction.status === "approved" && correction.final_result?.criteria?.length
    ? correction.final_result
    : correction.proposal ?? correction.final_result;
  if (!source || typeof source !== "object") return { criteria: [] };
  return {
    ...source,
    criteria: Array.isArray(source.criteria) ? source.criteria : [],
    strengths: Array.isArray(source.strengths) ? source.strengths : [],
    improvement_suggestions: Array.isArray(source.improvement_suggestions) ? source.improvement_suggestions : [],
  };
}

function statusLabel(status: string): string {
  if (status === "approved") return "Aprobada";
  if (status === "rejected") return "Rechazada";
  return "Pendiente de revisión";
}

function statusClass(status: string): string {
  if (status === "approved") return "delivery-status-approved";
  if (status === "rejected") return "delivery-status-rejected";
  return "delivery-status-review";
}

function courseName(correction: Correction): string {
  return correction.course_name?.trim() || "Sin curso asignado";
}

export default function CorrectionsPage() {
  const [items, setItems] = useState<Correction[]>([]);
  const [courseRows, setCourseRows] = useState<CourseOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [shareCorrection, setShareCorrection] = useState<Correction | null>(null);
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // Explicit true means expanded. Every correction starts compact by default.
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const loadController = useRef<AbortController | null>(null);
  const exportLock = useRef<number | null>(null);
  const closeShareModal = useCallback(() => setShareCorrection(null), []);

  const load = useCallback(async (showLoading = true) => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    if (showLoading) setLoading(true);
    setError("");
    try {
      const [correctionsResult, coursesResult] = await Promise.allSettled([
        api<Correction[]>("/corrections/", { signal: controller.signal }),
        api<CourseOption[]>("/courses/", { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      if (correctionsResult.status === "rejected") throw correctionsResult.reason;
      const safeItems = Array.isArray(correctionsResult.value) ? correctionsResult.value : [];
      setItems(safeItems);
      setCourseRows(coursesResult.status === "fulfilled" && Array.isArray(coursesResult.value) ? coursesResult.value : []);
      setExpanded({});
    } catch (caught) {
      if (controller.signal.aborted || (caught instanceof Error && caught.name === "AbortError")) return;
      setError(caught instanceof Error ? caught.message : "No se pudieron cargar las correcciones.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const courseFromUrl = params.get("course");
    const statusFromUrl = params.get("status");
    if (courseFromUrl && /^\d+$/.test(courseFromUrl)) setCourseFilter(courseFromUrl);
    if (statusFromUrl === "approved" || statusFromUrl === "pending_review" || statusFromUrl === "rejected") setStatusFilter(statusFromUrl);
    void load();
    return () => loadController.current?.abort();
  }, [load]);

  const courses = useMemo(() => {
    const unique = new Map<string, string>();
    courseRows.forEach((course) => unique.set(String(course.id), course.name));
    // Keep a fallback for archived/legacy course references if the course list is unavailable.
    items.forEach((item) => {
      if (item.course_id != null && !unique.has(String(item.course_id))) unique.set(String(item.course_id), courseName(item));
    });
    return Array.from(unique.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "es-AR"));
  }, [courseRows, items]);

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es-AR");
    return items.filter((item) => {
      const searchable = [item.student_name, item.submission_title, item.teacher_feedback, item.proposal?.summary, item.course_name, item.subject]
        .filter(Boolean).join(" ").toLocaleLowerCase("es-AR");
      const matchesSearch = !needle || searchable.includes(needle);
      const matchesCourse = courseFilter === "all" || String(item.course_id ?? "unassigned") === courseFilter;
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      return matchesSearch && matchesCourse && matchesStatus;
    });
  }, [items, search, courseFilter, statusFilter]);

  const groupedItems = useMemo(() => {
    const groups = new Map<string, { name: string; rows: Correction[] }>();
    for (const item of filteredItems) {
      const key = item.course_id == null ? "unassigned" : String(item.course_id);
      const resolvedCourseName = item.course_name?.trim()
        || courses.find((course) => String(course.id) === key)?.name
        || courseName(item);
      if (!groups.has(key)) groups.set(key, { name: resolvedCourseName, rows: [] });
      groups.get(key)!.rows.push(item);
    }
    return Array.from(groups.entries()).map(([id, group]) => ({ id, ...group }));
  }, [filteredItems, courses]);

  async function exportMarkdown(correction: Correction) {
    if (exportLock.current === correction.id) return;
    exportLock.current = correction.id;
    setError("");
    setMessage("");
    try {
      await downloadApiFile(`/corrections/${correction.id}/export/`, `devolucion-maestria-${correction.id}.md`);
      setMessage(`Devolución de ${correction.student_name || "estudiante"} exportada en Markdown.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo exportar la devolución.");
    } finally {
      exportLock.current = null;
    }
  }

  const shareData = useMemo<CorrectionShareData | null>(() => {
    if (!shareCorrection || shareCorrection.status !== "approved") return null;
    const proposal = getVisibleProposal(shareCorrection);
    return {
      studentName: shareCorrection.student_name || "Estudiante sin identificar",
      studentEmail: shareCorrection.student_email || "",
      assessmentTitle: shareCorrection.submission_title,
      totalScore: shareCorrection.total_score !== "" && Number.isFinite(Number(shareCorrection.total_score))
        ? Number(shareCorrection.total_score)
        : proposal.criteria.reduce((sum, criterion) => sum + Number(criterion.score || 0), 0),
      teacherFeedback: shareCorrection.teacher_feedback,
      proposal,
    };
  }, [shareCorrection]);

  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="app-main" id="main-content" tabIndex={-1}>
        <header className="app-header">
          <div>
            <span className="eyebrow">SEGUIMIENTO POR MATERIA</span>
            <h1>Correcciones</h1>
            <p>Encontrá cada devolución por estudiante y curso. Abrí el detalle solo cuando lo necesites.</p>
          </div>
          <Link className="button button-primary" href="/app/espacio-correccion">＋ Corregir entrega</Link>
        </header>

        {error && <p className="error-message" role="alert">{error}</p>}
        {message && <p className="success-message" role="status" aria-live="polite">{message}</p>}

        {!loading && items.length > 0 && (
          <section className="ux-filter-bar" aria-label="Filtros de correcciones">
            <label htmlFor="corrections-search">Buscar
              <input id="corrections-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Estudiante, evaluación o comentario…" />
            </label>
            <label htmlFor="corrections-course">Materia o curso
              <select id="corrections-course" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
                <option value="all">Todos los cursos</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
                {items.some((item) => item.course_id == null) && <option value="unassigned">Sin curso asignado</option>}
              </select>
            </label>
            <label htmlFor="corrections-status">Estado
              <select id="corrections-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">Todos</option><option value="pending_review">Pendientes</option><option value="approved">Aprobadas</option><option value="rejected">Rechazadas</option>
              </select>
            </label>
            <span className="ux-filter-count">{filteredItems.length} de {items.length}</span>
          </section>
        )}

        {loading ? <div className="empty-state" role="status" aria-live="polite">Cargando correcciones…</div> : items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden="true">✓</div><h2>Todavía no hay correcciones</h2>
            <p>Elegí una evaluación, cargá una respuesta y generá una propuesta para verla acá.</p>
            <Link className="button button-primary" href="/app/espacio-correccion">Ir al espacio de corrección</Link>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="empty-state"><h2>No encontramos correcciones</h2><p>Probá con otra búsqueda o cambiá los filtros.</p><button type="button" className="button button-quiet" onClick={() => { setSearch(""); setCourseFilter("all"); setStatusFilter("all"); }}>Limpiar filtros</button></div>
        ) : (
          <div className="course-section-list">
            {groupedItems.map((group) => (
              <section className="correction-course-group" key={group.id} aria-labelledby={`corrections-course-${group.id}`}>
                <header className="course-group-heading">
                  <div><span className="course-group-mark" aria-hidden="true">▣</span><div><h2 id={`corrections-course-${group.id}`}>{group.name}</h2><p>{group.rows.length} {group.rows.length === 1 ? "corrección" : "correcciones"}</p></div></div>
                  {group.id !== "unassigned" && <Link href={`/app/cursos/${group.id}`} className="text-link">Abrir curso →</Link>}
                </header>
                <div className="correction-card-list">
                  {group.rows.map((correction) => {
                    const proposal = getVisibleProposal(correction);
                    const scoreTotal = proposal.criteria.reduce((sum, criterion) => sum + Number(criterion.score || 0), 0);
                    const maxTotal = proposal.criteria.reduce((sum, criterion) => sum + Number(criterion.max_score || 0), 0);
                    const storedScore = String(correction.total_score ?? "").trim();
                    const hasStoredScore = storedScore !== "" && Number.isFinite(Number(storedScore));
                    const useCriteriaScore = proposal.criteria.length > 0 && (correction.status !== "approved" || Boolean(correction.final_result?.criteria?.length));
                    const scoreAvailable = useCriteriaScore || hasStoredScore;
                    const displayScore = useCriteriaScore ? scoreTotal : hasStoredScore ? Number(storedScore) : 0;
                    const displayMaxScore = useCriteriaScore ? maxTotal : maxTotal > 0 ? maxTotal : 0;
                    const isExpanded = expanded[correction.id] === true;
                    const workspaceUrl = `/app/espacio-correccion?assessment=${encodeURIComponent(String(correction.submission_assessment_id))}&submission=${correction.submission}`;
                    return (
                      <article className="correction-compact-card" key={correction.id}>
                        <div className="correction-compact-main">
                          <div className="correction-person-avatar" aria-hidden="true">{(correction.student_name || "E").slice(0, 1).toLocaleUpperCase("es-AR")}</div>
                          <div className="correction-person-copy">
                            <h3><Link href={workspaceUrl}>{correction.student_name || "Estudiante sin identificar"}</Link></h3>
                            <p className="correction-assessment-name">{correction.submission_title}</p>
                            <p className="correction-secondary-meta">{[correction.subject, correction.created_at ? new Date(correction.created_at).toLocaleDateString("es-AR") : ""].filter(Boolean).join(" · ")}</p>
                          </div>
                          <div className="correction-grade-summary" aria-label={scoreAvailable ? `Puntaje ${displayScore}${displayMaxScore > 0 ? ` de ${displayMaxScore}` : " registrado"}` : "Sin puntaje disponible"}>
                            <strong>{scoreAvailable ? displayScore.toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "—"}</strong>
                            <span>{!scoreAvailable ? "Sin nota" : displayMaxScore > 0 ? `/ ${displayMaxScore.toLocaleString("es-AR", { maximumFractionDigits: 2 })} pts` : "Puntaje registrado"}</span>
                          </div>
                          <span className={`status-pill ${statusClass(correction.status)}`}>{statusLabel(correction.status)}</span>
                        </div>
                        {proposal.demo && <p className="correction-demo-note" role="note">Ejemplo de práctica · no es una calificación real</p>}
                        <div className="correction-compact-actions">
                          <button className="button button-quiet button-small" type="button" aria-expanded={isExpanded} aria-controls={`correction-detail-${correction.id}`} onClick={() => setExpanded((previous) => ({ ...previous, [correction.id]: !isExpanded }))}>{isExpanded ? "Ocultar detalle ↑" : "Ver devolución ↓"}</button>
                          <Link className="button button-small button-primary" href={workspaceUrl}>{correction.status === "approved" ? "Abrir corrección" : "Revisar corrección"} →</Link>
                        </div>
                        <div className="correction-compact-detail" id={`correction-detail-${correction.id}`} hidden={!isExpanded}>
                          <div className="correction-detail-toolbar">
                              <strong>Detalle de la devolución</strong>
                              <div>
                                {correction.status === "approved" && <button className="button button-quiet button-small" type="button" onClick={() => setShareCorrection(correction)}>Compartir devolución</button>}
                                <button className="button button-quiet button-small" type="button" disabled={exportLock.current === correction.id} onClick={() => void exportMarkdown(correction)}>Exportar .md</button>
                              </div>
                            </div>
                            {proposal.summary ? <p className="correction-history-summary">{proposal.summary}</p> : !proposal.criteria.length ? <p className="correction-history-summary">Esta corrección no contiene un detalle estructurado. Abrila para revisar el registro completo.</p> : null}
                            {proposal.strengths?.length ? <div className="ai-detail-lists"><h4>Fortalezas</h4><ul>{proposal.strengths.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
                            {proposal.improvement_suggestions?.length ? <div className="ai-detail-lists"><h4>Para seguir mejorando</h4><ul>{proposal.improvement_suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
                            <div className="correction-history-criteria">
                              {proposal.criteria.map((criterion, index) => (
                                <article className="criterion-review" key={`${criterion.criterion}-${index}`}>
                                  <div className="criterion-head"><b>{criterion.criterion}</b><span>{criterion.score} / {criterion.max_score}</span></div>
                                  {criterion.level && <span className="level-pill">Nivel sugerido: {criterion.level}</span>}
                                  <p>{criterion.justification}</p>
                                  <blockquote className="evidence-quote">{criterion.evidence ? `“${criterion.evidence}”` : "Sin evidencia literal; revisar manualmente."}</blockquote>
                                </article>
                              ))}
                            </div>
                            <p className="correction-feedback-line"><strong>Devolución:</strong> {correction.teacher_feedback || proposal.feedback || "Sin retroalimentación adicional."}</p>
                          </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
        <p className="app-disclaimer">La nota y la devolución son definitivas solo después de la aprobación docente.</p>
      </main>
      <CorrectionShareModal open={Boolean(shareCorrection)} data={shareCorrection ? {
        studentName: shareCorrection.student_name || "Estudiante sin identificar",
        studentEmail: shareCorrection.student_email || "",
        assessmentTitle: shareCorrection.submission_title,
        totalScore: shareData?.totalScore ?? Number(shareCorrection.total_score || 0),
        teacherFeedback: shareCorrection.teacher_feedback,
        proposal: getVisibleProposal(shareCorrection),
      } : null} onClose={closeShareModal} />
    </div>
  );
}
