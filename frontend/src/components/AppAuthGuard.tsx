"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type VerifiedUser = { id: string; hasProfileName: boolean };

/**
 * The guard verifies the initial session once per mounted private layout.
 * Route changes no longer blank the application or recreate the auth listener.
 * Django's verified JWT remains the security boundary for every API request.
 */
export default function AppAuthGuard({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);
  const [configurationError, setConfigurationError] = useState(false);
  const [user, setUser] = useState<VerifiedUser | null>(null);
  const verifiedUserId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const client = supabase;

    if (!client) {
      setConfigurationError(true);
      setChecking(false);
      return () => { active = false; };
    }

    const updateUser = (sessionUser: { id: string; user_metadata?: Record<string, unknown> } | null) => {
      if (!active) return;
      if (!sessionUser) {
        verifiedUserId.current = null;
        setUser(null);
        setChecking(false);
        router.replace("/login");
        return;
      }

      if (verifiedUserId.current && verifiedUserId.current !== sessionUser.id) {
        // Do not leave client state from one teacher mounted under another account.
        window.location.replace("/app");
        return;
      }

      verifiedUserId.current = sessionUser.id;
      const profileName = String(sessionUser.user_metadata?.full_name || "").trim();
      setUser({ id: sessionUser.id, hasProfileName: Boolean(profileName) });
    };

    const verifyInitialSession = async () => {
      try {
        const { data, error } = await client.auth.getSession();
        if (!active) return;
        if (error || !data.session) {
          setChecking(false);
          router.replace("/login");
          return;
        }
        updateUser(data.session.user);
        setChecking(false);
      } catch {
        if (active) {
          setChecking(false);
          router.replace("/login");
        }
      }
    };

    // Subscribe once. Do not depend on pathname, so navigation keeps the guard mounted.
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      updateUser(session?.user ?? null);
    });
    void verifyInitialSession();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [router]);

  useEffect(() => {
    if (checking || configurationError || !user || user.hasProfileName || pathname === "/app/perfil") return;
    router.replace("/app/perfil?setup=1");
  }, [checking, configurationError, pathname, router, user]);

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

  if (!user || (!user.hasProfileName && pathname !== "/app/perfil")) return null;
  return <>{children}</>;
}
