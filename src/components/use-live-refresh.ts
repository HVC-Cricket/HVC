"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * Subscribe to Supabase Realtime for live match data and trigger a
 * router.refresh() whenever something material changes. Replaces the
 * old `AutoRefresh` setInterval polling.
 *
 * Two modes:
 *   - useLiveRefresh({ matchId })  — single match focus (match page,
 *     score page). Filters server-side so only this match's events
 *     wake up the subscriber.
 *   - useLiveRefresh()             — global / homepage. Listens to all
 *     match + innings changes so any live activity bumps the view.
 *
 * Implementation details:
 *   * `matches` UPDATEs cover status transitions
 *     (live → innings_break → completed → winner_id set, etc.)
 *   * `innings` UPDATEs cover ball-by-ball score totals — they fire
 *     via the `recompute_innings` trigger on every ball INSERT
 *   * `innings` INSERTs cover innings transitions (start of 2nd
 *     innings, super over)
 *   * Refreshes are debounced to ~3.5s so a burst of trigger events
 *     within an over coalesces into one full-route refetch per
 *     spectator. Math: each refresh runs ~7 Supabase queries via
 *     loadScoreboardState; with 100+ spectators all firing within
 *     the debounce window after a ball event, that's 100 × 7 = 700
 *     queries arriving in the window. At 3.5s that's ~200 q/s
 *     burst, comfortably under Mumbai's ~200-connection pool
 *     ceiling. Earlier values: 400ms originally (let every ball
 *     fan out, 50 spectators saturated the pool), 2.5s when we
 *     hit 50 spectators on tournament day, 3.5s for the 100+
 *     spectator Q2 / Final matches. A 30s fallback poll still
 *     backstops dropped WebSocket connections.
 */
export function useLiveRefresh(opts: { matchId?: string } = {}) {
  const router = useRouter();
  const { matchId } = opts;

  useEffect(() => {
    const supabase = createClient();
    let pending: ReturnType<typeof setTimeout> | null = null;

    const trigger = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = null;
        router.refresh();
      }, 3500);
    };

    const channelName = matchId ? `live:match:${matchId}` : "live:global";
    const channel = supabase.channel(channelName);

    if (matchId) {
      // Match-scoped subscription: only events for this match.
      channel
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "matches",
            filter: `id=eq.${matchId}`,
          },
          trigger,
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "innings",
            filter: `match_id=eq.${matchId}`,
          },
          trigger,
        );
    } else {
      // Global subscription (homepage live card + tournament live list).
      // No filter — every match + innings update bumps the view.
      channel
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "matches" },
          trigger,
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "innings" },
          trigger,
        );
    }

    channel.subscribe();

    // Safety net: if the WebSocket drops silently, this 30s poll
    // makes sure stale views recover. Much lighter than the old 2.5s
    // polling cadence.
    const fallback = setInterval(() => router.refresh(), 30_000);

    return () => {
      if (pending) clearTimeout(pending);
      clearInterval(fallback);
      supabase.removeChannel(channel);
    };
  }, [matchId, router]);
}
