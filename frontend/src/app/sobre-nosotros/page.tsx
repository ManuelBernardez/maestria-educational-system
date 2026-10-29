import "../styles/sobre-nosotros.css";
import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/PublicShell";

export const metadata: Metadata = {
  title: "Sobre MaestrIA",
  description: "Conocé el propósito académico de MaestrIA: asistir a docentes en el diseño, la corrección y la retroalimentación de evaluaciones escritas.",
  alternates: { canonical: "/sobre-nosotros" },
};

export default function AboutPage() {
  return (
    <PublicPage
      title="Enseñanza eficiente, con más retroalimentación"
      intro="MaestrIA nace de una pregunta sencilla: ¿cómo podemos aliviar parte del trabajo repetitivo para dedicar más tiempo a acompañar el aprendizaje?"
    >
      <section className="about-purpose" aria-labelledby="about-purpose-title">
        <div className="about-purpose-lead">
          <p className="eyebrow">Nuestro propósito</p>
          <h2 id="about-purpose-title">Menos tarea repetitiva.<br /><em>Más lugar para enseñar.</em></h2>
          <p>Un asistente de trabajo para docentes de secundaria y educación superior, pensado desde la realidad educativa argentina.</p>
        </div>
        <div className="about-principles-list">
          <article><span>01</span><div><h3>El docente decide</h3><p>La inteligencia artificial propone. La persona responsable revisa, modifica y aprueba el resultado final.</p></div></article>
          <article><span>02</span><div><h3>La nota tiene que explicarse</h3><p>Una valoración útil debe relacionarse con criterios claros y evidencias presentes en la respuesta.</p></div></article>
          <article><span>03</span><div><h3>La privacidad importa</h3><p>La información personal debe reducirse al mínimo necesario y las pruebas académicas deben usar datos ficticios o anonimizados.</p></div></article>
        </div>
      </section>

      <div className="about-content-grid">
        <article className="prose-card about-story-card">
          <p className="eyebrow">De dónde venimos</p>
          <h2>Un proyecto académico con un problema real en el centro.</h2>
          <p>MaestrIA es un proyecto de la Tecnicatura Universitaria en Programación de la Universidad Tecnológica Nacional, Facultad Regional Haedo. Busca asistir en el diseño, la corrección y la retroalimentación de evaluaciones escritas.</p>
          <p>La propuesta no es convertir la enseñanza en un proceso automático: es reducir parte del trabajo repetitivo para que el docente pueda dedicar más tiempo a las decisiones pedagógicas de mayor valor.</p>
        </article>
        <article className="prose-card about-method-card">
          <p className="eyebrow">Cómo trabajamos</p>
          <h2>Primero la necesidad. Después la tecnología.</h2>
          <p>El desarrollo sigue un enfoque incremental guiado por especificaciones: validamos necesidades con docentes, definimos reglas y criterios de aceptación, implementamos una parte funcional y comprobamos su calidad.</p>
          <p>La utilidad de MaestrIA se evaluará con tareas comparables y revisión humana, no solamente por la cantidad de funciones que logre incorporar.</p>
        </article>
      </div>

      <section className="public-callout about-contact-cta">
        <div><p className="eyebrow">Construyamos con experiencias reales</p><h2>¿Sos docente y querés aportar tu mirada?</h2><p>Nos interesa conocer cómo preparás evaluaciones y qué tipo de devolución sería útil para tus estudiantes.</p></div>
        <Link href="/contacto" className="button button-primary">Contactar al equipo <span aria-hidden="true">→</span></Link>
      </section>
      <p className="legal-links"><Link href="/privacidad">Privacidad</Link><Link href="/terminos">Términos</Link><Link href="/accesibilidad">Accesibilidad</Link><Link href="/">Inicio</Link></p>
    </PublicPage>
  );
}
