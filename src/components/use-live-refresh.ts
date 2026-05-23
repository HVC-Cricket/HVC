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
 *   * Refreshes are debounced to ~2.5s so a burst of trigger events
 *     within an over coalesces into one full-route refetch per
 *     spectator. Was 400ms originally, which let almost every ball
 *     fan out into its own refresh. With 50+ concurrent spectators
 *     each refresh = ~7 Supabase queries, that's 350+ queries per
 *     ball — enough to saturate the Mumbai connection pool and
 *     induce server-side queueing visible to ALL clients (including
 *     the scorer's saves). 2.5s trades "score appears instantly"
 *     for "score appears within a few seconds and the server stays
 *     responsive". A 30s fallback poll still backstops dropped
 *     WebSocket connections.
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
      }, 2500);
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
