"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle({ variant = "floating" }: { variant?: "floating" | "inline" }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const syncFromDocument = () => {
      setDark(document.documentElement.dataset.theme === "dark");
    };
    syncFromDocument();
    window.addEventListener("maestria-theme-change", syncFromDocument);
    window.addEventListener("storage", syncFromDocument);
    return () => {
      window.removeEventListener("maestria-theme-change", syncFromDocument);
      window.removeEventListener("storage", syncFromDocument);
    };
  }, []);

  function toggle() {
    // Read the shared document state to avoid stale state when more than one toggle is mounted.
    const next = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = next ? "dark" : "light";
    setDark(next);
    try { localStorage.setItem("maestria-theme", next ? "dark" : "light"); } catch { /* theme still changes for this page session */ }
    window.dispatchEvent(new Event("maestria-theme-change"));
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
