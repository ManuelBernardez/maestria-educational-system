"use client";

import AppSidebar from "@/components/AppSidebar";

import Link from "next/link";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { readPreference, writePreference } from "@/lib/preferences";
import ThemeToggle from "@/components/ThemeToggle";

export default function TeacherProfilePage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [feedbackStyle, setFeedbackStyle] = useState("constructivo");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSetup, setIsSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const saveLock = useRef(false);

  useEffect(() => {
    let active = true;
    const setupRequested = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("setup") === "1";
    setIsSetup(setupRequested);
    void (async () => {
      try {
        const result = supabase
          ? await supabase.auth.getUser()
          : { data: { user: null }, error: null };
        if (!active) return;
        if (result.error) {
          setError("No pudimos cargar el perfil de tu cuenta. Verificá la conexión e intentá nuevamente.");
          return;
        }
        const user = result.data.user;
        const metadata = user?.user_metadata ?? {};
        setEmail(user?.email || "");
        // During account setup, never prefill a name saved locally by another account
        // that may have used the same browser. The profile is account-scoped.
        const savedName = typeof metadata.full_name === "string" ? metadata.full_name.trim() : "";
        setDisplayName(savedName || (setupRequested ? "" : readPreference("maestria-display-name", user?.email?.split("@")[0] || "")));
        const style = metadata.maestria_feedback_style;
        setFeedbackStyle(style === "formal" || style === "constructivo" || style === "motivador"
          ? style
          : readPreference("maestria-feedback-style", "constructivo"));
      } catch {
        if (active) setError("No pudimos cargar el perfil de tu cuenta. Verificá la conexión e intentá nuevamente.");
      }
    })();
    return () => { active = false; };
  }, []);

  async function logout() {
    try { await supabase?.auth.signOut(); } finally { router.replace("/login"); }
  }

  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = displayName.trim().replace(/\s+/g, " ");
    if (cleanName.length < 2) {
      setError("Ingresá tu nombre y apellido para guardar el perfil.");
      return;
    }
    if (saveLock.current) return;
    saveLock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (supabase) {
        const { error } = await supabase.auth.updateUser({
          data: {
            full_name: cleanName,
            maestria_feedback_style: feedbackStyle,
          },
        });
        if (error) {
          setError("No se pudieron sincronizar las preferencias con tu cuenta. Revisá la conexión e intentá nuevamente.");
          return;
        }
      }
      writePreference("maestria-display-name", cleanName);
      writePreference("maestria-feedback-style", feedbackStyle);
      if (isSetup) {
        router.replace("/app");
        return;
      }
      setMessage(supabase ? "Preferencias guardadas en tu cuenta." : "Supabase no está configurado: las preferencias solo se guardaron en este navegador.");
    } catch {
      setError("No se pudieron guardar las preferencias. Verificá la conexión e intentá nuevamente.");
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }

  return <div className="app-shell"><AppSidebar />
    <main className="app-main narrow-main" id="main-content" tabIndex={-1}><Link href="/app" className="back-link">← Volver al espacio docente</Link><header className="app-header"><div><span className="eyebrow">TU CONFIGURACIÓN</span><h1>{isSetup ? "Antes de empezar, contanos tu nombre" : "Perfil y preferencias"}</h1><p>{isSetup ? "Este dato nos permite personalizar tu espacio docente. No cambia tu correo ni tu contraseña." : "Personalizá el nombre visible y el tono de las devoluciones. Tus preferencias quedan asociadas a tu cuenta."}</p></div></header>
      <form className="form-card profile-settings-form" onSubmit={save}><h2>Datos de perfil</h2><label htmlFor="profile-display-name">Nombre y apellido</label><input id="profile-display-name" value={displayName} onChange={event => setDisplayName(event.target.value)} required maxLength={100} /><label htmlFor="profile-email">Correo de la cuenta</label><input id="profile-email" value={email} readOnly disabled /><p className="field-hint">El correo se obtiene de Supabase Auth y no se modifica desde esta pantalla.</p><hr /><h2>Preferencias pedagógicas</h2><label htmlFor="profile-feedback-style">Tono de retroalimentación predeterminado</label><select id="profile-feedback-style" value={feedbackStyle} onChange={event => setFeedbackStyle(event.target.value)}><option value="formal">Formal / académico</option><option value="constructivo">Constructivo / orientador</option><option value="motivador">Motivador / empático</option></select><p className="field-hint">Esta preferencia se aplica a nuevas propuestas de corrección. La devolución siempre puede editarse antes de aprobarla.</p>{error && <p role="alert" className="error-message">{error}</p>}{message && <p role="status" className="success-message">{message}</p>}<section className="appearance-preferences" aria-labelledby="appearance-heading"><div><h2 id="appearance-heading">Apariencia</h2><p>Elegí el tema que te resulte más cómodo para trabajar.</p></div><ThemeToggle variant="inline" /></section><div className="form-actions"><button type="button" className="button button-quiet" onClick={() => void logout()}>Cerrar sesión</button><Link href="/app/espacio-correccion" className="button button-quiet">Ir a corregir</Link><button className="button button-primary" type="submit" disabled={busy || !displayName.trim()}>{busy ? "Guardando…" : "Guardar preferencias"}</button></div></form>
      <section className="form-card profile-integrations"><h2>Compartir devoluciones</h2><p>Las devoluciones aprobadas se preparan desde el espacio de corrección: podés abrir WhatsApp o correo, copiar el texto o guardar un PDF mediante la ventana de impresión del navegador. MaestrIA no envía mensajes automáticamente ni necesita credenciales de esos servicios.</p><p className="field-hint">Revisá el destinatario y confirmá el envío en la aplicación que se abra.</p></section>
    </main></div>;
}
