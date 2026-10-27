"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

/** Central client-side guard for every /app route. The API remains the security boundary. */
export default function AppAuthGuard({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let active = true;

    if (!supabase) {
      router.replace("/login");
      return () => {
        active = false;
      };
    }

    const verifySession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!active) return;
        if (error || !data.session) {
          router.replace("/login");
          return;
        }
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace("/login");
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

  return <>{children}</>;
}
