import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import "./styles.css";
import SiteHeader from "@/components/SiteHeader";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, "");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "MaestrIA — Asistencia docente", template: "%s | MaestrIA" },
  description: "Diseñá evaluaciones, aplicá rúbricas y revisá propuestas de corrección con asistencia de IA. El docente conserva la decisión final.",
  applicationName: "MaestrIA",
  category: "education",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "es_AR",
    siteName: "MaestrIA",
    title: "MaestrIA — Asistencia docente",
    description: "Evaluaciones, rúbricas y correcciones asistidas con revisión docente obligatoria.",
    url: siteUrl,
  },
  twitter: {
    card: "summary",
    title: "MaestrIA — Asistencia docente",
    description: "Diseñá evaluaciones y revisá propuestas de corrección sin ceder la decisión final.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2efe7" },
    { media: "(prefers-color-scheme: dark)", color: "#152326" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es-AR">
      <body>
        <a className="skip-link" href="#main-content">Saltar al contenido principal</a>
        <div id="app-container"><SiteHeader />{children}</div>
      </body>
    </html>
  );
}
