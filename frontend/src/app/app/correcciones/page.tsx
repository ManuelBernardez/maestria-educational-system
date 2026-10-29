"use client";

import "../../styles/espacio-correccion.css";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { CorrectionShareData, ShareableProposal } from "@/components/CorrectionShareModal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, downloadApiFile } from "@/lib/api";

const CorrectionShareModal = dynamic(() => import("@/components/CorrectionShareModal"), { ssr: false });

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
type CorrectionSummary = {
  id: number;
  submission: number;
  submission_assessment_id: number | string;
  status: string;
  provider: string;
  total_score: string;
  submission_title: string;
  student_name: string;
  course_id?: number | null;
  course_name?: string | null;
  subject?: string;
  created_at: string;
};
type Correction = CorrectionSummary & {
  proposal: CorrectionProposal | null;
  final_result: CorrectionProposal | null;
  teacher_feedback: string;
  student_email?: string;
};
type StatusFilter = "all" | "pending_review" | "approved" | "rejected";
type CourseOption = { id: number; name: string; active: boolean };

function isStatusFilter(value: string): value is StatusFilter {
  return (
    value === "all" ||
    value === "pending_review" ||
    value === "approved" ||
    value === "rejected"
  );
}

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

function courseName(correction: CorrectionSummary): string {
  return correction.course_name?.trim() || "Sin curso asignado";
}

export default function CorrectionsPage() {
  const [items, setItems] = useState<CorrectionSummary[]>([]);
  const [courseRows, setCourseRows] = useState<CourseOption[]>([]);
  const [correctionDetails, setCorrectionDetails] = useState<Record<number, Correction>>({});
  const [detailLoading, setDetailLoading] = useState<Record<number, boolean>>({});
  const [detailErrors, setDetailErrors] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [shareCorrection, setShareCorrection] = useState<Correction | null>(null);
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const loadController = useRef<AbortController | null>(null);
  const exportLock = useRef<number | null>(null);
  const detailsRef = useRef<Map<number, Correction>>(new Map());
  const detailRequests = useRef<Map<number, Promise<Correction>>>(new Map());
  const closeShareModal = useCallback(() => setShareCorrection(null), []);

  const loadCorrectionDetail = useCallback((id: number): Promise<Correction> => {
    const cached = detailsRef.current.get(id);
    if (cached) return Promise.resolve(cached);
    const pending = detailRequests.current.get(id);
    if (pending) return pending;

    setDetailLoading((previous) => ({ ...previous, [id]: true }));
    setDetailErrors((previous) => {
      const next = { ...previous };
      delete next[id];
      return next;
    });

    const request = api<Correction>(`/corrections/${id}/`)
      .then((detail) => {
        detailsRef.current.set(id, detail);
        setCorrectionDetails((previous) => ({ ...previous, [id]: detail }));
        return detail;
      })
      .catch((caught: unknown) => {
        const text = caught instanceof Error ? caught.message : "No se pudo cargar el detalle de esta devolución.";
        setDetailErrors((previous) => ({ ...previous, [id]: text }));
        throw caught;
      })
      .finally(() => {
        detailRequests.current.delete(id);
        setDetailLoading((previous) => ({ ...previous, [id]: false }));
      });
    detailRequests.current.set(id, request);
    return request;
  }, []);

  const load = useCallback(async (showLoading = true) => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    if (showLoading) setLoading(true);
    setError("");
    try {
      const [correctionsResult, coursesResult] = await Promise.allSettled([
        api<CorrectionSummary[]>("/corrections/?summary=1", { signal: controller.signal }),
        api<CourseOption[]>("/courses/?nav=1", { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      if (correctionsResult.status === "rejected") throw correctionsResult.reason;
      const safeItems = Array.isArray(correctionsResult.value) ? correctionsResult.value : [];
      setItems(safeItems);
      setCourseRows(coursesResult.status === "fulfilled" && Array.isArray(coursesResult.value) ? coursesResult.value : []);
      setExpanded({});
      detailsRef.current.clear();
      detailRequests.current.clear();
      setCorrectionDetails({});
      setDetailLoading({});
      setDetailErrors({});
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
    items.forEach((item) => {
      if (item.course_id != null && !unique.has(String(item.course_id))) unique.set(String(item.course_id), courseName(item));
    });
    return Array.from(unique.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "es-AR"));
  }, [courseRows, items]);

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("es-AR");
    return items.filter((item) => {
      // The initial list only contains identifying fields. Long feedback and AI JSON are fetched on demand.
      const searchable = [item.student_name, item.submission_title, item.course_name, item.subject]
        .filter(Boolean).join(" ").toLocaleLowerCase("es-AR");
      const matchesSearch = !needle || searchable.includes(needle);
      const matchesCourse = courseFilter === "all" || String(item.course_id ?? "unassigned") === courseFilter;
      const matchesStatus = statusFilter === "all" || item.status === statusFilter;
      return matchesSearch && matchesCourse && matchesStatus;
    });
  }, [items, search, courseFilter, statusFilter]);

  const groupedItems = useMemo(() => {
    const groups = new Map<string, { name: string; rows: CorrectionSummary[] }>();
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

  async function exportMarkdown(correction: CorrectionSummary) {
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
    <>
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
              <input id="corrections-search" type="search" value={search} 
                onChange={(event) =>
                  setStatusFilter(
                    isStatusFilter(event.currentTarget.value)
                      ? event.currentTarget.value
                      : "all"
                  )
                } placeholder="Estudiante, evaluación o curso…" />
            </label>
            <label htmlFor="corrections-course">Materia o curso
              <select id="corrections-course" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
                <option value="all">Todos los cursos</option>
                {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
                {items.some((item) => item.course_id == null) && <option value="unassigned">Sin curso asignado</option>}
              </select>
            </label>
            <label htmlFor="corrections-status">Estado
              <select id="corrections-status" value={statusFilter} 
                onChange={(event) => {
                  const value = event.currentTarget.value;

                  if (
                    value === "all" ||
                    value === "pending_review" ||
                    value === "approved" ||
                    value === "rejected"
                  ) {
                    setStatusFilter(value);
                  }
                }}
              >
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
                    const detail = correctionDetails[correction.id];
                    const proposal = detail ? getVisibleProposal(detail) : null;
                    const scoreTotal = proposal?.criteria.reduce((sum, criterion) => sum + Number(criterion.score || 0), 0) ?? 0;
                    const maxTotal = proposal?.criteria.reduce((sum, criterion) => sum + Number(criterion.max_score || 0), 0) ?? 0;
                    const storedScore = String(correction.total_score ?? "").trim();
                    const hasStoredScore = storedScore !== "" && Number.isFinite(Number(storedScore));
                    const useCriteriaScore = Boolean(proposal && proposal.criteria.length > 0 && (correction.status !== "approved" || Boolean(detail?.final_result?.criteria?.length)));
                    const scoreAvailable = useCriteriaScore || hasStoredScore;
                    const displayScore = useCriteriaScore ? scoreTotal : hasStoredScore ? Number(storedScore) : 0;
                    const displayMaxScore = useCriteriaScore ? maxTotal : 0;
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
                        {detail?.proposal?.demo && <p className="correction-demo-note" role="note">Ejemplo de práctica · no es una calificación real</p>}
                        <div className="correction-compact-actions">
                          <button className="button button-quiet button-small" type="button" aria-expanded={isExpanded} aria-controls={`correction-detail-${correction.id}`} onClick={() => {
                            const nextExpanded = !isExpanded;
                            setExpanded((previous) => ({ ...previous, [correction.id]: nextExpanded }));
                            if (nextExpanded) void loadCorrectionDetail(correction.id).catch(() => undefined);
                          }}>{isExpanded ? "Ocultar detalle ↑" : "Ver devolución ↓"}</button>
                          <Link className="button button-small button-primary" href={workspaceUrl}>{correction.status === "approved" ? "Abrir corrección" : "Revisar corrección"} →</Link>
                        </div>
                        <div className="correction-compact-detail" id={`correction-detail-${correction.id}`} hidden={!isExpanded}>
                          {detailLoading[correction.id] && <p role="status" aria-live="polite">Cargando devolución completa…</p>}
                          {detailErrors[correction.id] && <div className="error-message" role="alert"><p>{detailErrors[correction.id]}</p><button type="button" className="button button-quiet button-small" onClick={() => void loadCorrectionDetail(correction.id).catch(() => undefined)}>Reintentar</button></div>}
                          {detail && proposal && !detailLoading[correction.id] && (
                            <>
                              <div className="correction-detail-toolbar">
                                <strong>Detalle de la devolución</strong>
                                <div>
                                  {correction.status === "approved" && <button className="button button-quiet button-small" type="button" onClick={() => void loadCorrectionDetail(correction.id).then(setShareCorrection).catch(() => undefined)}>Compartir devolución</button>}
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
                              <p className="correction-feedback-line"><strong>Devolución:</strong> {detail.teacher_feedback || proposal.feedback || "Sin retroalimentación adicional."}</p>
                            </>
                          )}
                          {!detail && !detailLoading[correction.id] && !detailErrors[correction.id] && <p className="correction-history-summary">Abrí el detalle para cargar la devolución completa.</p>}
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
      {shareCorrection && <CorrectionShareModal open data={shareData} onClose={closeShareModal} />}
    </>
  );
}
