"use client";

import AppSidebar from "@/components/AppSidebar";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";

type Assessment = {
  id: number | string;
  title: string;
  subject?: string;
  level?: string;
  status?: string;
  updated_at?: string;
};

export default function AssessmentsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadAssessments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const sessionResult = await supabase?.auth.getSession();
      if (!sessionResult?.data.session) {
        router.replace("/login");
        return;
      }
      const assessments = await api<Assessment[]>("/assessments/");
      setItems(Array.isArray(assessments) ? assessments : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No pudimos cargar tus evaluaciones.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void loadAssessments(); }, [loadAssessments]);

  const filteredItems = useMemo(() => items.filter(item => {
    const status = item.status || "draft";
    const matchesStatus = statusFilter === "all" || status === statusFilter;
    const text = `${item.title} ${item.subject || ""} ${item.level || ""}`.toLocaleLowerCase("es-AR");
    return matchesStatus && text.includes(query.trim().toLocaleLowerCase("es-AR"));
  }), [items, statusFilter, query]);

  return (
    <div className="app-shell">
      <AppSidebar />
      <main className="app-main" id="main-content" tabIndex={-1}>
        <div className="app-header">
          <div><span className="eyebrow">TU ESPACIO DE TRABAJO</span><h1>Tus evaluaciones</h1><p>Prepará consignas, organizá criterios y revisá las propuestas de corrección.</p></div>
          <Link className="button button-primary" href="/app/evaluaciones/nueva">＋ Nueva evaluación</Link>
        </div>
        {!loading && !error && items.length > 0 && <div className="assessment-toolbar"><label htmlFor="assessment-search">Buscar evaluación<input id="assessment-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Título, materia o nivel…" /></label><label htmlFor="assessment-status">Estado<select id="assessment-status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">Todos</option><option value="draft">Borradores</option><option value="ready">Listas</option><option value="archived">Archivadas</option></select></label><span className="muted tiny">{filteredItems.length} de {items.length}</span></div>}
        {loading ? <div className="empty-state" role="status" aria-live="polite"><div className="loading-bar" aria-hidden="true"><span /></div><p>Estamos cargando tus evaluaciones…</p></div> : error ? (
          <section className="app-load-error" role="alert"><span className="app-load-error-icon" aria-hidden="true">!</span><div><h2>No pudimos cargar tus evaluaciones.</h2><p>{error}</p><p className="muted">Tu sesión no se cierra por este error. Verificá la conexión con el backend e intentá otra vez.</p><div className="hero-actions"><button type="button" className="button button-primary" onClick={() => void loadAssessments()}>Intentar nuevamente</button><Link href="/app" className="button button-quiet">Volver al espacio docente</Link></div></div></section>
        ) : items.length === 0 ? (
          <section className="empty-state"><div className="empty-icon" aria-hidden="true">✳</div><h2>Todavía no creaste evaluaciones</h2><p>Empezá con una evaluación para ordenar las preguntas, definir una rúbrica y cargar respuestas cuando las tengas.</p><Link className="button button-primary" href="/app/evaluaciones/nueva">Crear mi primera evaluación</Link></section>
        ) : filteredItems.length === 0 ? (
          <div className="empty-state"><h2>No encontramos evaluaciones con esos filtros</h2><p>Probá con otra búsqueda o cambiá el estado seleccionado.</p><button type="button" className="button button-quiet" onClick={() => { setQuery(""); setStatusFilter("all"); }}>Limpiar filtros</button></div>
        ) : (
          <div className="assessment-list" aria-label="Listado de evaluaciones">
            {filteredItems.map((item) => <Link className="assessment-row assessment-row-link" href={`/app/evaluaciones/${item.id}`} key={item.id}>
              <span className="assessment-icon" aria-hidden="true">▤</span>
              <span className="assessment-info"><strong>{item.title}</strong><span>{[item.subject, item.level].filter(Boolean).join(" · ") || "Sin materia o nivel indicado"}</span></span>
              <span className={`status-pill ${item.status === "archived" ? "delivery-status-review" : ""}`}>{item.status === "draft" || !item.status ? "Borrador" : item.status === "ready" ? "Lista para usar" : item.status === "archived" ? "Archivada" : item.status}</span><span className="row-arrow" aria-hidden="true">→</span>
            </Link>)}
          </div>
        )}
        <p className="app-disclaimer">Las propuestas de IA son asistencias revisables. La decisión final de calificación siempre corresponde al docente.</p>
      </main>
    </div>
  );
}
