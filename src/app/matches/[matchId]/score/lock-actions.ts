"use server";

import { z } from "zod";

import { requireTournamentAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import {
  LOCK_EXPIRY_SECONDS,
  PENDING_REQUEST_EXPIRY_SECONDS,
  type LockStatus,
  type PendingTakeoverRequest,
} from "./lock-types";

/**
 * Multi-scorer concurrency with a permission-based takeover model.
 *
 *  - Only one tournament admin holds the lock at a time.
 *  - Heartbeat keeps the lock fresh; expires after LOCK_EXPIRY_SECONDS.
 *  - To take over an active lock, a second admin files a *request*.
 *    The current holder gets a banner and decides Allow / Deny.
 *  - If the holder's heartbeat expires, the requester (or anyone)
 *    can claim via `acquireScoringLock` directly — no permission
 *    needed because the holder is presumed gone.
 *
 * Shared type + constant live in `lock-types.ts` because "use server"
 * files can only export async functions.
 */

const matchIdSchema = z.object({ matchId: z.string().uuid() });

type LockRow = {
  primary_scorer_id: string | null;
  primary_scorer_heartbeat_at: string | null;
  pending_scorer_request_id: string | null;
  pending_scorer_request_at: string | null;
};

async function loadLockState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: string,
): Promise<LockRow | null> {
  const { data } = await supabase
    .from("matches")
    .select(
      "primary_scorer_id, primary_scorer_heartbeat_at, pending_scorer_request_id, pending_scorer_request_at",
    )
    .eq("id", matchId)
    .single();
  if (!data) return null;

  // Lazy-clear stale pending takeover requests so the holder isn't
  // pestered by an indefinitely-old banner and the requester isn't
  // stuck on "Waiting for permission" if the holder never responds.
  // Doing it on read keeps every caller consistent without needing a
  // separate cron / scheduled function. The UPDATE only fires when
  // the row is actually stale — quiet most of the time.
  if (
    data.pending_scorer_request_id &&
    secondsAgo(data.pending_scorer_request_at) > PENDING_REQUEST_EXPIRY_SECONDS
  ) {
    await supabase
      .from("matches")
      .update({
        pending_scorer_request_id: null,
        pending_scorer_request_at: null,
      })
      .eq("id", matchId)
      // Match the stale request specifically — if a fresher request
      // raced in between SELECT and UPDATE, leave it alone.
      .eq("pending_scorer_request_id", data.pending_scorer_request_id);
    return {
      ...data,
      pending_scorer_request_id: null,
      pending_scorer_request_at: null,
    };
  }

  return data;
}

function secondsAgo(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
}

async function resolveDisplayName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  return data?.display_name ?? null;
}

async function buildPendingRequest(
  supabase: Awaited<ReturnType<typeof createClient>>,
  row: LockRow,
): Promise<PendingTakeoverRequest | null> {
  if (!row.pending_scorer_request_id) return null;
  const name = await resolveDisplayName(supabase, row.pending_scorer_request_id);
  return {
    requesterId: row.pending_scorer_request_id,
    requesterName: name,
    secondsAgo: secondsAgo(row.pending_scorer_request_at),
  };
}

/** Read-only: full lock status for the current user. */
export async function getScoringLockStatus(matchId: string): Promise<LockStatus> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const row = await loadLockState(supabase, matchId);

  if (!row || !row.primary_scorer_id) return { status: "free" };

  const ago = secondsAgo(row.primary_scorer_heartbeat_at);
  const expired = ago > LOCK_EXPIRY_SECONDS;

  if (user && row.primary_scorer_id === user.id) {
    // I hold the lock. Surface any pending request *against me*.
    const pending = await buildPendingRequest(supabase, row);
    return { status: "mine", secondsAgo: ago, pendingRequest: pending };
  }

  const holderName = await resolveDisplayName(supabase, row.primary_scorer_id);

  // Someone else holds. Split the pending request into "mine" vs
  // "someone else's" so the gate disables Request when another
  // admin is already in the queue.
  let myRequestPending = false;
  let otherRequestPending: PendingTakeoverRequest | null = null;
  if (row.pending_scorer_request_id) {
    if (user && row.pending_scorer_request_id === user.id) {
      myRequestPending = true;
    } else {
      otherRequestPending = await buildPendingRequest(supabase, row);
    }
  }

  return {
    status: "held",
    holderId: row.primary_scorer_id,
    holderName,
    secondsAgo: ago,
    expired,
    myRequestPending,
    otherRequestPending,
  };
}

/**
 * Claim the lock if it's free, already yours, or expired. Does NOT
 * forcibly take an active lock — for that, use the request flow.
 * Always clears the pending-request slot since the new holder takes
 * over the role the request was after.
 */
export async function acquireScoringLock(
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

  const current = await loadLockState(supabase, parsed.data.matchId);
  const heldByOther =
    current?.primary_scorer_id != null &&
    current.primary_scorer_id !== user.id;
  const stillFresh =
    heldByOther && secondsAgo(current?.primary_scorer_heartbeat_at ?? null) <= LOCK_EXPIRY_SECONDS;

  if (heldByOther && stillFresh) {
    // Permission needed — caller should use requestScoringTakeover.
    return getScoringLockStatus(parsed.data.matchId);
  }

  const { error } = await supabase
    .from("matches")
    .update({
      primary_scorer_id: user.id,
      primary_scorer_heartbeat_at: new Date().toISOString(),
      pending_scorer_request_id: null,
      pending_scorer_request_at: null,
    })
    .eq("id", parsed.data.matchId);
  if (error) return getScoringLockStatus(parsed.data.matchId);

  return getScoringLockStatus(parsed.data.matchId);
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

/**
 * Permission-based takeover, step 1 of 2 (requester side). File a
 * request against the current holder. The slot is single-occupant —
 * if another admin already has a pending request the call refuses.
 */
export async function requestScoringTakeover(
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

  const current = await loadLockState(supabase, parsed.data.matchId);
  if (!current) return { status: "free" };

  // No holder or holder is me → no request needed; just claim.
  if (!current.primary_scorer_id || current.primary_scorer_id === user.id) {
    return acquireScoringLock(parsed.data);
  }

  // Holder is expired → claim directly without permission.
  const heartbeatAge = secondsAgo(current.primary_scorer_heartbeat_at);
  if (heartbeatAge > LOCK_EXPIRY_SECONDS) {
    return acquireScoringLock(parsed.data);
  }

  // Already a pending request — if it's mine, no-op; if it's someone
  // else's, refuse (UI shows otherRequestPending).
  if (
    current.pending_scorer_request_id &&
    current.pending_scorer_request_id !== user.id
  ) {
    return getScoringLockStatus(parsed.data.matchId);
  }

  await supabase
    .from("matches")
    .update({
      pending_scorer_request_id: user.id,
      pending_scorer_request_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.matchId);

  return getScoringLockStatus(parsed.data.matchId);
}

/**
 * Step 2 of 2: current holder approves. Transfers the lock to the
 * pending requester and clears the request. Only succeeds if the
 * caller actually holds the lock.
 */
export async function approveScoringTakeover(
  input: z.infer<typeof matchIdSchema>,
): Promise<LockStatus> {
  const parsed = matchIdSchema.safeParse(input);
  if (!parsed.success) return { status: "free" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return getScoringLockStatus(parsed.data.matchId);

  const current = await loadLockState(supabase, parsed.data.matchId);
  if (!current || current.primary_scorer_id !== user.id) {
    return getScoringLockStatus(parsed.data.matchId);
  }
  if (!current.pending_scorer_request_id) {
    return getScoringLockStatus(parsed.data.matchId);
  }

  await supabase
    .from("matches")
    .update({
      primary_scorer_id: current.pending_scorer_request_id,
      primary_scorer_heartbeat_at: new Date().toISOString(),
      pending_scorer_request_id: null,
      pending_scorer_request_at: null,
    })
    .eq("id", parsed.data.matchId);

  return getScoringLockStatus(parsed.data.matchId);
}

/** Current holder denies the pending request. Clears the request slot. */
export async function denyScoringTakeover(
  input: z.infer<typeof matchIdSchema>,
): Promise<LockStatus> {
  const parsed = matchIdSchema.safeParse(input);
  if (!parsed.success) return { status: "free" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return getScoringLockStatus(parsed.data.matchId);

  await supabase
    .from("matches")
    .update({
      pending_scorer_request_id: null,
      pending_scorer_request_at: null,
    })
    .eq("id", parsed.data.matchId)
    .eq("primary_scorer_id", user.id);

  return getScoringLockStatus(parsed.data.matchId);
}

/** Requester cancels their own pending request. */
export async function cancelScoringTakeoverRequest(
  input: z.infer<typeof matchIdSchema>,
): Promise<LockStatus> {
  const parsed = matchIdSchema.safeParse(input);
  if (!parsed.success) return { status: "free" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return getScoringLockStatus(parsed.data.matchId);

  await supabase
    .from("matches")
    .update({
      pending_scorer_request_id: null,
      pending_scorer_request_at: null,
    })
    .eq("id", parsed.data.matchId)
    .eq("pending_scorer_request_id", user.id);

  return getScoringLockStatus(parsed.data.matchId);
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
        // If I'm claiming, my own pending request (if any) is moot.
        ...(current.pending_scorer_request_id === args.userId
          ? { pending_scorer_request_id: null, pending_scorer_request_at: null }
          : {}),
      })
      .eq("id", args.matchId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  return {
    ok: false,
    error:
      "Another scorer is recording this match. Request a takeover from the banner.",
  };
}

/** Release if you hold. No-op if you don't. Also clears any pending
 *  request — the next admin who picks up the match starts clean. */
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
      pending_scorer_request_id: null,
      pending_scorer_request_at: null,
    })
    .eq("id", parsed.data.matchId)
    .eq("primary_scorer_id", user.id);
  return { ok: true };
}
