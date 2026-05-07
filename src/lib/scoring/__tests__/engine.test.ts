import { describe, expect, it } from "vitest";

import { advanceBowler, applyBall, startInnings } from "../engine";
import { HVC_RULES } from "../rules";
import type { BallInput, EnginePlayer } from "../types";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const team_a = "team-a";
const team_b = "team-b";

function p(id: string, name: string, category: 1 | 2 | 3 | null): EnginePlayer {
  return { id, display_name: name, category, team_id: team_a };
}

function pBowl(id: string, name: string, category: 1 | 2 | 3 | null): EnginePlayer {
  return { id, display_name: name, category, team_id: team_b };
}

const cat1_batter = p("b-cat1", "Cat1 Bat", 1);
const cat2_batter = p("b-cat2", "Cat2 Bat", 2);
const cat3_batter = p("b-cat3", "Cat3 Bat", 3);
const cat2_batter_2 = p("b-cat2-2", "Cat2 Bat 2", 2);

const cat1_bowler = pBowl("o-cat1", "Cat1 Bowl", 1);
const cat2_bowler = pBowl("o-cat2", "Cat2 Bowl", 2);
const cat3_bowler = pBowl("o-cat3", "Cat3 Bowl", 3);

function legalBall(runs_off_bat = 0, extras = 0): BallInput {
  return {
    runs_off_bat,
    extras,
    extra_type: null,
    is_wicket: false,
  };
}

function freshInnings(opts?: {
  striker?: EnginePlayer;
  non_striker?: EnginePlayer;
  bowler?: EnginePlayer;
}) {
  return startInnings({
    innings_number: 1,
    batting_team_id: team_a,
    bowling_team_id: team_b,
    striker: opts?.striker ?? cat1_batter,
    non_striker: opts?.non_striker ?? cat2_batter,
    bowler: opts?.bowler ?? cat1_bowler,
    rules: HVC_RULES,
  });
}

// ---------------------------------------------------------------------------
// Basic flow
// ---------------------------------------------------------------------------

describe("applyBall — basic", () => {
  it("adds runs from the bat", () => {
    const s0 = freshInnings({ striker: cat2_batter, non_striker: cat2_batter_2, bowler: cat2_bowler });
    const r = applyBall(s0, legalBall(4), HVC_RULES);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.total_runs).toBe(4);
    expect(r.state.legal_balls).toBe(1);
    expect(r.state.ball_in_over).toBe(1);
  });

  it("rotates strike on a single (non-special-over)", () => {
    const s0 = freshInnings({
      striker: cat2_batter,
      non_striker: cat2_batter_2,
      bowler: cat2_bowler,
    });
    // jump out of over 1 / cat1 special so this is plain
    const s1 = startInnings({
      innings_number: 1,
      batting_team_id: team_a,
      bowling_team_id: team_b,
      striker: cat2_batter,
      non_striker: cat2_batter_2,
      bowler: cat2_bowler,
      rules: { ...HVC_RULES, categories: { ...HVC_RULES.categories, enabled: false } },
    });
    const r = applyBall(s1, legalBall(1), HVC_RULES);
    if (!r.ok) throw new Error("expected ok");
    expect(r.state.striker_id).toBe(cat2_batter_2.id);
    expect(r.state.non_striker_id).toBe(cat2_batter.id);
  });

  it("does NOT rotate on even runs", () => {
    const s0 = startInnings({
      innings_number: 1,
      batting_team_id: team_a,
      bowling_team_id: team_b,
      striker: cat2_batter,
      non_striker: cat2_batter_2,
      bowler: cat2_bowler,
      rules: { ...HVC_RULES, categories: { ...HVC_RULES.categories, enabled: false } },
    });
    const r = applyBall(s0, legalBall(2), HVC_RULES);
    if (!r.ok) throw new Error("expected ok");
    expect(r.state.striker_id).toBe(cat2_batter.id);
  });

  it("swaps ends at end of over and bumps over number", () => {
    let s = startInnings({
      innings_number: 1,
      batting_team_id: team_a,
      bowling_team_id: team_b,
      striker: cat2_batter,
      non_striker: cat2_batter_2,
      bowler: cat2_bowler,
      rules: { ...HVC_RULES, categories: { ...HVC_RULES.categories, enabled: false } },
    });
    for (let i = 0; i < 6; i++) {
      const r = applyBall(s, legalBall(0), HVC_RULES);
      if (!r.ok) throw new Error("expected ok");
      s = r.state;
    }
    expect(s.ball_in_over).toBe(0);
    expect(s.current_over_number).toBe(2);
    // 0 runs all 6 balls → no per-ball rotation; swap on end of over
    expect(s.striker_id).toBe(cat2_batter_2.id);
    expect(s.non_striker_id).toBe(cat2_batter.id);
  });
});

// ---------------------------------------------------------------------------
// Wides and no-balls
// ---------------------------------------------------------------------------

describe("applyBall — wides + no-balls", () => {
  it("wide adds extras but does not consume a legal ball", () => {
    const s0 = freshInnings();
    const r = applyBall(
      s0,
      { runs_off_bat: 0, extras: 1, extra_type: "wide", is_wicket: false },
      HVC_RULES,
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.state.total_runs).toBe(1);
    expect(r.state.extras_wides).toBe(1);
    expect(r.state.legal_balls).toBe(0);
    expect(r.state.ball_in_over).toBe(0);
    expect(r.state.free_hit_pending).toBe(false);
  });

  it("no-ball sets free-hit pending and adds extra", () => {
    const s0 = freshInnings();
    const r = applyBall(
      s0,
      { runs_off_bat: 0, extras: 1, extra_type: "no_ball", is_wicket: false },
      HVC_RULES,
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.state.extras_no_balls).toBe(1);
    expect(r.state.free_hit_pending).toBe(true);
    expect(r.state.legal_balls).toBe(0);
  });

  it("free hit consumed on next legal ball", () => {
    const s0 = freshInnings();
    const r1 = applyBall(
      s0,
      { runs_off_bat: 0, extras: 1, extra_type: "no_ball", is_wicket: false },
      HVC_RULES,
    );
    if (!r1.ok) throw new Error();
    const r2 = applyBall(r1.state, legalBall(2), HVC_RULES);
    if (!r2.ok) throw new Error();
    expect(r2.state.free_hit_pending).toBe(false);
  });

  it("free hit survives an intervening wide", () => {
    const s0 = freshInnings();
    const r1 = applyBall(
      s0,
      { runs_off_bat: 0, extras: 1, extra_type: "no_ball", is_wicket: false },
      HVC_RULES,
    );
    if (!r1.ok) throw new Error();
    const r2 = applyBall(
      r1.state,
      { runs_off_bat: 0, extras: 1, extra_type: "wide", is_wicket: false },
      HVC_RULES,
    );
    if (!r2.ok) throw new Error();
    expect(r2.state.free_hit_pending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Free-hit dismissals
// ---------------------------------------------------------------------------

describe("applyBall — free hit dismissals", () => {
  it("rejects a 'caught' on a free hit", () => {
    const s0 = freshInnings();
    const r1 = applyBall(
      s0,
      { runs_off_bat: 0, extras: 1, extra_type: "no_ball", is_wicket: false },
      HVC_RULES,
    );
    if (!r1.ok) throw new Error();
    const r2 = applyBall(
      r1.state,
      {
        runs_off_bat: 0,
        extras: 0,
        extra_type: null,
        is_wicket: true,
        wicket_type: "caught",
      },
      HVC_RULES,
    );
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error.code).toBe("invalid_free_hit_dismissal");
  });

  it("accepts a 'run_out' on a free hit", () => {
    const s0 = freshInnings();
    const r1 = applyBall(
      s0,
      { runs_off_bat: 0, extras: 1, extra_type: "no_ball", is_wicket: false },
      HVC_RULES,
    );
    if (!r1.ok) throw new Error();
    const r2 = applyBall(
      r1.state,
      {
        runs_off_bat: 0,
        extras: 0,
        extra_type: null,
        is_wicket: true,
        wicket_type: "run_out",
      },
      HVC_RULES,
    );
    expect(r2.ok).toBe(true);
  });

  it("accepts a 'hit_wicket' on a free hit", () => {
    const s0 = freshInnings();
    const r1 = applyBall(
      s0,
      { runs_off_bat: 0, extras: 1, extra_type: "no_ball", is_wicket: false },
      HVC_RULES,
    );
    if (!r1.ok) throw new Error();
    const r2 = applyBall(
      r1.state,
      {
        runs_off_bat: 0,
        extras: 0,
        extra_type: null,
        is_wicket: true,
        wicket_type: "hit_wicket",
      },
      HVC_RULES,
    );
    expect(r2.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cat 1 special-over rules
// ---------------------------------------------------------------------------

describe("applyBall — Cat 1 special over", () => {
  it("Cat 1 batter stays on strike after a single", () => {
    const s0 = freshInnings({
      striker: cat1_batter,
      non_striker: cat2_batter,
      bowler: cat1_bowler,
    });
    expect(s0.special_over?.type).toBe("cat1");
    const r = applyBall(s0, legalBall(1), HVC_RULES);
    if (!r.ok) throw new Error();
    // Strike stayed despite odd run
    expect(r.state.striker_id).toBe(cat1_batter.id);
    expect(r.state.non_striker_id).toBe(cat2_batter.id);
  });

  it("Cat 1 batter dismissed first time → wicket counts; second dismissal in same over → ignored", () => {
    const s0 = freshInnings({
      striker: cat1_batter,
      non_striker: cat2_batter,
      bowler: cat1_bowler,
    });
    const wicket: BallInput = {
      runs_off_bat: 0,
      extras: 0,
      extra_type: null,
      is_wicket: true,
      wicket_type: "bowled",
    };
    const r1 = applyBall(s0, wicket, HVC_RULES);
    if (!r1.ok) throw new Error();
    expect(r1.state.total_wickets).toBe(1);
    expect(r1.state.special_over?.special_batter_dismissed).toBe(true);

    const r2 = applyBall(r1.state, wicket, HVC_RULES);
    if (!r2.ok) throw new Error();
    // Subsequent dismissal in same special over: no extra wicket
    expect(r2.state.total_wickets).toBe(1);
  });

  it("non-striker run-out in special over bars them from later batting", () => {
    const s0 = freshInnings({
      striker: cat1_batter,
      non_striker: cat2_batter,
      bowler: cat1_bowler,
    });
    const r = applyBall(
      s0,
      {
        runs_off_bat: 0,
        extras: 0,
        extra_type: null,
        is_wicket: true,
        wicket_type: "run_out",
        player_out_id: cat2_batter.id,
      },
      HVC_RULES,
    );
    if (!r.ok) throw new Error();
    expect(r.state.barred_batters.has(cat2_batter.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Wicket type validation
// ---------------------------------------------------------------------------

describe("applyBall — wicket validation", () => {
  it("rejects LBW (HVC ruleset disallows)", () => {
    const s0 = freshInnings();
    const r = applyBall(
      s0,
      {
        runs_off_bat: 0,
        extras: 0,
        extra_type: null,
        is_wicket: true,
        // @ts-expect-error LBW is not in WicketType union (intentional)
        wicket_type: "lbw",
      },
      HVC_RULES,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("invalid_wicket_type");
  });

  it("rejects bye when ruleset disables byes", () => {
    const s0 = freshInnings();
    const noByes = { ...HVC_RULES, extras: { ...HVC_RULES.extras, byes: false } };
    const r = applyBall(
      s0,
      { runs_off_bat: 0, extras: 1, extra_type: "bye", is_wicket: false },
      noByes,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("invalid_extra_type");
  });
});

// ---------------------------------------------------------------------------
// Bowler max-overs cap
// ---------------------------------------------------------------------------

describe("applyBall — bowler cap", () => {
  it("rejects a delivery from a bowler already at the cap", () => {
    let s = freshInnings({
      striker: cat2_batter,
      non_striker: cat2_batter_2,
      bowler: cat2_bowler,
    });
    // bowl 2 full overs (12 legal balls) by the same bowler
    for (let i = 0; i < 12; i++) {
      const r = applyBall(s, legalBall(0), HVC_RULES);
      if (!r.ok) throw new Error("setup");
      s = r.state;
      // re-set the same bowler at the start of the new over
      if (s.ball_in_over === 0 && s.current_over_number > 1) {
        s = advanceBowler(s, cat2_bowler, cat2_batter, cat2_batter_2, HVC_RULES);
      }
    }
    expect(s.bowler_legal_balls[cat2_bowler.id]).toBe(12);
    const r = applyBall(s, legalBall(0), HVC_RULES);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("bowler_at_max");
  });
});

// ---------------------------------------------------------------------------
// Innings completion
// ---------------------------------------------------------------------------

describe("applyBall — innings completion", () => {
  it("marks innings complete after all overs bowled", () => {
    // Loosen the bowler cap so one bowler can carry the test innings.
    const rules = {
      ...HVC_RULES,
      max_overs_per_bowler: 7,
      categories: { ...HVC_RULES.categories, enabled: false },
    };
    let s = startInnings({
      innings_number: 1,
      batting_team_id: team_a,
      bowling_team_id: team_b,
      striker: cat2_batter,
      non_striker: cat2_batter_2,
      bowler: cat2_bowler,
      rules,
    });
    // 7 overs × 6 legal balls
    for (let i = 0; i < 7 * 6; i++) {
      const r = applyBall(s, legalBall(0), rules);
      if (!r.ok) throw new Error(`setup failed at ball ${i}: ${r.error.message}`);
      s = r.state;
    }
    expect(s.is_complete).toBe(true);
  });

  it("super over ends at 2 wickets", () => {
    let s = startInnings({
      innings_number: 3,
      batting_team_id: team_a,
      bowling_team_id: team_b,
      striker: cat2_batter,
      non_striker: cat2_batter_2,
      bowler: cat2_bowler,
      is_super_over: true,
      rules: { ...HVC_RULES, categories: { ...HVC_RULES.categories, enabled: false } },
    });
    const wicket: BallInput = {
      runs_off_bat: 0,
      extras: 0,
      extra_type: null,
      is_wicket: true,
      wicket_type: "bowled",
    };
    const r1 = applyBall(s, wicket, HVC_RULES);
    if (!r1.ok) throw new Error();
    s = r1.state;
    expect(s.is_complete).toBe(false);
    const r2 = applyBall(s, wicket, HVC_RULES);
    if (!r2.ok) throw new Error();
    expect(r2.state.is_complete).toBe(true);
  });
});
