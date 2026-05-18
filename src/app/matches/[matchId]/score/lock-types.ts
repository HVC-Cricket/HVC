/**
 * Shared types + constants for the multi-scorer lock. Server actions
 * live in `lock-actions.ts` (file marked `"use server"`, which can only
 * export async functions). This module is plain TS so it can carry
 * the value/type exports that lock-actions can't.
 */

/**
 * Seconds of no heartbeat before the server treats the primary scorer
 * lock as expired and lets another admin claim it without permission.
 */
export const LOCK_EXPIRY_SECONDS = 120;

/**
 * Seconds a pending takeover request can sit unanswered before the
 * server treats it as abandoned and clears it. Avoids a requester
 * being stuck on "Waiting for permission" forever if the holder has
 * the page open but isn't watching. Symmetric with LOCK_EXPIRY for
 * predictability.
 */
export const PENDING_REQUEST_EXPIRY_SECONDS = 120;

export type PendingTakeoverRequest = {
  requesterId: string;
  requesterName: string | null;
  /** How long ago the request was filed. */
  secondsAgo: number;
};

export type LockStatus =
  | { status: "free" }
  | {
      status: "mine";
      secondsAgo: number;
      /** Set if another admin has filed a takeover request against me.
       *  The gate shows an Allow / Deny banner so I can respond. */
      pendingRequest: PendingTakeoverRequest | null;
    }
  | {
      status: "held";
      holderId: string;
      holderName: string | null;
      secondsAgo: number;
      /** True when the holder's heartbeat exceeded LOCK_EXPIRY_SECONDS
       *  — anyone can claim without going through the permission flow. */
      expired: boolean;
      /** True when I'm the pending requester and waiting on the holder. */
      myRequestPending: boolean;
      /** Non-null if SOMEONE ELSE already has a pending request. The
       *  gate disables "Request takeover" so we don't queue duplicates. */
      otherRequestPending: PendingTakeoverRequest | null;
    };
