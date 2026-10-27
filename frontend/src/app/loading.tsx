export default function Loading() {
  return <main id="main-content" tabIndex={-1} className="status-page" aria-live="polite" aria-busy="true"><div className="status-card"><span className="eyebrow">MaestrIA</span><h1>Cargando la página…</h1><p>Estamos preparando el contenido. Esta pantalla se actualizará automáticamente.</p><div className="loading-bar" aria-hidden="true"><span /></div></div></main>;
}
