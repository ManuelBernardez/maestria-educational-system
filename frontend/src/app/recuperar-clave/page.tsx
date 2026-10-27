"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function RecoverPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSent(false);
    if (!supabase) { setError("El acceso no está configurado todavía. Contactá al responsable del sitio."); setBusy(false); return; }
    try {
      const { error: requestError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/restablecer-clave`,
      });
      if (requestError) throw requestError;
      // Keep the message generic so the page does not disclose account existence.
      setSent(true);
    } catch {
      setError("No se pudo solicitar el correo en este momento. Revisá la configuración de Auth e intentá nuevamente.");
    } finally { setBusy(false); }
  }

  return <main className="auth-page recovery-page" id="main-content" tabIndex={-1}><section className="auth-card" aria-labelledby="recover-title"><span className="eyebrow">RECUPERACIÓN SEGURA</span><h1 id="recover-title">Recuperá tu acceso.</h1><p>Te enviaremos un enlace si la dirección puede recibir recuperación de cuenta.</p><form onSubmit={submit}><label htmlFor="recovery-email">Correo electrónico</label><input id="recovery-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="docente@escuela.edu"/><button className="button button-primary full" disabled={busy}>{busy ? "Enviando…" : "Enviar enlace de recuperación"}</button></form>{sent && <p className="success-message" role="status">Si la solicitud es válida, recibirás un correo con las instrucciones.</p>}{error && <p className="error-message" role="alert">{error}</p>}<p className="auth-links"><Link href="/login">Volver a ingresar</Link></p></section></main>;
}
