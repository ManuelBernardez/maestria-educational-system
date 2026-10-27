"use client";

import "../../styles/espacio-correccion.css";

import AppSidebar from "@/components/AppSidebar";
import CorrectionShareModal, { type CorrectionShareData, type ShareableProposal } from "@/components/CorrectionShareModal";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  provider: string;
  proposal: CorrectionProposal;
  final_result: CorrectionProposal;
  teacher_feedback: string;
  total_score: string;
  submission_title: string;
  student_name: string;
  student_email?: string;
  created_at: string;
};

function getVisibleProposal(correction: Correction): CorrectionProposal {
  return correction.status === "approved" && correction.final_result?.criteria?.length
    ? correction.final_result
    : correction.proposal;
}

export default function CorrectionsPage() {
  const [items, setItems] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [shareCorrection, setShareCorrection] = useState<Correction | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const closeShareModal = useCallback(() => setShareCorrection(null), []);

  const load = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      setItems(await api<Correction[]>("/corrections/"));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron cargar las correcciones.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function approve(correction: Correction) {
    const proposal = getVisibleProposal(correction);
    if (proposal.demo) {
      setError("Las propuestas demostrativas no se pueden aprobar como una calificación real.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/corrections/${correction.id}/approve/`, {
        method: "POST",
        body: JSON.stringify({
          final_result: correction.proposal,
          teacher_feedback: correction.teacher_feedback,
        }),
      });
      setMessage("Corrección aprobada y guardada en el historial.");
      await load(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo aprobar la corrección.");
    } finally {
      setBusy(false);
    }
  }

  async function exportMarkdown(correction: Correction) {
    setError("");
    try {
      await downloadApiFile(`/corrections/${correction.id}/export/`, `devolucion-maestria-${correction.id}.md`);
      setMessage("Devolución exportada en Markdown.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo exportar la devolución.");
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
      <main className="app-main narrow-main" id="main-content" tabIndex={-1}>
        <Link href="/app" className="back-link">← Volver al resumen</Link>
        <span className="eyebrow">REVISIÓN DOCENTE</span>
        <h1>Correcciones</h1>
        <p className="page-intro">Consultá el historial, retomá una propuesta y compartí las devoluciones que ya aprobaste.</p>
        {error && <p className="error-message" role="alert">{error}</p>}
        {message && <p className="success-message" role="status" aria-live="polite">{message}</p>}
        {!loading && items.length > 0 && <label className="corrections-search" htmlFor="corrections-search">Buscar por estudiante o evaluación<input id="corrections-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre, evaluación o devolución…" /></label>}
        {loading ? <p className="muted" role="status">Cargando correcciones…</p> : items.length === 0 ? (
          <div className="empty-state">
            <h3>No hay correcciones todavía</h3>
            <p>Creá una evaluación, cargá una respuesta y generá una propuesta para verla acá.</p>
            <Link className="button button-primary" href="/app/espacio-correccion">Ir al espacio de corrección</Link>
          </div>
        ) : (
          <div className="submission-list">
            {items.filter(item => `${item.student_name} ${item.submission_title} ${item.teacher_feedback} ${item.proposal?.summary || ""}`.toLocaleLowerCase("es-AR").includes(search.trim().toLocaleLowerCase("es-AR"))).map((correction) => {
              const proposal = getVisibleProposal(correction);
              const total = proposal.criteria.reduce((sum, criterion) => sum + Number(criterion.score || 0), 0);
              return (
                <article className="form-card correction-history-item" key={correction.id}>
                  <div className="section-row">
                    <div>
                      <h2><Link className="correction-assessment-link" href={`/app/espacio-correccion?assessment=${encodeURIComponent(String(correction.submission_assessment_id))}&submission=${correction.submission}`}>{correction.submission_title} ↗</Link></h2>
                      <p className="muted">{correction.student_name || "Estudiante sin identificar"} · {correction.provider || "Proveedor no informado"}</p>
                    </div>
                    <span className={`status-pill ${correction.status === "approved" ? "delivery-status-approved" : correction.status === "rejected" ? "delivery-status-rejected" : "delivery-status-review"}`}>{correction.status === "approved" ? "Aprobada" : correction.status === "rejected" ? "Rechazada" : "Pendiente de revisión"}</span>
                  </div>
                  <button className="button button-quiet correction-collapse-toggle" type="button" aria-expanded={expanded[correction.id] !== false} onClick={() => setExpanded(previous => ({ ...previous, [correction.id]: previous[correction.id] === false }))}>{expanded[correction.id] === false ? "Desplegar examen y devolución ↓" : "Plegar examen y devolución ↑"}</button>
                  {expanded[correction.id] !== false && <div className="correction-expanded-content">
                  {proposal.demo && <p className="notice" role="note">Propuesta simulada para demostración. No usar como calificación real.</p>}
                  <div className="score-line"><strong>{total.toLocaleString("es-AR", { maximumFractionDigits: 2 })}</strong><span>puntos</span></div>
                  {proposal.summary && <p className="correction-history-summary">{proposal.summary}</p>}
                  {proposal.strengths?.length ? <div className="ai-detail-lists"><h3>Fortalezas observadas</h3><ul>{proposal.strengths.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
                  {proposal.improvement_suggestions?.length ? <div className="ai-detail-lists"><h3>Ideas para seguir mejorando</h3><ul>{proposal.improvement_suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
                  <div className="correction-history-criteria">
                    {proposal.criteria.map((criterion: Criterion, index: number) => (
                      <article className="criterion-review" key={`${criterion.criterion}-${index}`}>
                        <div className="criterion-head"><b>{criterion.criterion}</b><span>{criterion.score} / {criterion.max_score}</span></div>
                        {criterion.level && <span className="level-pill">Nivel sugerido: {criterion.level}</span>}
                        <p>{criterion.justification}</p>
                        <blockquote className="evidence-quote">{criterion.evidence ? `“${criterion.evidence}”` : "Sin evidencia literal; revisar manualmente."}</blockquote>
                      </article>
                    ))}
                  </div>
                  <p><b>Retroalimentación:</b> {correction.teacher_feedback || correction.proposal.feedback || "Sin retroalimentación adicional."}</p>
                  <div className="form-actions correction-history-actions">
                    {correction.status !== "approved" && <button className="button button-primary" type="button" disabled={busy || proposal.demo} onClick={() => void approve(correction)}>Aprobar corrección</button>}
                    {correction.status === "approved" && <button className="button button-primary" type="button" disabled={proposal.demo} onClick={() => setShareCorrection(correction)}>Compartir o guardar devolución</button>}
                    <button className="button button-quiet" type="button" disabled={busy} onClick={() => void exportMarkdown(correction)}>Exportar Markdown</button>
                  </div>
                  </div>}
                </article>
              );
            })}
          </div>
        )}
        {!loading && items.length > 0 && items.filter(item => `${item.student_name} ${item.submission_title} ${item.teacher_feedback} ${item.proposal?.summary || ""}`.toLocaleLowerCase("es-AR").includes(search.trim().toLocaleLowerCase("es-AR"))).length === 0 && <div className="empty-state"><h3>No encontramos coincidencias</h3><p>Probá con otro nombre, evaluación o texto.</p></div>}
      </main>
      <CorrectionShareModal open={Boolean(shareCorrection)} data={shareData} onClose={closeShareModal} />
    </div>
  );
}
