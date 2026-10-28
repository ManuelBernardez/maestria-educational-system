"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

export type ShareableCriterion = {
  criterion: string;
  score: number;
  max_score: number;
  justification?: string;
  evidence?: string;
  level?: string;
  question_prompt?: string;
};

export type ShareableProposal = {
  summary?: string;
  criteria: ShareableCriterion[];
  feedback?: string;
  strengths?: string[];
  improvement_suggestions?: string[];
  demo?: boolean;
};

export type CorrectionShareData = {
  studentName: string;
  studentEmail?: string;
  assessmentTitle: string;
  totalScore: string | number;
  teacherFeedback?: string;
  proposal: ShareableProposal;
};

type Props = {
  open: boolean;
  data: CorrectionShareData | null;
  onClose: () => void;
};

function formatScore(value: string | number): string {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? numeric.toLocaleString("es-AR", { maximumFractionDigits: 2 })
    : String(value);
}

function buildCorrectionText(data: CorrectionShareData): string {
  const possible = data.proposal.criteria.reduce((sum, criterion) => sum + Number(criterion.max_score || 0), 0);
  const lines = [
    "Devolución de MaestrIA",
    `Evaluación: ${data.assessmentTitle}`,
    `Estudiante: ${data.studentName}`,
    `Puntaje final: ${formatScore(data.totalScore)} / ${formatScore(possible)} puntos`,
    "",
    "Resumen",
    data.proposal.summary?.trim() || "Sin resumen adicional.",
    "",
    "Criterios de evaluación",
    ...data.proposal.criteria.flatMap((criterion) => [
      `• ${criterion.criterion}: ${formatScore(criterion.score)} / ${formatScore(criterion.max_score)} puntos${criterion.level ? ` · ${criterion.level}` : ""}`,
      ...(criterion.justification?.trim() ? [`  ${criterion.justification.trim()}`] : []),
    ]),
  ];

  if (data.proposal.strengths?.length) {
    lines.push("", "Fortalezas observadas", ...data.proposal.strengths.map((item) => `• ${item}`));
  }
  if (data.proposal.improvement_suggestions?.length) {
    lines.push("", "Próximos pasos sugeridos", ...data.proposal.improvement_suggestions.map((item) => `• ${item}`));
  }
  const feedback = data.teacherFeedback?.trim() || data.proposal.feedback?.trim();
  if (feedback) lines.push("", "Retroalimentación", feedback);
  lines.push("", "La calificación final fue revisada y aprobada por el docente.");
  return lines.join("\n");
}

export default function CorrectionShareModal({ open, data, onClose }: Props) {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const shareText = useMemo(() => (data ? buildCorrectionText(data) : ""), [data]);
  const possibleScore = data?.proposal.criteria.reduce((sum, criterion) => sum + Number(criterion.max_score || 0), 0) || 0;

  useEffect(() => {
    if (!open) return;
    setRecipientEmail(data?.studentEmail || "");
    setNotice("");
    setError("");
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const preferredControl = dialogRef.current?.querySelector<HTMLElement>("#correction-share-email");
    const firstControl = dialogRef.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])');
    (preferredControl || firstControl || dialogRef.current)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, data?.studentEmail, onClose]);

  if (!open || !data) return null;

  function openWhatsApp() {
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setNotice("Se intentó abrir WhatsApp con el texto preparado. Elegí el destinatario y confirmá el envío allí; si no se abre, revisá la configuración del navegador.");
    setError("");
  }

  function openEmail() {
    if (!data) return;

    const email = recipientEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Revisá el correo ingresado o dejalo vacío para completar el destinatario desde tu aplicación de correo.");
      setNotice("");
      return;
    }
    const subject = `Devolución de evaluación: ${data.assessmentTitle}`;
    // Encode the recipient too, so characters like &, ? or # in input data
    // cannot be interpreted as extra mailto parameters.
    const [localPart, domain] = email ? email.split("@") : ["", ""];
    const recipient = email ? `${encodeURIComponent(localPart)}@${encodeURIComponent(domain)}` : "";
    const url = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(shareText)}`;
    window.location.href = url;
    setNotice("Se solicitó abrir un borrador de correo. Revisá el destinatario y confirmá el envío desde tu aplicación.");
    setError("");
  }

  function trapDialogTab(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(shareText);
      setNotice("Devolución copiada. Ya podés pegarla donde la necesites.");
      setError("");
    } catch {
      setError("El navegador no permitió copiar automáticamente. Probá con WhatsApp o correo, o habilitá el permiso del portapapeles.");
      setNotice("");
    }
  }

  return (
    <>
      <div className="correction-share-backdrop" role="presentation">
        <section
          ref={dialogRef}
          className="correction-share-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="correction-share-title"
          tabIndex={-1}
          onKeyDown={trapDialogTab}
        >
          <header className="correction-share-header">
            <div>
              <span className="eyebrow">DEVOLUCIÓN APROBADA</span>
              <h2 id="correction-share-title">Compartir o guardar</h2>
              <p>{data.studentName} · {data.assessmentTitle}</p>
            </div>
            <button type="button" className="correction-share-close" onClick={onClose} aria-label="Cerrar ventana">×</button>
          </header>

          <div className="correction-share-score">
            <span>Puntaje final</span>
            <strong>{formatScore(data.totalScore)} <small>/ {formatScore(possibleScore)} puntos</small></strong>
          </div>
          <p className="correction-share-explainer">Elegí una acción. MaestrIA prepara el contenido, pero no envía mensajes automáticamente.</p>

          <label className="correction-share-email" htmlFor="correction-share-email">
            Correo del estudiante <span>(opcional)</span>
            <input
              id="correction-share-email"
              type="email"
              autoComplete="email"
              value={recipientEmail}
              onChange={(event) => setRecipientEmail(event.target.value)}
              placeholder="estudiante@ejemplo.com"
            />
          </label>

          <div className="correction-share-actions">
            <button type="button" className="button button-primary" onClick={openEmail}>Preparar correo</button>
            <button type="button" className="button button-quiet" onClick={openWhatsApp}>Abrir WhatsApp</button>
            <button type="button" className="button button-quiet" onClick={() => window.print()}>Imprimir / Guardar PDF</button>
            <button type="button" className="button button-quiet" onClick={() => void copyText()}>Copiar devolución</button>
          </div>
          {error && <p className="error-message" role="alert">{error}</p>}
          {notice && <p className="success-message" role="status" aria-live="polite">{notice}</p>}
          <p className="correction-share-footnote">Antes de compartir, verificá el destinatario y el contenido. Para obtener un PDF, elegí «Guardar como PDF» en la ventana de impresión del navegador.</p>
        </section>
      </div>

      <section className="correction-share-print-sheet" aria-hidden="true">
        <header>
          <p className="correction-print-brand">MaestrIA · Devolución de evaluación</p>
          <h1>{data.assessmentTitle}</h1>
          <p><strong>Estudiante:</strong> {data.studentName}</p>
          <p><strong>Puntaje final:</strong> {formatScore(data.totalScore)} / {formatScore(possibleScore)} puntos</p>
        </header>
        {data.proposal.summary && (
          <section>
            <h2>Resumen</h2>
            <p>{data.proposal.summary}</p>
          </section>
        )}
        <section>
          <h2>Criterios de evaluación</h2>
          <table>
            <thead>
              <tr><th>Criterio</th><th>Puntaje</th><th>Justificación</th></tr>
            </thead>
            <tbody>
              {data.proposal.criteria.map((criterion, index) => (
                <tr key={`${criterion.criterion}-${index}`}>
                  <td>
                    <strong>{criterion.criterion}</strong>
                    {criterion.level && <small>{criterion.level}</small>}
                  </td>
                  <td>{formatScore(criterion.score)} / {formatScore(criterion.max_score)}</td>
                  <td>{criterion.justification || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {data.proposal.strengths?.length ? (
          <section>
            <h2>Fortalezas observadas</h2>
            <ul>{data.proposal.strengths.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </section>
        ) : null}
        {data.proposal.improvement_suggestions?.length ? (
          <section>
            <h2>Próximos pasos sugeridos</h2>
            <ul>{data.proposal.improvement_suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul>
          </section>
        ) : null}
        {(data.teacherFeedback || data.proposal.feedback) && (
          <section>
            <h2>Retroalimentación para el estudiante</h2>
            <p>{data.teacherFeedback?.trim() || data.proposal.feedback}</p>
          </section>
        )}
        <footer>Esta devolución corresponde a un resultado revisado y aprobado por el docente.</footer>
      </section>
    </>
  );
}
