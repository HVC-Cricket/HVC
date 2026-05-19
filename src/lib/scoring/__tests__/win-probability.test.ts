import { describe, expect, it } from "vitest";

import { computeWinProbability } from "../win-probability";

// Default scenario: HVC 4-over, 7-a-side, last-man-standing.
const base = {
  inningsNumber: 1,
  runsScored: 0,
  wickets: 0,
  legalBalls: 0,
  target: null as number | null,
  oversCap: 4,
  playersPerSide: 7,
  lastManStanding: true,
  isSuperOver: false,
};

// ─────────────────────────────────────────────────────────────────
// Innings 1
// ─────────────────────────────────────────────────────────────────

describe("computeWinProbability — innings 1: shrinkage & evidence", () => {
  it("pre-match returns exactly 50/50", () => {
    const r = computeWinProbability(base);
    expect(r.mode).toBe("pre_match");
    expect(r.battingPct).toBe(50);
    expect(r.bowlingPct).toBe(50);
  });

  it("six off the first ball barely moves the bar (≤57%)", () => {
    const r = computeWinProbability({
      ...base,
      runsScored: 6,
      legalBalls: 1,
    });
    expect(r.mode).toBe("innings_1");
    expect(r.battingPct).toBeGreaterThanOrEqual(48);
    expect(r.battingPct).toBeLessThanOrEqual(57);
  });

  it("dot ball doesn't crater the bar (≥45%)", () => {
    const r = computeWinProbability({
      ...base,
      runsScored: 0,
      legalBalls: 1,
    });
    expect(r.battingPct).toBeGreaterThanOrEqual(45);
    expect(r.battingPct).toBeLessThanOrEqual(52);
  });

  it("10 off 6 balls (below par with all wickets) reads in 40–55% band", () => {
    // 1 over of 10 rpo (below par 15) with all wickets in hand. Should
    // read slightly below 50 since the team is behind on pace, but
    // nowhere near the v1 reading of 72%.
    const r = computeWinProbability({
      ...base,
      runsScored: 10,
      legalBalls: 6,
    });
    expect(r.battingPct).toBeGreaterThanOrEqual(40);
    expect(r.battingPct).toBeLessThanOrEqual(55);
  });

  it("sustained par-rate batting stays in a comfortable band (45–65%)", () => {
    // 30 off 12 = 15rpo (par exactly), 1 wkt down.
    // Par projection + 1 wicket down = near 50%.
    const r = computeWinProbability({
      ...base,
      runsScored: 30,
      legalBalls: 12,
      wickets: 1,
    });
    expect(r.battingPct).toBeGreaterThanOrEqual(45);
    expect(r.battingPct).toBeLessThanOrEqual(65);
  });

  it("dot balls progressively decrease probability (the v3.5 fix)", () => {
    // The bug v3.5 fixes: in v3, each dot ball was bumping the bar UP
    // because the time-relative wicket factor mechanically rewarded
    // "not losing a wicket today" with each passing ball. Locked in
    // with three sequential dot balls.
    const at13 = computeWinProbability({
      ...base,
      runsScored: 39,
      legalBalls: 13,
      wickets: 1,
    });
    const at14 = computeWinProbability({
      ...base,
      runsScored: 39,
      legalBalls: 14,
      wickets: 1,
    });
    const at15 = computeWinProbability({
      ...base,
      runsScored: 39,
      legalBalls: 15,
      wickets: 1,
    });
    expect(at14.battingPct).toBeLessThan(at13.battingPct);
    expect(at15.battingPct).toBeLessThan(at14.battingPct);
  });

  it("wicket loss drops probability noticeably more than a dot ball", () => {
    // Same runs, same balls — one scenario has +1 wicket. Wicket
    // should always hurt the batting team more than a dot.
    const dot = computeWinProbability({
      ...base,
      runsScored: 39,
      legalBalls: 14,
      wickets: 1,
    });
    const wkt = computeWinProbability({
      ...base,
      runsScored: 39,
      legalBalls: 14,
      wickets: 2,
    });
    expect(wkt.battingPct).toBeLessThan(dot.battingPct - 3);
  });
});

describe("computeWinProbability — innings 1: wicket-driven collapses", () => {
  it("5 of 6 wickets down halfway at par reads ≤35%", () => {
    // 6-a-side, 5 wickets down at ball 12 of 24 going at par rate
    const r = computeWinProbability({
      ...base,
      playersPerSide: 6,
      runsScored: 30,
      legalBalls: 12,
      wickets: 5,
    });
    expect(r.battingPct).toBeLessThanOrEqual(35);
  });

  it("5 of 9 wickets down halfway at par reads higher than 6-side equivalent", () => {
    // 9-a-side, same 5 wickets down at ball 12 going at par — should
    // read meaningfully higher because the team still has 4 in hand.
    const r6 = computeWinProbability({
      ...base,
      playersPerSide: 6,
      runsScored: 30,
      legalBalls: 12,
      wickets: 5,
    });
    const r9 = computeWinProbability({
      ...base,
      playersPerSide: 9,
      runsScored: 30,
      legalBalls: 12,
      wickets: 5,
    });
    expect(r9.battingPct).toBeGreaterThan(r6.battingPct + 8);
    expect(r9.battingPct).toBeGreaterThanOrEqual(35);
  });

  it("last man standing (cap-1 wickets down) at par halfway reads ≤30%", () => {
    // 7-a-side last-man: 6 wickets down with cap=7
    const r = computeWinProbability({
      ...base,
      runsScored: 30,
      legalBalls: 12,
      wickets: 6,
    });
    expect(r.battingPct).toBeLessThanOrEqual(30);
  });

  it("above-par scoring late in the innings holds up despite wicket loss", () => {
    // 5 of 7 down at ball 22 with above-par scoring (65 ≈ par+5).
    // v3.5 doesn't blanket-forgive late attrition (every wicket bites
    // regardless of timing), but a team that scored well past par
    // before losing those wickets still reads >25% — the projection
    // signal is decisive.
    const r = computeWinProbability({
      ...base,
      runsScored: 65,
      legalBalls: 22,
      wickets: 5,
    });
    expect(r.battingPct).toBeGreaterThanOrEqual(25);
  });

  it("clamps to [3, 97]", () => {
    // Trivial reach for the floor — bowl out very early.
    const r = computeWinProbability({
      ...base,
      runsScored: 0,
      legalBalls: 6,
      wickets: 6,
    });
    expect(r.battingPct).toBeGreaterThanOrEqual(3);
    expect(r.battingPct).toBeLessThanOrEqual(97);
  });
});

// ─────────────────────────────────────────────────────────────────
// Innings 2 — chase
// ─────────────────────────────────────────────────────────────────

describe("computeWinProbability — chase: target difficulty", () => {
  it("pre-chase of par total (56 in 4 overs) reads near 50%", () => {
    // Par is 14rpo × 4 overs = 56. Chasing exactly par should be
    // a coin flip with no other information.
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 56,
      runsScored: 0,
      legalBalls: 0,
    });
    expect(r.mode).toBe("innings_2");
    expect(r.battingPct).toBeGreaterThanOrEqual(45);
    expect(r.battingPct).toBeLessThanOrEqual(55);
  });

  it("pre-chase of easy total (40 in 4 overs) reads >70%", () => {
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 40,
      runsScored: 0,
      legalBalls: 0,
    });
    expect(r.battingPct).toBeGreaterThan(70);
  });

  it("pre-chase of hard total (80 in 4 overs) reads <40%", () => {
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 80,
      runsScored: 0,
      legalBalls: 0,
    });
    expect(r.battingPct).toBeLessThan(40);
  });

  it("pre-chase of brutal total (100 in 4 overs) reads <30%", () => {
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 100,
      runsScored: 0,
      legalBalls: 0,
    });
    expect(r.battingPct).toBeLessThan(30);
  });
});

describe("computeWinProbability — chase: live progression", () => {
  it("chase already done returns 100/0", () => {
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 80,
      runsScored: 81,
      legalBalls: 18,
      wickets: 2,
    });
    expect(r.mode).toBe("complete");
    expect(r.battingPct).toBe(100);
  });

  it("balls exhausted short of target returns 0/100", () => {
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 80,
      runsScored: 70,
      legalBalls: 24,
      wickets: 3,
    });
    expect(r.mode).toBe("complete");
    expect(r.battingPct).toBe(0);
  });

  it("all out short of target returns 0/100", () => {
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 80,
      runsScored: 60,
      legalBalls: 18,
      wickets: 7,
    });
    expect(r.mode).toBe("complete");
    expect(r.battingPct).toBe(0);
  });

  it("on-pace chase mid-innings reads as an underdog (30–55%)", () => {
    // 20 off 6 balls chasing 80 — needs 60 off 18 (=20rpo) at 20rpo
    // CRR. Currently par-rate-shrinkage projects them below target,
    // so this reads as a slight underdog despite the matching CRR.
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 80,
      runsScored: 20,
      legalBalls: 6,
      wickets: 0,
    });
    expect(r.battingPct).toBeGreaterThanOrEqual(30);
    expect(r.battingPct).toBeLessThanOrEqual(55);
  });

  it("behind on pace, all wickets — still trending down", () => {
    // 20 off 12 balls chasing 80, 0 wkts. Needs 60 off 12 = 30rpo;
    // crr only 10rpo. Tough.
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 80,
      runsScored: 20,
      legalBalls: 12,
      wickets: 0,
    });
    expect(r.battingPct).toBeLessThanOrEqual(40);
  });

  it("behind on pace + wickets gone reads <20%", () => {
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 80,
      runsScored: 20,
      legalBalls: 12,
      wickets: 5,
    });
    expect(r.battingPct).toBeLessThan(20);
  });

  it("last-over need 12 off 6 with 3 wickets in hand reads in 30–55%", () => {
    // CRR 16rpo, RRR 12rpo — ahead on pace, but 4 wickets gone hurts.
    // The squared wicket-loss penalty reads this as roughly even.
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 60,
      runsScored: 48,
      legalBalls: 18,
      wickets: 4,
    });
    expect(r.battingPct).toBeGreaterThanOrEqual(30);
    expect(r.battingPct).toBeLessThanOrEqual(55);
  });

  it("last-over thriller with last-man-standing reads dire (≤25%)", () => {
    // Need 18 off 6 at par-rate, but only the last batter is left —
    // (6/7)² penalty is severe and correctly so.
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 78,
      runsScored: 60,
      legalBalls: 18,
      wickets: 6,
    });
    expect(r.battingPct).toBeLessThanOrEqual(25);
  });
});

// ─────────────────────────────────────────────────────────────────
// Cap dynamics — wickets-in-hand scales naturally with players-per-side
// ─────────────────────────────────────────────────────────────────

describe("computeWinProbability — wicket caps & side sizes", () => {
  it("super over caps at 2 wickets regardless of XI size", () => {
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 12,
      runsScored: 5,
      legalBalls: 4,
      wickets: 2,
      oversCap: 1,
      isSuperOver: true,
    });
    expect(r.battingPct).toBe(0);
  });

  it("last_man_standing=false caps wickets at N-1", () => {
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 80,
      runsScored: 60,
      legalBalls: 18,
      wickets: 6,
      lastManStanding: false,
      playersPerSide: 7,
    });
    expect(r.battingPct).toBe(0);
  });

  it("5 wickets in 6-side vs 9-side gives meaningfully different chase readings", () => {
    const r6 = computeWinProbability({
      ...base,
      inningsNumber: 2,
      playersPerSide: 6,
      target: 60,
      runsScored: 35,
      legalBalls: 12,
      wickets: 4,
    });
    const r9 = computeWinProbability({
      ...base,
      inningsNumber: 2,
      playersPerSide: 9,
      target: 60,
      runsScored: 35,
      legalBalls: 12,
      wickets: 4,
    });
    expect(r9.battingPct).toBeGreaterThan(r6.battingPct);
  });
});
