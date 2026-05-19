/**
 * Shared statistics aggregation primitives used by both the
 * tournament-scoped Stats tab and the all-time `/stats` page.
 *
 * The data path is the same in both: raw rows (either `balls` for
 * live-scored matches, or `historical_match_batting`/`bowling` for
 * cricheroes-imported S1–S6) get rolled up per `(player_id,
 * innings_id)` into `PerInnBat` / `PerInnBowl`, then accumulated into
 * per-player `BatAgg` / `BowlAgg` / `FieldAgg`, then sliced into a
 * `Leaderboards` shape by `buildLeaderboards()`. The caller decides
 * the SCOPE (one tournament's matches vs every tournament's matches).
 */

import type {
  LeaderRow,
  LeaderboardTable,
  Leaderboards,
} from "@/app/tournaments/[slug]/tournament-stats-view";

// ---------------------------------------------------------------------
// Per-innings rollup shapes — what each ball / historical row collapses
// into before player-level aggregation runs.
// ---------------------------------------------------------------------

export type PerInnBat = {
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  got_out: boolean;
  match_id: string;
};

export type PerInnBowl = {
  wickets: number;
  runs_conceded: number;
  legal_balls: number;
  dots: number;
  maidens: number;
  match_id: string;
};

// ---------------------------------------------------------------------
// Per-player aggregates.
// ---------------------------------------------------------------------

export type BatAgg = {
  player_id: string;
  name: string;
  team: string;
  cat: number | null;
  matches: number;
  innings: number;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  dismissals: number;
  /** Count of innings in which the batter scored ≥50 runs. */
  fifties: number;
  highest: number;
  /** innings_id of the best single-innings score — used to look up the
   *  opposition team for the "Highest scores" leaderboard. */
  highestInningsId: string | null;
};

export type BowlAgg = {
  player_id: string;
  name: string;
  team: string;
  cat: number | null;
  matches: number;
  innings: number;
  wickets: number;
  runs_conceded: number;
  legal_balls: number;
  maidens: number;
  dots: number;
  bestBowling: string; // e.g. "3/15"
  bestSortKey: number;
};

export type FieldAgg = {
  player_id: string;
  name: string;
  team: string;
  cat: number | null;
  matches: number;
  catches: number;
  run_outs: number;
  stumpings: number;
};

/**
 * Per-player misc stats — matches selected for + player-of-the-match
 * awards. Lives outside BatAgg / BowlAgg / FieldAgg because it
 * counts presence (match_players) and a one-per-match credit
 * (matches.player_of_match_id), neither of which derives from
 * per-innings batting / bowling rollup.
 */
export type MiscAgg = {
  player_id: string;
  name: string;
  team: string;
  cat: number | null;
  matches: number;
  pom: number;
};

export type BuildLookups = {
  batByInn: Map<string, PerInnBat>;
  bowlingTeamShortByInnings: Map<string, string>;
};

// ---------------------------------------------------------------------
// Constants — minimum sample sizes for ratio leaderboards and a safety
// ceiling on rows per leaderboard.
// ---------------------------------------------------------------------

/** Safety ceiling on rows per leaderboard. Realistic counts are far
 *  lower than this (≤ 50 qualifying players per leaderboard for a
 *  single tournament, a few hundred all-time), so this effectively
 *  means "every qualifying row" — the view paginates from there. */
export const TOP_N = 500;
export const MIN_BAT_BALLS = 12; // for batting SR
export const MIN_BAT_INNINGS_FOR_AVG = 3;
export const MIN_BOWL_BALLS = 12; // for bowling economy
export const MIN_BOWL_WICKETS_FOR_RATIO = 2; // for bowling avg + SR

// ---------------------------------------------------------------------
// Constructors + accumulators.
// ---------------------------------------------------------------------

export function newBatAgg(
  player_id: string,
  name: string,
  team: string,
  cat: number | null,
): BatAgg {
  return {
    player_id,
    name,
    team,
    cat,
    matches: 0,
    innings: 0,
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    dismissals: 0,
    fifties: 0,
    highest: 0,
    highestInningsId: null,
  };
}

export function newBowlAgg(
  player_id: string,
  name: string,
  team: string,
  cat: number | null,
): BowlAgg {
  return {
    player_id,
    name,
    team,
    cat,
    matches: 0,
    innings: 0,
    wickets: 0,
    runs_conceded: 0,
    legal_balls: 0,
    maidens: 0,
    dots: 0,
    bestBowling: "—",
    bestSortKey: -1,
  };
}

export function newFieldAgg(
  player_id: string,
  name: string,
  team: string,
  cat: number | null,
): FieldAgg {
  return {
    player_id,
    name,
    team,
    cat,
    matches: 0,
    catches: 0,
    run_outs: 0,
    stumpings: 0,
  };
}

export function accumulateBatInnings(
  agg: BatAgg,
  b: PerInnBat,
  inningsId: string,
): void {
  agg.innings += 1;
  agg.runs += b.runs;
  agg.balls += b.balls;
  agg.fours += b.fours;
  agg.sixes += b.sixes;
  if (b.got_out) agg.dismissals += 1;
  if (b.runs >= 50) agg.fifties += 1;
  if (b.runs > agg.highest) {
    agg.highest = b.runs;
    agg.highestInningsId = inningsId;
  }
}

export function accumulateBowlInnings(agg: BowlAgg, b: PerInnBowl): void {
  agg.innings += 1;
  agg.wickets += b.wickets;
  agg.runs_conceded += b.runs_conceded;
  agg.legal_balls += b.legal_balls;
  agg.maidens += b.maidens;
  agg.dots += b.dots;
  // Best bowling = max wickets; tiebreak fewer runs conceded.
  const sortKey = b.wickets * 1000 - b.runs_conceded;
  if (sortKey > agg.bestSortKey) {
    agg.bestSortKey = sortKey;
    agg.bestBowling = `${b.wickets}/${b.runs_conceded}`;
  }
}

// ---------------------------------------------------------------------
// Leaderboard builder — turns per-player aggregates into the shape the
// view component renders.
// ---------------------------------------------------------------------

export function buildLeaderboards(
  batRows: BatAgg[],
  bowlRows: BowlAgg[],
  fieldRows: FieldAgg[],
  lookups: BuildLookups,
  miscRows: MiscAgg[] = [],
): Leaderboards {
  const oversStr = (legalBalls: number) =>
    `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
  const battingAvg = (a: BatAgg) =>
    a.dismissals > 0 ? a.runs / a.dismissals : null;
  const battingSR = (a: BatAgg) => (a.balls > 0 ? (a.runs / a.balls) * 100 : 0);
  const economy = (a: BowlAgg) =>
    a.legal_balls > 0 ? (a.runs_conceded / a.legal_balls) * 6 : 0;
  const bowlingAvg = (a: BowlAgg) =>
    a.wickets > 0 ? a.runs_conceded / a.wickets : null;
  const bowlingSR = (a: BowlAgg) =>
    a.wickets > 0 ? a.legal_balls / a.wickets : null;
  const mkBatRow = (r: BatAgg, values: string[]): LeaderRow => ({
    name: r.name,
    team: r.team,
    cat: r.cat,
    values,
  });
  const mkBowlRow = (r: BowlAgg, values: string[]): LeaderRow => ({
    name: r.name,
    team: r.team,
    cat: r.cat,
    values,
  });
  const mkFieldRow = (r: FieldAgg, values: string[]): LeaderRow => ({
    name: r.name,
    team: r.team,
    cat: r.cat,
    values,
  });
  const mkMiscRow = (r: MiscAgg, values: string[]): LeaderRow => ({
    name: r.name,
    team: r.team,
    cat: r.cat,
    values,
  });

  // ----- BAT -----
  const topRuns: LeaderboardTable = {
    cols: ["R", "M", "Avg", "SR", "HS"],
    rows: [...batRows]
      .sort((a, b) => b.runs - a.runs)
      .slice(0, TOP_N)
      .map((r) => {
        const avg = battingAvg(r);
        return mkBatRow(r, [
          String(r.runs),
          String(r.matches),
          avg != null ? avg.toFixed(1) : "—",
          battingSR(r).toFixed(0),
          String(r.highest),
        ]);
      }),
  };

  const topHighestScores: LeaderboardTable = {
    cols: ["R", "B", "SR", "4s", "6s", "vs"],
    rows: [...batRows]
      .filter((r) => r.highestInningsId != null)
      .sort((a, b) =>
        b.highest === a.highest ? a.balls - b.balls : b.highest - a.highest,
      )
      .slice(0, TOP_N)
      .map((r) => {
        const best = lookups.batByInn.get(
          `${r.player_id}|${r.highestInningsId}`,
        );
        const innSR =
          best && best.balls > 0
            ? ((best.runs / best.balls) * 100).toFixed(0)
            : "—";
        const vs = lookups.bowlingTeamShortByInnings.get(r.highestInningsId!);
        return mkBatRow(r, [
          String(r.highest),
          String(best?.balls ?? 0),
          innSR,
          String(best?.fours ?? 0),
          String(best?.sixes ?? 0),
          vs ?? "?",
        ]);
      }),
  };

  const topBattingSR: LeaderboardTable = {
    cols: ["SR", "R", "B", "4s", "6s"],
    rows: [...batRows]
      .filter((r) => r.balls >= MIN_BAT_BALLS)
      .sort((a, b) => battingSR(b) - battingSR(a))
      .slice(0, TOP_N)
      .map((r) =>
        mkBatRow(r, [
          battingSR(r).toFixed(0),
          String(r.runs),
          String(r.balls),
          String(r.fours),
          String(r.sixes),
        ]),
      ),
  };

  const topBattingAvg: LeaderboardTable = {
    cols: ["Avg", "R", "Inn", "NO", "M"],
    rows: [...batRows]
      .filter(
        (r) => r.innings >= MIN_BAT_INNINGS_FOR_AVG && battingAvg(r) != null,
      )
      .sort((a, b) => (battingAvg(b) ?? 0) - (battingAvg(a) ?? 0))
      .slice(0, TOP_N)
      .map((r) =>
        mkBatRow(r, [
          (battingAvg(r) ?? 0).toFixed(2),
          String(r.runs),
          String(r.innings),
          String(r.innings - r.dismissals),
          String(r.matches),
        ]),
      ),
  };

  const topFours: LeaderboardTable = {
    cols: ["4s", "R", "Inn", "M"],
    rows: [...batRows]
      .filter((r) => r.fours > 0)
      .sort((a, b) => b.fours - a.fours)
      .slice(0, TOP_N)
      .map((r) =>
        mkBatRow(r, [
          String(r.fours),
          String(r.runs),
          String(r.innings),
          String(r.matches),
        ]),
      ),
  };

  const topSixes: LeaderboardTable = {
    cols: ["6s", "R", "Inn", "M"],
    rows: [...batRows]
      .filter((r) => r.sixes > 0)
      .sort((a, b) => b.sixes - a.sixes)
      .slice(0, TOP_N)
      .map((r) =>
        mkBatRow(r, [
          String(r.sixes),
          String(r.runs),
          String(r.innings),
          String(r.matches),
        ]),
      ),
  };

  const topFifties: LeaderboardTable = {
    cols: ["50s", "Inn", "M", "HS"],
    rows: [...batRows]
      .filter((r) => r.fifties > 0)
      .sort((a, b) =>
        b.fifties === a.fifties ? b.runs - a.runs : b.fifties - a.fifties,
      )
      .slice(0, TOP_N)
      .map((r) =>
        mkBatRow(r, [
          String(r.fifties),
          String(r.innings),
          String(r.matches),
          String(r.highest),
        ]),
      ),
  };

  // ----- BOWL -----
  const topWickets: LeaderboardTable = {
    cols: ["W", "M", "Ov", "Econ", "BBI"],
    rows: [...bowlRows]
      .sort((a, b) =>
        b.wickets === a.wickets
          ? economy(a) - economy(b)
          : b.wickets - a.wickets,
      )
      .slice(0, TOP_N)
      .map((r) =>
        mkBowlRow(r, [
          String(r.wickets),
          String(r.matches),
          oversStr(r.legal_balls),
          economy(r).toFixed(2),
          r.bestBowling,
        ]),
      ),
  };

  const topBowlingAvg: LeaderboardTable = {
    cols: ["Avg", "W", "R", "Ov"],
    rows: [...bowlRows]
      .filter(
        (r) =>
          r.wickets >= MIN_BOWL_WICKETS_FOR_RATIO && bowlingAvg(r) != null,
      )
      .sort((a, b) => (bowlingAvg(a) ?? 0) - (bowlingAvg(b) ?? 0))
      .slice(0, TOP_N)
      .map((r) =>
        mkBowlRow(r, [
          (bowlingAvg(r) ?? 0).toFixed(2),
          String(r.wickets),
          String(r.runs_conceded),
          oversStr(r.legal_balls),
        ]),
      ),
  };

  const topEconomy: LeaderboardTable = {
    cols: ["Econ", "W", "Ov", "R"],
    rows: [...bowlRows]
      .filter((r) => r.legal_balls >= MIN_BOWL_BALLS)
      .sort((a, b) => economy(a) - economy(b))
      .slice(0, TOP_N)
      .map((r) =>
        mkBowlRow(r, [
          economy(r).toFixed(2),
          String(r.wickets),
          oversStr(r.legal_balls),
          String(r.runs_conceded),
        ]),
      ),
  };

  const topBowlingSR: LeaderboardTable = {
    cols: ["SR", "W", "B", "Ov"],
    rows: [...bowlRows]
      .filter(
        (r) =>
          r.wickets >= MIN_BOWL_WICKETS_FOR_RATIO && bowlingSR(r) != null,
      )
      .sort((a, b) => (bowlingSR(a) ?? 0) - (bowlingSR(b) ?? 0))
      .slice(0, TOP_N)
      .map((r) =>
        mkBowlRow(r, [
          (bowlingSR(r) ?? 0).toFixed(1),
          String(r.wickets),
          String(r.legal_balls),
          oversStr(r.legal_balls),
        ]),
      ),
  };

  const topBBI: LeaderboardTable = {
    cols: ["BBI", "Ov", "Econ"],
    rows: [...bowlRows]
      .filter((r) => r.bestSortKey > 0)
      .sort((a, b) => b.bestSortKey - a.bestSortKey)
      .slice(0, TOP_N)
      .map((r) =>
        mkBowlRow(r, [
          r.bestBowling,
          oversStr(r.legal_balls),
          economy(r).toFixed(2),
        ]),
      ),
  };

  const topMaidens: LeaderboardTable = {
    cols: ["Md", "W", "R", "Ov"],
    rows: [...bowlRows]
      .filter((r) => r.maidens > 0)
      .sort((a, b) =>
        b.maidens === a.maidens
          ? b.wickets - a.wickets
          : b.maidens - a.maidens,
      )
      .slice(0, TOP_N)
      .map((r) =>
        mkBowlRow(r, [
          String(r.maidens),
          String(r.wickets),
          String(r.runs_conceded),
          oversStr(r.legal_balls),
        ]),
      ),
  };

  const topDots: LeaderboardTable = {
    cols: ["Dot", "W", "R", "Ov"],
    rows: [...bowlRows]
      .filter((r) => r.dots > 0)
      .sort((a, b) => b.dots - a.dots)
      .slice(0, TOP_N)
      .map((r) =>
        mkBowlRow(r, [
          String(r.dots),
          String(r.wickets),
          String(r.runs_conceded),
          oversStr(r.legal_balls),
        ]),
      ),
  };

  // ----- FIELD (live only — fieldRows is empty for historical) -----
  const hasFielding = fieldRows.length > 0;
  const topCatches: LeaderboardTable | undefined = hasFielding
    ? {
        cols: ["C", "M"],
        rows: [...fieldRows]
          .filter((r) => r.catches > 0)
          .sort((a, b) => b.catches - a.catches)
          .slice(0, TOP_N)
          .map((r) =>
            mkFieldRow(r, [String(r.catches), String(r.matches)]),
          ),
      }
    : undefined;
  const topRunOuts: LeaderboardTable | undefined = hasFielding
    ? {
        cols: ["RO", "M"],
        rows: [...fieldRows]
          .filter((r) => r.run_outs > 0)
          .sort((a, b) => b.run_outs - a.run_outs)
          .slice(0, TOP_N)
          .map((r) =>
            mkFieldRow(r, [String(r.run_outs), String(r.matches)]),
          ),
      }
    : undefined;
  const topStumpings: LeaderboardTable | undefined = hasFielding
    ? {
        cols: ["St", "M"],
        rows: [...fieldRows]
          .filter((r) => r.stumpings > 0)
          .sort((a, b) => b.stumpings - a.stumpings)
          .slice(0, TOP_N)
          .map((r) =>
            mkFieldRow(r, [String(r.stumpings), String(r.matches)]),
          ),
      }
    : undefined;

  // ----- MISC (matches played + Player-of-the-Match awards) -----
  const hasMisc = miscRows.length > 0;
  const topMatches: LeaderboardTable | undefined = hasMisc
    ? {
        cols: ["M"],
        rows: [...miscRows]
          .filter((r) => r.matches > 0)
          .sort((a, b) =>
            b.matches === a.matches ? b.pom - a.pom : b.matches - a.matches,
          )
          .slice(0, TOP_N)
          .map((r) => mkMiscRow(r, [String(r.matches)])),
      }
    : undefined;
  const topPOM: LeaderboardTable | undefined = hasMisc
    ? {
        cols: ["POM", "M"],
        rows: [...miscRows]
          .filter((r) => r.pom > 0)
          .sort((a, b) =>
            b.pom === a.pom ? b.matches - a.matches : b.pom - a.pom,
          )
          .slice(0, TOP_N)
          .map((r) => mkMiscRow(r, [String(r.pom), String(r.matches)])),
      }
    : undefined;

  return {
    topRuns,
    topHighestScores,
    topBattingSR,
    topBattingAvg,
    topFours,
    topSixes,
    topFifties,
    topWickets,
    topBowlingAvg,
    topEconomy,
    topBowlingSR,
    topBBI,
    topMaidens,
    topDots,
    topCatches,
    topRunOuts,
    topStumpings,
    topMatches,
    topPOM,
  };
}
