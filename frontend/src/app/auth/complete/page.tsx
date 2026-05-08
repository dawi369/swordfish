"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

const SESSION_POLL_INTERVAL_MS = 250;
const SESSION_POLL_TIMEOUT_MS = 8_000;

function getSafeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/terminal";
  }

  return value;
}

function AuthCompleteContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const next = getSafeNextPath(searchParams.get("next"));
    let active = true;
    const startedAt = Date.now();

    const finishLogin = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!active) return;

      if (session) {
        router.replace(next);
        router.refresh();
        return;
      }

      if (Date.now() - startedAt >= SESSION_POLL_TIMEOUT_MS) {
        setError("Authentication completed, but the session did not finish loading.");
        return;
      }

      window.setTimeout(() => {
        void finishLogin();
      }, SESSION_POLL_INTERVAL_MS);
    };

    void finishLogin();

    return () => {
      active = false;
    };
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">
          {error ?? "Signing you in..."}
        </p>
      </div>
    </div>
  );
}

export default function AuthCompletePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <p className="mt-4 text-sm text-muted-foreground">Signing you in...</p>
          </div>
        </div>
      }
    >
      <AuthCompleteContent />
    </Suspense>
  );
}
