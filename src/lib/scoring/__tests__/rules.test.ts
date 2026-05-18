import { describe, expect, it } from "vitest";

import {
  applyRulesOverride,
  categoryForOver,
  findCategoryGaps,
  HVC_RULES,
  STANDARD_RULES,
  type RuleSet,
  type RulesOverride,
  type TeamXISummary,
} from "..";

// ---------------------------------------------------------------------------
// categoryForOver
// ---------------------------------------------------------------------------

describe("categoryForOver", () => {
  it("returns 2 when categories are disabled", () => {
    expect(categoryForOver(STANDARD_RULES, 1)).toBe(2);
    expect(categoryForOver(STANDARD_RULES, 6)).toBe(2);
  });

  it("returns the configured cat for matching overs", () => {
    // HVC default: cat1_overs=[1], cat3_overs=[2]
    expect(categoryForOver(HVC_RULES, 1)).toBe(1);
    expect(categoryForOver(HVC_RULES, 2)).toBe(3);
    expect(categoryForOver(HVC_RULES, 3)).toBe(2);
    expect(categoryForOver(HVC_RULES, 7)).toBe(2);
  });

  it("supports multi-over arrays", () => {
    const rules: RuleSet = {
      ...HVC_RULES,
      categories: {
        ...HVC_RULES.categories,
        cat1_overs: [1, 4],
        cat3_overs: [2, 5],
      },
    };
    expect(categoryForOver(rules, 1)).toBe(1);
    expect(categoryForOver(rules, 4)).toBe(1);
    expect(categoryForOver(rules, 2)).toBe(3);
    expect(categoryForOver(rules, 5)).toBe(3);
    expect(categoryForOver(rules, 3)).toBe(2);
  });

  it("returns 2 for an over outside both arrays", () => {
    const rules: RuleSet = {
      ...HVC_RULES,
      categories: {
        ...HVC_RULES.categories,
        cat1_overs: [],
        cat3_overs: [3],
      },
    };
    expect(categoryForOver(rules, 1)).toBe(2);
    expect(categoryForOver(rules, 2)).toBe(2);
    expect(categoryForOver(rules, 3)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// applyRulesOverride
// ---------------------------------------------------------------------------

describe("applyRulesOverride", () => {
  it("passes through unchanged when override is null", () => {
    expect(applyRulesOverride(HVC_RULES, null)).toBe(HVC_RULES);
  });

  it("passes through unchanged when override has no categories", () => {
    expect(applyRulesOverride(HVC_RULES, {})).toBe(HVC_RULES);
  });

  it("overrides cat1_overs only when provided", () => {
    const override: RulesOverride = {
      categories: { cat1_overs: [6] },
    };
    const out = applyRulesOverride(HVC_RULES, override);
    expect(out.categories.cat1_overs).toEqual([6]);
    // cat3_overs unchanged from base
    expect(out.categories.cat3_overs).toEqual(HVC_RULES.categories.cat3_overs);
  });

  it("overrides cat3_overs only when provided", () => {
    const override: RulesOverride = {
      categories: { cat3_overs: [] },
    };
    const out = applyRulesOverride(HVC_RULES, override);
    expect(out.categories.cat3_overs).toEqual([]);
    expect(out.categories.cat1_overs).toEqual(HVC_RULES.categories.cat1_overs);
  });

  it("overrides both when provided", () => {
    const override: RulesOverride = {
      categories: { cat1_overs: [], cat3_overs: [] },
    };
    const out = applyRulesOverride(HVC_RULES, override);
    expect(out.categories.cat1_overs).toEqual([]);
    expect(out.categories.cat3_overs).toEqual([]);
    // Engine still sees `enabled: true` from base — empty arrays mean
    // "no required cat overs", not "categories disabled".
    expect(out.categories.enabled).toBe(true);
  });

  it("ignores null entries (treats as 'not provided')", () => {
    const override: RulesOverride = {
      categories: { cat1_overs: null, cat3_overs: [4] },
    };
    const out = applyRulesOverride(HVC_RULES, override);
    expect(out.categories.cat1_overs).toEqual(HVC_RULES.categories.cat1_overs);
    expect(out.categories.cat3_overs).toEqual([4]);
  });

  it("doesn't mutate the base RuleSet", () => {
    const before = HVC_RULES.categories.cat1_overs.slice();
    applyRulesOverride(HVC_RULES, {
      categories: { cat1_overs: [99] },
    });
    expect(HVC_RULES.categories.cat1_overs).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// findCategoryGaps
// ---------------------------------------------------------------------------

describe("findCategoryGaps", () => {
  const teamA = (cats: (1 | 2 | 3)[]): TeamXISummary => ({
    team_id: "A",
    team_name: "Alpha",
    categories_in_xi: new Set(cats),
  });
  const teamB = (cats: (1 | 2 | 3)[]): TeamXISummary => ({
    team_id: "B",
    team_name: "Bravo",
    categories_in_xi: new Set(cats),
  });

  it("returns [] when categories are disabled", () => {
    expect(findCategoryGaps(STANDARD_RULES, [teamA([]), teamB([])])).toEqual(
      [],
    );
  });

  it("returns [] when both teams have all required categories", () => {
    expect(
      findCategoryGaps(HVC_RULES, [teamA([1, 2, 3]), teamB([1, 2, 3])]),
    ).toEqual([]);
  });

  it("reports a gap per (team, over, required category) triple", () => {
    // HVC: cat1_overs=[1], cat3_overs=[2]
    const gaps = findCategoryGaps(HVC_RULES, [
      teamA([2, 3]), // missing Cat 1
      teamB([1, 2]), // missing Cat 3
    ]);
    expect(gaps).toEqual([
      {
        over_number: 1,
        required_category: 1,
        team_id: "A",
        team_name: "Alpha",
      },
      {
        over_number: 2,
        required_category: 3,
        team_id: "B",
        team_name: "Bravo",
      },
    ]);
  });

  it("reports multiple overs of the same category", () => {
    const rules: RuleSet = {
      ...HVC_RULES,
      categories: {
        ...HVC_RULES.categories,
        cat1_overs: [1, 4],
        cat3_overs: [],
      },
    };
    const gaps = findCategoryGaps(rules, [
      teamA([2]), // missing Cat 1
      teamB([1, 2]), // has both
    ]);
    expect(gaps).toEqual([
      {
        over_number: 1,
        required_category: 1,
        team_id: "A",
        team_name: "Alpha",
      },
      {
        over_number: 4,
        required_category: 1,
        team_id: "A",
        team_name: "Alpha",
      },
    ]);
  });

  it("returns [] for empty cat arrays even when XIs lack categories", () => {
    const rules: RuleSet = {
      ...HVC_RULES,
      categories: {
        ...HVC_RULES.categories,
        cat1_overs: [],
        cat3_overs: [],
      },
    };
    expect(findCategoryGaps(rules, [teamA([]), teamB([])])).toEqual([]);
  });
});
