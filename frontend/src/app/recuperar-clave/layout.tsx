import "../styles/recuperar-clave.css";
import "../styles/acceso.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Recuperar contraseña",
  description: "Solicitá un enlace seguro para recuperar tu acceso a MaestrIA.",
  robots: { index: false, follow: false },
};

export default function AccountRecoveryLayout({ children }: Readonly<{ children: ReactNode }> ) {
  return children;
}
