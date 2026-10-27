import "../styles/preguntas-frecuentes.css";
import type { Metadata } from "next";
import { PublicPage } from "@/components/PublicShell";
export const metadata: Metadata = { title: "Preguntas frecuentes sobre MaestrIA", description: "Respuestas sobre el uso de IA en correcciones, revisión docente, archivos admitidos y tratamiento de datos.", alternates: { canonical: "/preguntas-frecuentes" } };
const faqs = [
  ["¿MaestrIA pone la nota final automáticamente?", "No. La IA genera una propuesta; el docente debe revisarla, editarla cuando corresponda y aprobar expresamente la calificación."],
  ["¿La IA puede equivocarse?", "Sí. Puede interpretar mal una respuesta, producir una explicación incompleta o proponer una puntuación inadecuada. Por eso la herramienta muestra criterios y evidencias para que el docente verifique el resultado."],
  ["¿Qué archivos puedo cargar?", "El MVP admite TXT, DOCX y PDF con texto seleccionable, además del texto ingresado o pegado. El tamaño y el texto extraído tienen límites. Los PDF escaneados, imágenes manuscritas y diagramas complejos no están incluidos."],
  ["¿Qué pasa con los datos de los estudiantes?", "El correo del estudiante no es necesario para procesar una respuesta y no debe enviarse al proveedor de IA. Las respuestas sí pueden enviarse al proveedor configurado cuando se solicita generación o corrección; por eso deben minimizarse los datos personales y revisarse las condiciones del servicio."],
  ["¿Las propuestas se guardan automáticamente como nota?", "No. Se guardan como propuestas pendientes. El sistema diferencia esas propuestas de las decisiones aprobadas por el docente."],
  ["¿Puedo usarlo en secundaria y educación superior?", "Ese es el público objetivo inicial. Las consignas, las rúbricas y los niveles deben adaptarse al contexto y ser revisados por la persona responsable de la evaluación."],
  ["¿Cómo comparto una devolución?", "Después de aprobarla, podés preparar un borrador de correo, abrir WhatsApp con el texto listo, copiar la devolución o imprimirla y guardarla como PDF. MaestrIA no envía mensajes automáticamente: revisás el destinatario y confirmás el envío desde la aplicación correspondiente."],
  ["¿MaestrIA es un LMS?", "No. El alcance inicial no incluye aulas virtuales completas, asistencia, matriculación institucional, exámenes vigilados ni integraciones con Moodle o Google Classroom."],
];
export default function PreguntasFrecuentesPage() {
  return <PublicPage eyebrow="Preguntas frecuentes" title="Tecnología clara, límites explícitos." intro="Respuestas simples para que puedas evaluar si MaestrIA encaja con tu forma de enseñar."><div className="faq-list">{faqs.map(([question, answer]) => <details key={question} className="faq-item"><summary>{question}</summary><p>{answer}</p></details>)}</div></PublicPage>;
}
