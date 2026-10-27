"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.error("[MaestrIA] Error de interfaz", {
        message: error.message || "Error de ejecución sin detalles",
        digest: error.digest || "sin-identificador",
      });
    }
  }, [error]);

  return (
    <main id="main-content" tabIndex={-1} className="status-page">
      <div className="status-card">
        <span className="eyebrow">ALGO SALIÓ MAL</span>
        <h1>No pudimos cargar esta pantalla.</h1>
        <p>Tu sesión no se cierra por mostrar esta pantalla. Podés volver a intentar o regresar al espacio de trabajo.</p>
        <div className="hero-actions status-actions">
          <button type="button" className="button button-primary" onClick={() => reset()}>Intentar nuevamente</button>
          <Link className="button button-quiet" href="/app">Volver al espacio docente</Link>
          <Link className="button button-quiet" href="/">Ir al inicio de MaestrIA</Link>
        </div>
      </div>
    </main>
  );
}
