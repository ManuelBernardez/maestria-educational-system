import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1} className="status-page">
      <div className="status-card">
        <span className="eyebrow">ERROR 404</span>
        <h1>No encontramos esa página.</h1>
        <p>Puede que el enlace esté incompleto o que la página se haya movido. La navegación principal sigue disponible arriba.</p>
        <div className="hero-actions status-actions">
          <Link className="button button-primary" href="/app">Volver al espacio docente</Link>
          <Link className="button button-quiet" href="/">Ir al inicio</Link>
        </div>
      </div>
    </main>
  );
}
