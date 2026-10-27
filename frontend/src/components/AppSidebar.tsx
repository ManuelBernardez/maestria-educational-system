"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import ThemeToggle from "@/components/ThemeToggle";

type NavigationItem = {
  href: string;
  icon: string;
  label: string;
  matches?: (pathname: string) => boolean;
};

const navigationItems: NavigationItem[] = [
  { href: "/app", icon: "⌂", label: "Inicio", matches: path => path === "/app" },
  { href: "/app/evaluaciones", icon: "▤", label: "Evaluaciones", matches: path => path.startsWith("/app/evaluaciones") },
  { href: "/app/espacio-correccion", icon: "✳", label: "Corregir", matches: path => path === "/app/espacio-correccion" },
  { href: "/app/entregas", icon: "↥", label: "Entregas", matches: path => path.startsWith("/app/entregas") },
  { href: "/app/correcciones", icon: "✓", label: "Correcciones", matches: path => path.startsWith("/app/correcciones") },
  { href: "/app/cursos", icon: "▣", label: "Cursos", matches: path => path.startsWith("/app/cursos") },
  { href: "/app/alumnos", icon: "♙", label: "Alumnos", matches: path => path.startsWith("/app/alumnos") },
];

function getCurrentSection(pathname: string): string {
  if (pathname === "/app") return "Resumen";
  if (pathname.startsWith("/app/espacio-correccion")) return "Espacio de trabajo";
  if (pathname.startsWith("/app/evaluaciones/nueva")) return "Nueva evaluación";
  if (pathname.startsWith("/app/evaluaciones")) return "Evaluaciones";
  if (pathname.startsWith("/app/entregas") || pathname.startsWith("/app/correcciones")) return "Entregas";
  if (pathname.startsWith("/app/cursos")) return "Cursos";
  if (pathname.startsWith("/app/alumnos")) return "Alumnos";
  if (pathname.startsWith("/app/perfil")) return "Perfil";
  return "Espacio docente";
}

export default function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("Docente");

  useEffect(() => {
    let active = true;
    if (!supabase) return () => { active = false; };
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const user = data.session?.user;
      const fullName = typeof user?.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name.trim()
        : "";
      const emailPrefix = user?.email?.split("@")[0] || "";
      setDisplayName(fullName || emailPrefix || "Docente");
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function logout() {
    try {
      await supabase?.auth.signOut();
    } finally {
      router.replace("/login");
    }
  }

  const currentSection = getCurrentSection(pathname);

  return (
    <>
      <aside className="sidebar">
        <Link className="brand" href="/app" aria-label="MaestrIA, ir al resumen">Maestr<span>IA</span></Link>
        <div className="sidebar-label">ESPACIO DOCENTE</div>
        <nav className="app-sidebar-nav" aria-label="Navegación del espacio docente">
          {navigationItems.map(item => {
            const active = item.matches ? item.matches(pathname) : pathname === item.href;
            return (
              <Link className={`side-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined} href={item.href} key={item.href}>
                <span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom"><Link href="/" className="sidebar-public-home" title="Ir a la página principal">Página principal ↗</Link>
          <span className="avatar" aria-hidden="true">{displayName.slice(0, 1).toLocaleUpperCase("es-AR")}</span>
          <div className="user-info"><b title={displayName}>{displayName}</b><small>Espacio docente</small></div>
          <button className="icon-button sidebar-logout" type="button" onClick={() => void logout()} aria-label="Cerrar sesión" title="Cerrar sesión">↗</button>
        </div>
      </aside>
      <div className="app-topbar">
        <nav className="app-breadcrumb" aria-label="Ubicación actual"><Link href="/app">Inicio</Link><span aria-hidden="true">/</span><strong>{currentSection}</strong></nav>
        <div className="app-topbar-actions">
          <Link href="/preguntas-frecuentes" title="Ayuda y preguntas frecuentes" aria-label="Ayuda"><span className="topbar-help-icon" aria-hidden="true">?</span><span>Ayuda</span></Link>
          <ThemeToggle variant="inline" />
          <Link className="app-topbar-profile" href="/app/perfil" aria-label={`Abrir perfil de ${displayName}`} title="Perfil y preferencias">{displayName.slice(0, 1).toLocaleUpperCase("es-AR")}</Link>
        </div>
      </div>
    </>
  );
}
