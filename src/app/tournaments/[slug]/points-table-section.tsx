import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

type PointsRow = {
  tournament_id: string;
  team_id: string;
  played: number;
  won: number;
  lost: number;
  tied: number;
  no_results: number;
  points: number;
};

type InningsForNRR = {
  match_id: string;
  innings_number: number;
  batting_team_id: string;
  bowling_team_id: string;
  total_runs: number;
  total_wickets: number;
  total_legal_balls: number;
};

type MatchForNRR = {
  id: string;
  status: string;
  result_type: string | null;
  players_per_side: number;
  overs_per_innings: number;
};

/**
 * Server component for the league standings, sourced from the
 * `v_points_table` view + an in-app NRR computation.
 *
 * NRR formula (per ICC convention):
 *   For each completed match where the team played:
 *     scored  = innings.total_runs when batting
 *     faced   = legal_balls/6 (decimal) — but if the team was bowled
 *               out, use the full overs_per_innings quota instead.
 *     same for conceded / bowled when fielding.
 *   NRR = (Σ scored / Σ faced) − (Σ conceded / Σ bowled).
 *
 * Super-over innings (innings_number > 2) are excluded.
 * No-result / abandoned matches are excluded.
 */
export async function PointsTableSection({
  tournamentId,
  teams,
}: {
  tournamentId: string;
  teams: { id: string; name: string; short_name: string }[];
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_points_table" as never)
    .select("*")
    .eq("tournament_id", tournamentId);

  // Only hide the section when there's an outright fetch error or no
  // teams have been added yet. An upcoming tournament with teams but
  // no matches played is still useful — the filler below renders every
  // team at 0/0/0 so the spectator can see who's competing.
  if (error || teams.length === 0) {
    return null;
  }

  const rows = (data ?? []) as unknown as PointsRow[];
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // ---- Compute NRR per team ----
  // matches + innings can be fetched in parallel by filtering innings
  // through the tournament via an `innings!inner(matches!inner(...))`
  // chain — saves the matches → matchIds → innings waterfall.
  const [matchesRes, inningsRes] = await Promise.all([
    supabase
      .from("matches")
      .select("id, status, result_type, players_per_side, overs_per_innings")
      .eq("tournament_id", tournamentId)
      .eq("status", "completed"),
    supabase
      .from("innings")
      .select(
        // `matches` has two FKs back to `innings` (innings_match_id_fkey
        // + matches_current_innings_fk), so the embed has to spell out
        // which one — otherwise PostgREST 400s with PGRST201 and the
        // NRR column silently renders as '—' for every team.
        "match_id, innings_number, batting_team_id, bowling_team_id, total_runs, total_wickets, total_legal_balls, matches!innings_match_id_fkey!inner(tournament_id, status)",
      )
      .eq("matches.tournament_id", tournamentId)
      .eq("matches.status", "completed")
      .lte("innings_number", 2),
  ]);
  const matches = matchesRes.data;
  const decidedMatches = (matches ?? []).filter(
    (m) =>
      m.result_type !== "no_result" && m.result_type !== "abandoned",
  ) as MatchForNRR[];

  const nrrByTeam = new Map<string, number>();
  if (decidedMatches.length > 0) {
    const decidedIds = new Set(decidedMatches.map((m) => m.id));
    // The single inner-joined fetch above pulled innings for every
    // completed match; filter to just the decided ones (excluding
    // no_result / abandoned) since NRR is only computed for those.
    const inningsRows = (inningsRes.data ?? []).filter((i) =>
      decidedIds.has(i.match_id),
    );
    const innings = (inningsRows ?? []) as InningsForNRR[];

    const matchById = new Map(decidedMatches.map((m) => [m.id, m]));
    type Acc = {
      scored: number;
      faced_balls: number; // count balls; convert to overs at the end
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
      const maxWickets = m.players_per_side - 1;
      const fullQuotaBalls = m.overs_per_innings * 6;
      const wasAllOut = i.total_wickets >= maxWickets;
      const inningsBalls = wasAllOut ? fullQuotaBalls : i.total_legal_balls;

      // Batting side: scored runs across `inningsBalls`.
      const bat = bump(i.batting_team_id);
      bat.scored += i.total_runs;
      bat.faced_balls += inningsBalls;

      // Bowling side: conceded those runs across the same span.
      const bowl = bump(i.bowling_team_id);
      bowl.conceded += i.total_runs;
      bowl.bowled_balls += inningsBalls;
    }

    for (const [teamId, a] of acc) {
      const facedOvers = a.faced_balls / 6;
      const bowledOvers = a.bowled_balls / 6;
      const rs = facedOvers > 0 ? a.scored / facedOvers : 0;
      const rc = bowledOvers > 0 ? a.conceded / bowledOvers : 0;
      nrrByTeam.set(teamId, rs - rc);
    }
  }

  // Standings: one row per team that has played at least one match. Add
  // any teams that haven't played so the table is complete.
  const playedIds = new Set(rows.map((r) => r.team_id));
  const filler: PointsRow[] = teams
    .filter((t) => !playedIds.has(t.id))
    .map((t) => ({
      tournament_id: tournamentId,
      team_id: t.id,
      played: 0,
      won: 0,
      lost: 0,
      tied: 0,
      no_results: 0,
      points: 0,
    }));

  const all = [...rows, ...filler];
  all.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    const aNrr = nrrByTeam.get(a.team_id) ?? 0;
    const bNrr = nrrByTeam.get(b.team_id) ?? 0;
    if (bNrr !== aNrr) return bNrr - aNrr;
    return (
      (teamById.get(a.team_id)?.name ?? "") <
      (teamById.get(b.team_id)?.name ?? "")
        ? -1
        : 1
    );
  });

  const fmtNrr = (n: number | undefined) =>
    n === undefined ? "—" : (n >= 0 ? "+" : "") + n.toFixed(3);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Standings</h2>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="text-xs">
            2 points per win, 1 for a tie or no-result. Tied on points →
            higher net run rate ranks first. Bowled-out innings are
            treated as if they batted their full quota of overs.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {/* Cricbuzz-style standings. # column + short-name pill
              dropped to keep the whole row (Team / P / W / L / T /
              Pts / NRR) within ~360 px. Body sits at text-sm (was
              text-xs) per request to make the numbers more readable;
              Pts bumped one step further to text-base so the most-
              important column is unmistakable at a glance. */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase text-muted-foreground">
                <tr className="border-b border-foreground/10">
                  <th className="px-2 py-2 text-left font-medium">Team</th>
                  <th className="w-0 whitespace-nowrap px-1.5 py-2 text-right font-medium">P</th>
                  <th className="w-0 whitespace-nowrap px-1.5 py-2 text-right font-medium">W</th>
                  <th className="w-0 whitespace-nowrap px-1.5 py-2 text-right font-medium">L</th>
                  <th className="w-0 whitespace-nowrap px-1.5 py-2 text-right font-medium">T</th>
                  <th className="w-0 whitespace-nowrap px-1.5 py-2 text-right font-medium">Pts</th>
                  <th className="w-0 whitespace-nowrap px-1.5 py-2 text-right font-medium">NRR</th>
                </tr>
              </thead>
              <tbody>
                {all.map((r) => {
                  const team = teamById.get(r.team_id);
                  return (
                    <tr
                      key={r.team_id}
                      className="border-b border-foreground/5 last:border-b-0"
                    >
                      <td className="max-w-0 px-2 py-2.5 font-medium">
                        <span className="block truncate capitalize">
                          {team?.name ?? "(unknown)"}
                        </span>
                      </td>
                      <td className="w-0 whitespace-nowrap px-1.5 py-2.5 text-right font-mono tabular-nums">
                        {r.played}
                      </td>
                      <td className="w-0 whitespace-nowrap px-1.5 py-2.5 text-right font-mono tabular-nums">
                        {r.won}
                      </td>
                      <td className="w-0 whitespace-nowrap px-1.5 py-2.5 text-right font-mono tabular-nums">
                        {r.lost}
                      </td>
                      <td className="w-0 whitespace-nowrap px-1.5 py-2.5 text-right font-mono tabular-nums">
                        {r.tied}
                      </td>
                      <td className="w-0 whitespace-nowrap px-1.5 py-2.5 text-right font-mono text-base font-semibold tabular-nums">
                        {r.points}
                      </td>
                      <td className="w-0 whitespace-nowrap px-1.5 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                        {fmtNrr(nrrByTeam.get(r.team_id))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
