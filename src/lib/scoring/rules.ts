import type { RuleSet, WicketType } from "./types";

const STANDARD_WICKETS: WicketType[] = [
  "bowled",
  "caught",
  "caught_and_bowled",
  "run_out",
  "stumped",
  "hit_wicket",
  "retired",
  "obstructing",
  "timed_out",
];

/**
 * HVC Premier League — Season 6 ruleset. Authoritative source:
 * `~/Downloads/HVC 6 - Rules & Regulations.pdf` plus Pavan's clarifications
 * captured in `memory/project_hvc_rules.md`.
 */
export const HVC_RULES: RuleSet = {
  overs_per_innings: 7,
  players_per_side: 7,
  max_overs_per_bowler: 2,
  last_man_standing: true,

  strike_rotation: "standard",

  extras: {
    byes: true,
    leg_byes: false, // HVC: not used
    overthrow_dead_on_batsman: true,
  },

  no_ball: {
    causes_free_hit: true,
  },

  free_hit: {
    // Pavan-confirmed: only run-out and hit-wicket count as out on a free hit
    out_dismissals: ["run_out", "hit_wicket"],
  },

  // No LBW in HVC; everything else from the standard list.
  allowed_wicket_types: STANDARD_WICKETS,

  categories: {
    enabled: true,
    cat1_over: 1,
    cat3_over: 2,
    cat_special_dismissals: "first_only",
    cat_special_strike: "stay",
    cat_special_non_striker_lock: true,
  },

  super_over: {
    enabled: true,
    overs: 1,
    max_wickets: 2,
    nominate_batters: 3,
    second_team_bats_first: true,
  },
};

/**
 * A loose standard-cricket fallback for non-HVC tournaments. Currently unused
 * by the app but useful for engine tests + future tournaments.
 */
export const STANDARD_RULES: RuleSet = {
  overs_per_innings: 20,
  players_per_side: 11,
  max_overs_per_bowler: 4,
  last_man_standing: false,

  strike_rotation: "standard",

  extras: {
    byes: true,
    leg_byes: true,
    overthrow_dead_on_batsman: false,
  },

  no_ball: {
    causes_free_hit: true,
  },

  free_hit: {
    // Standard T20: only run-out, obstructing, hit-wicket
    out_dismissals: ["run_out", "obstructing", "hit_wicket"],
  },

  allowed_wicket_types: [...STANDARD_WICKETS],

  categories: {
    enabled: false,
    cat1_over: 0,
    cat3_over: 0,
    cat_special_dismissals: "all",
    cat_special_strike: "standard",
    cat_special_non_striker_lock: false,
  },

  super_over: {
    enabled: true,
    overs: 1,
    max_wickets: 2,
    nominate_batters: 3,
    second_team_bats_first: true,
  },
};
