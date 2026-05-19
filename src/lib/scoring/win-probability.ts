// Live win-probability estimator for HVC box-cricket matches.
//
// v3.5 — wicket signal redesign:
//
// The v3 formula used a *time-relative* wicket factor: signed advantage
// against `cap × ballsRemaining/totalBalls`. That had a subtle bug —
// as balls were bowled WITHOUT wickets falling, the linear baseline
// shrank while observed wickets-in-hand stayed put, so a dot ball was
// read as "you kept more wickets than expected". Combined with the
// evidence-weighting that grows with `ballsBowled`, **each dot ball
// monotonically bumped the batting team's probability up ~1%.**
//
// Fix: replace the time-relative wicket factor with an absolute one —
// a power-curve loss penalty `(wickets/cap)^1.5`. Properties:
//   - Doesn't change on a dot ball (penalty is a function of wickets, not balls)
//   - Drops on each wicket lost; the exponent shape means early wickets
//     register but don't crush, and late wickets dominate
//   - Naturally cap-aware — 5 of 6 reads worse than 5 of 9 without branching
//   - 1→2 of 7 gives roughly 3% probability drop; dot ball gives 1-2%, so
//     wickets always feel worse than dots while still moving the bar smoothly
//
// This intentionally drops the v3 "late attrition is normal" forgiveness.
// In a 4-over match, every wicket is meaningful regardless of when it
// falls — there's no comparable resource depletion the way 50-over
// cricket has tail-enders coming in.
//
// v3 par/shrinkage/evidence design notes still apply:
//
// 1. **PAR_RUN_RATE = 14.** Empirical HVC box-cricket mean, not the
//    8.5 rpo of long-format cricket. Revised from 15 once enough
//    season data was in.
//
// 2. **Bayesian shrinkage on observed run rate.** `shrunkRate =
//    (runsScored + K × par/6) / (legalBalls + K) × 6` with K = 18.
//    At ball 0 the shrunk rate is exactly par; converges on raw CRR
//    as the sample grows. Damps "six on ball 1 → 90%" noise.
//
// 3. **50/50 prior blended by evidence.** observed_p is blended with
//    a 50/50 prior weighted by `evidence = balls/18` (capped at 1).
//    Chase has an `evidence_floor = 0.6` because the target itself is
//    real information from ball 0.
//
// Cat 1 / Cat 3 over wicket-collapse rule is honoured implicitly:
// `Inputs.wickets` is sourced from `innings.total_wickets`, which the
// 2026-05-13 trigger recomputes from only `balls` rows where
// `counts_for_innings_total = true`. So a bunch of physical wickets
// inside a single cat-N over still increments by 1, matching the
// final scorecard. Don't replace that input with `balls.filter(w).length`
// or you'll re-introduce the bug.
//
// Not a DLS port. Treat single-point readings as ±10% wide.

const PAR_RUN_RATE = 14;
const SHRINKAGE_K = 18;
const EVIDENCE_BALLS = 18;

// Curve shaping for projection signal
const PROJ_TANH_SCALE_INNINGS1 = 1.5;
const PROJ_TANH_SCALE_CHASE = 2.5;

// Unified weights across innings 1 and chase. Wicket loss matters in
// both, and the projection signal does the rest (chase uses target gap;
// innings 1 uses par gap).
const PROJ_WEIGHT = 0.55;
const WKT_LOSS_WEIGHT = 0.45;

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
 * grows.
 */
function shrunkRunRate(runsScored: number, legalBalls: number): number {
  const numerator = runsScored + (SHRINKAGE_K * PAR_RUN_RATE) / 6;
  const denominator = legalBalls + SHRINKAGE_K;
  return (numerator / denominator) * 6;
}

/**
 * Loss penalty curve — positive, in [0, 1]. Returns 0 at full wickets,
 * 1 at all-out (terminal anyway). Exponent of 1.5 hits the sweet spot:
 * gentle enough that 1 wicket of 7 doesn't crush the bar (`(1/7)^1.5 ≈
 * 0.054`), steep enough that 6 of 7 reads as dire (`(6/7)^1.5 ≈ 0.79`),
 * and produces a meaningful gap between consecutive wicket counts
 * (1→2 of 7 ≈ 3% probability swing, which is enough to feel a wicket
 * tick down the bar vs a dot ball ticking it down ~1-2%).
 */
function wicketLossPenalty(wickets: number, cap: number): number {
  if (cap === 0) return 0;
  const ratio = clamp(wickets / cap, 0, 1);
  return Math.pow(ratio, 1.5);
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

    const wktLoss = wicketLossPenalty(input.wickets, cap);

    const observed =
      0.5 + projSigned * PROJ_WEIGHT - wktLoss * WKT_LOSS_WEIGHT;
    const evidence = Math.max(
      CHASE_EVIDENCE_FLOOR,
      Math.min(1, input.legalBalls / EVIDENCE_BALLS),
    );
    const p = 0.5 + (observed - 0.5) * evidence;

    const pct = clamp(p * 100, 3, 97);
    return { mode: modeTag, battingPct: pct, bowlingPct: 100 - pct };
  }

  // ──────────────────────────────────────────────────────────────
  // No-target branch — innings 1 (and first super over batting-first).
  // ──────────────────────────────────────────────────────────────
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

  const wktLoss = wicketLossPenalty(input.wickets, cap);

  const observed =
    0.5 + projSigned * PROJ_WEIGHT - wktLoss * WKT_LOSS_WEIGHT;
  const evidence = Math.min(1, input.legalBalls / EVIDENCE_BALLS);
  const p = 0.5 + (observed - 0.5) * evidence;

  const pct = clamp(p * 100, 3, 97);
  return { mode: modeTag, battingPct: pct, bowlingPct: 100 - pct };
}
