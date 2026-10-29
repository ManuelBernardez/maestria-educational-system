"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/** Client-side navigation guard; Django's verified JWT remains the security boundary. */
export default function AppAuthGuard({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [configurationError, setConfigurationError] = useState(false);
  const verifiedUserId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const client = supabase;
    setChecking(true);
    setConfigurationError(false);

    if (!client) {
      setConfigurationError(true);
      setChecking(false);
      return () => {
        active = false;
      };
    }

    const verifySession = async () => {
      try {
        const { data, error } = await client.auth.getSession();
        if (!active) return;
        if (error || !data.session) {
          router.replace("/login");
          return;
        }

        verifiedUserId.current = data.session.user.id;
        const profileName = String(data.session.user.user_metadata?.full_name || "").trim();
        if (!profileName && pathname !== "/app/perfil") {
          router.replace("/app/perfil?setup=1");
          return;
        }
        setChecking(false);
      } catch {
        if (active) router.replace("/login");
      }
    };

    void verifySession();
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      if (!session) {
        verifiedUserId.current = null;
        router.replace("/login");
        return;
      }
      const nextUserId = session.user.id;
      if (verifiedUserId.current && verifiedUserId.current !== nextUserId) {
        // A sign-in as another teacher in the same tab must not leave the prior
        // account's client-side page state mounted in memory.
        window.location.replace("/app");
        return;
      }
      verifiedUserId.current = nextUserId;
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  if (checking) {
    return (
      <main className="auth-guard-loading" aria-live="polite" aria-busy="true">
        <p>Verificando tu sesión…</p>
      </main>
    );
  }

  if (configurationError) {
    return (
      <main className="auth-guard-loading" role="alert">
        <h1>Configuración incompleta</h1>
        <p>La autenticación no está configurada. Revisá las variables públicas de Supabase y recargá la aplicación.</p>
      </main>
    );
  }

  return <>{children}</>;
}
