"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type Celebration = "FOUR" | "SIX" | "WICKET";

/**
 * Full-screen "FOUR! / SIX! / WICKET!" overlay that flashes for 2s
 * each time a celebratable ball lands. Mounted on the Live tab; uses
 * `fixed` positioning so the text floats over the scorecard rather
 * than shifting layout.
 *
 * Trigger:
 *   - `useLiveRefresh` already runs router.refresh() on every new ball,
 *     so the component re-renders with a new `latestBall` whenever a
 *     ball lands. We track the last seen ball id in a ref and fire
 *     the overlay only when the id flips to something newer.
 *   - Recency check (`scored_at` within ~10s) suppresses two failure
 *     modes: initial page mount (where the latest ball is the most
 *     recent ball in the innings, possibly minutes old) and undo
 *     (where the latest ball flicks back to a delivery that already
 *     happened). On a fresh tap the server's `scored_at` is roughly
 *     now, so the new ball clears the gate.
 */
export function BallCelebration({
  latestBall,
}: {
  latestBall: {
    id: string;
    runs_off_bat: number;
    is_wicket: boolean;
    scored_at: string;
  } | null;
}) {
  const lastIdRef = useRef<string | null>(latestBall?.id ?? null);
  const [show, setShow] = useState<Celebration | null>(null);

  useEffect(() => {
    if (!latestBall) return;
    if (latestBall.id === lastIdRef.current) return;
    lastIdRef.current = latestBall.id;

    // Skip stale balls (initial mount, undo). A fresh tap has a
    // server timestamp within the last few seconds of when the
    // client renders.
    const age = Date.now() - new Date(latestBall.scored_at).getTime();
    if (age > 10_000) return;

    let type: Celebration | null = null;
    if (latestBall.is_wicket) type = "WICKET";
    else if (latestBall.runs_off_bat === 4) type = "FOUR";
    else if (latestBall.runs_off_bat === 6) type = "SIX";

    if (!type) return;
    setShow(type);
    const timer = setTimeout(() => setShow(null), 2000);
    return () => clearTimeout(timer);
  }, [
    latestBall?.id,
    latestBall?.runs_off_bat,
    latestBall?.is_wicket,
    latestBall?.scored_at,
    latestBall,
  ]);

  if (!show) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        className={cn(
          "select-none font-extrabold tracking-tight",
          "text-7xl sm:text-9xl",
          "duration-300 animate-in fade-in zoom-in-50",
          "drop-shadow-[0_4px_24px_rgba(0,0,0,0.55)]",
          show === "FOUR" && "text-sky-400",
          show === "SIX" && "text-violet-400",
          show === "WICKET" && "text-red-500",
        )}
      >
        {show}!
      </div>
    </div>
  );
}
