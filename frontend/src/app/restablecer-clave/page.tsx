"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    let active = true;
    (async () => {
      if (!supabase) { if (active) setError("Supabase Auth no está configurado."); return; }
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (!active) return;
        if (sessionError || !data.session) setError("El enlace puede haber vencido o no ser válido. Solicitá uno nuevo.");
        else setReady(true);
      } catch {
        if (active) setError("No pudimos verificar el enlace en este navegador. Solicitá uno nuevo o habilitá el almacenamiento del sitio.");
      }
    })();
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (password.length < 8) { setError("Usá una contraseña de al menos 8 caracteres."); return; }
    if (password !== confirmPassword) { setError("Las contraseñas no coinciden."); return; }
    if (!supabase) { setError("Supabase Auth no está configurado."); return; }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await supabase.auth.signOut();
      router.replace("/login?password_updated=1");
    } catch {
      setError("No se pudo cambiar la contraseña. Volvé a solicitar un enlace si este ya venció.");
    } finally { setBusy(false); }
  }

  return <main className="auth-page reset-password-page" id="main-content" tabIndex={-1}><section className="auth-card" aria-labelledby="reset-title"><span className="eyebrow">SEGURIDAD DE CUENTA</span><h1 id="reset-title">Elegí una contraseña nueva.</h1>{!ready ? <p role={error ? "alert" : "status"}>{error || "Verificando el enlace seguro…"}</p> : <form onSubmit={submit}><label htmlFor="new-password">Nueva contraseña</label><input id="new-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={event => setPassword(event.target.value)}/><label htmlFor="confirm-password">Repetir contraseña</label><input id="confirm-password" type="password" autoComplete="new-password" minLength={8} required value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)}/><p className="muted tiny">Usá al menos 8 caracteres y una contraseña que no reutilices en otros servicios.</p><button className="button button-primary full" disabled={busy}>{busy ? "Guardando…" : "Cambiar contraseña"}</button></form>}{error && ready && <p className="error-message" role="alert">{error}</p>}<p className="auth-links"><Link href="/recuperar-clave">Solicitar otro enlace</Link> · <Link href="/login">Volver a ingresar</Link></p></section></main>;
}
