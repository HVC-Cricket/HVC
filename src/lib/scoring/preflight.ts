import type { RuleSet } from "./types";

export type TeamXISummary = {
  team_id: string;
  team_name: string;
  /** Categories represented in the playing XI (is_substitute = false).
   *  Anything else is irrelevant for the coverage check. */
  categories_in_xi: Set<1 | 2 | 3>;
};

export type CategoryGap = {
  over_number: number;
  required_category: 1 | 3;
  team_id: string;
  team_name: string;
};

/**
 * Pure-function pre-flight check: given the effective rule set and a
 * team-XI summary for both sides, list every (over, team, category)
 * tuple where the team's playing XI can't fulfil a required category.
 * Empty array = match is good to start (modulo other gates).
 *
 * Called from the match page CTA logic + the score-page pre-match
 * panel. Keeps the rule-driven gate identical on both surfaces.
 */
export function findCategoryGaps(
  rules: RuleSet,
  teams: [TeamXISummary, TeamXISummary],
): CategoryGap[] {
  if (!rules.categories.enabled) return [];
  const gaps: CategoryGap[] = [];
  const check = (over: number, required: 1 | 3) => {
    for (const team of teams) {
      if (!team.categories_in_xi.has(required)) {
        gaps.push({
          over_number: over,
          required_category: required,
          team_id: team.team_id,
          team_name: team.team_name,
        });
      }
    }
  };
  for (const over of rules.categories.cat1_overs) check(over, 1);
  for (const over of rules.categories.cat3_overs) check(over, 3);
  return gaps;
}
