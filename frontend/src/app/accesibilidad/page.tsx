import "../styles/accesibilidad.css";
import type { Metadata } from "next";
import Link from "next/link";
import { PublicPage } from "@/components/PublicShell";
export const metadata: Metadata = { title: "Accesibilidad de MaestrIA", description: "Compromisos de MaestrIA con navegación por teclado, contraste, lenguaje claro y diseño adaptable.", alternates: { canonical: "/accesibilidad" } };
export default function AccesibilidadPage() {
  return <PublicPage eyebrow="Accesibilidad" title="Una herramienta útil tiene que ser fácil de usar." intro="MaestrIA se diseña para docentes con distintos dispositivos, preferencias y formas de navegar. La accesibilidad es un requisito de calidad, no un añadido visual.">
    <section className="prose-card accessibility-content"><h2>Objetivos de diseño</h2><ul><li>Navegación completa con teclado y foco visible.</li><li>Etiquetas explícitas, mensajes de error asociados a los campos y avisos de estado anunciables.</li><li>Contraste legible, jerarquía de encabezados y lenguaje comprensible.</li><li>Diseño responsive mobile-first y respeto por la preferencia de movimiento reducido.</li><li>Evitar que el color sea la única forma de comunicar un estado.</li></ul><h2>Objetivo de conformidad</h2><p>El objetivo de desarrollo es WCAG 2.2 nivel AA. La conformidad debe comprobarse con pruebas automatizadas y evaluación manual con teclado y tecnologías de asistencia; no se afirma una certificación de conformidad automática.</p><h2>Cómo informar una barrera</h2><p>Si encontrás una dificultad de acceso, escribinos describiendo la página, el dispositivo y la acción que intentabas realizar.</p><Link className="button button-primary" href="/contacto">Contactar al equipo</Link></section>
  </PublicPage>;
}
