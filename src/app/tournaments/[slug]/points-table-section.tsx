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

/**
 * Server component for the league standings, sourced from the
 * `v_points_table` view. NRR is not yet implemented (HANDOFF §10);
 * we sort by points → tie-breaker on points-per-match → team name.
 */
export async function PointsTableSection({
  tournamentId,
  teams,
}: {
  tournamentId: string;
  teams: { id: string; name: string; short_name: string }[];
}) {
  const supabase = await createClient();
  // The view isn't in the typed Database stub yet — query via cast.
  const { data, error } = await supabase
    .from("v_points_table" as never)
    .select("*")
    .eq("tournament_id", tournamentId);

  // No completed matches → no rows. Suppress the section to avoid a
  // confusing all-zeros table.
  if (error || !data || (data as unknown[]).length === 0) {
    return null;
  }

  const rows = data as unknown as PointsRow[];
  const teamById = new Map(teams.map((t) => [t.id, t]));

  // Standings rows are one per team that has played at least one match.
  // Add any teams that haven't played at all so the table is complete.
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
    const aPpm = a.played > 0 ? a.points / a.played : 0;
    const bPpm = b.played > 0 ? b.points / b.played : 0;
    if (bPpm !== aPpm) return bPpm - aPpm;
    return (
      (teamById.get(a.team_id)?.name ?? "") <
      (teamById.get(b.team_id)?.name ?? "")
        ? -1
        : 1
    );
  });

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Standings</h2>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription className="text-xs">
            2 points per win, 1 for a tie or no-result. NRR tie-break is
            on the way; for now ties are broken by points-per-match.
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
                <th className="px-4 py-2 text-right font-medium">Pts</th>
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
                    <td className="px-4 py-2 text-right font-mono font-semibold">
                      {r.points}
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
