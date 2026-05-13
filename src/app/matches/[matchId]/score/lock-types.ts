/**
 * Shared types + constants for the multi-scorer lock. Server actions
 * live in `lock-actions.ts` (file marked `"use server"`, which can only
 * export async functions). This module is plain TS so it can carry
 * the value/type exports that lock-actions can't.
 */

/**
 * Seconds of no heartbeat before the server treats the primary scorer
 * lock as expired and lets another admin claim it.
 */
export const LOCK_EXPIRY_SECONDS = 120;

export type LockStatus =
  | { status: "free" }
  | { status: "mine"; secondsAgo: number }
  | {
      status: "held";
      holderId: string;
      holderName: string | null;
      secondsAgo: number;
      expired: boolean;
    };
