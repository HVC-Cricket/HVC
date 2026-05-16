/**
 * Client-side mirror of the engine's strike-rotation rules. Used by the
 * scoreboard to predict who's on strike the instant the scorer taps a
 * run button, so the slot tiles swap with zero perceived latency. The
 * server reconciles via `state.active.{striker,non_striker,bowler}_id`
 * on the next refresh; if the prediction was wrong (rare edge cases
 * like the dismissed-special-batter race), the slot tile jumps to the
 * canonical value once Realtime + revalidate land. For the 95% case —
 * a normal legal delivery or extra in a normal over — the prediction
 * matches the engine, so the visual transition is seamless.
 *
 * Kept deliberately simple and out of the engine module so it's easy
 * to read alongside the scoreboard. If the engine's rotation logic
 * ever changes materially, mirror it here too.
 */

type ExtraType = "wide" | "no_ball" | "bye" | null;

type Ball = {
  runs_off_bat: number;
  extras: number;
  extra_type: ExtraType;
  is_wicket: boolean;
  player_out_id?: string | null;
};

type ActiveState = {
  /** Server flag — locks the lone batter at the striker end. */
  last_man_mode: boolean;
  /** Server flag — Cat 1 / Cat 3 special over forces the special batter
   *  to stay on strike (`cat_special_strike: "stay"` rule). We don't
   *  know on the client which player is the "special batter" of this
   *  over, so we suppress the odd-runs swap for any special over —
   *  that's the safer default for Cat 1/3 overs in HVC's ruleset. */
  is_special_over: "cat1" | "cat3" | null;
};

export type OptimisticRotation = {
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
  /** True when this ball completed the 6th legal delivery of the over,
   *  so the caller should also clear `bowlerId` to force a fresh pick. */
  endOfOver: boolean;
};

export function applyOptimisticRotation(args: {
  strikerId: string;
  nonStrikerId: string;
  bowlerId: string;
  /** Legal balls bowled in the current over BEFORE this ball. */
  legalBallsInOver: number;
  ball: Ball;
  active: ActiveState;
}): OptimisticRotation {
  let { strikerId, nonStrikerId, bowlerId } = args;
  const { ball, active } = args;

  const isLegalBall = !ball.extra_type || ball.extra_type === "bye";
  const isBye = ball.extra_type === "bye";
  const isWide = ball.extra_type === "wide";
  const isNoBall = ball.extra_type === "no_ball";

  // Mirror of engine.ts `rotationRuns`. The 1-run penalty on a wide /
  // no-ball doesn't rotate; any *additional* extras (byes the batters
  // ran for, overthrows) do.
  let rotationRuns = ball.runs_off_bat;
  if (isBye) rotationRuns += ball.extras;
  else if (isWide || isNoBall) rotationRuns += Math.max(0, ball.extras - 1);
  const isOdd = rotationRuns % 2 === 1;

  // Wicket: clear the dismissed slot so the scorer picks a replacement
  // immediately. Default `player_out_id` is the striker if unspecified
  // (caught / bowled / hit-wicket).
  if (ball.is_wicket) {
    const dismissed = ball.player_out_id ?? strikerId;
    if (dismissed === strikerId) strikerId = "";
    else if (dismissed === nonStrikerId) nonStrikerId = "";
  }

  // Odd-run swap, suppressed in last-man mode (lone batter stays) and
  // during special overs (the special batter is supposed to stay).
  const suppressOddSwap = active.last_man_mode || active.is_special_over !== null;
  if (isOdd && !suppressOddSwap) {
    [strikerId, nonStrikerId] = [nonStrikerId, strikerId];
  }

  // End-of-over: also swaps ends, and forces a new bowler pick.
  const legalAfter = isLegalBall ? args.legalBallsInOver + 1 : args.legalBallsInOver;
  const endOfOver = isLegalBall && legalAfter >= 6;
  if (endOfOver && !active.last_man_mode) {
    [strikerId, nonStrikerId] = [nonStrikerId, strikerId];
  }
  if (endOfOver) {
    bowlerId = "";
  }

  return { strikerId, nonStrikerId, bowlerId, endOfOver };
}
