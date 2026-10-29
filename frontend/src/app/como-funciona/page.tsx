import "../styles/como-funciona.css";
import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/PublicShell";
import PublicDemo from "@/components/PublicDemo";

export const metadata: Metadata = {
  title: "Cómo funciona MaestrIA",
  description: "Conocé el recorrido de MaestrIA: preparar una evaluación, definir criterios, cargar respuestas y revisar una propuesta de corrección antes de aprobarla.",
  alternates: { canonical: "/como-funciona" },
};

const steps = [
  {
    number: "01",
    chip: "Vos definís",
    title: "Prepará la evaluación",
    body: "Elegí el curso, anotá los objetivos y contenidos, y escribí tus consignas. También podés pedir ideas de preguntas y quedarte solo con las que tengan sentido para tu grupo.",
    resultTitle: "Lo que queda listo",
    result: "Una evaluación propia, editable y alineada con lo que querés enseñar.",
  },
  {
    number: "02",
    chip: "Criterios visibles",
    title: "Acordá qué vas a valorar",
    body: "Organizá una rúbrica con puntajes numéricos, niveles de desempeño o una combinación de ambos. Los criterios son tuyos: la herramienta no debería adivinar qué considerás importante.",
    resultTitle: "Lo que queda listo",
    result: "Expectativas explícitas para valorar las respuestas de manera más consistente.",
  },
  {
    number: "03",
    chip: "Menos tareas repetidas",
    title: "Cargá las respuestas",
    body: "Pegá el texto o importá documentos TXT, DOCX o PDF con texto seleccionable. Antes de solicitar una propuesta, podés revisar el texto extraído y verificar que se lea correctamente.",
    resultTitle: "Lo que queda listo",
    result: "Una entrega organizada y vinculada con la evaluación y la pregunta correspondiente.",
  },
  {
    number: "04",
    chip: "La decisión es tuya",
    title: "Revisá, ajustá y aprobá",
    body: "MaestrIA propone puntajes por criterio, una justificación, evidencia textual y comentarios para aprender. Podés editar el resultado, explicar un cambio de puntaje y aprobarlo cuando estés conforme.",
    resultTitle: "Lo que queda listo",
    result: "Una devolución revisada por vos, con registro de la propuesta y de tu decisión final.",
  },
];

export default function ComoFuncionaPage() {
  return (
    <PublicPage
      title="Trabajar con MaestrIA"
      intro="El proceso completo, con un paso a paso claro para reducir tareas repetitivas, tu criterio docente es la prioridad."
    >
      <section className="how-intro-panel" aria-labelledby="how-intro-title">
        <div>
          <h2 id="how-intro-title">Resultados más rápido</h2>
          <p>
            Desde crear una evaluación hasta entregar las correcciones, todo en un mismo espacio.
          </p>
        </div>
        <div className="how-mini-flow" aria-label="Resumen de las cuatro etapas">
          <div className="how-mini-flow-item"><span>01</span><strong>Diseñar exámen</strong></div>
          <div className="how-mini-flow-item"><span>02</span><strong>Definir criterios</strong></div>
          <div className="how-mini-flow-item"><span>03</span><strong>Cargar respuestas</strong></div>
          <div className="how-mini-flow-item"><span>04</span><strong>Revisar y decidir</strong></div>
        </div>
      </section>

      <div className="how-step-grid">
        {steps.map((step) => (
          <article className="how-step-card" key={step.number}>
            <div className="how-step-top">
              <span className="how-step-number" aria-hidden="true">{step.number}</span>
              <span className="how-step-chip">{step.chip}</span>
            </div>
            <h2>{step.title}</h2>
            <p>{step.body}</p>
            <div className="how-step-result">
              <strong>{step.resultTitle}</strong>
              <span>{step.result}</span>
            </div>
          </article>
        ))}
      </div>

      <section className="how-human-panel">
        <div className="how-human-copy"><span className="eyebrow">EL CRITERIO SIGUE SIENDO TUYO</span><h2>No es apretar un botón y poner una nota.</h2><p>MaestrIA pone en orden la consigna, los criterios y la respuesta; después te muestra una propuesta explicada para que puedas aceptarla, ajustarla o descartarla con criterio pedagógico.</p></div>
        <div className="how-human-points"><div><b>01</b><span>La evidencia debe salir de la respuesta, no inventarse.</span></div><div><b>02</b><span>Los puntajes se contrastan con los criterios que definiste.</span></div><div><b>03</b><span>La devolución final necesita tu aprobación explícita.</span></div></div>
      </section>

      <PublicDemo />

      <aside className="public-callout how-principle-panel">
        <div>
          <h2>Menos tiempo en lo repetitivo. Más tiempo para enseñar.</h2>
          <p>Probá la demostración visual y, cuando quieras recorrer el flujo real con IA, ingresá al espacio docente.</p>
        </div>
        <div className="hero-actions"><Link className="button button-primary" href="#demostracion">Explorar la demostración <span aria-hidden="true">→</span></Link><Link className="button button-quiet" href="/#funciones">Ver funciones</Link></div>
      </aside>
    </PublicPage>
  );
}
