"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle({ variant = "floating" }: { variant?: "floating" | "inline" }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem("maestria-theme"); } catch { /* storage can be disabled by the browser */ }
    const useDark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(useDark);
    document.documentElement.dataset.theme = useDark ? "dark" : "light";
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem("maestria-theme", next ? "dark" : "light"); } catch { /* theme still changes for this page session */ }
  }

  return (
    <button
      className={`theme-toggle${variant === "inline" ? " theme-toggle-inline" : ""}`}
      type="button"
      onClick={toggle}
      aria-label={dark ? "Activar tema claro" : "Activar tema oscuro"}
      aria-pressed={dark}
      title={dark ? "Tema claro" : "Tema oscuro"}
    >
      <span aria-hidden="true">{dark ? "☀" : "☾"}</span>
    </button>
  );
}
