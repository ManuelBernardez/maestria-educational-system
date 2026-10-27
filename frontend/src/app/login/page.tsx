"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type AuthErrorInfo = {
  code?: string;
  status?: number;
  message?: string;
};

/** Convert Supabase Auth error codes to actionable messages without exposing raw server details. */
function getAuthErrorMessage(error: AuthErrorInfo, mode: "login" | "signup"): string {
  const code = (error.code ?? "").toLowerCase();
  const message = (error.message ?? "").toLowerCase();
  const status = typeof error.status === "number" ? error.status : 0;

  if (mode === "signup") {
    if (code === "email_provider_disabled" || code === "signup_disabled" || message.includes("signups not allowed")) {
      return "El registro por correo está deshabilitado en Supabase. En Authentication, habilitá el proveedor Email y la opción para permitir nuevos usuarios.";
    }
    if (code === "email_address_invalid") {
      return "Supabase no acepta ese correo. Verificá la dirección e intentá con un correo válido que pueda recibir confirmaciones.";
    }
    if (code === "email_address_not_authorized") {
      return "Supabase no pudo enviar el correo de confirmación. Con el SMTP compartido, el envío puede limitarse a miembros de la organización. Configurá un proveedor SMTP propio en Auth.";
    }
    if (code === "weak_password" || message.includes("password should") || message.includes("password must")) {
      return "La contraseña no cumple la política configurada en Supabase. Usá una contraseña más fuerte y revisá los requisitos del proyecto.";
    }
    if (code === "redirect_to_not_allowed" || code === "redirect_url_not_allowed" || message.includes("redirect url") || message.includes("redirect_to")) {
      return "Supabase rechazó la URL de redirección. En Authentication → URL Configuration, agregá la URL exacta del frontend, por ejemplo http://localhost:3000/login, a Redirect URLs.";
    }
    if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || status === 429) {
      return "Se alcanzó el límite temporal de solicitudes o correos de Supabase. Esperá unos minutos antes de volver a intentar.";
    }
    if (code === "email_exists" || code === "user_already_registered") {
      return "No se pudo completar el registro con esos datos. Si ya tenés una cuenta, iniciá sesión o recuperá tu contraseña.";
    }
    if (status >= 500 || code === "unexpected_failure" || message.includes("database error saving new user")) {
      return "Supabase Auth encontró un error interno al crear la cuenta. Abrí Authentication → Logs en Supabase; si aparece un error de base de datos, revisá triggers o funciones asociadas a auth.users.";
    }
  } else {
    if (code === "email_not_confirmed") {
      return "Tu correo todavía no está confirmado. Buscá el mensaje de confirmación en tu bandeja de entrada o spam.";
    }
    if (code === "invalid_credentials") {
      return "No pudimos iniciar sesión con esos datos. Revisá el correo y la contraseña, o recuperá tu contraseña.";
    }
    if (code === "over_request_rate_limit" || status === 429) {
      return "Se alcanzó el límite temporal de intentos. Esperá unos minutos antes de volver a ingresar.";
    }
  }

  const reference = code ? `Código de diagnóstico: ${code}.` : status ? `Estado HTTP: ${status}.` : "";
  return `${mode === "signup" ? "Supabase rechazó el registro" : "No pudimos iniciar sesión"}. Revisá Authentication → Logs en el panel de Supabase. ${reference}`.trim();
}

export default function LoginPage() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    const passwordUpdated = new URLSearchParams(window.location.search).get("password_updated") === "1";
    if (passwordUpdated) {
      setNotice("La contraseña se actualizó. Ya podés ingresar con ella.");
      window.history.replaceState({}, "", "/login");
    }
    (async () => {
      if (!supabase || passwordUpdated) return;
      try {
        const { data } = await supabase.auth.getSession();
        if (active && data.session) router.replace("/app");
      } catch {
        // If session lookup fails, leave the sign-in form available without clearing local state.
      }
    })();
    return () => { active = false; };
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!supabase) {
      setError("Configurá NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en frontend/.env.local y reiniciá Next.js.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "signup") {
        const cleanName = fullName.trim().replace(/\s+/g, " ");
        if (cleanName.length < 2) {
          setError("Ingresá tu nombre para personalizar tu espacio docente.");
          return;
        }
        const result = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/login`,
            data: { full_name: cleanName },
          },
        });
        if (result.error) {
          setError(getAuthErrorMessage(result.error, "signup"));
          return;
        }
        if (result.data.session) {
          router.push("/app");
          return;
        }
        setNotice("Solicitud de registro recibida. Revisá tu correo y la carpeta de spam para confirmar la cuenta antes de ingresar.");
        return;
      }

      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) {
        setError(getAuthErrorMessage(result.error, "login"));
        return;
      }
      router.push("/app");
    } catch {
      setError("No se pudo completar la solicitud. Comprobá tu conexión y que la URL y la clave pública correspondan al mismo proyecto de Supabase.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page login-page" id="main-content" tabIndex={-1}>
      <section className="auth-card" aria-labelledby="auth-title">
        <span className="eyebrow">ESPACIO DOCENTE</span>
        <h1 id="auth-title">{mode === "login" ? "Qué bueno verte." : "Creá tu espacio."}</h1>
        <p>{mode === "login" ? "Ingresá para continuar con tus evaluaciones. Si todavía no completaste tu perfil, te vamos a pedir tu nombre al entrar." : "Registrate para empezar a preparar evaluaciones. Te pedimos tu nombre para personalizar tu espacio docente."}</p>
        <form onSubmit={submit}>
          {mode === "signup" && <>
            <label htmlFor="full-name">Nombre y apellido</label>
            <input id="full-name" type="text" autoComplete="name" required minLength={2} maxLength={100} value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Ej. Andrea Gómez" />
            <p className="field-hint">Se usará para saludarte y personalizar tu espacio. Podés cambiarlo más adelante.</p>
          </>}
          <label htmlFor="email">Correo electrónico</label>
          <input id="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="docente@escuela.edu" />
          <label htmlFor="password">{mode === "login" ? "Contraseña" : "Crear contraseña"}</label>
          <input id="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={mode === "signup" ? 8 : undefined} required value={password} onChange={event => setPassword(event.target.value)} placeholder="Tu contraseña" />
          <button className="button button-primary full" disabled={busy}>
            {busy ? (mode === "login" ? "Ingresando…" : "Creando cuenta…") : (mode === "login" ? "Ingresar" : "Crear cuenta")}
          </button>
          {notice && <p className="success-message" role="status">{notice}</p>}
          {error && <p className="error-message" role="alert">{error}</p>}
        </form>
        <p className="auth-foot">El acceso se gestiona mediante Supabase Auth. No reutilices contraseñas de otros servicios.</p>
        <p className="auth-links"><Link href="/recuperar-clave">¿Olvidaste tu contraseña?</Link></p>
        <button type="button" className="auth-toggle" onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); setNotice(""); }}>
          {mode === "login" ? "¿Todavía no tenés cuenta? Registrate" : "¿Ya tenés cuenta? Ingresá"}
        </button>
        <Link href="/">← Volver al inicio</Link>
      </section>
    </main>
  );
}
