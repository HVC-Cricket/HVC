import { z } from "zod";

import { HVC_RULES } from "./rules";
import type { RuleSet, WicketType } from "./types";

const wicketTypeSchema = z.enum([
  "bowled",
  "caught",
  "caught_and_bowled",
  "run_out",
  "stumped",
  "hit_wicket",
  "retired",
  "obstructing",
  "timed_out",
]) satisfies z.ZodType<WicketType>;

const ruleSetSchema = z.object({
  overs_per_innings: z.number().int().positive(),
  players_per_side: z.number().int().min(2),
  max_overs_per_bowler: z.number().int().positive(),
  // Optional + default false so older `tournaments.rules` JSONB rows
  // that pre-date the flag still parse cleanly. HVC_RULES sets it
  // explicitly to true.
  last_man_standing: z.boolean().default(false),
  strike_rotation: z.literal("standard"),
  extras: z.object({
    byes: z.boolean(),
    leg_byes: z.boolean(),
    overthrow_dead_on_batsman: z.boolean(),
  }),
  no_ball: z.object({ causes_free_hit: z.boolean() }),
  free_hit: z.object({ out_dismissals: z.array(wicketTypeSchema) }),
  allowed_wicket_types: z.array(wicketTypeSchema),
  categories: z.object({
    enabled: z.boolean(),
    cat1_over: z.number().int().nonnegative(),
    cat3_over: z.number().int().nonnegative(),
    cat_special_dismissals: z.enum(["first_only", "all"]),
    cat_special_strike: z.enum(["stay", "standard"]),
    cat_special_non_striker_lock: z.boolean(),
  }),
  super_over: z.object({
    enabled: z.boolean(),
    overs: z.number().int().positive(),
    max_wickets: z.number().int().positive(),
    nominate_batters: z.number().int().positive(),
    second_team_bats_first: z.boolean(),
  }),
}) satisfies z.ZodType<RuleSet, z.ZodTypeDef, unknown>;

/**
 * Parse a JSONB value from `tournaments.rules` into a typed RuleSet.
 * Falls back to HVC_RULES when the JSON is missing, empty, or invalid —
 * the engine never runs against an undefined rule set.
 */
export function getRuleSet(value: unknown): RuleSet {
  if (!value || typeof value !== "object" || Object.keys(value).length === 0) {
    return HVC_RULES;
  }
  const parsed = ruleSetSchema.safeParse(value);
  if (!parsed.success) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "tournaments.rules failed schema validation; falling back to HVC_RULES",
        parsed.error.issues,
      );
    }
    return HVC_RULES;
  }
  return parsed.data;
}
