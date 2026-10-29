import "../styles/espacio-docente.css";
import "../styles/ux-refresh.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import AppAuthGuard from "@/components/AppAuthGuard";
import AppSidebar from "@/components/AppSidebar";

export const metadata: Metadata = {
  title: { default: "Espacio docente", template: "%s | MaestrIA" },
  robots: { index: false, follow: false, nocache: true },
};

export default function PrivateAppLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AppAuthGuard><div className="app-shell"><AppSidebar />{children}</div></AppAuthGuard>;
}
