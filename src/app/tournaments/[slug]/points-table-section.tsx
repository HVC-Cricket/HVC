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

  if (error || !data || (data as unknown[]).length === 0) {
    return null;
  }

  const rows = data as unknown as PointsRow[];
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // ---- Compute NRR per team ----
  const { data: matches } = await supabase
    .from("matches")
    .select("id, status, result_type, players_per_side, overs_per_innings")
    .eq("tournament_id", tournamentId)
    .eq("status", "completed");
  const decidedMatches = (matches ?? []).filter(
    (m) =>
      m.result_type !== "no_result" && m.result_type !== "abandoned",
  ) as MatchForNRR[];

  const nrrByTeam = new Map<string, number>();
  if (decidedMatches.length > 0) {
    const matchIds = decidedMatches.map((m) => m.id);
    const { data: inningsRows } = await supabase
      .from("innings")
      .select(
        "match_id, innings_number, batting_team_id, bowling_team_id, total_runs, total_wickets, total_legal_balls",
      )
      .in("match_id", matchIds)
      .lte("innings_number", 2);
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
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground">
              <tr className="border-b border-foreground/10">
                <th className="px-4 py-2 text-left font-medium">#</th>
                <th className="px-4 py-2 text-left font-medium">Team</th>
                <th className="px-2 py-2 text-right font-medium">P</th>
                <th className="px-2 py-2 text-right font-medium">W</th>
                <th className="px-2 py-2 text-right font-medium">L</th>
                <th className="px-2 py-2 text-right font-medium">T</th>
                <th className="px-2 py-2 text-right font-medium">NR</th>
                <th className="px-2 py-2 text-right font-medium">Pts</th>
                <th className="px-4 py-2 text-right font-medium">NRR</th>
              </tr>
            </thead>
            <tbody>
              {all.map((r, idx) => {
                const team = teamById.get(r.team_id);
                return (
                  <tr
                    key={r.team_id}
                    className="border-b border-foreground/5 last:border-b-0"
                  >
                    <td className="px-4 py-2 text-muted-foreground">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-2 font-medium">
                      {team?.name ?? "(unknown)"}
                      {team?.short_name && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {team.short_name}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">{r.played}</td>
                    <td className="px-2 py-2 text-right font-mono">{r.won}</td>
                    <td className="px-2 py-2 text-right font-mono">{r.lost}</td>
                    <td className="px-2 py-2 text-right font-mono">{r.tied}</td>
                    <td className="px-2 py-2 text-right font-mono">
                      {r.no_results}
                    </td>
                    <td className="px-2 py-2 text-right font-mono font-semibold">
                      {r.points}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-muted-foreground">
                      {fmtNrr(nrrByTeam.get(r.team_id))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </section>
  );
}
