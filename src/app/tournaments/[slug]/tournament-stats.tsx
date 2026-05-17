import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import type { BallRow } from "@/lib/supabase/row-types";

import {
  TournamentStatsView,
  type LeaderRow,
  type LeaderboardTable,
  type Leaderboards,
} from "./tournament-stats-view";

/**
 * Tournament-wide leaderboards: top batters, top bowlers, most
 * boundaries, best strike rates / economies. Aggregated across every
 * non-voided ball in every completed/live match of the tournament.
 *
 * Single bulk fetch — balls in this tournament + the players + teams
 * lookup — then in-memory rollup. With a 20-match tournament that's
 * ~12k ball rows; fine for a Server Component render.
 */
export async function TournamentStats({
  tournamentId,
}: {
  tournamentId: string;
}) {
  const supabase = await createClient();

  // 1. Matches in this tournament (only ones that have started — no
  //    point pulling rows for scheduled fixtures).
  const { data: matches } = await supabase
    .from("matches")
    .select("id, status")
    .eq("tournament_id", tournamentId)
    .in("status", ["live", "innings_break", "completed"]);

  if (!matches || matches.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Stats unlock once a match has started.
        </CardContent>
      </Card>
    );
  }

  const matchIds = matches.map((m) => m.id);

  // 2. All innings → for the match_id → team mapping that drives the
  //    "X bats for HH" lookup later. We also use it to constrain the
  //    balls query. `innings_number` is read by the historical fallback
  //    to translate per-innings rows from historical_match_batting/
  //    bowling back to a real innings_id.
  const { data: innings } = await supabase
    .from("innings")
    .select("id, match_id, innings_number, batting_team_id, bowling_team_id")
    .in("match_id", matchIds);

  if (!innings || innings.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No balls bowled yet.
        </CardContent>
      </Card>
    );
  }

  const inningsIds = innings.map((i) => i.id);
  const inningsById = new Map(innings.map((i) => [i.id, i]));

  // 3. All balls (non-voided) across this tournament. Selecting only
  // the columns this leaderboard actually reads — was `select("*")`,
  // which pulls all ~22 columns of balls. fielder_id is included so
  // the fielding leaderboards (catches / run-outs / stumpings) can
  // credit the right player.
  const { data: ballsRows } = await supabase
    .from("balls")
    .select(
      "innings_id, batter_id, non_striker_id, bowler_id, fielder_id, player_out_id, runs_off_bat, extras, extra_type, is_wicket, wicket_type",
    )
    .in("innings_id", inningsIds)
    .eq("is_voided", false)
    .order("scored_at", { ascending: true });
  const allBalls = (ballsRows ?? []) as BallRow[];

  if (allBalls.length === 0) {
    // Historical (cricheroes-imported) seasons have no ball-by-ball
    // data; per-innings aggregates live in historical_match_batting /
    // historical_match_bowling instead. Compute the same leaderboards
    // from those rows so the Stats tab works for S1–S6.
    return loadHistoricalStats(supabase, matchIds, innings);
  }

  // 4. All player IDs we touched + the team they bat for, derived from
  //    innings.batting_team_id (the team they bat for is whatever team
  //    they were a batter for first).
  const playerToTeam = new Map<string, string>();
  for (const b of allBalls) {
    if (!playerToTeam.has(b.batter_id)) {
      const inn = inningsById.get(b.innings_id);
      if (inn) playerToTeam.set(b.batter_id, inn.batting_team_id);
    }
    if (!playerToTeam.has(b.non_striker_id)) {
      const inn = inningsById.get(b.innings_id);
      if (inn) playerToTeam.set(b.non_striker_id, inn.batting_team_id);
    }
    if (!playerToTeam.has(b.bowler_id)) {
      const inn = inningsById.get(b.innings_id);
      if (inn) playerToTeam.set(b.bowler_id, inn.bowling_team_id);
    }
  }

  const playerIds = [...new Set(playerToTeam.keys())];
  const teamIds = [...new Set(playerToTeam.values())];

  const [{ data: players }, { data: teams }] = await Promise.all([
    supabase
      .from("players")
      .select("id, display_name, category")
      .in("id", playerIds),
    supabase
      .from("teams")
      .select("id, short_name")
      .in("id", teamIds),
  ]);
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));
  const teamShortById = new Map(
    (teams ?? []).map((t) => [t.id, t.short_name]),
  );

  // 5. Per-innings rollup. Cricbuzz-style tournament stats need
  //    matches/innings played + averages + best single-innings figures,
  //    so we aggregate by (player_id, innings_id) first, then summarize
  //    across innings per player. Map keys are `${player}|${innings}`.
  type PerInnBat = {
    runs: number;
    balls: number;
    fours: number;
    sixes: number;
    got_out: boolean;
    match_id: string;
  };
  type PerInnBowl = {
    wickets: number;
    runs_conceded: number;
    legal_balls: number;
    dots: number;
    maidens: number;
    match_id: string;
  };
  const batByInn = new Map<string, PerInnBat>();
  const bowlByInn = new Map<string, PerInnBowl>();

  for (const b of allBalls) {
    const inn = inningsById.get(b.innings_id);
    if (!inn) continue;

    // Batter
    const batKey = `${b.batter_id}|${b.innings_id}`;
    let bat = batByInn.get(batKey);
    if (!bat) {
      bat = {
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        got_out: false,
        match_id: inn.match_id,
      };
      batByInn.set(batKey, bat);
    }
    // Mirror of computeBatterStats single-ball loop.
    if (b.extra_type !== "wide") {
      bat.runs += b.runs_off_bat;
      if (b.extra_type !== "no_ball") bat.balls += 1;
      if (b.extra_type !== "no_ball" && b.extra_type !== "bye") {
        if (b.runs_off_bat === 4) bat.fours += 1;
        if (b.runs_off_bat === 6) bat.sixes += 1;
      }
    }
    if (b.is_wicket && b.player_out_id === b.batter_id) bat.got_out = true;

    // Bowler
    const bowlKey = `${b.bowler_id}|${b.innings_id}`;
    let bowl = bowlByInn.get(bowlKey);
    if (!bowl) {
      bowl = {
        wickets: 0,
        runs_conceded: 0,
        legal_balls: 0,
        dots: 0,
        maidens: 0,
        match_id: inn.match_id,
      };
      bowlByInn.set(bowlKey, bowl);
    }
    if (b.extra_type !== "wide" && b.extra_type !== "no_ball") {
      bowl.legal_balls += 1;
    }
    // Runs conceded: bat runs (always) + wides + no-balls. Byes don't
    // count against the bowler.
    bowl.runs_conceded += b.runs_off_bat;
    if (b.extra_type === "wide" || b.extra_type === "no_ball") {
      bowl.runs_conceded += b.extras;
    }
    if (b.is_wicket && b.wicket_type !== "run_out") bowl.wickets += 1;
    if (
      b.extra_type !== "wide" &&
      b.extra_type !== "no_ball" &&
      b.runs_off_bat === 0 &&
      b.extras === 0
    ) {
      bowl.dots += 1;
    }
  }

  // 6. Player-level aggregates.
  const batPerPlayer = new Map<string, BatAgg>();
  const bowlPerPlayer = new Map<string, BowlAgg>();

  for (const [key, b] of batByInn) {
    const [pid, inningsId] = key.split("|");
    const p = playerById.get(pid);
    if (!p) continue;
    if (b.balls === 0 && b.runs === 0) continue;
    let agg = batPerPlayer.get(pid);
    if (!agg) {
      const teamId = playerToTeam.get(pid)!;
      agg = newBatAgg(pid, p.display_name, teamShortById.get(teamId) ?? "?", p.category);
      batPerPlayer.set(pid, agg);
    }
    accumulateBatInnings(agg, b, inningsId);
  }

  for (const [key, b] of bowlByInn) {
    const [pid] = key.split("|");
    const p = playerById.get(pid);
    if (!p) continue;
    if (b.legal_balls === 0) continue;
    let agg = bowlPerPlayer.get(pid);
    if (!agg) {
      const teamId = playerToTeam.get(pid)!;
      agg = newBowlAgg(pid, p.display_name, teamShortById.get(teamId) ?? "?", p.category);
      bowlPerPlayer.set(pid, agg);
    }
    accumulateBowlInnings(agg, b);
  }

  // Fielding aggregation — credits the fielder on each catch / run-out
  // / stumping. Historical seasons skip this entirely (no fielder data
  // in cricheroes commentary).
  const fieldPerPlayer = new Map<string, FieldAgg>();
  const fielderMatches = new Map<string, Set<string>>();
  for (const b of allBalls) {
    if (!b.is_wicket) continue;
    const inn = inningsById.get(b.innings_id);
    if (!inn) continue;
    let creditedTo: string | null = null;
    if (b.wicket_type === "caught" && b.fielder_id) creditedTo = b.fielder_id;
    else if (b.wicket_type === "caught_and_bowled") creditedTo = b.bowler_id;
    else if (b.wicket_type === "run_out" && b.fielder_id) creditedTo = b.fielder_id;
    else if (b.wicket_type === "stumped" && b.fielder_id) creditedTo = b.fielder_id;
    if (!creditedTo) continue;
    const p = playerById.get(creditedTo);
    if (!p) continue;
    let agg = fieldPerPlayer.get(creditedTo);
    if (!agg) {
      // Fielders aren't necessarily batters/bowlers, so fall back to
      // their innings.bowling_team_id for the team label.
      const teamId =
        playerToTeam.get(creditedTo) ?? inn.bowling_team_id;
      agg = newFieldAgg(creditedTo, p.display_name, teamShortById.get(teamId) ?? "?", p.category);
      fieldPerPlayer.set(creditedTo, agg);
    }
    if (b.wicket_type === "caught" || b.wicket_type === "caught_and_bowled")
      agg.catches += 1;
    else if (b.wicket_type === "run_out") agg.run_outs += 1;
    else if (b.wicket_type === "stumped") agg.stumpings += 1;
    let s = fielderMatches.get(creditedTo);
    if (!s) { s = new Set(); fielderMatches.set(creditedTo, s); }
    s.add(inn.match_id);
  }
  for (const [pid, s] of fielderMatches) {
    const agg = fieldPerPlayer.get(pid);
    if (agg) agg.matches = s.size;
  }

  // Distinct-matches counts.
  const batterMatches = new Map<string, Set<string>>();
  for (const [key, b] of batByInn) {
    const [pid] = key.split("|");
    let s = batterMatches.get(pid);
    if (!s) {
      s = new Set();
      batterMatches.set(pid, s);
    }
    s.add(b.match_id);
  }
  for (const [pid, set] of batterMatches) {
    const agg = batPerPlayer.get(pid);
    if (agg) agg.matches = set.size;
  }

  const bowlerMatches = new Map<string, Set<string>>();
  for (const [key, b] of bowlByInn) {
    const [pid] = key.split("|");
    let s = bowlerMatches.get(pid);
    if (!s) {
      s = new Set();
      bowlerMatches.set(pid, s);
    }
    s.add(b.match_id);
  }
  for (const [pid, set] of bowlerMatches) {
    const agg = bowlPerPlayer.get(pid);
    if (agg) agg.matches = set.size;
  }

  const batRows = [...batPerPlayer.values()];
  const bowlRows = [...bowlPerPlayer.values()];
  const fieldRows = [...fieldPerPlayer.values()];

  // Bowling-team short per innings → used by the Highest scores card
  // to show who the batter scored against ("vs").
  const bowlingTeamShortByInnings = new Map<string, string>();
  for (const inn of innings) {
    bowlingTeamShortByInnings.set(
      inn.id,
      teamShortById.get(inn.bowling_team_id) ?? "?",
    );
  }

  // 7. Ranked leaderboards — computed once for the full pool and once
  //    per HVC category so the client can flip between them instantly.
  //    Fielding included here (live-scored seasons only).
  const lookups = { batByInn, bowlingTeamShortByInnings };
  const all = buildLeaderboards(batRows, bowlRows, fieldRows, lookups);
  const cat1 = buildLeaderboards(
    batRows.filter((r) => r.cat === 1),
    bowlRows.filter((r) => r.cat === 1),
    fieldRows.filter((r) => r.cat === 1),
    lookups,
  );
  const cat2 = buildLeaderboards(
    batRows.filter((r) => r.cat === 2),
    bowlRows.filter((r) => r.cat === 2),
    fieldRows.filter((r) => r.cat === 2),
    lookups,
  );
  const cat3 = buildLeaderboards(
    batRows.filter((r) => r.cat === 3),
    bowlRows.filter((r) => r.cat === 3),
    fieldRows.filter((r) => r.cat === 3),
    lookups,
  );

  return (
    <TournamentStatsView all={all} cat1={cat1} cat2={cat2} cat3={cat3} />
  );
}

// ---------------------------------------------------------------------
// Shared aggregate types + helpers, used by both the balls-based path
// above and the historical fallback below.
// ---------------------------------------------------------------------

type BatAgg = {
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

type BowlAgg = {
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

type FieldAgg = {
  player_id: string;
  name: string;
  team: string;
  cat: number | null;
  matches: number;
  catches: number;
  run_outs: number;
  stumpings: number;
};

type PerInnBat = {
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  got_out: boolean;
  match_id: string;
};
type PerInnBowl = {
  wickets: number;
  runs_conceded: number;
  legal_balls: number;
  dots: number;
  maidens: number;
  match_id: string;
};

function newBatAgg(
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

function newBowlAgg(
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

function newFieldAgg(
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

function accumulateBatInnings(
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

function accumulateBowlInnings(agg: BowlAgg, b: PerInnBowl): void {
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

type BuildLookups = {
  batByInn: Map<string, PerInnBat>;
  bowlingTeamShortByInnings: Map<string, string>;
};

/** Top-N for every leaderboard. Kept small so the page stays scannable. */
const TOP_N = 5;
/** Minimum sample sizes for ratio-based leaderboards. */
const MIN_BAT_BALLS = 12; // for SR
const MIN_BAT_INNINGS_FOR_AVG = 3;
const MIN_BOWL_BALLS = 12; // for econ
const MIN_BOWL_WICKETS_FOR_RATIO = 2; // for bowling avg + SR

function buildLeaderboards(
  batRows: BatAgg[],
  bowlRows: BowlAgg[],
  fieldRows: FieldAgg[],
  lookups: BuildLookups,
): Leaderboards {
  const oversStr = (legalBalls: number) =>
    `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
  const battingAvg = (a: BatAgg) => (a.dismissals > 0 ? a.runs / a.dismissals : null);
  const battingSR = (a: BatAgg) => (a.balls > 0 ? (a.runs / a.balls) * 100 : 0);
  const economy = (a: BowlAgg) =>
    a.legal_balls > 0 ? (a.runs_conceded / a.legal_balls) * 6 : 0;
  const bowlingAvg = (a: BowlAgg) => (a.wickets > 0 ? a.runs_conceded / a.wickets : null);
  const bowlingSR = (a: BowlAgg) => (a.wickets > 0 ? a.legal_balls / a.wickets : null);
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

  // Highest single-innings scores: rank by best knock. Look up the
  // best innings' details (balls / SR / opposition) so the row's `vs`
  // makes sense — that's the bit the per-innings rollup would
  // otherwise drop on the way to the player-level aggregate.
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
        (r) =>
          r.innings >= MIN_BAT_INNINGS_FOR_AVG && battingAvg(r) != null,
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
        mkBowlRow(r, [r.bestBowling, oversStr(r.legal_balls), economy(r).toFixed(2)]),
      ),
  };

  const topMaidens: LeaderboardTable = {
    cols: ["Md", "W", "R", "Ov"],
    rows: [...bowlRows]
      .filter((r) => r.maidens > 0)
      .sort((a, b) =>
        b.maidens === a.maidens ? b.wickets - a.wickets : b.maidens - a.maidens,
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
  };
}

/**
 * Stats path for cricheroes-imported tournaments (S1–S6). Same
 * leaderboards as the balls-based path, but the per-innings rollup is
 * sourced from historical_match_batting/bowling rather than the empty
 * balls table.
 *
 * Caveats vs the balls path:
 *   - SR/econ thresholds use the same ≥12 ball minimums, but the data
 *     is rounded by cricheroes to whole balls/overs.
 *   - "Highest scores vs <X>" gets the opposition team from the OTHER
 *     innings of the same match — i.e. innings_number 3-N for N=1, 2.
 *   - Best-bowling (BBI) uses per-innings wickets/runs straight from
 *     historical_match_bowling so the tie-break (fewer runs conceded)
 *     still works.
 */
async function loadHistoricalStats(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchIds: string[],
  innings: Array<{
    id: string;
    match_id: string;
    innings_number: number;
    batting_team_id: string;
    bowling_team_id: string;
  }>,
) {
  const [{ data: hbRows }, { data: hwRows }] = await Promise.all([
    supabase
      .from("historical_match_batting")
      .select(
        "match_id, innings_number, batting_team_id, player_id, runs, balls_faced, fours, sixes, is_out",
      )
      .in("match_id", matchIds),
    supabase
      .from("historical_match_bowling")
      .select(
        "match_id, innings_number, bowling_team_id, player_id, wickets, runs, dots, maidens, overs",
      )
      .in("match_id", matchIds),
  ]);

  const hbBat = hbRows ?? [];
  const hbBowl = hwRows ?? [];
  if (hbBat.length === 0 && hbBowl.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No stats for this tournament.
        </CardContent>
      </Card>
    );
  }

  // (match_id, innings_number) → innings.id, so we can reuse the same
  // batByInn lookup shape the balls-based builder expects.
  const inningsIdByKey = new Map<string, string>();
  for (const inn of innings) {
    inningsIdByKey.set(`${inn.match_id}|${inn.innings_number}`, inn.id);
  }

  const batByInn = new Map<string, PerInnBat>();
  const bowlByInn = new Map<string, PerInnBowl>();
  // player_id → team_id for the "X bats for HH" label. Cricheroes data
  // is one team per player per tournament, so first sighting wins.
  const playerToTeam = new Map<string, string>();

  for (const r of hbBat) {
    if (!r.player_id) continue;
    const inningsId = inningsIdByKey.get(`${r.match_id}|${r.innings_number}`);
    if (!inningsId) continue;
    if (!playerToTeam.has(r.player_id))
      playerToTeam.set(r.player_id, r.batting_team_id);
    batByInn.set(`${r.player_id}|${inningsId}`, {
      runs: r.runs,
      balls: r.balls_faced,
      fours: r.fours,
      sixes: r.sixes,
      got_out: r.is_out,
      match_id: r.match_id,
    });
  }
  for (const r of hbBowl) {
    if (!r.player_id) continue;
    const inningsId = inningsIdByKey.get(`${r.match_id}|${r.innings_number}`);
    if (!inningsId) continue;
    if (!playerToTeam.has(r.player_id))
      playerToTeam.set(r.player_id, r.bowling_team_id);
    // overs like "1.5" → 1*6 + 5 = 11 legal balls.
    const overs = String(r.overs ?? "0");
    let legalBalls = 0;
    if (overs.includes(".")) {
      const [full, partial] = overs.split(".", 2);
      legalBalls = parseInt(full, 10) * 6 + parseInt(partial, 10);
    } else {
      legalBalls = parseInt(overs, 10) * 6;
    }
    if (!Number.isFinite(legalBalls)) legalBalls = 0;
    bowlByInn.set(`${r.player_id}|${inningsId}`, {
      wickets: r.wickets,
      runs_conceded: r.runs,
      legal_balls: legalBalls,
      dots: r.dots,
      maidens: r.maidens,
      match_id: r.match_id,
    });
  }

  // Player + team metadata.
  const playerIds = [...playerToTeam.keys()];
  const teamIds = [...new Set(playerToTeam.values())];
  const [{ data: players }, { data: teams }] = await Promise.all([
    supabase
      .from("players")
      .select("id, display_name, category")
      .in("id", playerIds),
    supabase.from("teams").select("id, short_name").in("id", teamIds),
  ]);
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));
  const teamShortById = new Map(
    (teams ?? []).map((t) => [t.id, t.short_name]),
  );

  // Per-player aggregates — reuse the shared helpers so historical and
  // balls-based paths produce identical Leaderboard shapes.
  const batPerPlayer = new Map<string, BatAgg>();
  const bowlPerPlayer = new Map<string, BowlAgg>();

  for (const [key, b] of batByInn) {
    const [pid] = key.split("|");
    const inningsId = key.slice(pid.length + 1);
    const p = playerById.get(pid);
    if (!p) continue;
    if (b.balls === 0 && b.runs === 0) continue;
    let agg = batPerPlayer.get(pid);
    if (!agg) {
      const teamId = playerToTeam.get(pid)!;
      agg = newBatAgg(pid, p.display_name, teamShortById.get(teamId) ?? "?", p.category);
      batPerPlayer.set(pid, agg);
    }
    accumulateBatInnings(agg, b, inningsId);
  }
  for (const [key, b] of bowlByInn) {
    const [pid] = key.split("|");
    const p = playerById.get(pid);
    if (!p) continue;
    if (b.legal_balls === 0 && b.wickets === 0) continue;
    let agg = bowlPerPlayer.get(pid);
    if (!agg) {
      const teamId = playerToTeam.get(pid)!;
      agg = newBowlAgg(pid, p.display_name, teamShortById.get(teamId) ?? "?", p.category);
      bowlPerPlayer.set(pid, agg);
    }
    accumulateBowlInnings(agg, b);
  }

  // Distinct-match counts.
  const batterMatches = new Map<string, Set<string>>();
  for (const [key, b] of batByInn) {
    const pid = key.split("|", 1)[0];
    let s = batterMatches.get(pid);
    if (!s) { s = new Set(); batterMatches.set(pid, s); }
    s.add(b.match_id);
  }
  for (const [pid, s] of batterMatches) {
    const agg = batPerPlayer.get(pid);
    if (agg) agg.matches = s.size;
  }
  const bowlerMatches = new Map<string, Set<string>>();
  for (const [key, b] of bowlByInn) {
    const pid = key.split("|", 1)[0];
    let s = bowlerMatches.get(pid);
    if (!s) { s = new Set(); bowlerMatches.set(pid, s); }
    s.add(b.match_id);
  }
  for (const [pid, s] of bowlerMatches) {
    const agg = bowlPerPlayer.get(pid);
    if (agg) agg.matches = s.size;
  }

  // Per-innings bowling-team short name, for the "vs" column on the
  // Highest scores leaderboard.
  const bowlingTeamShortByInnings = new Map<string, string>();
  for (const inn of innings) {
    bowlingTeamShortByInnings.set(
      inn.id,
      teamShortById.get(inn.bowling_team_id) ?? "?",
    );
  }

  const batRowsAll = [...batPerPlayer.values()];
  const bowlRowsAll = [...bowlPerPlayer.values()];
  const lookups = { batByInn, bowlingTeamShortByInnings };
  // Fielding stays empty for historical seasons — cricheroes commentary
  // doesn't expose per-ball fielder credits.
  const fieldRowsAll: FieldAgg[] = [];
  const all = buildLeaderboards(batRowsAll, bowlRowsAll, fieldRowsAll, lookups);
  const cat1 = buildLeaderboards(
    batRowsAll.filter((r) => r.cat === 1),
    bowlRowsAll.filter((r) => r.cat === 1),
    fieldRowsAll,
    lookups,
  );
  const cat2 = buildLeaderboards(
    batRowsAll.filter((r) => r.cat === 2),
    bowlRowsAll.filter((r) => r.cat === 2),
    fieldRowsAll,
    lookups,
  );
  const cat3 = buildLeaderboards(
    batRowsAll.filter((r) => r.cat === 3),
    bowlRowsAll.filter((r) => r.cat === 3),
    fieldRowsAll,
    lookups,
  );

  return (
    <TournamentStatsView all={all} cat1={cat1} cat2={cat2} cat3={cat3} />
  );
}
