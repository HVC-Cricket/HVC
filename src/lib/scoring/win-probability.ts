// Live win-probability estimator for HVC box-cricket matches.
//
// v3 design notes — read this before touching the numbers:
//
// The old v1 formula extrapolated current run rate over the whole
// remaining innings. With 24 balls in a 4-over innings, a six on the
// first ball read as 144 projected (15rpo par → "way above par") and
// surfaced as 90%. That was nonsense.
//
// v3 fixes three things:
//
// 1. **PAR_RUN_RATE = 15.** Empirical HVC box-cricket mean, not the
//    8.5 rpo of long-format cricket. Box-cricket pitches are short,
//    bowlers can't generate genuine pace, and the boundary count per
//    over is much higher.
//
// 2. **Bayesian shrinkage on observed run rate.** Instead of extrapolating
//    raw CRR, we pull it toward par with a pseudo-count of K=18 balls of
//    "prior par-rate data". At balls_bowled=0 the shrunk rate is exactly
//    par; at balls_bowled=K it's 50/50 mix; beyond that the observed
//    rate dominates. A single six on ball 1 only nudges the shrunk rate
//    from 15 → ~16.1 rpo — not 15 → 36.
//
// 3. **Wickets factor scales with ball-progress, not raw count.** We
//    compute "expected wickets in hand at this point in the innings"
//    via a linear-attrition baseline (cap × ballsRemaining/totalBalls)
//    and use the signed advantage vs that baseline. Same code handles
//    6-, 7-, 9-a-side naturally because everything routes through
//    `cap`. Losing 5 wickets means "1 in hand" in a 6-side match
//    (collapse) and "4 in hand" in a 9-side (just normal attrition).
//
// 4. **50/50 prior blended by evidence.** observed_p is blended with a
//    50/50 prior by `evidence = min(1, ballsBowled/18)`. Innings 1
//    starts at exactly 50/50; the chase starts with `evidence_floor =
//    0.6` because the target itself is real information from ball 0.
//
// Cat 1 / Cat 3 over wicket-collapse rule is handled implicitly:
// `Inputs.wickets` is sourced from `innings.total_wickets`, which the
// 2026-05-13 trigger recomputes from only `balls` rows where
// `counts_for_innings_total = true`. So a bunch of physical wickets
// inside a single cat-N over still increments by 1, matching the
// final scorecard. Don't replace that input with `balls.filter(w).length`
// or you'll re-introduce the bug.
//
// This is intentionally not a DLS port. It's a calibrated narrative
// number that follows the rhythm of an HVC innings; treat single-point
// readings as ±10% wide.

const PAR_RUN_RATE = 15; // empirical HVC mean rpo — revisit if seasons drift
const SHRINKAGE_K = 18; // pseudo-balls of par-rate prior. ~3 overs.
const EVIDENCE_BALLS = 18; // balls to reach full evidence weight

// Curve shaping
const WKT_TANH_SCALE = 2;
const PROJ_TANH_SCALE_INNINGS1 = 1.5;
const PROJ_TANH_SCALE_CHASE = 2.5;

// Innings 1 blend — wickets dominate because there's no target yet to
// reference, so "collapsing" is the primary "in trouble" signal.
const INNINGS1_PROJ_WEIGHT = 0.35;
const INNINGS1_WKT_WEIGHT = 0.5;

// Chase blend — target equation dominates; wickets are secondary
// because even with all wickets you can't beat a 25rpo ask.
const CHASE_PROJ_WEIGHT = 0.55;
const CHASE_WKT_WEIGHT = 0.3;

// Pre-chase, the target is real info — don't let the 50/50 prior
// swallow it entirely.
const CHASE_EVIDENCE_FLOOR = 0.6;

export type WinProbabilityMode =
  | "pre_match"
  | "innings_1"
  | "innings_2"
  | "super_over"
  | "complete";

export type WinProbability = {
  mode: WinProbabilityMode;
  /** Batting-team probability, 0–100. */
  battingPct: number;
  /** Bowling-team probability, 0–100. */
  bowlingPct: number;
};

type Inputs = {
  inningsNumber: number;
  /** Sourced from `innings.total_runs`. */
  runsScored: number;
  /**
   * Sourced from `innings.total_wickets`. The trigger that maintains
   * this column already collapses cat-1/cat-3 repeat dismissals (only
   * counts `balls` rows with `counts_for_innings_total = true`), so
   * this is exactly the "final scorecard wickets" number.
   */
  wickets: number;
  /** Sourced from `innings.total_legal_balls`. */
  legalBalls: number;
  /** Sourced from `innings.target`. Null in innings 1 / first super over. */
  target: number | null;
  /** Per-innings over cap (regular vs super-over). */
  oversCap: number;
  playersPerSide: number;
  lastManStanding: boolean;
  isSuperOver: boolean;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function wicketsCap(input: Inputs): number {
  if (input.isSuperOver) return 2;
  return input.lastManStanding
    ? input.playersPerSide
    : input.playersPerSide - 1;
}

/**
 * Pull the observed run rate toward par. Returns par exactly when no
 * balls have been bowled, and converges on the raw CRR as the sample
 * grows. See file header for the motivation.
 */
function shrunkRunRate(runsScored: number, legalBalls: number): number {
  const numerator = runsScored + (SHRINKAGE_K * PAR_RUN_RATE) / 6;
  const denominator = legalBalls + SHRINKAGE_K;
  return (numerator / denominator) * 6;
}

/**
 * Signed wickets-in-hand advantage against a linear-attrition baseline.
 * Returns 0 at the start of the innings (you have all your wickets but
 * also all your balls — no advantage yet); positive when you've kept
 * more than the linear baseline expects; negative when you've lost
 * more.
 */
function wktSigned(
  wicketsInHand: number,
  ballsRemaining: number,
  totalInningsBalls: number,
  cap: number,
): number {
  if (totalInningsBalls === 0 || cap === 0) return 0;
  const expected = cap * (ballsRemaining / totalInningsBalls);
  const advantage = (wicketsInHand - expected) / cap;
  return Math.tanh(advantage * WKT_TANH_SCALE);
}

export function computeWinProbability(input: Inputs): WinProbability {
  const cap = wicketsCap(input);
  const wicketsInHand = Math.max(0, cap - input.wickets);
  const totalInningsBalls = input.oversCap * 6;
  const ballsRemaining = Math.max(0, totalInningsBalls - input.legalBalls);
  const modeTag: WinProbabilityMode = input.isSuperOver
    ? "super_over"
    : input.inningsNumber === 1
      ? "innings_1"
      : input.inningsNumber === 2
        ? "innings_2"
        : "complete";

  // ──────────────────────────────────────────────────────────────
  // Chase branch — anything with a defined target.
  // ──────────────────────────────────────────────────────────────
  if (input.target != null) {
    const runsNeeded = input.target - input.runsScored;

    if (runsNeeded <= 0) {
      return { mode: "complete", battingPct: 100, bowlingPct: 0 };
    }
    if (ballsRemaining === 0 || wicketsInHand === 0) {
      return { mode: "complete", battingPct: 0, bowlingPct: 100 };
    }

    const sRate = shrunkRunRate(input.runsScored, input.legalBalls);
    const projectedFinal = input.runsScored + (ballsRemaining * sRate) / 6;
    const targetGap = projectedFinal - input.target;
    const projSigned = Math.tanh(
      (targetGap / Math.max(input.target, 30)) * PROJ_TANH_SCALE_CHASE,
    );

    const wkts = wktSigned(
      wicketsInHand,
      ballsRemaining,
      totalInningsBalls,
      cap,
    );

    const observed =
      0.5 + projSigned * CHASE_PROJ_WEIGHT + wkts * CHASE_WKT_WEIGHT;
    const evidence = Math.max(
      CHASE_EVIDENCE_FLOOR,
      Math.min(1, input.legalBalls / EVIDENCE_BALLS),
    );
    const p = 0.5 + (observed - 0.5) * evidence;

    const pct = clamp(p * 100, 3, 97);
    return { mode: modeTag, battingPct: pct, bowlingPct: 100 - pct };
  }

  // ──────────────────────────────────────────────────────────────
  // No-target branch — innings 1 (and innings 3 super-over batting-first).
  // ──────────────────────────────────────────────────────────────
  // Special-case pre-match purely for the mode label; the math below
  // would also return 50/50 at legalBalls=0.
  if (input.legalBalls === 0 && input.inningsNumber === 1) {
    return { mode: "pre_match", battingPct: 50, bowlingPct: 50 };
  }

  if (totalInningsBalls === 0) {
    return { mode: "complete", battingPct: 50, bowlingPct: 50 };
  }

  const parTotal = PAR_RUN_RATE * input.oversCap;
  const sRate = shrunkRunRate(input.runsScored, input.legalBalls);
  const projectedFinal = input.runsScored + (ballsRemaining * sRate) / 6;
  const projSigned = Math.tanh(
    ((projectedFinal - parTotal) / Math.max(parTotal, 1)) *
      PROJ_TANH_SCALE_INNINGS1,
  );

  const wkts = wktSigned(wicketsInHand, ballsRemaining, totalInningsBalls, cap);

  const observed =
    0.5 + projSigned * INNINGS1_PROJ_WEIGHT + wkts * INNINGS1_WKT_WEIGHT;
  const evidence = Math.min(1, input.legalBalls / EVIDENCE_BALLS);
  const p = 0.5 + (observed - 0.5) * evidence;

  const pct = clamp(p * 100, 3, 97);
  return { mode: modeTag, battingPct: pct, bowlingPct: 100 - pct };
}
