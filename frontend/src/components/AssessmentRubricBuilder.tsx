"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type AssessmentContext = {
  id: number;
  title: string;
  subject: string;
  level: string;
  objectives: string;
  instructions: string;
  course?: number | null;
};
type QuestionContext = { prompt: string };
type RubricCriterionDraft = { name: string; description: string; max_score: number; weight: number };
type GeneratedRubric = { rubric_title: string; description: string; criteria: RubricCriterionDraft[]; demo?: boolean; warnings?: string[] };
type SavedRubric = { id: number; title: string };

export default function AssessmentRubricBuilder({ assessment, questions }: { assessment: AssessmentContext; questions: QuestionContext[] }) {
  const [draft, setDraft] = useState<GeneratedRubric | null>(null);
  const [title, setTitle] = useState("");
  const [scaleType, setScaleType] = useState<"numeric" | "levels" | "both">("both");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function generate() {
    setGenerating(true); setError(""); setMessage("");
    try {
      // Fetch source material only for this selected assessment; the editor list deliberately omits long text fields.
      const source = await api<{ reference_material?: string }>(`/assessments/${assessment.id}/`);
      const result = await api<GeneratedRubric>("/rubrics/generate/", {
        method: "POST",
        body: JSON.stringify({
          title: assessment.title,
          subject: assessment.subject,
          level: assessment.level,
          objectives: assessment.objectives,
          instructions: assessment.instructions,
          question_prompts: questions.slice(0, 10).map(question => question.prompt),
          reference_material: source.reference_material || "",
          count: 4,
        }),
      });
      const validCriteria = Array.isArray(result.criteria) ? result.criteria.filter(item => typeof item?.name === "string" && item.name.trim()).slice(0, 20) : [];
      if (validCriteria.length < 2) throw new Error("La propuesta no contiene suficientes criterios editables. Revisá la evaluación e intentá nuevamente.");
      setDraft({ ...result, criteria: validCriteria.map(item => ({ name: item.name, description: item.description || "", max_score: Number(item.max_score) > 0 ? Number(item.max_score) : 10, weight: Number.isFinite(Number(item.weight)) ? Number(item.weight) : 1 })) });
      setTitle(result.rubric_title || `Rúbrica — ${assessment.title}`);
      setMessage(result.demo ? "Se cargó una plantilla demostrativa editable; no fue generada por un modelo real." : "Propuesta lista. Revisá y editá cada criterio antes de guardarla.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo proponer la rúbrica.");
    } finally { setGenerating(false); }
  }

  function updateCriterion(index: number, patch: Partial<RubricCriterionDraft>) {
    setDraft(previous => previous ? { ...previous, criteria: previous.criteria.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) } : previous);
  }

  async function save() {
    if (!draft) return;
    const cleanTitle = title.trim();
    const criteria = draft.criteria.map(item => ({
      name: item.name.trim(), description: item.description.trim(),
      max_score: Number(item.max_score), weight: Number(item.weight),
    }));
    if (!cleanTitle) { setError("Poné un nombre para la rúbrica."); return; }
    if (criteria.length < 2 || criteria.some(item => !item.name || !Number.isFinite(item.max_score) || item.max_score <= 0 || item.max_score > 1000 || !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 100)) {
      setError("Cada criterio necesita nombre, puntaje máximo entre 0,5 y 1.000, y ponderación entre 0 y 100."); return;
    }
    setSaving(true); setError(""); setMessage("");
    try {
      const saved = await api<SavedRubric>("/rubrics/create-with-criteria/", {
        method: "POST",
        body: JSON.stringify({ title: cleanTitle, description: draft.description || "Propuesta revisada por el docente.", scale_type: scaleType, criteria }),
      });
      setDraft(null);
      setMessage(`“${saved.title || cleanTitle}” quedó guardada en tu biblioteca de rúbricas. Podés seleccionarla al corregir.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar la rúbrica.");
    } finally { setSaving(false); }
  }

  return <section className="form-card assessment-rubric-builder" aria-labelledby="assessment-rubric-title">
    <div className="assessment-rubric-heading">
      <span className="eyebrow">02 · CRITERIOS</span>
      <span className="assessment-rubric-mark" aria-hidden="true">✳</span>
      <div><h2 id="assessment-rubric-title">Construí una rúbrica con tu criterio</h2><p>Partimos de los objetivos y consignas de esta evaluación. La propuesta es editable: vos decidís qué criterios conservar y cómo puntuar.</p></div>
    </div>
    {!draft ? <div className="assessment-rubric-empty"><div><b>Una base para revisar, no una decisión automática.</b><p>MaestrIA puede sugerir de 2 a 6 criterios a partir del contexto que ya cargaste.</p></div><button className="button button-primary" type="button" onClick={() => void generate()} disabled={generating}>{generating ? "Preparando propuesta…" : "✳ Proponer rúbrica"}</button></div> : <div className="assessment-rubric-draft">
      <label htmlFor="assessment-rubric-name">Nombre de la rúbrica</label>
      <input id="assessment-rubric-name" value={title} maxLength={180} onChange={event => setTitle(event.target.value)} />
      <div className="assessment-rubric-scale"><div><label htmlFor="assessment-rubric-scale">Tipo de escala</label><select id="assessment-rubric-scale" value={scaleType} onChange={event => setScaleType(event.target.value as "numeric" | "levels" | "both")}><option value="both">Puntajes y niveles de desempeño</option><option value="numeric">Solo puntajes</option><option value="levels">Niveles de desempeño</option></select></div><span>{draft.criteria.length} criterios sugeridos</span></div>
      {draft.demo && <p className="notice" role="note">Plantilla de demostración: no fue generada por un modelo real. Adaptala a tus objetivos antes de usarla.</p>}
      {draft.warnings?.map((warning, index) => <p className="assessment-rubric-warning" key={`${warning}-${index}`}>{warning}</p>)}
      <div className="assessment-rubric-criteria">{draft.criteria.map((criterion, index) => <article key={`${index}-${criterion.name}`}>
        <span className="assessment-rubric-index">{String(index + 1).padStart(2, "0")}</span>
        <div className="assessment-rubric-fields"><label htmlFor={`rubric-criterion-name-${index}`}>Criterio</label><input id={`rubric-criterion-name-${index}`} value={criterion.name} maxLength={160} onChange={event => updateCriterion(index, { name: event.target.value })} /><label htmlFor={`rubric-criterion-description-${index}`}>Qué se observa</label><textarea id={`rubric-criterion-description-${index}`} rows={2} value={criterion.description} maxLength={2000} onChange={event => updateCriterion(index, { description: event.target.value })} /></div>
        <div className="assessment-rubric-score"><label htmlFor={`rubric-criterion-score-${index}`}>Puntaje máx.</label><input id={`rubric-criterion-score-${index}`} type="number" min="0.5" max="1000" step="0.5" value={criterion.max_score} onChange={event => updateCriterion(index, { max_score: Number(event.target.value) })} /><label htmlFor={`rubric-criterion-weight-${index}`}>Ponderación</label><input id={`rubric-criterion-weight-${index}`} type="number" min="0" max="100" step="0.5" value={criterion.weight} onChange={event => updateCriterion(index, { weight: Number(event.target.value) })} /></div>
      </article>)}</div>
      <div className="assessment-rubric-actions"><button type="button" className="button button-quiet" onClick={() => { setDraft(null); setError(""); setMessage(""); }} disabled={saving}>Descartar propuesta</button><button type="button" className="button button-primary" onClick={() => void save()} disabled={saving}>{saving ? "Guardando…" : "Guardar rúbrica"}</button><button type="button" className="button button-quiet" onClick={() => void generate()} disabled={generating || saving}>{generating ? "Regenerando…" : "Proponer otra"}</button></div>
    </div>}
    {error && <p className="error-message" role="alert">{error}</p>}
    {message && <p className="success-message" role="status">{message}</p>}
    <p className="assessment-rubric-footnote">La rúbrica se guarda en tu biblioteca para poder seleccionarla en el espacio de trabajo. Antes de usarla, confirmá que los criterios reflejen lo que enseñaste y lo que pedís evaluar.</p>
    <div className="assessment-rubric-links"><Link href={`/app/espacio-correccion?assessment=${assessment.id}${assessment.course ? `&course=${assessment.course}` : ""}`}>Volver al espacio de trabajo →</Link></div>
  </section>;
}
