"use client";

import { useLiveRefresh } from "./use-live-refresh";

/**
 * Drop-in replacement for the old `AutoRefresh` setInterval polling.
 * Mount in a server component to subscribe to Supabase Realtime and
 * keep the route auto-refreshed.
 *
 * - `<LiveRefresh matchId={id} />` — match-page focus
 * - `<LiveRefresh />`               — homepage / global view
 *
 * Renders nothing; the hook does all the work.
 */
export function LiveRefresh({ matchId }: { matchId?: string }) {
  useLiveRefresh({ matchId });
  return null;
}
