/**
 * Pure helpers carved out of `recordBall` so the action body stays
 * focused on persistence + Supabase calls. Everything here is a plain
 * function of its inputs — no DB, no I/O, easy to read and test by
 * hand if needed.
 */

import type { RuleSet } from "@/lib/scoring";

/** Just the fields these helpers need from a recorded ball. */
type PriorBall = {
  over_number: number;
  ball_in_over: number;
  legal_ball_seq: number | null;
  bowler_id: string;
  extra_type: string | null;
};

export type BowlerRuleViolation = { ok: false; error: string };
export type BowlerRulesOk = { ok: true };
export type BowlerRulesResult = BowlerRulesOk | BowlerRuleViolation;

/**
 * Enforce the three HVC bowling rules on the new ball:
 *   1. The picked bowler hasn't already maxed out their over allowance
 *      (`rules.max_overs_per_bowler`, currently 2 in HVC).
 *   2. If they're about to start their 2nd over, no other bowler has
 *      already started theirs — HVC convention is that exactly one
 *      bowler in the innings may bowl 2 overs.
 *   3. No mid-over bowler swaps (the bowler stays the same within an
 *      over) and no consecutive overs by the same bowler.
 *
 * Skipped for super overs (innings 3 + 4): they have their own caps.
 */
export function validateBowlerRules(args: {
  prevBalls: readonly PriorBall[];
  newBowlerId: string;
  rules: RuleSet;
  inningsNumber: number;
}): BowlerRulesResult {
  const { prevBalls, newBowlerId, rules, inningsNumber } = args;
  if (inningsNumber > 2) return { ok: true };

  const legalBallsByBowler = new Map<string, number>();
  for (const b of prevBalls) {
    if (b.extra_type === "wide" || b.extra_type === "no_ball") continue;
    legalBallsByBowler.set(
      b.bowler_id,
      (legalBallsByBowler.get(b.bowler_id) ?? 0) + 1,
    );
  }
  const thisBowlerLegalBefore = legalBallsByBowler.get(newBowlerId) ?? 0;

  // Hard cap from the ruleset.
  if (thisBowlerLegalBefore >= rules.max_overs_per_bowler * 6) {
    return {
      ok: false,
      error: `Bowler has already bowled their ${rules.max_overs_per_bowler} overs`,
    };
  }

  // About to bowl ball 7+ → starting / continuing 2nd over. Check
  // nobody else is also past the 1-over mark.
  if (thisBowlerLegalBefore >= 6) {
    const otherDoubleUp = Array.from(legalBallsByBowler.entries()).some(
      ([id, n]) => id !== newBowlerId && n > 6,
    );
    if (otherDoubleUp) {
      return {
        ok: false,
        error:
          "Only one bowler per innings can bowl 2 overs and another bowler is already using that slot.",
      };
    }
  }

  const lastBall = prevBalls[prevBalls.length - 1];
  const overJustEnded =
    !!lastBall && lastBall.legal_ball_seq != null && lastBall.ball_in_over === 6;

  // Mid-over swap (real cricket only allows on injury, which we don't
  // model).
  if (
    lastBall &&
    !overJustEnded &&
    lastBall.bowler_id !== newBowlerId
  ) {
    return {
      ok: false,
      error: "Bowler can't change mid-over. Finish the current over with the same bowler.",
    };
  }

  // Consecutive overs.
  if (overJustEnded && lastBall.bowler_id === newBowlerId) {
    return { ok: false, error: "Same bowler can't bowl consecutive overs" };
  }

  return { ok: true };
}

export type BallPosition = {
  over_number: number;
  ball_in_over: number;
  legal_ball_seq: number | null;
  /** True if the new ball is itself a legal delivery (not a wide /
   *  no-ball). Byes are legal. */
  isLegal: boolean;
};

const BALLS_PER_OVER = 6;

/**
 * Compute `over_number` / `ball_in_over` / `legal_ball_seq` for the new
 * row from the previous balls and the new ball's extra_type. Pure: no
 * mutation, no I/O.
 */
export function computeBallPosition(args: {
  prevBalls: readonly PriorBall[];
  newExtraType: string | null;
}): BallPosition {
  const { prevBalls, newExtraType } = args;
  const last = prevBalls[prevBalls.length - 1];

  let over_number = 1;
  let ball_in_over = 0;
  let legal_ball_seq: number | null = null;
  if (last) {
    over_number = last.over_number;
    ball_in_over = last.ball_in_over;
    if (
      last.legal_ball_seq != null &&
      last.ball_in_over === BALLS_PER_OVER
    ) {
      over_number += 1;
      ball_in_over = 0;
    }
  }

  // Byes are legal balls; wides and no-balls aren't.
  const isLegal = !newExtraType || newExtraType === "bye";
  if (isLegal) {
    ball_in_over += 1;
    const totalLegalBefore = prevBalls.filter(
      (b) => b.extra_type !== "wide" && b.extra_type !== "no_ball",
    ).length;
    legal_ball_seq = totalLegalBefore + 1;
  }

  return { over_number, ball_in_over, legal_ball_seq, isLegal };
}
