"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Wraps the global SiteNav and hides it on mobile when the current
 * route is a live-scoring screen. Scoring on a phone is space-starved
 * and the global nav adds zero value mid-match. Tablet/desktop keeps
 * the nav since vertical space isn't the constraint.
 */
export function SiteNavShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isScoreRoute = /^\/matches\/[^/]+\/score(\/|$)/.test(pathname ?? "");
  return (
    <div className={isScoreRoute ? "hidden sm:block" : undefined}>
      {children}
    </div>
  );
}
