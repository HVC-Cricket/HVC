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
  //    balls query.
  const { data: innings } = await supabase
    .from("innings")
    .select("id, match_id, batting_team_id, bowling_team_id")
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

  // 3. All balls (non-voided) across this tournament.
  const { data: ballsRows } = await supabase
    .from("balls")
    .select("*")
    .in("innings_id", inningsIds)
    .eq("is_voided", false)
    .order("scored_at", { ascending: true });
  const allBalls = (ballsRows ?? []) as BallRow[];

  if (allBalls.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No balls bowled yet.
        </CardContent>
      </Card>
    );
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
    highest: number;
    /** innings_id of the best single-innings score — used to look up
     *  the opposition team for the "Highest scores" leaderboard. */
    highestInningsId: string | null;
    strikeRate: number;
    average: number | null;
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
    economy: number;
    bestBowling: string; // e.g. "3/15"
    bestSortKey: number;
  };

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
      agg = {
        player_id: pid,
        name: p.display_name,
        team: teamShortById.get(teamId) ?? "?",
        cat: p.category,
        matches: 0,
        innings: 0,
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        dismissals: 0,
        highest: 0,
        highestInningsId: null,
        strikeRate: 0,
        average: null,
      };
      batPerPlayer.set(pid, agg);
    }
    agg.innings += 1;
    agg.runs += b.runs;
    agg.balls += b.balls;
    agg.fours += b.fours;
    agg.sixes += b.sixes;
    if (b.got_out) agg.dismissals += 1;
    if (b.runs > agg.highest) {
      agg.highest = b.runs;
      agg.highestInningsId = inningsId;
    }
  }

  for (const [key, b] of bowlByInn) {
    const [pid] = key.split("|");
    const p = playerById.get(pid);
    if (!p) continue;
    if (b.legal_balls === 0) continue;
    let agg = bowlPerPlayer.get(pid);
    if (!agg) {
      const teamId = playerToTeam.get(pid)!;
      agg = {
        player_id: pid,
        name: p.display_name,
        team: teamShortById.get(teamId) ?? "?",
        cat: p.category,
        matches: 0,
        innings: 0,
        wickets: 0,
        runs_conceded: 0,
        legal_balls: 0,
        economy: 0,
        bestBowling: "—",
        bestSortKey: -1,
      };
      bowlPerPlayer.set(pid, agg);
    }
    agg.innings += 1;
    agg.wickets += b.wickets;
    agg.runs_conceded += b.runs_conceded;
    agg.legal_balls += b.legal_balls;
    // Best bowling = max wickets; tiebreak fewer runs conceded.
    // Sort key: wickets * 1000 - runs_conceded.
    const sortKey = b.wickets * 1000 - b.runs_conceded;
    if (sortKey > agg.bestSortKey) {
      agg.bestSortKey = sortKey;
      agg.bestBowling = `${b.wickets}/${b.runs_conceded}`;
    }
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

  // Derived metrics.
  const batRows: BatAgg[] = [...batPerPlayer.values()].map((a) => ({
    ...a,
    strikeRate: a.balls > 0 ? (a.runs / a.balls) * 100 : 0,
    average: a.dismissals > 0 ? a.runs / a.dismissals : null,
  }));
  const bowlRows: BowlAgg[] = [...bowlPerPlayer.values()].map((a) => ({
    ...a,
    economy: a.legal_balls > 0 ? (a.runs_conceded / a.legal_balls) * 6 : 0,
  }));

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
  const lookups = { batByInn, bowlingTeamShortByInnings };
  const all = buildLeaderboards(batRows, bowlRows, lookups);
  const cat1 = buildLeaderboards(
    batRows.filter((r) => r.cat === 1),
    bowlRows.filter((r) => r.cat === 1),
    lookups,
  );
  const cat2 = buildLeaderboards(
    batRows.filter((r) => r.cat === 2),
    bowlRows.filter((r) => r.cat === 2),
    lookups,
  );
  const cat3 = buildLeaderboards(
    batRows.filter((r) => r.cat === 3),
    bowlRows.filter((r) => r.cat === 3),
    lookups,
  );

  return (
    <TournamentStatsView all={all} cat1={cat1} cat2={cat2} cat3={cat3} />
  );
}

type BatLite = {
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
  highest: number;
  highestInningsId: string | null;
  strikeRate: number;
  average: number | null;
};
type BowlLite = {
  player_id: string;
  name: string;
  team: string;
  cat: number | null;
  matches: number;
  innings: number;
  wickets: number;
  runs_conceded: number;
  legal_balls: number;
  economy: number;
  bestBowling: string;
};

type BuildLookups = {
  batByInn: Map<
    string,
    {
      runs: number;
      balls: number;
      fours: number;
      sixes: number;
      got_out: boolean;
      match_id: string;
    }
  >;
  bowlingTeamShortByInnings: Map<string, string>;
};

function buildLeaderboards(
  batRows: BatLite[],
  bowlRows: BowlLite[],
  lookups: BuildLookups,
): Leaderboards {
  const oversStr = (legalBalls: number) =>
    `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`;
  const mkBatRow = (r: BatLite, values: string[]): LeaderRow => ({
    name: r.name,
    team: r.team,
    cat: r.cat,
    values,
  });
  const mkBowlRow = (r: BowlLite, values: string[]): LeaderRow => ({
    name: r.name,
    team: r.team,
    cat: r.cat,
    values,
  });

  const topRuns: LeaderboardTable = {
    cols: ["R", "M", "Avg", "SR", "HS"],
    rows: [...batRows]
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 5)
      .map((r) =>
        mkBatRow(r, [
          String(r.runs),
          String(r.matches),
          r.average != null ? r.average.toFixed(1) : "—",
          r.strikeRate.toFixed(0),
          String(r.highest),
        ]),
      ),
  };

  const topWickets: LeaderboardTable = {
    cols: ["W", "M", "Ov", "Econ", "BBI"],
    rows: [...bowlRows]
      .sort((a, b) =>
        b.wickets === a.wickets
          ? a.economy - b.economy
          : b.wickets - a.wickets,
      )
      .slice(0, 5)
      .map((r) =>
        mkBowlRow(r, [
          String(r.wickets),
          String(r.matches),
          oversStr(r.legal_balls),
          r.economy.toFixed(2),
          r.bestBowling,
        ]),
      ),
  };

  // Highest single-innings scores: rank players by their best knock.
  // Look up the best innings' details (balls / SR / opposition) so the
  // row's `vs` makes sense — that's the bit the per-innings rollup
  // would otherwise drop on the way to the player-level aggregate.
  const topHighestScores: LeaderboardTable = {
    cols: ["R", "B", "SR", "4s", "6s", "vs"],
    rows: [...batRows]
      .filter((r) => r.highestInningsId != null)
      .sort((a, b) =>
        b.highest === a.highest ? a.balls - b.balls : b.highest - a.highest,
      )
      .slice(0, 5)
      .map((r) => {
        const best = lookups.batByInn.get(
          `${r.player_id}|${r.highestInningsId}`,
        );
        const innSR =
          best && best.balls > 0
            ? ((best.runs / best.balls) * 100).toFixed(0)
            : "—";
        const vs = lookups.bowlingTeamShortByInnings.get(
          r.highestInningsId!,
        );
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

  const topBoundaries: LeaderboardTable = {
    cols: ["Tot", "4s", "6s", "R"],
    rows: [...batRows]
      .map((r) => ({ r, total: r.fours + r.sixes }))
      .filter((x) => x.total > 0)
      .sort((a, b) =>
        b.total === a.total ? b.r.sixes - a.r.sixes : b.total - a.total,
      )
      .slice(0, 5)
      .map(({ r, total }) =>
        mkBatRow(r, [
          String(total),
          String(r.fours),
          String(r.sixes),
          String(r.runs),
        ]),
      ),
  };

  // Min sample sizes set with HVC's special-over rule in mind — Cat 1/3
  // specialists only get one over per match, so 12 balls across the
  // tournament is a reasonable bar for both SR and economy.
  const topSR: LeaderboardTable = {
    cols: ["SR", "R", "B", "4s", "6s"],
    rows: [...batRows]
      .filter((r) => r.balls >= 12)
      .sort((a, b) => b.strikeRate - a.strikeRate)
      .slice(0, 5)
      .map((r) =>
        mkBatRow(r, [
          r.strikeRate.toFixed(0),
          String(r.runs),
          String(r.balls),
          String(r.fours),
          String(r.sixes),
        ]),
      ),
  };

  const topEcon: LeaderboardTable = {
    cols: ["Econ", "W", "Ov", "R"],
    rows: [...bowlRows]
      .filter((r) => r.legal_balls >= 12)
      .sort((a, b) => a.economy - b.economy)
      .slice(0, 5)
      .map((r) =>
        mkBowlRow(r, [
          r.economy.toFixed(2),
          String(r.wickets),
          oversStr(r.legal_balls),
          String(r.runs_conceded),
        ]),
      ),
  };

  return {
    topRuns,
    topWickets,
    topHighestScores,
    topBoundaries,
    topSR,
    topEcon,
  };
}
