import { describe, expect, it } from "vitest";

import { computeWinProbability } from "../win-probability";

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

describe("computeWinProbability — innings 1", () => {
  it("pre-match returns a slight batting nudge", () => {
    const r = computeWinProbability(base);
    expect(r.mode).toBe("pre_match");
    expect(r.battingPct + r.bowlingPct).toBe(100);
    expect(r.battingPct).toBeGreaterThan(50);
    expect(r.battingPct).toBeLessThan(60);
  });

  it("strong pace pushes batting team above 60%", () => {
    // 30 off 12 balls = 15rpo, well above 8.5 par
    const r = computeWinProbability({
      ...base,
      runsScored: 30,
      legalBalls: 12,
      wickets: 1,
    });
    expect(r.mode).toBe("innings_1");
    expect(r.battingPct).toBeGreaterThan(60);
  });

  it("collapsing innings pushes bowling team ahead", () => {
    // 10 off 12 balls with 5 down — pace and resources both bad
    const r = computeWinProbability({
      ...base,
      runsScored: 10,
      legalBalls: 12,
      wickets: 5,
    });
    expect(r.bowlingPct).toBeGreaterThan(55);
  });

  it("clamps to [8, 92]", () => {
    // Absurdly bad: 0 runs 12 balls 6 down (lms cap is 7 so 1 in hand)
    const r = computeWinProbability({
      ...base,
      runsScored: 0,
      legalBalls: 12,
      wickets: 6,
    });
    expect(r.battingPct).toBeGreaterThanOrEqual(8);
    expect(r.battingPct).toBeLessThanOrEqual(92);
  });
});

describe("computeWinProbability — innings 2", () => {
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

  it("balls exhausted with target unmet returns 0/100", () => {
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 80,
      runsScored: 70,
      legalBalls: 24, // 4 overs * 6
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
      wickets: 7, // lms cap = playersPerSide = 7
    });
    expect(r.mode).toBe("complete");
    expect(r.battingPct).toBe(0);
  });

  it("comfortable chase (low RRR, wickets in hand) favors batters >70%", () => {
    // Need 20 off 24 balls (5rpo), 6 wickets in hand, current RR 10
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 80,
      runsScored: 60,
      legalBalls: 6 * 6, // 36 balls? — adjust to 12
      wickets: 1,
      oversCap: 6,
    });
    // 60 off 36 balls = 10rpo; need 20 off 0 balls — that's exhausted.
    // Switch to a valid scenario:
    const r2 = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 80,
      runsScored: 60,
      legalBalls: 12,
      wickets: 1,
      oversCap: 4,
    });
    // 60 off 12 = 30rpo current, need 20 off 12 balls = 10rpo required → very comfortable
    expect(r2.mode).toBe("innings_2");
    expect(r2.battingPct).toBeGreaterThan(70);
    // r used as a syntax anchor; ensure both calls type-check
    expect(typeof r.mode).toBe("string");
  });

  it("steep RRR with few wickets crashes batters <30%", () => {
    // 10 off 12 balls (CRR 5), need 70 off 12 balls (RRR 35), 5 down — almost impossible
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 80,
      runsScored: 10,
      legalBalls: 12,
      wickets: 5,
      oversCap: 4,
    });
    expect(r.mode).toBe("innings_2");
    expect(r.battingPct).toBeLessThan(30);
  });

  it("never returns flat 0 or 100 during a live chase", () => {
    // Tight chase
    const r = computeWinProbability({
      ...base,
      inningsNumber: 2,
      target: 80,
      runsScored: 70,
      legalBalls: 18,
      wickets: 4,
      oversCap: 4,
    });
    expect(r.battingPct).toBeGreaterThanOrEqual(3);
    expect(r.battingPct).toBeLessThanOrEqual(97);
  });
});

describe("computeWinProbability — wicket caps", () => {
  it("super over caps at 2 wickets regardless of XI size", () => {
    // 2 wickets down in a super over = all out
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
    // 6 of 7 down with last_man_standing=false → all out
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
});
