import "./styles/inicio.css";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PublicFooter } from "@/components/PublicShell";

export const metadata: Metadata = {
  title: "MaestrIA — Menos tiempo corrigiendo, más tiempo enseñando",
  description: "Plataforma de asistencia docente para diseñar evaluaciones, utilizar rúbricas y revisar propuestas de corrección explicadas, con aprobación final del docente.",
  alternates: { canonical: "/" },
};

const applicationJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "MaestrIA",
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web",
  inLanguage: "es-AR",
  description: "Asistencia para diseñar evaluaciones escritas, aplicar rúbricas y preparar propuestas de corrección sujetas a revisión y aprobación docente.",
};

export default function Home() {
  return <div className="landing">
    <main className="landing-content" id="main-content" tabIndex={-1}>
      <section className="hero hero-redesigned">
        <div className="hero-layout">
          <div className="hero-copy-column">
            <div className="eyebrow"><span className="dot" /> Asistencia inteligente para docentes</div>
            <h2 className="hero-slogan">Menos tiempo corrigiendo:<br /><em>más tiempo enseñando</em></h2>
            <h1>MaestrIA</h1>
            <p className="hero-copy">Diseñá evaluaciones, definí criterios y revisá propuestas de corrección con explicaciones útiles. Tu experiencia docente sigue al frente de cada decisión</p>
            <div className="hero-actions"><Link className="button button-primary" href="/login">Entrar al espacio docente <span aria-hidden>→</span></Link></div>
            </div>
          <div className="hero-art-wrap"><Image src="/maestria-docencia.svg" alt="Ilustración de una evaluación con rúbrica y una propuesta de retroalimentación pendiente de revisión docente" width={760} height={560} priority className="hero-art" /><p className="art-caption">Una herramienta para acompañar el trabajo docente, no para reemplazarlo.</p></div>
        </div>
        <div className="preview-card"><div className="preview-top"><span className="preview-label">VISTA PREVIA · EJEMPLO FICTICIO</span><span className="status-pill">Pendiente de revisión</span></div><div className="preview-grid"><div className="answer-panel"><span className="small-label">RESPUESTA DEL ESTUDIANTE</span><h3>¿Qué función cumple la fotosíntesis?</h3><p>La fotosíntesis es el proceso por el cual las plantas usan la luz solar para producir glucosa a partir de agua y dióxido de carbono, liberando oxígeno.</p><span className="evidence">Evidencia disponible en el texto</span></div><div className="score-panel"><span className="small-label">PROPUESTA EDITABLE · DEMO VISUAL</span><div className="score-line"><strong>8,5</strong><span>/ 10 puntos</span></div><div className="criterion"><div><span>Comprensión conceptual</span><b>4,5 / 5</b></div><div className="progress"><span style={{ width: "90%" }} /></div></div><div className="criterion"><div><span>Uso de conceptos</span><b>4 / 5</b></div><div className="progress"><span style={{ width: "80%" }} /></div></div></div></div></div>
      </section>
      <section id="como-funciona" className="section"><div className="section-heading"><h2>De la consigna a una devolución útil</h2><p>MaestrIA acompaña las tareas repetitivas sin reemplazar tu criterio profesional.</p></div><div className="steps"><article><h3>Diseñá un examen</h3><p>Definí objetivos de evaluación y contenidos. También te sugerimos consignas que podés editar, aceptar o descartar.</p></article><article><h3>Establecé criterios de corrección</h3><p>Para que la corrección se adapte a tus pautas de evaluación</p></article><article><h3>Revisá y decidí</h3><p>Automatizamos la corrección y brindamos retroalimentación al estudiante, vos elegís si aceptar esa propuesta o editarla a tu gusto.</p></article></div><div className="center-action"><Link href="/como-funciona" className="text-link">Conocé el proceso completo →</Link></div></section>
      <section className="principles" id="principios"><div><h2>La IA propone,<br /><em>Vos decidís</em></h2><p>El propósito es devolver tiempo de trabajo operativo sin quitarle a la evaluación su dimensión humana.</p><Link className="button button-quiet" href="/sobre-nosotros">Conocé por qué nace MaestrIA</Link></div><div className="principle-list"><p><b>Transparencia</b><br />Las propuestas deben incluir justificaciones y evidencias que puedan revisarse.</p><p><b>Control total</b><br />Ninguna propuesta se transforma en resultado definitivo sin aprobación explícita.</p><p><b>Privacidad</b><br />Sólo vos podés acceder a los datos sensibles.</p></div></section>
      <section id="funciones" className="section home-features-section">
        <div className="section-heading"><span className="eyebrow">FUNCIONES</span><h2>Todo lo importante, en un mismo recorrido.</h2><p>MaestrIA reúne la preparación, los criterios y la revisión de respuestas para que no tengas que saltar entre herramientas ni empezar de cero cada vez.</p></div>
        <section className="function-story-strip"><div><h3>De lo que enseñaste a una devolución útil.</h3><p>Primero definís qué evaluar. Después, MaestrIA te ayuda con el trabajo repetitivo y te deja la decisión final.</p><Link href="/como-funciona" className="text-link">Ver el recorrido completo →</Link></div><div className="function-story-steps" aria-label="Resumen del flujo"><span><b>1</b> Contexto</span><span><b>2</b> Rúbrica</span><span><b>3</b> Respuesta</span><span><b>4</b> Revisión</span></div></section>
        <div className="function-accordion-list">
          <details className="function-accordion"><summary><span className="function-num">01</span><span className="function-accordion-copy"><small>Prepará</small><b>Una evaluación con contexto</b><span>Organizá la materia, los objetivos y las consignas. Adjuntá apuntes para que la propuesta se apoye en lo que enseñaste.</span></span><span className="function-expand" aria-hidden="true">＋</span></summary><div className="function-accordion-detail"><p>Podés crear preguntas desde cero o partir de ideas generadas por IA. Las propuestas se editan antes de guardarse.</p></div></details>
          <details className="function-accordion"><summary><span className="function-num">02</span><span className="function-accordion-copy"><small>Definí</small><b>Qué significa hacerlo bien</b><span>Usá una escala numérica, niveles de desempeño o una combinación. Los criterios y sus descriptores quedan visibles.</span></span><span className="function-expand" aria-hidden="true">＋</span></summary><div className="function-accordion-detail"><p>Una rúbrica clara mejora la consistencia, pero no elimina la necesidad de revisar respuestas ambiguas o poco habituales.</p></div></details>
          <details className="function-accordion"><summary><span className="function-num">03</span><span className="function-accordion-copy"><small>Revisá</small><b>Una corrección explicada</b><span>Contrastá la respuesta original con los puntajes propuestos, la evidencia textual y la justificación por criterio.</span></span><span className="function-expand" aria-hidden="true">＋</span></summary><div className="function-accordion-detail"><p>Podés editar la puntuación y el feedback. Si cambiás una nota, se registra el motivo antes de aprobar el resultado.</p><Link href="/como-funciona#demostracion" className="text-link">Ver la demostración visual →</Link></div></details>
          <details className="function-accordion"><summary><span className="function-num">04</span><span className="function-accordion-copy"><small>Compartí</small><b>Una devolución a tu manera</b><span>Cuando aprobás la corrección, podés compartirla desde tu correo o WhatsApp, copiar el texto o guardarla como PDF.</span></span><span className="function-expand" aria-hidden="true">＋</span></summary><div className="function-accordion-detail"><p>MaestrIA prepara el borrador en la aplicación que elijas, pero no envía mensajes automáticamente. Revisá el destinatario y confirmá el envío desde esa aplicación.</p></div></details>
        </div>
        </section>
      <section className="section public-next-step"><div className="section-heading"><h2>La IA propone; vos conservás la decisión.</h2><p>Conocé el proceso y distinguí la demostración visual pública de una corrección real asistida por IA dentro del espacio docente.</p><Link className="button button-primary" href="/como-funciona#demostracion">Ver cómo funciona</Link></div></section>
    </main>
    <PublicFooter />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(applicationJsonLd).replace(/</g, "\\u003c") }} />
  </div>;
}
