"use client";

import "../../../styles/espacio-correccion.css";

import AssessmentRubricBuilder from "@/components/AssessmentRubricBuilder";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SubmitEvent } from "react";
import { api } from "@/lib/api";
type Assessment = {
  id: number;
  title: string;
  subject: string;
  level: string;
  objectives: string;
  instructions: string;
  status: "draft" | "ready" | "archived";
  course?: number | null;
  course_name?: string | null;
};
type CourseOption = { id: number; name: string; active: boolean };
type Question = { id: number; assessment: number; prompt: string; max_score: string | number; position: number };
type SuggestedQuestion = { prompt: string; max_score: number; rationale: string };
export default function AssessmentDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editSubject, setEditSubject] = useState("");
  const [editLevel, setEditLevel] = useState("");
  const [editObjectives, setEditObjectives] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [editCourse, setEditCourse] = useState("");
  const [editStatus, setEditStatus] = useState<Assessment["status"]>("draft");
  const [questionPrompt, setQuestionPrompt] = useState("");
  const [questionMaxScore, setQuestionMaxScore] = useState("10");
  const [editingQuestionId, setEditingQuestionId] = useState<number | null>(null);
  const [editQuestionPrompt, setEditQuestionPrompt] = useState("");
  const [editQuestionScore, setEditQuestionScore] = useState("10");
  const [suggestions, setSuggestions] = useState<SuggestedQuestion[]>([]);
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [suggestionIsDemo, setSuggestionIsDemo] = useState(false);
  const loadController = useRef<AbortController | null>(null);
  const mutationLock = useRef(false);
  const load = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await api<{
        assessment: Assessment;
        courses: CourseOption[];
        questions: Question[];
      }>(`/assessments/${encodeURIComponent(id)}/editor/`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      const current = result.assessment;
      setAssessment(current);
      setCourses(Array.isArray(result.courses) ? result.courses : []);
      setQuestions(Array.isArray(result.questions) ? result.questions : []);
      setEditTitle(current.title || "");
      setEditSubject(current.subject || "");
      setEditLevel(current.level || "");
      setEditObjectives(current.objectives || "");
      setEditInstructions(current.instructions || "");
      setEditCourse(current.course ? String(current.course) : "");
      setEditStatus(current.status || "draft");
    } catch (caught) {
      if (controller.signal.aborted || (caught instanceof Error && caught.name === "AbortError")) return;
      setError(caught instanceof Error ? caught.message : "No se pudieron cargar los datos de la evaluación.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
    return () => loadController.current?.abort();
  }, [load]);
  async function saveAssessmentDetails(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assessment || mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const updated = await api<Assessment>(`/assessments/${id}/`, {
        method: "PATCH",
        body: JSON.stringify({
          title: editTitle.trim(), subject: editSubject.trim(), level: editLevel.trim(),
          objectives: editObjectives.trim(), instructions: editInstructions.trim(),
          status: editStatus, course: editCourse ? Number(editCourse) : null,
        }),
      });
      setAssessment(previous => previous ? { ...previous, ...updated } : updated);
      setEditingDetails(false);
      setMessage("Datos de la evaluación actualizados.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron guardar los datos de la evaluación.");
    } finally { mutationLock.current = false; setBusy(false); }
  }
  async function archiveAssessment() {
    if (!assessment || assessment.status === "archived" || mutationLock.current) return;
    if (!window.confirm("¿Archivar esta evaluación? Se conservarán las respuestas y las correcciones.")) return;
    if (mutationLock.current) return;
    mutationLock.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/assessments/${id}/`, { method: "PATCH", body: JSON.stringify({ status: "archived" }) });
      setAssessment(previous => previous ? { ...previous, status: "archived" } : previous);
      setEditStatus("archived");
      setMessage("Evaluación archivada. Se conservará el historial.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo archivar la evaluación.");
    } finally { mutationLock.current = false; setBusy(false); }
  }
  async function addQuestion(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assessment || mutationLock.current) return;
    const points = Number(questionMaxScore);
    if (!Number.isFinite(points) || points <= 0 || points > 1000) {
      setError("El puntaje máximo debe ser mayor que cero y no superar 1.000.");
      return;
    }
    mutationLock.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const created = await api<Question>("/questions/", {
        method: "POST",
        body: JSON.stringify({ assessment: assessment.id, prompt: questionPrompt.trim(), max_score: points, position: questions.reduce((max, item) => Math.max(max, item.position), 0) + 1 }),
      });
      setQuestions(previous => [...previous, created].sort((a, b) => a.position - b.position));
      setQuestionPrompt(""); setQuestionMaxScore("10");
      setMessage("Consigna agregada a la evaluación.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar la consigna.");
    } finally { mutationLock.current = false; setBusy(false); }
  }
  function beginQuestionEdit(question: Question) {
    setEditingQuestionId(question.id);
    setEditQuestionPrompt(question.prompt);
    setEditQuestionScore(String(question.max_score));
  }
  async function saveQuestionEdit(event: SubmitEvent<HTMLFormElement>, questionId: number) {
    event.preventDefault();
    if (mutationLock.current) return;
    const points = Number(editQuestionScore);
    if (!editQuestionPrompt.trim() || !Number.isFinite(points) || points <= 0 || points > 1000) {
      setError("Ingresá una consigna y un puntaje máximo válido (hasta 1.000).");
      return;
    }
    mutationLock.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const updated = await api<Question>(`/questions/${questionId}/`, {
        method: "PATCH",
        body: JSON.stringify({ prompt: editQuestionPrompt.trim(), max_score: points }),
      });
      setQuestions(previous => previous.map(item => item.id === questionId ? { ...item, ...updated } : item));
      setEditingQuestionId(null);
      setMessage("Consigna actualizada.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo actualizar la consigna.");
    } finally { mutationLock.current = false; setBusy(false); }
  }
  async function deleteQuestion(question: Question) {
    if (mutationLock.current) return;
    if (!window.confirm("¿Eliminar esta consigna? Si tiene entregas vinculadas, MaestrIA impedirá eliminarla para proteger el historial.")) return;
    mutationLock.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/questions/${question.id}/`, { method: "DELETE" });
      setQuestions(previous => previous.filter(item => item.id !== question.id));
      setMessage("Consigna eliminada.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo eliminar la consigna.");
    } finally { mutationLock.current = false; setBusy(false); }
  }
  async function generateSuggestions() {
    if (!assessment || mutationLock.current) return;
    mutationLock.current = true;
    setGeneratingSuggestions(true); setError(""); setMessage("");
    try {
      const result = await api<{ questions: SuggestedQuestion[]; demo?: boolean; warnings?: string[] }>(`/assessments/${id}/generate-questions/`, {
        method: "POST", body: JSON.stringify({ count: 3 }),
      });
      setSuggestions(Array.isArray(result.questions) ? result.questions : []);
      setSuggestionIsDemo(Boolean(result.demo));
      setMessage(result.demo ? "Se prepararon ejemplos editables. No fueron generados por un modelo real." : "Revisá las consignas sugeridas y agregá solo las que quieras usar.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron proponer consignas.");
    } finally { mutationLock.current = false; setGeneratingSuggestions(false); }
  }
  function updateSuggestion(index: number, patch: Partial<SuggestedQuestion>) {
    setSuggestions(previous => previous.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }
  async function acceptSuggestion(suggestion: SuggestedQuestion, index: number) {
    if (!assessment || mutationLock.current) return;
    const points = Number(suggestion.max_score);
    if (!suggestion.prompt.trim() || !Number.isFinite(points) || points <= 0 || points > 1000) {
      setError("Revisá el texto y el puntaje máximo de la consigna antes de agregarla.");
      return;
    }
    mutationLock.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const created = await api<Question>("/questions/", {
        method: "POST",
        body: JSON.stringify({ assessment: assessment.id, prompt: suggestion.prompt.trim(), max_score: points, position: questions.reduce((max, item) => Math.max(max, item.position), 0) + 1 }),
      });
      setQuestions(previous => [...previous, created].sort((a, b) => a.position - b.position));
      setSuggestions(previous => previous.filter((_, itemIndex) => itemIndex !== index));
      setMessage("Consigna agregada a la evaluación.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo agregar la consigna.");
    } finally { mutationLock.current = false; setBusy(false); }
  }
  if (loading) return <><main className="app-main" id="main-content" tabIndex={-1} aria-busy="true"><p role="status">Cargando evaluación…</p></main></>;
  if (!assessment) return (
    <><main className="app-main" id="main-content" tabIndex={-1}>
      <h1>Evaluación no disponible</h1>
      <p>{error || "No encontramos esta evaluación o no tenés permiso para verla."}</p>
      <div className="form-actions"><button type="button" className="button button-primary" onClick={() => void load()}>Intentar nuevamente</button><Link className="button button-quiet" href="/app/evaluaciones">Volver a tus evaluaciones</Link><Link className="button button-quiet" href="/app">Volver al resumen</Link></div>
    </main></>
  );
  return (
    <>
      
      <main className="app-main" id="main-content" tabIndex={-1}>
        <Link href="/app/evaluaciones" className="back-link">← Volver a tus evaluaciones</Link>
        <header className="app-header assessment-editor-heading">
          <div>
            <span className="eyebrow">PREPARAR EVALUACIÓN</span>
            <h1>{assessment.title}</h1>
            <p>{[assessment.subject, assessment.level, assessment.course_name].filter(Boolean).join(" · ") || "Agregá la información que ayude a contextualizar la evaluación."}</p>
          </div>
          <Link href={`/app/espacio-correccion?assessment=${assessment.id}`} className="button button-primary">Ir al espacio de corrección →</Link>
        </header>
        <div className="assessment-detail-actions">
          <div className="assessment-state-line">
            <span className={`status-pill ${assessment.status === "archived" ? "delivery-status-review" : ""}`}>{assessment.status === "ready" ? "Lista para usar" : assessment.status === "archived" ? "Archivada" : "Borrador"}</span>
            {assessment.course ? <Link className="assessment-course-context" href={`/app/cursos/${assessment.course}`}>Materia: {assessment.course_name || "Ver curso"} ↗</Link> : <span className="muted">Todavía no está asociada a un curso</span>}
          </div>
          <div className="form-actions">
            <button type="button" className="button button-quiet" onClick={() => setEditingDetails(value => !value)}>{editingDetails ? "Cerrar edición" : "Editar datos"}</button>
            {assessment.status !== "archived" && <button type="button" className="button button-quiet" disabled={busy} onClick={() => void archiveAssessment()}>Archivar evaluación</button>}
          </div>
        </div>
        {error && <p className="error-message" role="alert">{error}</p>}
        {message && <p className="success-message" role="status">{message}</p>}
        {editingDetails && <section className="form-card assessment-edit-card" aria-labelledby="assessment-data-heading">
          <div className="section-row"><div><h2 id="assessment-data-heading">Datos de la evaluación</h2><p>Esta información orienta las consignas y las propuestas de corrección.</p></div></div>
          <form onSubmit={saveAssessmentDetails}>
            <label htmlFor="edit-assessment-title">Título <span aria-hidden="true">*</span></label>
            <input id="edit-assessment-title" value={editTitle} onChange={event => setEditTitle(event.target.value)} maxLength={180} required />
            <div className="form-two">
              <div><label htmlFor="edit-assessment-subject">Materia</label><input id="edit-assessment-subject" value={editSubject} onChange={event => setEditSubject(event.target.value)} maxLength={120} /></div>
              <div><label htmlFor="edit-assessment-level">Nivel educativo</label><input id="edit-assessment-level" value={editLevel} onChange={event => setEditLevel(event.target.value)} maxLength={120} /></div>
            </div>
            <label htmlFor="edit-assessment-objectives">Objetivos de aprendizaje (opcional)</label>
            <textarea id="edit-assessment-objectives" rows={3} value={editObjectives} onChange={event => setEditObjectives(event.target.value)} maxLength={5000} placeholder="¿Qué deberían comprender o poder hacer los estudiantes?" />
            <label htmlFor="edit-assessment-instructions">Consigna general o indicaciones</label>
            <textarea id="edit-assessment-instructions" rows={4} value={editInstructions} onChange={event => setEditInstructions(event.target.value)} maxLength={8000} placeholder="Agregá el contexto general de la evaluación." />
            <label htmlFor="edit-assessment-course">Curso (opcional)</label>
            <select id="edit-assessment-course" value={editCourse} onChange={event => setEditCourse(event.target.value)}><option value="">Sin asociar a un curso</option>{courses.filter(course => course.active).map(course => <option key={course.id} value={course.id}>{course.name}</option>)}</select>
            <label htmlFor="edit-assessment-status">Estado</label>
            <select id="edit-assessment-status" value={editStatus} onChange={event => setEditStatus(event.target.value as Assessment["status"])}><option value="draft">Borrador</option><option value="ready">Lista para usar</option><option value="archived">Archivada</option></select>
            <div className="form-actions"><button type="submit" className="button button-primary" disabled={busy || !editTitle.trim()}>{busy ? "Guardando…" : "Guardar cambios"}</button><button type="button" className="button button-quiet" onClick={() => setEditingDetails(false)}>Cancelar</button></div>
          </form>
        </section>}
        <div className="assessment-editor-layout">
          <section className="form-card" aria-labelledby="assessment-questions-heading">
            <div className="section-row"><div><span className="eyebrow">01 · CONSIGNAS</span><h2 id="assessment-questions-heading">Preguntas de la evaluación <span className="count">{questions.length}</span></h2><p className="muted">Agregá las consignas que deberán responder los estudiantes. Los criterios y las correcciones se trabajan en el mismo espacio de corrección.</p></div></div>
            {questions.length === 0 ? <div className="empty-state"><h3>Todavía no hay consignas</h3><p>Escribí una pregunta o pedile a MaestrIA una primera propuesta editable.</p></div> : <div className="assessment-question-list">{questions.map(question => <article className="question-item" key={question.id}>
              {editingQuestionId === question.id ? <form className="question-edit-form" onSubmit={event => void saveQuestionEdit(event, question.id)}>
                <label htmlFor={`question-prompt-${question.id}`}>Consigna</label><textarea id={`question-prompt-${question.id}`} rows={3} value={editQuestionPrompt} onChange={event => setEditQuestionPrompt(event.target.value)} maxLength={8000} required />
                <label htmlFor={`question-score-${question.id}`}>Puntaje máximo</label><input id={`question-score-${question.id}`} type="number" min="0.5" max="1000" step="0.5" value={editQuestionScore} onChange={event => setEditQuestionScore(event.target.value)} required />
                <div className="form-actions"><button type="submit" className="button button-primary" disabled={busy}>Guardar</button><button type="button" className="button button-quiet" onClick={() => setEditingQuestionId(null)}>Cancelar</button></div>
              </form> : <>
                <div className="question-item-main"><b>{question.position}. {question.prompt}</b><small>Puntaje máximo: {question.max_score} puntos</small></div>
                <div className="question-item-actions"><button type="button" className="button button-quiet button-small" disabled={busy} onClick={() => beginQuestionEdit(question)}>Editar</button><button type="button" className="button button-quiet button-small" disabled={busy} onClick={() => void deleteQuestion(question)}>Eliminar</button></div>
              </>}
            </article>)}</div>}
            <form className="assessment-add-question-form" onSubmit={addQuestion}>
              <h3>Agregar una consigna</h3>
              <label htmlFor="new-question-prompt">Pregunta o consigna</label><textarea id="new-question-prompt" rows={4} value={questionPrompt} onChange={event => setQuestionPrompt(event.target.value)} maxLength={8000} placeholder="Escribí qué debe resolver o explicar el estudiante…" required />
              <label htmlFor="new-question-score">Puntaje máximo</label><input id="new-question-score" type="number" min="0.5" max="1000" step="0.5" value={questionMaxScore} onChange={event => setQuestionMaxScore(event.target.value)} required />
              <button type="submit" className="button button-primary" disabled={busy || !questionPrompt.trim()}>{busy ? "Guardando…" : "＋ Agregar consigna"}</button>
            </form>
          </section>
          <section className="form-card" aria-labelledby="question-assistant-heading">
            <span className="eyebrow">02 · ASISTENCIA OPCIONAL</span>
            <h2 id="question-assistant-heading">¿Querés ideas para las consignas?</h2>
            <p className="muted">MaestrIA puede proponer preguntas a partir de los datos de esta evaluación. Revisá y editá cada propuesta antes de agregarla; no se incorpora nada automáticamente.</p>
            <button type="button" className="button button-quiet" onClick={() => void generateSuggestions()} disabled={generatingSuggestions || busy}>{generatingSuggestions ? "Preparando propuestas…" : "✳ Proponer 3 consignas"}</button>
            {suggestionIsDemo && <p className="notice" role="note">Estas son propuestas de demostración. No fueron generadas por un modelo real.</p>}
            {suggestions.length > 0 && <div className="question-suggestions" aria-label="Consignas sugeridas">{suggestions.map((suggestion, index) => <article key={`suggestion-${index}`}>
              <span className="question-suggestion-number">{String(index + 1).padStart(2, "0")}</span>
              <div className="question-suggestion-editor">
                <label htmlFor={`suggested-prompt-${index}`}>Consigna propuesta (editable)</label>
                <textarea id={`suggested-prompt-${index}`} rows={4} value={suggestion.prompt} onChange={event => updateSuggestion(index, { prompt: event.target.value })} maxLength={8000} />
                <p>{suggestion.rationale || "Revisá que esta consigna corresponda a los objetivos de tu evaluación."}</p>
                <label htmlFor={`suggested-score-${index}`}>Puntaje máximo</label><input id={`suggested-score-${index}`} type="number" min="0.5" max="1000" step="0.5" value={suggestion.max_score} onChange={event => updateSuggestion(index, { max_score: Number(event.target.value) })} />
              </div>
              <div className="question-suggestion-actions"><button type="button" className="button button-quiet button-small" disabled={busy || !suggestion.prompt.trim()} onClick={() => void acceptSuggestion(suggestion, index)}>Agregar a la evaluación</button><button type="button" className="text-link" disabled={busy} onClick={() => setSuggestions(previous => previous.filter((_, itemIndex) => itemIndex !== index))}>Descartar</button></div>
            </article>)}</div>}
          </section>
        </div>
        {assessment && <AssessmentRubricBuilder assessment={assessment} questions={questions} />}
        <section className="form-card assessment-workflow-next-step">
          <span className="eyebrow">SIGUIENTE PASO</span>
          <h2>Preparar criterios, corregir y devolver</h2>
          <p>En el espacio de corrección vas a encontrar en conjunto los criterios de evaluación, los apuntes, las respuestas de los estudiantes, las propuestas de MaestrIA y las acciones para aprobar, exportar o compartir cada devolución.</p>
          <div className="form-actions"><Link href={`/app/espacio-correccion?assessment=${assessment.id}`} className="button button-primary">Abrir espacio de corrección →</Link><Link href="/app/entregas" className="button button-quiet">Consultar entregas y devoluciones</Link></div>
        </section>
        <p className="app-disclaimer">MaestrIA propone y organiza; vos conservás la decisión final sobre cada criterio y calificación.</p>
      </main>
    </>
  );
}
