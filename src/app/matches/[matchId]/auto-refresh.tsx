"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Polls the page on a fixed interval via Next.js' router.refresh().
 * Used by the public match scoreboard so spectators see live updates
 * WITHOUT subscribing to Supabase realtime — staying under the
 * free-tier 200 concurrent-connections cap. Server-side `dynamic =
 * 'force-dynamic'` ensures each refresh re-reads fresh data.
 */
export function AutoRefresh({ intervalMs = 2500 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
