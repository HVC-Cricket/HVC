/**
 * Pure stat computations derived from a ball stream. Mirror the SQL
 * views (`v_innings_batting`, `v_innings_bowling`) but in TS so the
 * live scorecard, the post-match full scorecard, the scoring screen,
 * and the auto-POTM ranking all share one implementation. Was
 * previously duplicated in four files.
 */

/**
 * Wicket types where the BOWLER gets the wicket credit (vs the
 * fielder, which is `run_out`, or no one, which is `retired` /
 * `obstructing` / `timed_out`). Used by both `computeBowlerStats` and
 * the POTM scoring.
 */
export const BOWLER_CREDIT_WICKETS: ReadonlySet<string> = new Set([
  "bowled",
  "caught",
  "caught_and_bowled",
  "lbw",
  "stumped",
  "hit_wicket",
]);

/**
 * Minimal field set a batter-stat compute needs. Anything that has
 * these properties is usable — `BallRow`, the optimistic queue's
 * entries, etc.
 */
type BatterStatBall = {
  batter_id: string;
  runs_off_bat: number;
  extra_type: string | null;
};

export type BatterStats = {
  runs: number;
  balls_faced: number;
  fours: number;
  sixes: number;
};

export function computeBatterStats<B extends BatterStatBall>(
  balls: readonly B[],
  playerId: string,
): BatterStats {
  let runs = 0;
  let balls_faced = 0;
  let fours = 0;
  let sixes = 0;
  for (const b of balls) {
    if (b.batter_id !== playerId) continue;
    runs += b.runs_off_bat;
    if (b.extra_type !== "wide") balls_faced += 1;
    if (b.runs_off_bat === 4) fours += 1;
    if (b.runs_off_bat === 6) sixes += 1;
  }
  return { runs, balls_faced, fours, sixes };
}

/**
 * Minimal field set for bowler-stat compute. Includes `over_number`
 * so we can detect maiden overs.
 */
type BowlerStatBall = {
  bowler_id: string;
  runs_off_bat: number;
  extras: number;
  extra_type: string | null;
  is_wicket: boolean;
  wicket_type: string | null;
  over_number: number;
};

export type BowlerStats = {
  legal_balls: number;
  runs_conceded: number;
  wickets: number;
  wides: number;
  no_balls: number;
  dots: number;
  maidens: number;
};

export function computeBowlerStats<B extends BowlerStatBall>(
  balls: readonly B[],
  playerId: string,
): BowlerStats {
  let legal_balls = 0;
  let runs_conceded = 0;
  let wickets = 0;
  let wides = 0;
  let no_balls = 0;
  let dots = 0;
  const overBalls = new Map<number, B[]>();

  for (const b of balls) {
    if (b.bowler_id !== playerId) continue;
    const isLegal = b.extra_type !== "wide" && b.extra_type !== "no_ball";
    if (isLegal) legal_balls += 1;
    runs_conceded += b.runs_off_bat;
    if (b.extra_type === "wide" || b.extra_type === "no_ball") {
      runs_conceded += b.extras;
    }
    if (b.extra_type === "wide") wides += 1;
    if (b.extra_type === "no_ball") no_balls += 1;
    if (b.is_wicket && b.wicket_type && BOWLER_CREDIT_WICKETS.has(b.wicket_type)) {
      wickets += 1;
    }
    // A dot is a legal ball with zero runs (off bat OR byes). Wides /
    // no-balls aren't legal so they never count as dots.
    if (isLegal && b.runs_off_bat + b.extras === 0) dots += 1;
    if (!overBalls.has(b.over_number)) overBalls.set(b.over_number, []);
    overBalls.get(b.over_number)!.push(b);
  }

  // A maiden requires this bowler to have bowled all 6 legal balls of
  // the over AND zero runs scored in any form across them (no batter
  // runs, no wides, no no-balls, no byes).
  let maidens = 0;
  for (const [, group] of overBalls) {
    const legalInOver = group.filter(
      (b) => b.extra_type !== "wide" && b.extra_type !== "no_ball",
    ).length;
    if (legalInOver !== 6) continue;
    const runsInOver = group.reduce(
      (s, b) => s + b.runs_off_bat + b.extras,
      0,
    );
    if (runsInOver === 0) maidens += 1;
  }

  return {
    legal_balls,
    runs_conceded,
    wickets,
    wides,
    no_balls,
    dots,
    maidens,
  };
}
