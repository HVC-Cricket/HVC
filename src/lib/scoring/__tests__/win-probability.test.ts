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

  it("10 off 6 balls at full wickets reads near par (48–60%)", () => {
    // Scenario from the screenshot: 1 over of 10 rpo (below par 15)
    // with all wickets in hand. Shouldn't blow past 60%.
    const r = computeWinProbability({
      ...base,
      runsScored: 10,
      legalBalls: 6,
    });
    expect(r.battingPct).toBeGreaterThanOrEqual(48);
    expect(r.battingPct).toBeLessThanOrEqual(60);
  });

  it("sustained par-rate batting stays in a comfortable band", () => {
    // 30 off 12 = 15rpo (par exactly), 1 wkt down
    const r = computeWinProbability({
      ...base,
      runsScored: 30,
      legalBalls: 12,
      wickets: 1,
    });
    expect(r.battingPct).toBeGreaterThanOrEqual(50);
    expect(r.battingPct).toBeLessThanOrEqual(72);
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
    expect(r9.battingPct).toBeGreaterThan(r6.battingPct + 10);
    expect(r9.battingPct).toBeGreaterThanOrEqual(38);
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

  it("5 of 7 down at ball 22 of 24 is forgiven (not punished)", () => {
    // Late-innings attrition is normal — bar shouldn't tank below
    // ~30% just because the count is high.
    const r = computeWinProbability({
      ...base,
      runsScored: 50,
      legalBalls: 22,
      wickets: 5,
    });
    expect(r.battingPct).toBeGreaterThanOrEqual(30);
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
  it("pre-chase of par total (60 in 4 overs) reads near 50%", () => {
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 60,
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

  it("on-pace chase mid-innings stays in 40–60% band", () => {
    // 20 off 6 balls chasing 80 — needs 60 off 18 (=20rpo) and is at
    // 20rpo currently. Knife-edge.
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 80,
      runsScored: 20,
      legalBalls: 6,
      wickets: 0,
    });
    expect(r.battingPct).toBeGreaterThanOrEqual(40);
    expect(r.battingPct).toBeLessThanOrEqual(60);
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

  it("comfortable last over: need 12 off 6 with 3 wickets in hand reads >55%", () => {
    // CRR 16rpo, RRR 12rpo — batting team is ahead on pace.
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 60,
      runsScored: 48,
      legalBalls: 18,
      wickets: 4,
    });
    expect(r.battingPct).toBeGreaterThan(55);
  });

  it("real last-over thriller: need 18 off 6 with 1 wicket in hand reads 30–55%", () => {
    // Knife-edge: on par-rate, but last man standing.
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 78,
      runsScored: 60,
      legalBalls: 18,
      wickets: 6,
    });
    expect(r.battingPct).toBeGreaterThanOrEqual(30);
    expect(r.battingPct).toBeLessThanOrEqual(55);
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
