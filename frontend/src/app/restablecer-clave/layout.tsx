import "../styles/restablecer-clave.css";
import "../styles/acceso.css";
import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cambiar contraseña",
  description: "Definí una nueva contraseña para tu cuenta de MaestrIA mediante un enlace de recuperación válido.",
  robots: { index: false, follow: false },
};

export default function AccountRecoveryLayout({ children }: Readonly<{ children: ReactNode }> ) {
  return children;
}
