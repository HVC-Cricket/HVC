/**
 * Compute league standings + NRR for a tournament's group stage.
 *
 * Pulls W/L/Pts from `v_points_table` (already filtered to `stage='group'`
 * by migration 20260516100000) and computes NRR per ICC convention:
 *   For each completed group match where the team played:
 *     scored  = innings.total_runs when batting
 *     faced   = legal_balls/6 (decimal) — but if the team was bowled out,
 *               use the full overs_per_innings quota instead
 *     same flipped for conceded / bowled when fielding
 *   NRR = (Σ scored / Σ faced) − (Σ conceded / Σ bowled)
 *
 * Super-over innings (innings_number > 2) and no-result / abandoned
 * matches are excluded. Returned rows are sorted: Pts desc, NRR desc.
 */

import { createClient } from "@/lib/supabase/server";

export type StandingsRow = {
  team_id: string;
  played: number;
  won: number;
  lost: number;
  tied: number;
  no_results: number;
  points: number;
  nrr: number;
};

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function computeStandings(
  supabase: SupabaseServerClient,
  tournamentId: string,
): Promise<StandingsRow[]> {
  const [pointsRes, matchesRes, inningsRes] = await Promise.all([
    supabase
      .from("v_points_table" as never)
      .select("team_id, played, won, lost, tied, no_results, points")
      .eq("tournament_id", tournamentId),
    supabase
      .from("matches")
      .select("id, status, result_type, players_per_side, overs_per_innings")
      .eq("tournament_id", tournamentId)
      .eq("status", "completed")
      .eq("stage", "group"),
    supabase
      .from("innings")
      .select(
        // Spell out the FK — `matches` has two relationships back to
        // `innings` (innings_match_id_fkey + matches_current_innings_fk)
        // and the ambiguous form 400s with PGRST201. Same fix as the
        // homepage match-card embed.
        "match_id, innings_number, batting_team_id, bowling_team_id, total_runs, total_wickets, total_legal_balls, matches!innings_match_id_fkey!inner(tournament_id, status, stage)",
      )
      .eq("matches.tournament_id", tournamentId)
      .eq("matches.status", "completed")
      .eq("matches.stage", "group")
      .lte("innings_number", 2),
  ]);

  type PointsRow = Omit<StandingsRow, "nrr">;
  const points = (pointsRes.data ?? []) as unknown as PointsRow[];

  type MatchForNRR = {
    id: string;
    status: string;
    result_type: string | null;
    players_per_side: number;
    overs_per_innings: number;
  };
  const decidedMatches = ((matchesRes.data ?? []) as MatchForNRR[]).filter(
    (m) => m.result_type !== "no_result" && m.result_type !== "abandoned",
  );
  const matchById = new Map(decidedMatches.map((m) => [m.id, m]));
  const decidedIds = new Set(decidedMatches.map((m) => m.id));

  type InningsForNRR = {
    match_id: string;
    innings_number: number;
    batting_team_id: string;
    bowling_team_id: string;
    total_runs: number;
    total_wickets: number;
    total_legal_balls: number;
  };
  const innings = ((inningsRes.data ?? []) as unknown as InningsForNRR[]).filter(
    (i) => decidedIds.has(i.match_id),
  );

  type Acc = {
    scored: number;
    faced_balls: number;
    conceded: number;
    bowled_balls: number;
  };
  const acc = new Map<string, Acc>();
  const bump = (id: string) => {
    let a = acc.get(id);
    if (!a) {
      a = { scored: 0, faced_balls: 0, conceded: 0, bowled_balls: 0 };
      acc.set(id, a);
    }
    return a;
  };

  for (const i of innings) {
    const m = matchById.get(i.match_id);
    if (!m) continue;
    // Bowled-out side gets credited with the full overs quota for NRR
    // purposes (ICC convention); otherwise count their actual balls.
    const maxWickets = m.players_per_side - 1;
    const fullQuotaBalls = m.overs_per_innings * 6;
    const wasAllOut = i.total_wickets >= maxWickets;
    const inningsBalls = wasAllOut ? fullQuotaBalls : i.total_legal_balls;
    const bat = bump(i.batting_team_id);
    bat.scored += i.total_runs;
    bat.faced_balls += inningsBalls;
    const bowl = bump(i.bowling_team_id);
    bowl.conceded += i.total_runs;
    bowl.bowled_balls += inningsBalls;
  }

  const nrrByTeam = new Map<string, number>();
  for (const [teamId, a] of acc) {
    const facedOvers = a.faced_balls / 6;
    const bowledOvers = a.bowled_balls / 6;
    const rs = facedOvers > 0 ? a.scored / facedOvers : 0;
    const rc = bowledOvers > 0 ? a.conceded / bowledOvers : 0;
    nrrByTeam.set(teamId, rs - rc);
  }

  const rows: StandingsRow[] = points.map((p) => ({
    ...p,
    nrr: nrrByTeam.get(p.team_id) ?? 0,
  }));

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.nrr !== a.nrr) return b.nrr - a.nrr;
    // Final tiebreaker — team_id alphabetical — so the standings order
    // is fully deterministic when teams are tied on points + NRR.
    // Matters for the playoff auto-scheduler (it picks standings[0..3]
    // by index, so a flaky tie-break could send the wrong team into
    // Q1 / Eliminator).
    return a.team_id.localeCompare(b.team_id);
  });

  return rows;
}
