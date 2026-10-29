"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readPreference, writePreference } from "@/lib/preferences";
import { supabase } from "@/lib/supabase";

const steps = [
  { kicker: "PASO 1 DE 4", title: "Organizá tu curso", body: "Creá un espacio para una materia o comisión y agregá los estudiantes que correspondan. Así las evaluaciones y entregas quedan organizadas.", href: "/app/cursos", action: "Ir a cursos", icon: "▣" },
  { kicker: "PASO 2 DE 4", title: "Prepará una evaluación", body: "Definí el objetivo, agregá consignas y guardá preguntas. No hace falta completar todo de una vez: podés volver y editarlo.", href: "/app/evaluaciones/nueva", action: "Crear evaluación", icon: "▤" },
  { kicker: "PASO 3 DE 4", title: "Probá el espacio de corrección", body: "Sumá tus apuntes, elegí una rúbrica, cargá una respuesta y generá una propuesta explicada. En desarrollo podés usar datos ficticios.", href: "/app/espacio-correccion", action: "Abrir espacio de corrección", icon: "✳" },
  { kicker: "PASO 4 DE 4", title: "Volvé a tu materia", body: "En cada curso vas a encontrar sus estudiantes, evaluaciones, entregas y correcciones, sin mezclar información de otras materias.", href: "/app/cursos", action: "Ir a mis materias", icon: "✓" },
];

export default function QuickStartTour() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const completionKeyRef = useRef("maestria-quickstart-complete:local");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = supabase ? await supabase.auth.getUser() : null;
        if (!active) return;
        const userId = result?.data.user?.id || "local";
        const key = `maestria-quickstart-complete:${userId}`;
        completionKeyRef.current = key;
        // Completion is scoped to the authenticated user, not shared between accounts on one browser.
        setOpen(readPreference(key, "false") !== "true");
      } catch {
        if (active) setOpen(readPreference(completionKeyRef.current, "false") !== "true");
      }
    })();
    return () => { active = false; };
  }, []);

  const finish = useCallback(() => {
    writePreference(completionKeyRef.current, "true");
    setOpen(false);
  }, []);

  useEffect(() => {
    function reopenGuide() { setStep(0); setOpen(true); }
    window.addEventListener("maestria:open-guide", reopenGuide);
    return () => window.removeEventListener("maestria:open-guide", reopenGuide);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        finish();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter(element => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [open, step, finish]);

  function navigate() { const target = steps[step].href; finish(); router.push(target); }
  const item = steps[step];
  return <>
    {open && <div className="quickstart-backdrop" role="presentation"><section ref={dialogRef} className="quickstart-dialog" role="dialog" aria-modal="true" aria-labelledby="quickstart-title" aria-describedby="quickstart-description"><div className="quickstart-topline"><span className="eyebrow">PRIMEROS PASOS CON MAESTRIA</span><button ref={closeButtonRef} type="button" className="quickstart-close" aria-label="Cerrar guía" onClick={finish}>×</button></div><div className="quickstart-progress" aria-label={`Paso ${step + 1} de ${steps.length}`}>{steps.map((s, index) => <span className={index <= step ? "is-current" : ""} key={s.kicker} />)}</div><div className="quickstart-icon" aria-hidden="true">{item.icon}</div><span className="quickstart-step-label">{item.kicker}</span><h2 id="quickstart-title">{item.title}</h2><p id="quickstart-description">{item.body}</p><div className="quickstart-tip"><strong>Una idea útil</strong><span>Podés explorar con información ficticia antes de cargar respuestas reales de estudiantes.</span></div><div className="quickstart-footer"><button type="button" className="button button-quiet" onClick={finish}>Lo veo después</button><div>{step > 0 && <button type="button" className="button button-quiet" onClick={() => setStep(value => Math.max(0, value - 1))}>← Anterior</button>}{step < steps.length - 1 ? <button type="button" className="button button-primary" onClick={() => setStep(value => Math.min(steps.length - 1, value + 1))}>Siguiente →</button> : <button type="button" className="button button-primary" onClick={navigate}>Empezar →</button>}</div></div><p className="quickstart-link-row"><Link href={item.href} onClick={finish}>{item.action}</Link><span aria-hidden="true"> · </span><Link href="/preguntas-frecuentes" onClick={finish}>Preguntas frecuentes</Link><span> · La guía está disponible desde Ayuda.</span></p></section></div>}
  </>;
}
