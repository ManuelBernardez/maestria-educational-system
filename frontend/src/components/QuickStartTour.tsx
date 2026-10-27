"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readPreference, writePreference } from "@/lib/preferences";

const steps = [
  { kicker: "PASO 1 DE 4", title: "Organizá tu curso", body: "Creá un espacio para una materia o comisión y agregá los estudiantes que correspondan. Así las evaluaciones y entregas quedan organizadas.", href: "/app/cursos", action: "Ir a cursos", icon: "▣" },
  { kicker: "PASO 2 DE 4", title: "Prepará una evaluación", body: "Definí el objetivo, agregá consignas y guardá preguntas. No hace falta completar todo de una vez: podés volver y editarlo.", href: "/app/evaluaciones/nueva", action: "Crear evaluación", icon: "▤" },
  { kicker: "PASO 3 DE 4", title: "Probá el espacio de corrección", body: "Sumá tus apuntes, elegí una rúbrica, cargá una respuesta y generá una propuesta explicada. En desarrollo podés usar datos ficticios.", href: "/app/espacio-correccion", action: "Abrir espacio de corrección", icon: "✳" },
  { kicker: "PASO 4 DE 4", title: "Revisá y compartí", body: "Editá puntajes y comentarios, aprobá la devolución y compartila desde tu correo o WhatsApp. También podés copiarla o guardarla como PDF; MaestrIA no envía mensajes automáticamente.", href: "/app/correcciones", action: "Ver correcciones", icon: "✓" },
];

export default function QuickStartTour() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  useEffect(() => { setOpen(readPreference("maestria-quickstart-complete", "false") !== "true"); }, []);
  function finish() { writePreference("maestria-quickstart-complete", "true"); setOpen(false); }
  function navigate() { const target = steps[step].href; finish(); router.push(target); }
  const item = steps[step];
  return <>
    <button className="quickstart-reopen" type="button" onClick={() => setOpen(true)}>Guía de inicio rápido ↗</button>
    {open && <div className="quickstart-backdrop" role="presentation"><section className="quickstart-dialog" role="dialog" aria-modal="true" aria-labelledby="quickstart-title" aria-describedby="quickstart-description"><div className="quickstart-topline"><span className="eyebrow">PRIMEROS PASOS CON MAESTRIA</span><button type="button" className="quickstart-close" aria-label="Cerrar guía" onClick={finish}>×</button></div><div className="quickstart-progress" aria-label={`Paso ${step + 1} de ${steps.length}`}>{steps.map((s, index) => <span className={index <= step ? "is-current" : ""} key={s.kicker} />)}</div><div className="quickstart-icon" aria-hidden="true">{item.icon}</div><span className="quickstart-step-label">{item.kicker}</span><h2 id="quickstart-title">{item.title}</h2><p id="quickstart-description">{item.body}</p><div className="quickstart-tip"><strong>Una idea útil</strong><span>Podés explorar con información ficticia antes de cargar respuestas reales de estudiantes.</span></div><div className="quickstart-footer"><button type="button" className="button button-quiet" onClick={finish}>Lo veo después</button><div>{step > 0 && <button type="button" className="button button-quiet" onClick={() => setStep(value => Math.max(0, value - 1))}>← Anterior</button>}{step < steps.length - 1 ? <button type="button" className="button button-primary" onClick={() => setStep(value => Math.min(steps.length - 1, value + 1))}>Siguiente →</button> : <button type="button" className="button button-primary" onClick={navigate}>Empezar →</button>}</div></div><p className="quickstart-link-row"><Link href={item.href} onClick={finish}>{item.action}</Link> · Podés volver a abrir esta guía desde el resumen.</p></section></div>}
  </>;
}
