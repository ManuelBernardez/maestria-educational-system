"use client";

import "../../styles/espacio-correccion.css";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, SubmitEvent } from "react";
import { api } from "@/lib/api";
import dynamic from "next/dynamic";
import type { CorrectionShareData } from "@/components/CorrectionShareModal";
import { supabase } from "@/lib/supabase";
import { readPreference, writePreference } from "@/lib/preferences";

const CorrectionShareModal = dynamic(() => import("@/components/CorrectionShareModal"), {
  ssr: false,
  loading: () => null,
});
type Assessment = { id: number; title: string; subject: string; level: string; objectives: string; instructions: string; reference_material: string; status: string; course?: number | null; course_name?: string; questions?: Question[] };
type Question = { id: number; assessment: number; prompt: string; max_score: string | number; position: number; rubric?: number | null };
type Student = { id: number; name: string; email: string; phone: string; active: boolean };
type CourseOption = { id: number; name: string; active: boolean };
type Criterion = { criterion: string; score: number; max_score: number; level?: string; justification: string; evidence: string; question_id?: number; question_prompt?: string };
type Proposal = { summary: string; criteria: Criterion[]; feedback: string; strengths?: string[]; improvement_suggestions?: string[]; warnings?: string[]; demo?: boolean };
type Submission = { id: number; assessment: number; student?: number | null; student_name: string; student_display_name?: string; question?: number | null; answer_text: string; source_filename?: string; status: string; created_at?: string };
type Correction = { id: number; submission: number; rubric?: number | null; proposal: Proposal; final_result?: Proposal; teacher_feedback: string; total_score: string; status: string; provider?: string; student_name?: string; submission_title?: string; submission_assessment_id?: number | string; course_id?: number | null; course_name?: string | null; subject?: string; created_at?: string };
type CorrectionSummary = { id: number; submission: number; status: string; total_score: string; submission_assessment_id: number | string; submission_title: string; student_name: string; course_id?: number | null; course_name?: string | null; subject?: string; created_at?: string };

function summarizeCorrection(item: Correction): CorrectionSummary {
  return {
    id: item.id,
    submission: item.submission,
    status: item.status,
    total_score: item.total_score,
    submission_assessment_id: item.submission_assessment_id ?? 0,
    submission_title: item.submission_title || "Evaluación",
    student_name: item.student_name || "Estudiante sin identificar",
    course_id: item.course_id ?? null,
    course_name: item.course_name ?? null,
    subject: item.subject || "",
    created_at: item.created_at,
  };
}
type WorkspaceStep = 1 | 2 | 3;
type QuestionSuggestion = { prompt: string; max_score: number; rationale: string };
const ACCEPTED_FILES = ".txt,.md,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export default function CorrectionWorkspacePage() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [courseFilter, setCourseFilter] = useState("all");
  const [students, setStudents] = useState<Student[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [rubrics, setRubrics] = useState<{ id: number; title: string; criteria?: { id: number; name: string; max_score: string | number }[]; scale_type?: string }[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [corrections, setCorrections] = useState<CorrectionSummary[]>([]);
  const [assessmentId, setAssessmentId] = useState("");
  const [questionId, setQuestionId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [rubricId, setRubricId] = useState("");
  const [questionSuggestions, setQuestionSuggestions] = useState<QuestionSuggestion[]>([]);
  const [questionSuggestionDemo, setQuestionSuggestionDemo] = useState(false);
  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [objectives, setObjectives] = useState("");
  const [instructions, setInstructions] = useState("");
  const [referenceMaterial, setReferenceMaterial] = useState("");
  const [answerText, setAnswerText] = useState("");
  const [answerFile, setAnswerFile] = useState<File | null>(null);
  const [materialFile, setMaterialFile] = useState<File | null>(null);
  const [materialMode, setMaterialMode] = useState<"replace" | "append">("append");
  const [feedbackStyle, setFeedbackStyle] = useState("constructivo");
  const [aiProvider, setAiProvider] = useState("mock");
  const [searchStudents, setSearchStudents] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeSubmission, setActiveSubmission] = useState<Submission | null>(null);
  const [correction, setCorrection] = useState<Correction | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [feedback, setFeedback] = useState("");
  const [changeReason, setChangeReason] = useState("");
  const [step, setStep] = useState<WorkspaceStep>(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadingSelection, setLoadingSelection] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const closeShareModal = useCallback(() => setShareModalOpen(false), []);
  const loadRequestRef = useRef(0);
  const loadControllerRef = useRef<AbortController | null>(null);
  const selectionControllerRef = useRef<AbortController | null>(null);
  const selectionRequestRef = useRef(0);
  // A synchronous lock closes the gap before React renders `busy=true`; it
  // prevents double clicks from starting duplicate uploads or expensive AI calls.
  const actionLockRef = useRef(false);
  const selectedAssessment = useMemo(() => assessments.find(item => String(item.id) === assessmentId) || null, [assessments, assessmentId]);
  const filteredAssessments = useMemo(() => assessments.filter(item => item.status !== "archived" && (courseFilter === "all" || String(item.course ?? "unassigned") === courseFilter)), [assessments, courseFilter]);
  const assessmentQuestions = useMemo(() => questions.filter(item => String(item.assessment) === assessmentId).sort((a, b) => a.position - b.position), [questions, assessmentId]);
  // The workspace API already scopes this list to active students enrolled in
  // the selected course (or all active students when the assessment has no course).
  const availableStudents = useMemo(() => students.filter(item => item.active), [students]);
  const visibleSubmissions = useMemo(() => submissions.filter(item => {
    if (String(item.assessment) !== assessmentId) return false;
    const text = `${item.student_display_name || item.student_name} ${item.source_filename || ""} ${item.answer_text}`.toLocaleLowerCase("es-AR");
    if (!text.includes(searchStudents.trim().toLocaleLowerCase("es-AR"))) return false;
    const itemCorrection = corrections.find(c => c.submission === item.id);
    if (statusFilter === "pending") return !itemCorrection;
    if (statusFilter === "review") return !!itemCorrection && !["approved", "rejected"].includes(itemCorrection.status);
    if (statusFilter === "approved") return itemCorrection?.status === "approved";
    if (statusFilter === "rejected") return itemCorrection?.status === "rejected";
    return true;
  }), [submissions, assessmentId, searchStudents, statusFilter, corrections]);
  const selectedRubric = useMemo(() => rubrics.find(item => String(item.id) === rubricId) || null, [rubrics, rubricId]);
  const loadAll = useCallback(async (preferredId?: string) => {
    loadControllerRef.current?.abort();
    selectionControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const requestId = ++loadRequestRef.current;
    setLoading(true); setError("");
    try {
      const queryId = preferredId ?? (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("assessment") || "" : "");
      const endpoint = queryId ? `/correction-workspace/?assessment=${encodeURIComponent(queryId)}&summary=1` : "/correction-workspace/?summary=1";
      const workspace = await api<{
        assessments: Assessment[];
        selected_assessment: Assessment | null;
        students: Student[];
        courses: CourseOption[];
        questions: Question[];
        rubrics: typeof rubrics;
        submissions: Submission[];
        corrections: CorrectionSummary[];
        enrollments: unknown[];
        ai_provider?: string;
      }>(endpoint, { signal: controller.signal });
      if (controller.signal.aborted || requestId !== loadRequestRef.current) return;
      const listed = Array.isArray(workspace.assessments) ? workspace.assessments : [];
      const selected = workspace.selected_assessment || null;
      const nextAssessments = selected
        ? listed.map(item => item.id === selected.id ? { ...item, ...selected } : item)
        : listed;
      setAssessments(nextAssessments);
      setCourses(Array.isArray(workspace.courses) ? workspace.courses : []);
      const requestedCourse = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("course") : null;
      if (!preferredId) setCourseFilter(requestedCourse || "all");
      setStudents(Array.isArray(workspace.students) ? workspace.students : []);
      setQuestions(Array.isArray(workspace.questions) ? workspace.questions : []);
      setRubrics(Array.isArray(workspace.rubrics) ? workspace.rubrics : []);
      setSubmissions(Array.isArray(workspace.submissions) ? workspace.submissions : []);
      setCorrections(Array.isArray(workspace.corrections) ? workspace.corrections : []);
      const requestedSubmission = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("submission") : null;
      if (requestedSubmission) {
        const target = (Array.isArray(workspace.submissions) ? workspace.submissions : []).find(item => String(item.id) === requestedSubmission);
        if (target) {
          const relatedCorrection = (Array.isArray(workspace.corrections) ? workspace.corrections : []).find(item => item.submission === target.id);
          const [detail, detailedCorrection] = await Promise.all([
            api<Submission>(`/submissions/${target.id}/`, { signal: controller.signal }),
            relatedCorrection
              ? api<Correction>(`/corrections/${relatedCorrection.id}/`, { signal: controller.signal })
              : Promise.resolve(null),
          ]);
          if (controller.signal.aborted || requestId !== loadRequestRef.current) return;
          setActiveSubmission(detail);
          setSubmissions(previous => previous.map(item => item.id === detail.id ? { ...item, ...detail } : item));
          setAnswerText(detail.answer_text || "");
          setStudentId(detail.student ? String(detail.student) : "");
          setStudentName(detail.student_name || detail.student_display_name || "");
          setQuestionId(detail.question ? String(detail.question) : "");
          if (detailedCorrection) {
            setCorrection(detailedCorrection);
            const visible = detailedCorrection.status === "approved" && detailedCorrection.final_result?.criteria?.length ? detailedCorrection.final_result : detailedCorrection.proposal;
            setProposal(visible);
            setRubricId(detailedCorrection.rubric ? String(detailedCorrection.rubric) : "");
            setFeedback(detailedCorrection.teacher_feedback || visible.feedback || "");
            setStep(3);
          } else { setCorrection(null); setProposal(null); setStep(2); }
        }
      }
      setAiProvider(workspace.ai_provider || "mock");
      const nextId = selected ? String(selected.id) : "";
      setAssessmentId(nextId);
      if (!selected) {
        setActiveSubmission(null); setCorrection(null); setProposal(null); setAnswerText("");
        setStudentId(""); setStudentName(""); setRubricId(""); setStep(1);
      }
      if (selected) {
        setObjectives(selected.objectives || "");
        setInstructions(selected.instructions || "");
        setReferenceMaterial(selected.reference_material || "");
        const relatedQuestions = (workspace.questions || []).slice().sort((x, y) => x.position - y.position);
        setQuestionId(prev => relatedQuestions.some(item => String(item.id) === prev) ? prev : String(relatedQuestions[0]?.id || ""));
      } else {
        setObjectives(""); setInstructions(""); setReferenceMaterial(""); setQuestionId("");
      }
    } catch (caught) {
      if (!controller.signal.aborted && requestId === loadRequestRef.current) {
        setError(caught instanceof Error ? caught.message : "No pudimos cargar el espacio de corrección.");
      }
    } finally {
      if (!controller.signal.aborted && requestId === loadRequestRef.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadAll();
    return () => {
      loadRequestRef.current += 1;
      loadControllerRef.current?.abort();
      selectionRequestRef.current += 1;
      selectionControllerRef.current?.abort();
    };
  }, [loadAll]);
  useEffect(() => {
    let active = true;
    setFeedbackStyle(readPreference("maestria-feedback-style", "constructivo"));
    void (async () => {
      try {
        const session = await supabase?.auth.getSession();
        const savedStyle = session?.data.session?.user.user_metadata?.maestria_feedback_style;
        if (active && (savedStyle === "formal" || savedStyle === "constructivo" || savedStyle === "motivador")) {
          setFeedbackStyle(savedStyle);
          writePreference("maestria-feedback-style", savedStyle);
        }
      } catch {
        // Local preference remains as a resilient fallback when session storage fails.
      }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!selectedAssessment) return;
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("submission")) return;
    setObjectives(selectedAssessment.objectives || ""); setInstructions(selectedAssessment.instructions || ""); setReferenceMaterial(selectedAssessment.reference_material || "");
    setQuestionId(prev => assessmentQuestions.some(item => String(item.id) === prev) ? prev : String(assessmentQuestions[0]?.id || ""));
    setRubricId(""); setActiveSubmission(null); setCorrection(null); setProposal(null); setAnswerText(""); setAnswerFile(null); setQuestionSuggestions([]); setQuestionSuggestionDemo(false); setStep(1);
  // Keep the synchronization tied to the selected assessment only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId]);
  function changeAssessment(value: string) {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (value) url.searchParams.set("assessment", value); else url.searchParams.delete("assessment");
      window.history.replaceState({}, "", url.toString());
    }
    if (!value) {
      loadRequestRef.current += 1;
      loadControllerRef.current?.abort();
      setLoading(false);
      setAssessmentId(""); setQuestions([]); setSubmissions([]); setCorrections([]);
      setObjectives(""); setInstructions(""); setReferenceMaterial(""); setQuestionId("");
      setRubricId(""); setActiveSubmission(null); setCorrection(null); setProposal(null); setAnswerText("");
      setStep(1); setError(""); setMessage("");
      return;
    }
    void loadAll(value);
  }
  function beginAction(): boolean {
    if (actionLockRef.current) return false;
    actionLockRef.current = true;
    return true;
  }
  function endAction(): void {
    actionLockRef.current = false;
  }
  async function saveContext(): Promise<void> {
    if (!selectedAssessment) throw new Error("Seleccioná una evaluación primero.");
    const updated = await api<Assessment>(`/assessments/${selectedAssessment.id}/`, {
      method: "PATCH", body: JSON.stringify({
        objectives: objectives.trim(), instructions: instructions.trim(), reference_material: referenceMaterial,
        title: selectedAssessment.title, subject: selectedAssessment.subject, level: selectedAssessment.level,
        status: selectedAssessment.status, course: selectedAssessment.course || null,
      }),
    });
    setAssessments(prev => prev.map(item => item.id === updated.id ? { ...item, ...updated } : item));
  }
  async function importReference() {
    if (!selectedAssessment || !materialFile || !beginAction()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await saveContext();
      const form = new FormData(); form.set("file", materialFile); form.set("mode", materialMode);
      const result = await api<{ reference_material: string; chars: number }>(`/assessments/${selectedAssessment.id}/import-reference/`, { method: "POST", body: form });
      setReferenceMaterial(result.reference_material); setAssessments(prev => prev.map(item => item.id === selectedAssessment.id ? { ...item, reference_material: result.reference_material } : item)); setMaterialFile(null); setMessage(`Material incorporado: ${result.chars.toLocaleString("es-AR")} caracteres extraídos.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No pudimos procesar el material."); }
    finally { endAction(); setBusy(false); }
  }
  async function suggestQuestions() {
    if (!selectedAssessment || !beginAction()) return;
    setGeneratingQuestions(true); setError(""); setMessage("");
    try {
      await saveContext();
      const result = await api<{ questions: QuestionSuggestion[]; demo?: boolean; warnings?: string[] }>(`/assessments/${selectedAssessment.id}/generate-questions/`, { method: "POST", body: JSON.stringify({ count: 3 }) });
      setQuestionSuggestions(Array.isArray(result.questions) ? result.questions : []);
      setQuestionSuggestionDemo(Boolean(result.demo));
      if (result.questions?.length) setMessage(result.demo ? "Se prepararon consignas de ejemplo. Editalas antes de incorporarlas." : "Revisá las consignas propuestas y agregá solo las que quieras conservar.");
      else setError("No recibimos preguntas válidas. Revisá la configuración de IA e intentá de nuevo.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudieron proponer consignas."); }
    finally { endAction(); setGeneratingQuestions(false); }
  }
  function updateQuestionSuggestion(index: number, patch: Partial<QuestionSuggestion>) {
    setQuestionSuggestions(previous => previous.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }
  function discardQuestionSuggestion(index: number) {
    setQuestionSuggestions(previous => previous.filter((_, itemIndex) => itemIndex !== index));
  }
  async function acceptQuestion(suggestion: QuestionSuggestion) {
    if (!selectedAssessment || !beginAction()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const nextPosition = assessmentQuestions.reduce((max, question) => Math.max(max, question.position), 0) + 1;
      const created = await api<Question>("/questions/", { method: "POST", body: JSON.stringify({ assessment: selectedAssessment.id, prompt: suggestion.prompt.trim(), max_score: suggestion.max_score, position: nextPosition }) });
      setQuestions(previous => [...previous, created].sort((a, b) => a.position - b.position));
      setQuestionId(String(created.id));
      setMessage("Consigna agregada a la evaluación y seleccionada para la próxima entrega.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo agregar la consigna."); }
    finally { endAction(); setBusy(false); }
  }
  function updateProposalCriterion(index: number, patch: Partial<Criterion>) {
    setProposal(prev => prev ? { ...prev, criteria: prev.criteria.map((item, i) => i === index ? { ...item, ...patch } : item) } : prev);
  }
  async function makeSubmissionAndCorrect(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedAssessment) return;
    if (!answerText.trim() && !answerFile) { setError("Pegá la respuesta o adjuntá un archivo antes de generar la corrección."); return; }
    if (!studentId && !studentName.trim()) { setError("Seleccioná un estudiante o indicá un nombre para identificar la entrega."); return; }
    if (!beginAction()) return;
    setBusy(true); setError(""); setMessage(""); setShareModalOpen(false); setCorrection(null); setProposal(null);
    try {
      await saveContext();
      let submission: Submission;
      if (answerFile) {
        const form = new FormData();
        form.set("file", answerFile); form.set("assessment", String(selectedAssessment.id));
        if (questionId) form.set("question", questionId);
        if (studentId) form.set("student", studentId);
        if (studentName.trim()) form.set("student_name", studentName.trim());
        submission = await api<Submission>("/submissions/import-file/", { method: "POST", body: form });
      } else {
        const payload = { assessment: selectedAssessment.id, question: questionId ? Number(questionId) : null, student: studentId ? Number(studentId) : null, student_name: studentName.trim(), answer_text: answerText.trim(), source_type: "text" };
        if (activeSubmission && String(activeSubmission.assessment) === String(selectedAssessment.id)) {
          submission = await api<Submission>(`/submissions/${activeSubmission.id}/`, { method: "PATCH", body: JSON.stringify(payload) });
        } else {
          submission = await api<Submission>("/submissions/", { method: "POST", body: JSON.stringify(payload) });
        }
      }
      setActiveSubmission(submission);
      const generated = await api<Correction>(`/submissions/${submission.id}/generate-correction/`, { method: "POST", body: JSON.stringify({ rubric_id: rubricId ? Number(rubricId) : null, feedback_style: feedbackStyle }) });
      setCorrection(generated); setProposal(generated.proposal); setFeedback(generated.teacher_feedback || generated.proposal.feedback || "");
      setChangeReason(""); setStep(3); setMessage("La propuesta está lista. Revisá cada criterio antes de aprobarla.");
      setSubmissions(previous => [submission, ...previous.filter(item => item.id !== submission.id)]);
      setCorrections(previous => [summarizeCorrection(generated), ...previous.filter(item => item.id !== generated.id && item.submission !== generated.submission)]);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No pudimos generar la propuesta."); }
    finally { endAction(); setBusy(false); }
  }
  async function approveCorrection() {
    if (!correction || !proposal || !activeSubmission) return;
    const base = correction.proposal.criteria || [];
    const changed = proposal.criteria.some((item, index) => Number(item.score) !== Number(base[index]?.score));
    if (changed && changeReason.trim().length < 8) { setError("Explicá brevemente por qué modificaste el puntaje (al menos 8 caracteres)."); return; }
    if (!beginAction()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api<Correction>(`/corrections/${correction.id}/approve/`, { method: "POST", body: JSON.stringify({ final_result: proposal, teacher_feedback: feedback, change_reason: changeReason }) });
      setCorrection(result); setProposal(result.final_result || proposal); setFeedback(result.teacher_feedback || feedback); setCorrections(previous => previous.map(item => item.id === result.id ? { ...item, status: result.status, total_score: result.total_score } : item)); setSubmissions(previous => previous.map(item => item.id === activeSubmission.id ? { ...item, status: "approved" } : item)); setMessage("Corrección aprobada y guardada en el historial.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo aprobar la corrección."); }
    finally { endAction(); setBusy(false); }
  }
  async function selectSubmission(submission: Submission) {
    if (actionLockRef.current) return;
    selectionControllerRef.current?.abort();
    const controller = new AbortController();
    selectionControllerRef.current = controller;
    const requestId = ++selectionRequestRef.current;
    setError("");
    setAnswerFile(null);
    setLoadingSelection(true);
    const found = corrections.find(item => item.submission === submission.id);
    try {
      const [detail, detailedCorrection] = await Promise.all([
        api<Submission>(`/submissions/${submission.id}/`, { signal: controller.signal }),
        found ? api<Correction>(`/corrections/${found.id}/`, { signal: controller.signal }) : Promise.resolve(null),
      ]);
      if (controller.signal.aborted || requestId !== selectionRequestRef.current) return;
      setActiveSubmission(detail);
      setSubmissions(previous => previous.map(item => item.id === detail.id ? { ...item, ...detail } : item));
      setAnswerText(detail.answer_text || "");
      setStudentId(detail.student ? String(detail.student) : "");
      setStudentName(detail.student_name || detail.student_display_name || "");
      setQuestionId(detail.question ? String(detail.question) : "");
      if (detailedCorrection) {
        setCorrection(detailedCorrection);
        setRubricId(detailedCorrection.rubric ? String(detailedCorrection.rubric) : "");
        const visible = detailedCorrection.status === "approved" && detailedCorrection.final_result?.criteria?.length ? detailedCorrection.final_result : detailedCorrection.proposal;
        setProposal(visible);
        setFeedback(detailedCorrection.teacher_feedback || visible.feedback || "");
        setStep(3);
      } else {
        setCorrection(null); setProposal(null); setFeedback(""); setStep(2);
      }
    } catch (caught) {
      if (controller.signal.aborted || requestId !== selectionRequestRef.current) return;
      setError(caught instanceof Error ? caught.message : "No se pudo cargar el detalle de la entrega.");
    } finally {
      if (requestId === selectionRequestRef.current) setLoadingSelection(false);
    }
  }
  const approvedCount = visibleSubmissions.filter(item => corrections.some(c => c.submission === item.id && c.status === "approved")).length;
  const reviewedCount = visibleSubmissions.filter(item => corrections.some(c => c.submission === item.id)).length;
  const selectedStudent = useMemo(() => activeSubmission?.student
    ? students.find(item => String(item.id) === String(activeSubmission.student)) || null
    : null, [students, activeSubmission]);
  const shareData = useMemo<CorrectionShareData | null>(() => {
    if (!selectedAssessment || !activeSubmission || !correction || correction.status !== "approved" || !proposal) return null;
    return {
      studentName: activeSubmission.student_display_name || activeSubmission.student_name || selectedStudent?.name || "Estudiante",
      studentEmail: selectedStudent?.email || "",
      assessmentTitle: selectedAssessment.title,
      totalScore: proposal.criteria.reduce((sum, item) => sum + Number(item.score || 0), 0),
      teacherFeedback: feedback,
      proposal,
    };
  }, [selectedAssessment, activeSubmission, correction, proposal, selectedStudent, feedback]);
  return (
    <>
      
      <main className="app-main correction-workspace" id="main-content" tabIndex={-1}>
        <header className="app-header workspace-main-heading">
          <div className="workspace-heading-copy"><span className="eyebrow">ESPACIO DE TRABAJO</span><h1>Vamos a corregir con criterio.</h1><p>Elegí la materia, prepará el contexto y revisá cada propuesta antes de aprobarla.</p></div>
          <div className="workspace-heading-tools">
            <label className="workspace-assessment-select" htmlFor="workspace-course-filter">Materia o curso
              <select id="workspace-course-filter" value={courseFilter} onChange={event => { const next = event.target.value; setCourseFilter(next); if (typeof window !== "undefined") { const url = new URL(window.location.href); if (next === "all") url.searchParams.delete("course"); else url.searchParams.set("course", next); window.history.replaceState({}, "", url.toString()); } const visible = assessments.filter(item => item.status !== "archived" && (next === "all" || String(item.course ?? "unassigned") === next)); if (!visible.some(item => String(item.id) === assessmentId)) changeAssessment(visible[0] ? String(visible[0].id) : ""); }} disabled={loading || busy}><option value="all">Todas las materias</option>{courses.filter(course => course.active).map(course => <option key={course.id} value={course.id}>{course.name}</option>)}{assessments.some(item => !item.course) && <option value="unassigned">Sin materia asignada</option>}</select>
            </label>
            <label className="workspace-assessment-select" htmlFor="workspace-assessment">Evaluación
              <select id="workspace-assessment" value={filteredAssessments.some(item => String(item.id) === assessmentId) ? assessmentId : ""} onChange={event => changeAssessment(event.target.value)} disabled={loading || busy || generatingQuestions || assessments.length === 0}><option value="">Elegí una evaluación…</option>{filteredAssessments.map(item => <option key={item.id} value={item.id}>{item.title}{item.course_name ? ` · ${item.course_name}` : ""}</option>)}</select>
            </label>
            <div className="workspace-heading-links">
              {selectedAssessment && <div className="workspace-assessment-meta"><span className={`assessment-status status-${selectedAssessment.status}`}>{selectedAssessment.status === "ready" ? "Lista" : selectedAssessment.status === "archived" ? "Archivada" : "Borrador"}</span><span>{selectedAssessment.subject || selectedAssessment.course_name || "Sin materia indicada"}</span><Link href={`/app/evaluaciones/${selectedAssessment.id}`} className="text-link">Editar ↗</Link></div>}
              <Link href="/app/evaluaciones/nueva" className="workspace-create-link">＋ Nueva evaluación</Link>
            </div>
          </div>
        </header>
        {selectedAssessment && aiProvider === "mock" && <p className="notice ai-demo-inline" role="note"><strong>Modo de práctica.</strong> Las propuestas son simuladas y no deben usarse para calificar respuestas reales.</p>}
        {selectedAssessment?.title.startsWith("Ejemplo MaestrIA") && <details className="practice-help-card"><summary><span aria-hidden="true">ⓘ</span> Cómo usar el ejemplo de práctica</summary><p>Este conjunto contiene un curso, estudiantes y respuestas ficticios guardados en tu cuenta. No se subió un archivo de respuesta: los textos de práctica se guardan como texto.</p><ol><li>Elegí una entrega pendiente y revisá la consigna y la rúbrica.</li><li>Generá la propuesta con un proveedor de IA real configurado; el modo MOCK está bloqueado para este conjunto.</li><li>Revisá la evidencia textual y la justificación de cada criterio. Podés editar los puntajes y la devolución.</li><li>Aprobá para guardar la decisión docente; después podés compartir la devolución o guardarla como PDF desde la impresión del navegador.</li></ol><p className="field-hint">Si falla la generación, revisá el proveedor, las claves y los permisos de procesamiento externo del servidor.</p></details>}
        {loading ? <div className="empty-state" role="status" aria-live="polite">Preparando tu espacio de corrección…</div> : null}
        {!loading && assessments.length === 0 && <section className="empty-state"><div className="empty-icon" aria-hidden="true">✳</div><h2>Primero necesitamos una evaluación</h2><p>Creá una evaluación, aunque sea sencilla. Después vas a poder sumar materiales, elegir una entrega y generar una propuesta de corrección.</p><Link className="button button-primary" href="/app/evaluaciones/nueva">Crear evaluación</Link></section>}
        {!loading && assessments.length > 0 && !selectedAssessment && <div className="notice" role="alert">Seleccioná una evaluación para continuar.</div>}
        {error && <div className="error-message" role="alert"><b>No se pudo completar el paso.</b><p>{error}</p></div>}
        {message && <div className="success-message" role="status" aria-live="polite">{message}</div>}
        {loadingSelection && <p className="loading-message" role="status" aria-live="polite">Cargando la entrega seleccionada…</p>}
        {selectedAssessment && <>
          <ol className="workspace-stepper" aria-label="Etapas del proceso de corrección. Contexto y entrega se pueden preparar en paralelo.">{([{id:1,title:"Contexto",hint:"Consigna y criterios"},{id:2,title:"Entrega",hint:"Respuesta del estudiante"},{id:3,title:"Revisar",hint:"Editar y aprobar"}] as const).map(item => <li key={item.id} className={step === item.id ? "is-current" : step > item.id ? "is-done" : ""}><button type="button" onClick={() => item.id < 3 || correction ? setStep(item.id) : setStep(2)} aria-current={step === item.id ? "step" : undefined}><span className="step-number">{step > item.id ? "✓" : item.id}</span><span><b>{item.title}</b><small>{item.hint}</small></span></button></li>)}</ol>
          {step !== 3 && <div className="correction-intake-layout correction-three-column">
            <section className="workspace-panel workspace-context-panel"><header className="workspace-panel-head"><span className="workspace-panel-icon">01</span><div><h2>Contexto y criterios</h2><p>Consigna, materiales y rúbrica.</p></div></header><div className="workspace-panel-body">
              <label htmlFor="workspace-objectives">Objetivos de aprendizaje</label><p className="field-hint workspace-field-hint">¿Qué deberían comprender o poder hacer los estudiantes?</p><textarea id="workspace-objectives" rows={3} maxLength={5000} value={objectives} onChange={event => setObjectives(event.target.value)} placeholder="Ej. comparar dos teorías y justificar una conclusión con evidencia." />
              <label htmlFor="workspace-instructions">¿Qué querés evaluar?</label><textarea id="workspace-instructions" rows={4} maxLength={8000} value={instructions} onChange={event => setInstructions(event.target.value)} placeholder="Describí el tema, la consigna o qué debería resolver el estudiante." />
              <section className="workspace-consignas" aria-labelledby="workspace-consignas-title"><div className="workspace-consignas-heading"><h3 id="workspace-consignas-title">Consignas</h3><Link href={`/app/evaluaciones/${selectedAssessment.id}`} className="text-link">Gestionar consignas ↗</Link></div>{assessmentQuestions.length > 0 ? <ol>{assessmentQuestions.map(question => <li key={question.id}><span>{question.prompt}</span><small>{question.max_score} pts</small></li>)}</ol> : <p className="field-hint">Todavía no hay consignas guardadas para esta evaluación. Podés agregarlas desde el editor.</p>}<details className="question-assistance"><summary><span><b>Proponer consignas con MaestrIA</b><small>Ideas editables a partir del contexto y los apuntes</small></span><span className="disclosure-cue" aria-hidden="true">+</span></summary><div className="question-assistance-body"><p>Revisá las propuestas y agregá solo las que quieras conservar.</p><button type="button" className="button button-quiet" onClick={() => void suggestQuestions()} disabled={generatingQuestions || busy}>{generatingQuestions ? "Preparando ideas…" : "Proponer 3 consignas"}</button></div></details></section>
              {questionSuggestionDemo && <p className="field-hint">Modo demostración: estas consignas son ejemplos editables; no fueron generadas por un modelo real.</p>}
              {questionSuggestions.length > 0 && <div className="question-suggestions" aria-label="Consignas propuestas">{questionSuggestions.map((item, index) => <article key={`question-suggestion-${index}`}><span className="question-suggestion-number">{String(index + 1).padStart(2, "0")}</span><div className="question-suggestion-editor"><label htmlFor={`question-suggestion-prompt-${index}`}>Consigna propuesta (editable)</label><textarea id={`question-suggestion-prompt-${index}`} rows={3} maxLength={5000} value={item.prompt} onChange={event => updateQuestionSuggestion(index, { prompt: event.target.value })}/><p>{item.rationale || "Propuesta editable; revisá que corresponda a los objetivos de la evaluación."}</p><label htmlFor={`question-suggestion-score-${index}`}>Puntaje máximo</label><input id={`question-suggestion-score-${index}`} type="number" min="0.5" max="1000" step="0.5" value={item.max_score} onChange={event => updateQuestionSuggestion(index, { max_score: Number(event.target.value) })}/></div><div className="question-suggestion-actions"><button type="button" className="button button-quiet button-small" disabled={busy || !item.prompt.trim() || !Number.isFinite(item.max_score) || item.max_score <= 0 || assessmentQuestions.some(question => question.prompt.trim().toLocaleLowerCase("es-AR") === item.prompt.trim().toLocaleLowerCase("es-AR"))} onClick={() => void acceptQuestion(item)}>{assessmentQuestions.some(question => question.prompt.trim().toLocaleLowerCase("es-AR") === item.prompt.trim().toLocaleLowerCase("es-AR")) ? "Agregada" : "Agregar a la evaluación"}</button><button type="button" className="text-link" disabled={busy} onClick={() => discardQuestionSuggestion(index)}>Descartar</button></div></article>)}</div>}
              <div className="material-dropzone"><div className="material-dropzone-icon" aria-hidden="true">↥</div><div className="material-dropzone-copy"><b>Apuntes y materiales de la cursada</b><span>PDF con texto, DOCX, TXT o MD · máximo 5 MB</span>{materialFile && <small>Seleccionado: {materialFile.name}</small>}</div><label className="button button-quiet upload-button">Elegir archivo<input type="file" accept={ACCEPTED_FILES} onChange={(event: ChangeEvent<HTMLInputElement>) => setMaterialFile(event.target.files?.[0] || null)} /></label></div>
              <div className="material-actions"><button type="button" className="button button-primary" disabled={!materialFile || busy} onClick={() => void importReference()}>{busy ? "Procesando…" : "Incorporar material"}</button><span className="field-hint">El texto extraído se conserva como contexto de esta evaluación.</span></div>
              <details className="workspace-more-details"><summary>Más detalles</summary>
                <div className="workspace-more-details-body">{referenceMaterial && <details className="reference-preview"><summary>Ver material incorporado ({referenceMaterial.length.toLocaleString("es-AR")} caracteres)</summary><pre>{referenceMaterial.slice(0, 12000)}{referenceMaterial.length > 12000 ? "\n\n[Vista previa recortada; se conserva el texto completo.]" : ""}</pre></details>}
                  <label htmlFor="material-mode">Al incorporar el archivo</label><select id="material-mode" value={materialMode} onChange={event => setMaterialMode(event.target.value as "replace" | "append")}><option value="append">Agregar al material existente</option><option value="replace">Reemplazar el material existente</option></select>
                  <label htmlFor="workspace-rubric">Rúbrica para la corrección</label><select id="workspace-rubric" value={rubricId} onChange={event => setRubricId(event.target.value)}><option value="">Usar criterios generales de la consigna</option>{rubrics.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>
                  {selectedRubric && <div className="rubric-compact-summary"><div><b>{selectedRubric.title}</b><span>{selectedRubric.criteria?.length || 0} criterios · {selectedRubric.scale_type === "levels" ? "Niveles" : selectedRubric.scale_type === "both" ? "Puntajes y niveles" : "Escala numérica"}</span></div><details><summary>Ver criterios</summary><ul>{selectedRubric.criteria?.map(item => <li key={item.id}>{item.name}<span>{item.max_score} pts</span></li>)}</ul></details></div>}
                  <p className="field-hint">Para crear o modificar una rúbrica, entrá al editor de esta evaluación.</p>
                  <Link href={`/app/evaluaciones/${selectedAssessment.id}`} className="text-link">Configurar rúbrica en la evaluación ↗</Link></div></details>

              <div className="panel-bottom-actions"><Link href={`/app/evaluaciones/${selectedAssessment.id}`} className="text-link">Editar evaluación y preguntas ↗</Link><button className="button button-primary" type="button" disabled={busy} onClick={async () => { if (!beginAction()) return; setBusy(true); setError(""); try { await saveContext(); setMessage("Contexto guardado. Ya podés cargar una entrega en el panel siguiente."); setStep(2); } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar el contexto."); } finally { endAction(); setBusy(false); } }}>Guardar contexto</button></div>
            </div></section>
            <section className="workspace-panel intake-panel"><header className="workspace-panel-head"><span className="workspace-panel-icon">02</span><div><h2>Entrega del estudiante</h2><p>Elegí a quién corresponde y cargá su respuesta.</p></div></header><div className="workspace-panel-body"><form onSubmit={makeSubmissionAndCorrect}>
              <div className="form-two"><div><label htmlFor="workspace-student">Estudiante <span className="muted">(o escribí un nombre)</span></label><select id="workspace-student" value={studentId} onChange={event => { setStudentId(event.target.value); const found = students.find(item => String(item.id) === event.target.value); if (found) setStudentName(found.name); }}><option value="">Elegir estudiante…</option>{availableStudents.map(item => <option key={item.id} value={item.id}>{item.name}{item.email ? ` · ${item.email}` : ""}</option>)}</select><label htmlFor="workspace-student-name">Nombre identificador</label><input id="workspace-student-name" value={studentName} onChange={event => setStudentName(event.target.value)} maxLength={180} placeholder="Ej. Estudiante 01" /></div><details className="delivery-options"><summary>Opciones de la entrega <span className="muted">(consigna y tono)</span></summary><div className="delivery-options-fields"><label htmlFor="workspace-question">Consigna específica<select id="workspace-question" value={questionId} onChange={event => setQuestionId(event.target.value)}><option value="">Usar consigna general</option>{assessmentQuestions.map(item => <option key={item.id} value={item.id}>{item.position}. {item.prompt.slice(0, 100)}</option>)}</select></label><label htmlFor="workspace-feedback-style">Tono de la devolución<select id="workspace-feedback-style" value={feedbackStyle} onChange={event => setFeedbackStyle(event.target.value)}><option value="formal">Formal / académico</option><option value="constructivo">Constructivo / orientador</option><option value="motivador">Motivador / empático</option></select></label></div></details></div>
              <label htmlFor="workspace-answer">Respuesta del estudiante</label><textarea id="workspace-answer" rows={7} maxLength={50000} value={answerText} onChange={event => setAnswerText(event.target.value)} placeholder="Pegá acá la respuesta. Se conservará el texto original para contrastarlo con la propuesta." />
              <div className="answer-upload-row"><div><b>¿Tenés un archivo?</b><span>TXT, MD, PDF con texto seleccionable o DOCX · máximo 5 MB</span>{answerFile && <small>Seleccionado: {answerFile.name}</small>}</div><label className="button button-quiet upload-button">Adjuntar archivo<input type="file" accept={ACCEPTED_FILES} onChange={(event: ChangeEvent<HTMLInputElement>) => setAnswerFile(event.target.files?.[0] || null)} /></label>{answerFile && <button className="text-link" type="button" onClick={() => setAnswerFile(null)}>Quitar</button>}</div>
              <details className="privacy-note"><summary><span aria-hidden="true">⌑</span> Privacidad y uso de IA</summary><p>Antes de enviar una respuesta a un proveedor de IA, evitá incluir datos personales innecesarios. Verificá la configuración del proveedor y revisá el texto extraído antes de confiar en una propuesta.</p></details>
              <div className="panel-bottom-actions"><button className="button button-primary" disabled={busy || (!answerText.trim() && !answerFile) || (!studentId && !studentName.trim())}>{busy ? "Analizando respuesta…" : "Guardar y proponer corrección"}</button></div>
            </form></div></section>
            <aside className="workspace-panel student-queue-panel"><header className="workspace-panel-head"><span className="workspace-panel-icon">03</span><div><h2>Entregas</h2><p>{visibleSubmissions.length} registradas · {approvedCount} aprobadas</p></div></header><div className="queue-progress"><span><i style={{ width: `${visibleSubmissions.length ? Math.round(reviewedCount / visibleSubmissions.length * 100) : 0}%` }} /></span><small>{reviewedCount} de {visibleSubmissions.length} revisadas</small></div><div className="workspace-panel-body queue-body"><label htmlFor="queue-search">Buscar entrega<input id="queue-search" type="search" value={searchStudents} onChange={event => setSearchStudents(event.target.value)} placeholder="Nombre, archivo o primeras palabras de la respuesta" /></label><label className="queue-filter-select" htmlFor="queue-status-filter">Estado<select id="queue-status-filter" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>{[{id:"all",label:"Todas"},{id:"pending",label:"Pendientes"},{id:"review",label:"En revisión"},{id:"rejected",label:"Rechazadas"},{id:"approved",label:"Aprobadas"}].map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{visibleSubmissions.length === 0 ? <div className="queue-empty"><span aria-hidden="true">▤</span><b>Aún no hay entregas para mostrar</b><p>Cuando guardes una respuesta, aparecerá acá para poder retomarla.</p></div> : <div className="queue-list">{visibleSubmissions.map(item => { const c = corrections.find(value => value.submission === item.id); const state = c?.status === "approved" ? "Aprobada" : c?.status === "rejected" ? "Rechazada" : c ? "En revisión" : "Pendiente"; return <button key={item.id} type="button" className={`queue-item ${activeSubmission?.id === item.id ? "is-active" : ""}`} onClick={() => selectSubmission(item)}><span className="queue-avatar">{(item.student_display_name || item.student_name || "E").slice(0, 1).toUpperCase()}</span><span className="queue-item-copy"><b>{item.student_display_name || item.student_name || "Estudiante"}</b><small>{item.source_filename || (item.answer_text || "Entrega") .slice(0, 58)}</small></span><span className={`status-pill ${c?.status === "approved" ? "delivery-status-approved" : c?.status === "rejected" ? "delivery-status-rejected" : ""}`}>{state}</span></button>; })}</div>}</div></aside>
          </div>}
          {step === 3 && activeSubmission && correction && proposal && <section className="workspace-review-view"><header className="review-page-header"><div><span className="eyebrow">PASO 3 · REVISIÓN DOCENTE</span><h2>{activeSubmission.student_display_name || activeSubmission.student_name || selectedStudent?.name || "Estudiante sin identificar"}</h2><p>{[selectedAssessment.course_name, selectedAssessment.title, correction.status === "approved" ? "Resultado aprobado" : "Propuesta pendiente de tu revisión"].filter(Boolean).join(" · ")}</p><label className="review-submission-picker">Entrega a revisar<select value={String(activeSubmission.id)} onChange={event => { const item = submissions.find(value => String(value.id) === event.target.value); if (item) selectSubmission(item); }} aria-label="Cambiar entrega para revisar">{submissions.map(item => <option key={item.id} value={item.id}>{item.student_display_name || item.student_name || "Estudiante"} · #{item.id}</option>)}</select></label></div><div className="review-header-actions"><span className={`status-pill ${correction.status === "approved" ? "delivery-status-approved" : correction.status === "rejected" ? "delivery-status-rejected" : "delivery-status-review"}`}>{correction.status === "approved" ? "Aprobada por vos" : correction.status === "rejected" ? "Propuesta rechazada" : "Propuesta no definitiva"}</span><button type="button" className="button button-quiet" onClick={() => { setStep(2); setMessage(""); }}>← Entregas</button></div></header>
            {proposal.demo && <div className="notice" role="note"><b>Modo demostración:</b> esta propuesta está simulada porque `AI_PROVIDER=mock`. No la uses como calificación real.</div>}
            {(proposal.warnings || []).length > 0 && <details className="review-warnings"><summary>Advertencias para revisar ({proposal.warnings?.length || 0})</summary><ul>{proposal.warnings?.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
            <div className="workspace-review-split"><section className="workspace-source-card"><header><span className="workspace-panel-icon">A</span><div><h3>Respuesta original</h3><p>Contenido que entregó el estudiante; no se modifica durante la evaluación.</p></div></header><div className="source-block"><span>CONSIGNA</span><p>{(assessmentQuestions.find(item => String(item.id) === String(activeSubmission.question || questionId))?.prompt || selectedAssessment.instructions || "No hay una consigna específica guardada.")}</p></div>{selectedAssessment.objectives && <div className="source-block"><span>OBJETIVOS DE APRENDIZAJE</span><p>{selectedAssessment.objectives}</p></div>}{selectedRubric && <div className="source-block workspace-source-rubric"><span>CRITERIOS ACORDADOS</span><b>{selectedRubric.title}</b><ul>{selectedRubric.criteria?.map(item => <li key={item.id}>{item.name}<small>{item.max_score} pts</small></li>)}</ul></div>}<div className="source-block"><span>RESPUESTA DEL ESTUDIANTE</span><blockquote>{activeSubmission.answer_text || "No hay texto disponible."}</blockquote></div>{activeSubmission.source_filename && <p className="source-file-note">Archivo de origen: {activeSubmission.source_filename}</p>}</section>
              <section className="workspace-proposal-card"><header><span className="workspace-panel-icon">✳</span><div><h3>{correction.status === "approved" ? "Resultado aprobado" : "Propuesta de MaestrIA"}</h3><p>{correction.status === "approved" ? "Esta es la devolución final guardada." : "Editá puntajes, evidencia y comentarios. Nada es definitivo hasta aprobarlo."}</p></div></header><div className="proposal-total"><div><span>Puntaje total</span><strong>{proposal.criteria.reduce((sum, item) => sum + Number(item.score || 0), 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })}<small> / {proposal.criteria.reduce((sum, item) => sum + Number(item.max_score || 0), 0).toLocaleString("es-AR", { maximumFractionDigits: 2 })} puntos</small></strong></div></div><p className="proposal-summary-text">{proposal.summary}</p>
                {proposal.strengths?.length ? <div className="feedback-highlights"><h4>Lo que logró</h4><ul>{proposal.strengths.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
                <div className="workspace-criteria-list"><h4>Criterios de evaluación</h4>{proposal.criteria.map((criterion, index) => <article className="workspace-criterion" key={`${criterion.criterion}-${index}`}><div className="workspace-criterion-head"><b>{criterion.criterion}</b><span>Máximo: {criterion.max_score}</span></div>{criterion.level && <span className="level-pill">Nivel sugerido: {criterion.level}</span>}<div className="criterion-editor-score"><label htmlFor={`workspace-score-${index}`}>Puntaje propuesto</label><div><input id={`workspace-score-${index}`} type="number" min="0" max={criterion.max_score} step="0.25" value={criterion.score} disabled={correction.status === "approved"} onChange={event => updateProposalCriterion(index, { score: Math.min(Number(criterion.max_score), Math.max(0, Number(event.target.value))) })} /><span>/ {criterion.max_score}</span></div></div><label htmlFor={`workspace-evidence-${index}`}>Evidencia literal en la respuesta</label><blockquote className="workspace-evidence">{criterion.evidence ? `“${criterion.evidence}”` : "No se encontró evidencia literal suficiente. Revisá manualmente."}</blockquote><label htmlFor={`workspace-justification-${index}`}>Justificación del puntaje</label><textarea id={`workspace-justification-${index}`} rows={3} value={criterion.justification} disabled={correction.status === "approved"} onChange={event => updateProposalCriterion(index, { justification: event.target.value })} /></article>)}</div>
                {proposal.improvement_suggestions?.length ? <div className="feedback-highlights improvement-highlights"><h4>Ideas para seguir mejorando</h4><ul>{proposal.improvement_suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
                <label htmlFor="workspace-teacher-feedback">Retroalimentación para el estudiante</label><textarea id="workspace-teacher-feedback" className="teacher-feedback-editor" rows={5} value={feedback} disabled={correction.status === "approved"} onChange={event => setFeedback(event.target.value)} />
                {correction.status !== "approved" && <div className="change-reason-box"><label htmlFor="workspace-change-reason">Motivo si ajustaste la puntuación</label><textarea id="workspace-change-reason" rows={2} value={changeReason} onChange={event => setChangeReason(event.target.value)} placeholder="Explicá el criterio pedagógico que justifica el cambio (si corresponde)." /><small>Solo es obligatorio cuando modificás uno o más puntajes de la propuesta.</small></div>}
                <div className="workspace-review-actions">
                  {correction.status !== "approved"
                    ? <button className="button button-primary" type="button" disabled={busy || proposal.demo} onClick={() => void approveCorrection()}>{busy ? "Guardando…" : "Aprobar y guardar resultado"}</button>
                    : <><span className="approved-label">✓ Resultado final guardado</span><button className="button button-primary" type="button" disabled={!shareData || proposal.demo} onClick={() => setShareModalOpen(true)}>Compartir o guardar devolución</button></>}
                </div>
                {correction.status === "approved" && <p className="field-hint workspace-share-hint">Se abrirá tu aplicación de correo o WhatsApp, o la ventana de impresión para guardar como PDF. Revisá siempre el destinatario y confirmá el envío desde esa aplicación.</p>}
              </section></div>
            <div className="workspace-review-footer"><button type="button" className="button button-quiet" onClick={() => { setStep(2); setMessage(""); }}>← Volver a las entregas</button><Link href="/app/correcciones" className="text-link">Ver historial de correcciones →</Link></div>
          </section>}
          {step === 3 && !activeSubmission && <div className="empty-state"><h2>Elegí una entrega para revisar</h2><p>Volvé al paso anterior y cargá una respuesta o seleccioná una entrega existente.</p><button className="button button-primary" type="button" onClick={() => setStep(2)}>Ver entregas</button></div>}
        </>}
        {shareModalOpen && <CorrectionShareModal open={shareModalOpen} data={shareData} onClose={closeShareModal} />}
        <p className="app-disclaimer">MaestrIA asiste en la corrección; el docente revisa y aprueba la calificación final.</p>
      </main>
    </>
  );
}
