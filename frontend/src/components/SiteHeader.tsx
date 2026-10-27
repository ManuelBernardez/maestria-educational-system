"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";

/** Public navigation. Authenticated routes use the compact shell provided by AppSidebar. */
export default function SiteHeader() {
  const pathname = usePathname();
  if (pathname.startsWith("/app")) return null;

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="brand site-brand" href="/" aria-label="MaestrIA — Inicio">
          Maestr<span>IA</span>
        </Link>
        <nav aria-label="Navegación principal" className="site-nav">
          <Link href="/" className="site-nav-home">Inicio</Link>
          <Link href="/como-funciona">Cómo funciona</Link>
          <Link href="/sobre-nosotros">Sobre nosotros</Link>
          <Link className="button button-primary site-nav-cta" href="/app">Espacio docente <span aria-hidden="true">→</span></Link>
        </nav>
        <ThemeToggle variant="inline" />
      </div>
    </header>
  );
}
