"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api";
import QuickStartTour from "@/components/QuickStartTour";
import ThemeToggle from "@/components/ThemeToggle";

type CourseNavigationItem = { id: number; name: string; subject?: string; active: boolean };
type NavigationItem = {
  href: string;
  icon: string;
  label: string;
  matches: (pathname: string) => boolean;
};

const navigationItems: NavigationItem[] = [
  { href: "/app", icon: "📊", label: "Panel docente", matches: path => path === "/app" },
  { href: "/app/espacio-correccion", icon: "📝", label: "Espacio de trabajo", matches: path => path.startsWith("/app/espacio-correccion") || path.startsWith("/app/evaluaciones") },
  { href: "/app/cursos", icon: "📚", label: "Mis materias", matches: path => path.startsWith("/app/cursos") },
  { href: "/app/alumnos", icon: "👥", label: "Estudiantes", matches: path => path.startsWith("/app/alumnos") },
];

function getCurrentSection(pathname: string): string {
  if (pathname === "/app") return "Panel docente";
  if (pathname.startsWith("/app/espacio-correccion")) return "Espacio de trabajo";
  if (pathname.startsWith("/app/evaluaciones/nueva")) return "Nueva evaluación";
  if (pathname.startsWith("/app/evaluaciones")) return "Evaluación";
  if (pathname.startsWith("/app/entregas")) return "Entregas";
  if (pathname.startsWith("/app/correcciones")) return "Correcciones";
  if (pathname.startsWith("/app/cursos/")) return "Mi materia";
  if (pathname.startsWith("/app/cursos")) return "Mis materias";
  if (pathname.startsWith("/app/alumnos")) return "Estudiantes";
  if (pathname.startsWith("/app/perfil")) return "Perfil y preferencias";
  return "Espacio docente";
}

export default function AppSidebar() {
  const pathname = usePathname();
  const [displayName, setDisplayName] = useState("Docente");
  const [courses, setCourses] = useState<CourseNavigationItem[]>([]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    if (supabase) {
      void supabase.auth.getSession().then(({ data }) => {
        if (!active) return;
        const user = data.session?.user;
        const fullName = typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";
        const emailPrefix = user?.email?.split("@")[0] || "";
        setDisplayName(fullName || emailPrefix || "Docente");
      }).catch(() => undefined);
    }
    void api<CourseNavigationItem[]>("/courses/", { signal: controller.signal })
      .then(result => { if (active) setCourses((Array.isArray(result) ? result : []).filter(course => course.active).slice(0, 5)); })
      .catch(() => undefined);
    return () => { active = false; controller.abort(); };
  }, []);

  const currentSection = getCurrentSection(pathname);
  const sectionLetter = (course: CourseNavigationItem) => (course.subject || course.name || "M").trim().slice(0, 1).toLocaleUpperCase("es-AR");

  return <>
    <aside className="sidebar">
      <Link className="brand" href="/" aria-label="MaestrIA, ir a la página principal">Maestr<span>IA</span></Link>
      <div className="sidebar-label">ESPACIO DOCENTE</div>
      <nav className="app-sidebar-nav" aria-label="Navegación del espacio docente">
        {navigationItems.map(item => {
          const active = item.matches(pathname);
          return <Link className={`side-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined} href={item.href} key={item.href}>
            <span className="nav-icon" aria-hidden="true">{item.icon}</span><span>{item.label}</span>
          </Link>;
        })}
      </nav>
      <div className="sidebar-course-section" aria-label="Accesos rápidos a materias">
        <div className="sidebar-course-heading"><span>MIS MATERIAS</span><Link href="/app/cursos?new=1" aria-label="Crear materia o curso" title="Crear materia o curso">＋</Link></div>
        {courses.length > 0 ? <ul className="sidebar-course-list">{courses.map(course => {
          const active = pathname === `/app/cursos/${course.id}`;
          return <li key={course.id}><Link className={`sidebar-course-link${active ? " active" : ""}`} href={`/app/cursos/${course.id}`} aria-current={active ? "page" : undefined}>
            <span className={`sidebar-course-initial course-tone-${course.id % 4}`} aria-hidden="true">{sectionLetter(course)}</span><span className="sidebar-course-name">{course.name}</span>
          </Link></li>;
        })}</ul> : <p className="sidebar-courses-empty">Tus materias y comisiones aparecerán acá.</p>}
      </div>
      <div className="sidebar-note"><strong>Tu criterio, siempre</strong><p>La IA propone; vos revisás, ajustás y decidís cada devolución.</p></div>
      <div className="sidebar-bottom">
        <span className="avatar" aria-hidden="true">{displayName.slice(0, 1).toLocaleUpperCase("es-AR")}</span>
        <div className="user-info"><b title={displayName}>{displayName}</b><small>Docente · Cuenta</small></div>
        <Link className="icon-button sidebar-logout" href="/app/perfil" aria-label="Configuración de cuenta" title="Perfil y preferencias">⚙</Link>
      </div>
    </aside>
    <div className="app-topbar">
      <nav className="app-breadcrumb" aria-label="Ubicación actual"><Link href="/app">Inicio</Link><span aria-hidden="true">/</span><strong>{currentSection}</strong></nav>
      <div className="app-topbar-actions">
        <button className="app-help-trigger" type="button" onClick={() => window.dispatchEvent(new Event("maestria:open-guide"))} aria-label="Abrir guía de ayuda y preguntas frecuentes"><span className="topbar-help-icon" aria-hidden="true">?</span><span>Ayuda</span></button>
        <ThemeToggle variant="inline" />
        <Link className="app-topbar-profile" href="/app/perfil" aria-label={`Abrir perfil de ${displayName}`} title="Perfil y preferencias">{displayName.slice(0, 1).toLocaleUpperCase("es-AR")}</Link>
      </div>
    </div>
    <QuickStartTour />
  </>;
}
