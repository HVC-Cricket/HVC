import { Card, CardContent } from "@/components/ui/card";
import {
  accumulateBatInnings,
  accumulateBowlInnings,
  buildLeaderboards,
  newBatAgg,
  newBowlAgg,
  newFieldAgg,
  type BatAgg,
  type BowlAgg,
  type FieldAgg,
  type PerInnBat,
  type PerInnBowl,
} from "@/lib/stats/aggregate";
import { createClient } from "@/lib/supabase/server";
import type { BallRow } from "@/lib/supabase/row-types";

import { TournamentStatsView } from "@/app/tournaments/[slug]/tournament-stats-view";

/**
 * Supabase REST caps each request at the project's `db.max_rows`
 * (default 1000); `.limit(N)` in the JS client doesn't lift that
 * ceiling — the server truncates. For tables that can exceed 1000
 * rows in production (balls, historical_match_batting/bowling),
 * page through with `.range()` and stop when a partial page lands.
 */
const PAGE_SIZE = 1000;

async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data } = await query(from, from + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

/**
 * All-time HVC leaderboards — same Bat / Bowl / Field tables as the
 * per-tournament Stats tab, but aggregated across every match in every
 * tournament. New tournaments scored in-app contribute their `balls`
 * rows; historical seasons (S1–S6, cricheroes-imported) contribute
 * their `historical_match_batting`/`bowling` rows. Both sources merge
 * by `player_id` so a player who batted in S5 (historical) and S7
 * (new) shows one combined row.
 *
 * Team column shows the player's MOST RECENT team (balls are walked
 * newest-first so first-seen wins). Players who only have historical
 * data show whatever team they played for in S1–S6.
 */
export async function CareerStats() {
  const supabase = await createClient();

  // 1. Every match that has started — schedule-only fixtures contribute
  //    nothing to stats.
  const { data: matches } = await supabase
    .from("matches")
    .select("id, status")
    .in("status", ["live", "innings_break", "completed"]);

  if (!matches || matches.length === 0) {
    return (
      <EmptyState text="No matches scored yet — leaderboards unlock once balls start landing." />
    );
  }

  const matchIds = matches.map((m) => m.id);

  // 2. All innings for the eligible matches — needed both for the
  //    balls-path innings_id → team mapping and for the historical
  //    path's (match_id, innings_number) → innings_id translation.
  const { data: innings } = await supabase
    .from("innings")
    .select("id, match_id, innings_number, batting_team_id, bowling_team_id")
    .in("match_id", matchIds)
    .limit(50000);

  if (!innings || innings.length === 0) {
    return <EmptyState text="No innings recorded yet." />;
  }

  const inningsById = new Map(innings.map((i) => [i.id, i]));
  const inningsIds = innings.map((i) => i.id);

  // 3. Pull both data sources in parallel: live-scored balls + the
  //    two historical per-match aggregate tables. Each is paginated
  //    so the server-side 1000-row cap doesn't silently truncate —
  //    historical_match_batting alone has 1600+ rows on prod and the
  //    naive single-request approach was dropping ~600 of them.
  const [allBalls, hbBat, hbBowl] = await Promise.all([
    fetchAllRows<BallRow>((from, to) =>
      supabase
        .from("balls")
        .select(
          "innings_id, batter_id, non_striker_id, bowler_id, fielder_id, player_out_id, runs_off_bat, extras, extra_type, is_wicket, wicket_type",
        )
        .in("innings_id", inningsIds)
        .eq("is_voided", false)
        // Newest first so the playerToTeam map's "first-seen wins"
        // logic resolves to the player's most recent team rather
        // than their oldest historical one.
        .order("scored_at", { ascending: false, nullsFirst: false })
        .range(from, to) as PromiseLike<{ data: BallRow[] | null }>,
    ),
    fetchAllRows<{
      match_id: string;
      innings_number: number;
      batting_team_id: string;
      player_id: string | null;
      runs: number;
      balls_faced: number;
      fours: number;
      sixes: number;
      is_out: boolean;
    }>((from, to) =>
      supabase
        .from("historical_match_batting")
        .select(
          "match_id, innings_number, batting_team_id, player_id, runs, balls_faced, fours, sixes, is_out",
        )
        .in("match_id", matchIds)
        .range(from, to),
    ),
    fetchAllRows<{
      match_id: string;
      innings_number: number;
      bowling_team_id: string;
      player_id: string | null;
      wickets: number;
      runs: number;
      dots: number;
      maidens: number;
      overs: number | string | null;
    }>((from, to) =>
      supabase
        .from("historical_match_bowling")
        .select(
          "match_id, innings_number, bowling_team_id, player_id, wickets, runs, dots, maidens, overs",
        )
        .in("match_id", matchIds)
        .range(from, to),
    ),
  ]);

  if (allBalls.length === 0 && hbBat.length === 0 && hbBowl.length === 0) {
    return <EmptyState text="No stats yet — scoring hasn't started." />;
  }

  // 4. Per-innings rollup from BOTH sources. Same shape (PerInnBat /
  //    PerInnBowl) regardless of source, so downstream code is
  //    source-agnostic.
  const batByInn = new Map<string, PerInnBat>();
  const bowlByInn = new Map<string, PerInnBowl>();
  const playerToTeam = new Map<string, string>();

  // ---- Balls path ----
  for (const b of allBalls) {
    const inn = inningsById.get(b.innings_id);
    if (!inn) continue;

    // First-seen team wins (we ordered balls newest-first → newest team).
    if (!playerToTeam.has(b.batter_id)) {
      playerToTeam.set(b.batter_id, inn.batting_team_id);
    }
    if (!playerToTeam.has(b.non_striker_id)) {
      playerToTeam.set(b.non_striker_id, inn.batting_team_id);
    }
    if (!playerToTeam.has(b.bowler_id)) {
      playerToTeam.set(b.bowler_id, inn.bowling_team_id);
    }

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
    if (b.extra_type !== "wide") {
      bat.runs += b.runs_off_bat;
      if (b.extra_type !== "no_ball") bat.balls += 1;
      if (b.extra_type !== "no_ball" && b.extra_type !== "bye") {
        if (b.runs_off_bat === 4) bat.fours += 1;
        if (b.runs_off_bat === 6) bat.sixes += 1;
      }
    }
    if (b.is_wicket && b.player_out_id === b.batter_id) bat.got_out = true;

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

  // ---- Historical path ----
  const inningsIdByKey = new Map<string, string>();
  for (const inn of innings) {
    inningsIdByKey.set(`${inn.match_id}|${inn.innings_number}`, inn.id);
  }
  for (const r of hbBat) {
    if (!r.player_id) continue;
    const inningsId = inningsIdByKey.get(`${r.match_id}|${r.innings_number}`);
    if (!inningsId) continue;
    // Don't override a team already set by the balls path — that one
    // came from a more recent match. Only fill the gap.
    if (!playerToTeam.has(r.player_id)) {
      playerToTeam.set(r.player_id, r.batting_team_id);
    }
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
    if (!playerToTeam.has(r.player_id)) {
      playerToTeam.set(r.player_id, r.bowling_team_id);
    }
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

  // 5. Player + team metadata. Team IDs must include every innings'
  //    both teams (not just the ones reachable via playerToTeam) —
  //    historical S1–S6 rows sometimes carry player_id = null for a
  //    bowler whose CricHeroes name never got linked to our players
  //    table. Without this widening, the "vs" column on the Highest
  //    Scores leaderboard renders "?" for any innings whose bowling
  //    XI was entirely null-player-id.
  const playerIds = [...playerToTeam.keys()];
  const teamIdSet = new Set<string>(playerToTeam.values());
  for (const inn of innings) {
    teamIdSet.add(inn.batting_team_id);
    teamIdSet.add(inn.bowling_team_id);
  }
  const teamIds = [...teamIdSet];
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

  // 6. Per-player aggregates (shared helpers).
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
      agg = newBatAgg(
        pid,
        p.display_name,
        teamShortById.get(teamId) ?? "?",
        p.category,
      );
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
      agg = newBowlAgg(
        pid,
        p.display_name,
        teamShortById.get(teamId) ?? "?",
        p.category,
      );
      bowlPerPlayer.set(pid, agg);
    }
    accumulateBowlInnings(agg, b);
  }

  // Fielding (live-scored balls only — historical commentary has no
  // per-ball fielder credits).
  const fieldPerPlayer = new Map<string, FieldAgg>();
  const fielderMatches = new Map<string, Set<string>>();
  for (const b of allBalls) {
    if (!b.is_wicket) continue;
    const inn = inningsById.get(b.innings_id);
    if (!inn) continue;
    let creditedTo: string | null = null;
    if (b.wicket_type === "caught" && b.fielder_id) creditedTo = b.fielder_id;
    else if (b.wicket_type === "caught_and_bowled") creditedTo = b.bowler_id;
    else if (b.wicket_type === "run_out" && b.fielder_id)
      creditedTo = b.fielder_id;
    else if (b.wicket_type === "stumped" && b.fielder_id)
      creditedTo = b.fielder_id;
    if (!creditedTo) continue;
    const p = playerById.get(creditedTo);
    if (!p) continue;
    let agg = fieldPerPlayer.get(creditedTo);
    if (!agg) {
      const teamId = playerToTeam.get(creditedTo) ?? inn.bowling_team_id;
      agg = newFieldAgg(
        creditedTo,
        p.display_name,
        teamShortById.get(teamId) ?? "?",
        p.category,
      );
      fieldPerPlayer.set(creditedTo, agg);
    }
    if (b.wicket_type === "caught" || b.wicket_type === "caught_and_bowled") {
      agg.catches += 1;
    } else if (b.wicket_type === "run_out") agg.run_outs += 1;
    else if (b.wicket_type === "stumped") agg.stumpings += 1;
    let s = fielderMatches.get(creditedTo);
    if (!s) {
      s = new Set();
      fielderMatches.set(creditedTo, s);
    }
    s.add(inn.match_id);
  }
  for (const [pid, s] of fielderMatches) {
    const agg = fieldPerPlayer.get(pid);
    if (agg) agg.matches = s.size;
  }

  // Distinct-match counts (batters + bowlers).
  const batterMatches = new Map<string, Set<string>>();
  for (const [key, b] of batByInn) {
    const pid = key.split("|", 1)[0];
    let s = batterMatches.get(pid);
    if (!s) {
      s = new Set();
      batterMatches.set(pid, s);
    }
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
    if (!s) {
      s = new Set();
      bowlerMatches.set(pid, s);
    }
    s.add(b.match_id);
  }
  for (const [pid, s] of bowlerMatches) {
    const agg = bowlPerPlayer.get(pid);
    if (agg) agg.matches = s.size;
  }

  const batRows = [...batPerPlayer.values()];
  const bowlRows = [...bowlPerPlayer.values()];
  const fieldRows = [...fieldPerPlayer.values()];

  // Per-innings bowling-team short — drives the "vs X" column on the
  // "Highest scores" leaderboard.
  const bowlingTeamShortByInnings = new Map<string, string>();
  for (const inn of innings) {
    bowlingTeamShortByInnings.set(
      inn.id,
      teamShortById.get(inn.bowling_team_id) ?? "?",
    );
  }

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

function EmptyState({ text }: { text: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-12 text-center text-sm text-muted-foreground">
        {text}
      </CardContent>
    </Card>
  );
}
