import "../styles/login.css";
import "../styles/acceso.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Acceso docente",
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: Readonly<{ children: ReactNode }>) {
  return children;
}
