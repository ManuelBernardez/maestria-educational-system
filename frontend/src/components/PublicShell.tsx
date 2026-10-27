import Link from "next/link";
import type { ReactNode } from "react";

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <div><Link className="brand" href="/">Maestr<span>IA</span></Link><p>Más tiempo para enseñar. Más claridad para aprender.</p></div>
      <nav aria-label="Información del sitio" className="public-footer-links">
        <Link href="/como-funciona">Cómo funciona</Link>
        <Link href="/preguntas-frecuentes">Preguntas frecuentes</Link>
        <Link href="/sobre-nosotros">Sobre nosotros</Link>
        <Link href="/contacto">Contacto</Link>
        <Link href="/privacidad">Privacidad</Link>
        <Link href="/terminos">Términos</Link>
        <Link href="/accesibilidad">Accesibilidad</Link>
      </nav>
      <small>La IA propone. La decisión final siempre es docente.</small>
    </footer>
  );
}

export function PublicPage({ title, intro, children, eyebrow }: { title: string; intro: string; children: ReactNode; eyebrow?: string }) {
  return (
    <div className="public-page">
      <main id="main-content" className="public-main" tabIndex={-1}>
        <section className="public-page-hero">
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <h1>{title}</h1>
          <p className="public-intro">{intro}</p>
        </section>
        <div className="public-page-body">{children}</div>
      </main>
      <PublicFooter />
    </div>
  );
}
