import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MaestrIA — evaluación con criterio docente", template: "%s | MaestrIA" },
  description: "Prepará evaluaciones, definí rúbricas y revisá propuestas de corrección asistidas por IA. La decisión final siempre es del docente.",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
