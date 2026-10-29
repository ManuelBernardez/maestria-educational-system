"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
const studentAnswer = "La fotosíntesis es el proceso por el que las plantas usan la luz del sol para producir glucosa a partir de agua y dióxido de carbono. En ese proceso se libera oxígeno.";
export default function PublicDemo() {
  const [scoreOne, setScoreOne] = useState(4);
  const [scoreTwo, setScoreTwo] = useState(4.5);
  const [feedback, setFeedback] = useState("Reconociste los elementos centrales del proceso y explicaste para qué los utiliza la planta. Para profundizar, podrías aclarar el papel de la clorofila y distinguir la energía luminosa de la materia que se transforma.");
  const [approved, setApproved] = useState(false);
  const total = useMemo(() => (scoreOne + scoreTwo).toFixed(1).replace(".", ","), [scoreOne, scoreTwo]);
  return <section id="demostracion" className="how-demo-section" aria-labelledby="public-demo-title">
    <div className="public-page-hero"><h2 id="public-demo-title">Más que un número: una nota con retroalimentación</h2><p className="public-intro">Esta vista interactiva ayuda a reconocer la consigna, la respuesta, los criterios y la devolución editable. Es una simulación visual pública: no llama a la IA ni guarda calificaciones. Para probar el flujo real —con IA configurada, aprobación y exportación— entrá al espacio docente.</p></div>
    <section className="demo-board" aria-labelledby="demo-heading">
      <div className="demo-columns">
        <article className="demo-answer demo-source-card" aria-labelledby="demo-heading">
          <div className="demo-section-heading"><span className="demo-step">01</span><div><h2 id="demo-heading">Solución del estudiante</h2></div></div>
          <section className="demo-content-block"><span className="demo-field-label">Consigna del examen</span><blockquote>“¿Qué función cumple la fotosíntesis?”</blockquote></section>
          <section className="demo-content-block student-response"><span className="demo-field-label">Respuesta entregada por el estudiante</span><blockquote>“{studentAnswer}”</blockquote><p className="demo-help-text">Esta es la respuesta que se evalúa. No es la consigna ni una respuesta generada por MaestrIA.</p></section>
          <section className="demo-content-block"><span className="demo-field-label">¿Qué revisa el docente?</span><p className="demo-help-text">La propuesta compara esta respuesta con los criterios de evaluación. El docente puede comprobar si la valoración está bien fundamentada.</p></section>
        </article>
        <article className="demo-review" aria-labelledby="demo-review-title">
          <div className="demo-section-heading"><span className="demo-step">02</span><div><h2 id="demo-review-title">Propuesta de evaluación</h2></div></div>
          <div className="demo-total"><strong>{total}</strong><span>/ 10 puntos propuestos</span></div>
          <p className="demo-help-text">Los puntos son una sugerencia, no una nota definitiva. Usá los controles para simular un ajuste del docente.</p>
          <div className="demo-score-field"><label htmlFor="score-one">Criterio 1: Comprensión conceptual <span>(máximo 5 puntos)</span></label><input id="score-one" type="range" min="0" max="5" step="0.5" value={scoreOne} onChange={(event) => { setScoreOne(Number(event.target.value)); setApproved(false); }}/><output htmlFor="score-one">{scoreOne.toFixed(1).replace(".", ",")} de 5 puntos</output></div>
          <div className="demo-score-field"><label htmlFor="score-two">Criterio 2: Explicación del proceso <span>(máximo 5 puntos)</span></label><input id="score-two" type="range" min="0" max="5" step="0.5" value={scoreTwo} onChange={(event) => { setScoreTwo(Number(event.target.value)); setApproved(false); }}/><output htmlFor="score-two">{scoreTwo.toFixed(1).replace(".", ",")} de 5 puntos</output></div>
          <div className="demo-feedback-block"><label htmlFor="feedback-demo">Devolución que recibiría el estudiante</label><p className="demo-help-text">El docente puede editar este texto para explicar los aciertos y orientar la mejora.</p><textarea id="feedback-demo" rows={6} maxLength={1200} value={feedback} onChange={(event) => { setFeedback(event.target.value); setApproved(false); }}/><p className="muted tiny">{feedback.length}/1200 caracteres</p></div>
        </article>
      </div>
    </section>
</section>;
}
