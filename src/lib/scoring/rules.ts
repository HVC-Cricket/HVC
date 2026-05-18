import type { RuleSet, WicketType } from "./types";

/**
 * Look up the category required at a given over number under the
 * supplied rules. Returns `1` / `3` if the over is on either array,
 * otherwise `2` (open — anyone can bat / bowl). Used by the
 * scoreboard's per-over category default + the pre-flight check
 * that warns when an XI can't satisfy a required category.
 */
export function categoryForOver(
  rules: RuleSet,
  overNumber: number,
): 1 | 2 | 3 {
  if (!rules.categories.enabled) return 2;
  if (rules.categories.cat1_overs.includes(overNumber)) return 1;
  if (rules.categories.cat3_overs.includes(overNumber)) return 3;
  return 2;
}

/**
 * Shape accepted by `matches.rules_override` — partial RuleSet,
 * with only the category-over arrays meaningful today. Anything not
 * provided inherits from the tournament-level rules.
 */
export type RulesOverride = {
  categories?: {
    cat1_overs?: number[] | null;
    cat3_overs?: number[] | null;
  };
} | null;

/**
 * Merge a per-match override into the tournament-level rules. The
 * override is sparse — only fields present (and non-null) actually
 * override; everything else passes through from the base.
 */
export function applyRulesOverride(
  base: RuleSet,
  override: RulesOverride,
): RuleSet {
  if (!override) return base;
  const cats = override.categories;
  if (!cats) return base;
  return {
    ...base,
    categories: {
      ...base.categories,
      cat1_overs: Array.isArray(cats.cat1_overs)
        ? cats.cat1_overs
        : base.categories.cat1_overs,
      cat3_overs: Array.isArray(cats.cat3_overs)
        ? cats.cat3_overs
        : base.categories.cat3_overs,
    },
  };
}

/**
 * Layer the per-match scalar columns (`players_per_side`,
 * `overs_per_innings`) on top of the merged tournament + override
 * rules. These columns live on the `matches` table — not in
 * `rules_override` — and are first-class per-match config: the match
 * edit form writes directly to them. They MUST win over the
 * tournament defaults, otherwise the engine ends innings using the
 * tournament's player count even when the specific match was scored
 * with fewer players.
 *
 * Use this everywhere effective rules are needed for a specific
 * match (state derivation, recordBall validation, preflight, etc.).
 */
export function applyMatchScalarRules(
  rules: RuleSet,
  match: { players_per_side: number; overs_per_innings: number },
): RuleSet {
  return {
    ...rules,
    players_per_side: match.players_per_side,
    overs_per_innings: match.overs_per_innings,
  };
}

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
    cat1_overs: [1],
    cat3_overs: [2],
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
    cat1_overs: [],
    cat3_overs: [],
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
