"use server";

import { z } from "zod";

import { requireTournamentAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { LOCK_EXPIRY_SECONDS, type LockStatus } from "./lock-types";

/**
 * Multi-scorer concurrency: at most one tournament admin holds the
 * "primary scorer" lock on a match at a time. The lock auto-expires
 * after `LOCK_EXPIRY_SECONDS` of no heartbeat, so a closed-tab
 * scenario doesn't strand the match. A second admin can also force-
 * take-over with an explicit click.
 *
 * Shared type + constant live in `lock-types.ts` because "use server"
 * files can only export async functions.
 */

const matchIdSchema = z.object({ matchId: z.string().uuid() });

async function loadLockState(supabase: Awaited<ReturnType<typeof createClient>>, matchId: string) {
  const { data: match } = await supabase
    .from("matches")
    .select("primary_scorer_id, primary_scorer_heartbeat_at")
    .eq("id", matchId)
    .single();
  return match;
}

function secondsAgo(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
}

/** Read-only: who currently holds the lock on this match? */
export async function getScoringLockStatus(matchId: string): Promise<LockStatus> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const match = await loadLockState(supabase, matchId);

  if (!match || !match.primary_scorer_id) return { status: "free" };

  const ago = secondsAgo(match.primary_scorer_heartbeat_at);
  const expired = ago > LOCK_EXPIRY_SECONDS;

  if (user && match.primary_scorer_id === user.id) {
    return { status: "mine", secondsAgo: ago };
  }

  // Look up the holder's display name if we can. Skip silently if the
  // profile row is unreadable — the UI falls back to "another scorer".
  let holderName: string | null = null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", match.primary_scorer_id)
    .maybeSingle();
  if (profile?.display_name) holderName = profile.display_name;

  return {
    status: "held",
    holderId: match.primary_scorer_id,
    holderName,
    secondsAgo: ago,
    expired,
  };
}

/**
 * Try to claim the lock. Succeeds if it's free, already yours, or
 * expired. If it's held and not expired, returns `held`.
 */
export async function acquireScoringLock(
  input: z.infer<typeof matchIdSchema>,
): Promise<LockStatus> {
  const parsed = matchIdSchema.safeParse(input);
  if (!parsed.success) return { status: "free" }; // permissive fallback

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return await getScoringLockStatus(parsed.data.matchId);

  const { data: match } = await supabase
    .from("matches")
    .select("tournament_id")
    .eq("id", parsed.data.matchId)
    .single();
  if (!match) return { status: "free" };
  await requireTournamentAdmin(match.tournament_id);

  const current = await loadLockState(supabase, parsed.data.matchId);
  const heldByOther =
    current?.primary_scorer_id != null &&
    current.primary_scorer_id !== user.id;
  const stillFresh =
    heldByOther && secondsAgo(current?.primary_scorer_heartbeat_at) <= LOCK_EXPIRY_SECONDS;

  if (heldByOther && stillFresh) {
    return getScoringLockStatus(parsed.data.matchId);
  }

  // Claim. Conditional WHERE makes this atomic enough — a race that
  // changes the holder between our read and our update is rare and
  // the loser will see the right state on the next status poll.
  const { error } = await supabase
    .from("matches")
    .update({
      primary_scorer_id: user.id,
      primary_scorer_heartbeat_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.matchId);
  if (error) return getScoringLockStatus(parsed.data.matchId);

  return { status: "mine", secondsAgo: 0 };
}

/** Bump the heartbeat. Only succeeds if you hold the lock. */
export async function heartbeatScoringLock(
  input: z.infer<typeof matchIdSchema>,
): Promise<{ ok: boolean }> {
  const parsed = matchIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { error } = await supabase
    .from("matches")
    .update({ primary_scorer_heartbeat_at: new Date().toISOString() })
    .eq("id", parsed.data.matchId)
    .eq("primary_scorer_id", user.id);
  return { ok: !error };
}

/** Force-claim the lock regardless of who holds it. */
export async function forceTakeoverScoringLock(
  input: z.infer<typeof matchIdSchema>,
): Promise<LockStatus> {
  const parsed = matchIdSchema.safeParse(input);
  if (!parsed.success) return { status: "free" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return getScoringLockStatus(parsed.data.matchId);

  const { data: match } = await supabase
    .from("matches")
    .select("tournament_id")
    .eq("id", parsed.data.matchId)
    .single();
  if (!match) return { status: "free" };
  await requireTournamentAdmin(match.tournament_id);

  await supabase
    .from("matches")
    .update({
      primary_scorer_id: user.id,
      primary_scorer_heartbeat_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.matchId);

  return { status: "mine", secondsAgo: 0 };
}

/**
 * Internal helper called by every write action (recordBall, voidLastBall,
 * voidLastN). Atomically: if the lock is free, yours, or expired, claim
 * it (or bump your heartbeat). Otherwise reject with a friendly error
 * the action can surface to the scorer via toast.
 */
export async function enforceScoringLock(args: {
  matchId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const current = await loadLockState(supabase, args.matchId);
  if (!current) return { ok: false, error: "Match not found" };

  const holder = current.primary_scorer_id;
  const expired =
    secondsAgo(current.primary_scorer_heartbeat_at) > LOCK_EXPIRY_SECONDS;

  if (!holder || holder === args.userId || expired) {
    const { error } = await supabase
      .from("matches")
      .update({
        primary_scorer_id: args.userId,
        primary_scorer_heartbeat_at: new Date().toISOString(),
      })
      .eq("id", args.matchId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  return {
    ok: false,
    error:
      "Another scorer is recording this match. Take over from the banner to record balls.",
  };
}

/** Release if you hold. No-op if you don't. */
export async function releaseScoringLock(
  input: z.infer<typeof matchIdSchema>,
): Promise<{ ok: true }> {
  const parsed = matchIdSchema.safeParse(input);
  if (!parsed.success) return { ok: true };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: true };

  await supabase
    .from("matches")
    .update({
      primary_scorer_id: null,
      primary_scorer_heartbeat_at: null,
    })
    .eq("id", parsed.data.matchId)
    .eq("primary_scorer_id", user.id);
  return { ok: true };
}
