// Live win-probability estimator for HVC box-cricket matches.
//
// This is not a Duckworth–Lewis port. With 4–6 overs a side and very
// little historical micro-data per team, a calibrated model would be
// overkill (and dishonest). What this gives you instead is a
// fast-feedback narrative number — "MM 65% likely to win" — driven by
// the two signals that actually move a chase in HVC: pace (current RR
// vs the rate you still need) and resources (wickets in hand vs the
// XI size).
//
// Output is intentionally clamped to [3, 97] so the bar never goes
// flat — even a dead-rubber chase still feels like a game until the
// last ball, which matches the live-spectator vibe better than a
// "100/0" reading 12 balls before the end.

const PAR_RUN_RATE = 8.5; // empirical HVC mean — adjust if a season shows it's drifted

export type WinProbabilityMode =
  | "pre_match" // no balls bowled in either innings
  | "innings_1" // innings 1 in progress; probability is projection-based
  | "innings_2" // innings 2 in progress; probability is chase-based
  | "complete"; // chase done, all out, or balls exhausted

export type WinProbability = {
  mode: WinProbabilityMode;
  /** Batting-team probability, 0–100. */
  battingPct: number;
  /** Bowling-team probability, 0–100. */
  bowlingPct: number;
};

type Inputs = {
  inningsNumber: number;
  runsScored: number;
  wickets: number;
  legalBalls: number;
  target: number | null;
  oversCap: number; // overs per innings cap that applies to *this* innings (super-over included)
  playersPerSide: number;
  lastManStanding: boolean;
  isSuperOver: boolean;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** How many wickets can fall before this innings is over. */
function wicketsCap(input: Inputs): number {
  // Super overs cap at 2 wickets regardless of the player count;
  // box-cricket "all out" otherwise lets the last man bat solo.
  if (input.isSuperOver) return 2;
  return input.lastManStanding
    ? input.playersPerSide
    : input.playersPerSide - 1;
}

export function computeWinProbability(input: Inputs): WinProbability {
  const cap = wicketsCap(input);
  const wicketsInHand = Math.max(0, cap - input.wickets);
  const ballsRemaining = Math.max(0, input.oversCap * 6 - input.legalBalls);
  const runRate =
    input.legalBalls > 0 ? (input.runsScored * 6) / input.legalBalls : 0;

  // ──────────────────────────────────────────────────────────────
  // Innings 2: chase math
  // ──────────────────────────────────────────────────────────────
  if (input.inningsNumber === 2 && input.target != null) {
    const runsNeeded = input.target - input.runsScored;

    // Chase complete → 100/0.
    if (runsNeeded <= 0) {
      return { mode: "complete", battingPct: 100, bowlingPct: 0 };
    }
    // Balls exhausted or all out before the target → 0/100.
    if (ballsRemaining === 0 || wicketsInHand === 0) {
      return { mode: "complete", battingPct: 0, bowlingPct: 100 };
    }

    const rrr = (runsNeeded * 6) / ballsRemaining;
    // Pace factor — how far is the current RR above (or below) what's
    // required. Each rpo of margin shifts the sigmoid by 0.5; 2rpo
    // either way is roughly the difference between 27% and 73%.
    const paceFactor = sigmoid((runRate - rrr) * 0.5);

    // Wicket factor — concave (^0.5) so the first two losses don't
    // crater the probability but the last two do.
    const wktFactor = Math.pow(wicketsInHand / cap, 0.5);

    // 60/40 split between pace and resources. Pace gets the heavier
    // weight because in a 4-over chase one good over swings the game
    // far more than one wicket does.
    const battingP = paceFactor * 0.6 + wktFactor * 0.4;
    const pct = clamp(battingP * 100, 3, 97);
    return {
      mode: "innings_2",
      battingPct: pct,
      bowlingPct: 100 - pct,
    };
  }

  // ──────────────────────────────────────────────────────────────
  // Innings 1: projection-based; no target yet, so "winning" means
  // "on track to post an above-par total".
  // ──────────────────────────────────────────────────────────────
  if (input.inningsNumber === 1) {
    // Pre-match coin flip with a tiny batting-first nudge — useful
    // mostly so the bar isn't dead at 0/0 before the first ball.
    if (input.legalBalls === 0) {
      return { mode: "pre_match", battingPct: 52, bowlingPct: 48 };
    }

    const par = PAR_RUN_RATE * input.oversCap;
    const projected =
      input.runsScored + (ballsRemaining * Math.max(runRate, 1)) / 6;
    // Map (projected − par)/par to [0,1] with a gentle 4× slope so
    // 25% above par lands near 70%, 25% below par near 30%.
    const projectionFactor = sigmoid(((projected - par) / par) * 4);

    const wktFactor = Math.pow(wicketsInHand / cap, 0.4);
    // Slightly less pace-heavy here than in the chase — innings 1 has
    // more time for things to reverse, so don't over-react.
    const battingP = projectionFactor * 0.55 + wktFactor * 0.3 + 0.05;
    const pct = clamp(battingP * 100, 8, 92);
    return {
      mode: "innings_1",
      battingPct: pct,
      bowlingPct: 100 - pct,
    };
  }

  // Super overs, no-result, or innings_number > 2 — fall back to
  // 50/50 so the bar doesn't render garbage. Caller decides whether
  // to hide it.
  return { mode: "complete", battingPct: 50, bowlingPct: 50 };
}
