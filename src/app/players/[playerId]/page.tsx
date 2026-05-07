import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type StatRow = {
  tournament_id: string;
  player_id: string;
  display_name: string;
  runs: number;
  balls_faced: number;
  fours: number;
  sixes: number;
  wickets: number;
  runs_conceded: number;
  legal_balls_bowled: number;
};

export default async function PlayerDetailPage(props: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await props.params;
  const supabase = await createClient();
  const ctx = await getSessionContext();

  const { data: player } = await supabase
    .from("players")
    .select("id, display_name, category, batting_style, bowling_style, phone")
    .eq("id", playerId)
    .single();
  if (!player) notFound();

  const { data: rows } = await supabase
    .from("v_player_tournament_stats" as never)
    .select("*")
    .eq("player_id", playerId);
  const stats = (rows as unknown as StatRow[] | null) ?? [];

  const tournamentIds = Array.from(new Set(stats.map((s) => s.tournament_id)));
  const { data: tournaments } = tournamentIds.length
    ? await supabase
        .from("tournaments")
        .select("id, slug, name")
        .in("id", tournamentIds)
    : { data: [] as { id: string; slug: string; name: string }[] };
  const tournamentById = new Map(
    (tournaments ?? []).map((t) => [t.id, t]),
  );

  // Career totals across all tournaments where the player has any record.
  const career = stats.reduce(
    (acc, r) => ({
      runs: acc.runs + (r.runs ?? 0),
      balls_faced: acc.balls_faced + (r.balls_faced ?? 0),
      fours: acc.fours + (r.fours ?? 0),
      sixes: acc.sixes + (r.sixes ?? 0),
      wickets: acc.wickets + (r.wickets ?? 0),
      runs_conceded: acc.runs_conceded + (r.runs_conceded ?? 0),
      legal_balls_bowled: acc.legal_balls_bowled + (r.legal_balls_bowled ?? 0),
    }),
    {
      runs: 0,
      balls_faced: 0,
      fours: 0,
      sixes: 0,
      wickets: 0,
      runs_conceded: 0,
      legal_balls_bowled: 0,
    },
  );

  const careerSR =
    career.balls_faced > 0
      ? ((career.runs / career.balls_faced) * 100).toFixed(1)
      : "—";
  const careerEcon =
    career.legal_balls_bowled > 0
      ? ((career.runs_conceded / career.legal_balls_bowled) * 6).toFixed(2)
      : "—";

  // Filter the per-tournament rows down to those with any actual numbers.
  const playedRows = stats.filter(
    (r) =>
      r.runs > 0 ||
      r.balls_faced > 0 ||
      r.wickets > 0 ||
      r.legal_balls_bowled > 0,
  );

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              <Link href="/players" className="hover:underline">
                ← Players
              </Link>
            </p>
            <h1 className="flex items-center gap-3 text-2xl font-semibold">
              {player.display_name}
              {player.category && (
                <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-xs font-mono">
                  C{player.category}
                </span>
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {[player.batting_style, player.bowling_style]
                .filter(Boolean)
                .map((s) => s!.replace(/_/g, " "))
                .join(" · ") || "—"}
            </p>
          </div>
          {ctx?.user && (
            <Link href={`/players/${player.id}/edit`}>
              <Button variant="ghost" size="sm">
                Edit
              </Button>
            </Link>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Career</CardTitle>
            <CardDescription>
              Aggregated across every HVC Scoring tournament.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Runs" value={career.runs} />
            <Stat label="Balls" value={career.balls_faced} />
            <Stat label="4s" value={career.fours} />
            <Stat label="6s" value={career.sixes} />
            <Stat label="SR" value={careerSR} />
            <Stat label="Wickets" value={career.wickets} />
            <Stat
              label="Overs bowled"
              value={`${Math.floor(career.legal_balls_bowled / 6)}.${career.legal_balls_bowled % 6}`}
            />
            <Stat label="Econ" value={careerEcon} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By tournament</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {playedRows.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">
                No matches played yet.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr className="border-y border-foreground/10">
                    <th className="px-4 py-2 text-left font-medium">
                      Tournament
                    </th>
                    <th className="px-2 py-2 text-right font-medium">R</th>
                    <th className="px-2 py-2 text-right font-medium">B</th>
                    <th className="px-2 py-2 text-right font-medium">4s</th>
                    <th className="px-2 py-2 text-right font-medium">6s</th>
                    <th className="px-2 py-2 text-right font-medium">SR</th>
                    <th className="px-4 py-2 text-right font-medium">
                      W (O / R / Econ)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {playedRows.map((r) => {
                    const t = tournamentById.get(r.tournament_id);
                    const sr =
                      r.balls_faced > 0
                        ? ((r.runs / r.balls_faced) * 100).toFixed(1)
                        : "—";
                    const overs = `${Math.floor(r.legal_balls_bowled / 6)}.${r.legal_balls_bowled % 6}`;
                    const econ =
                      r.legal_balls_bowled > 0
                        ? ((r.runs_conceded / r.legal_balls_bowled) * 6).toFixed(2)
                        : "—";
                    return (
                      <tr
                        key={r.tournament_id}
                        className="border-b border-foreground/5 last:border-b-0"
                      >
                        <td className="px-4 py-2">
                          {t ? (
                            <Link
                              href={`/tournaments/${t.slug}`}
                              className="hover:underline"
                            >
                              {t.name}
                            </Link>
                          ) : (
                            "(unknown)"
                          )}
                        </td>
                        <td className="px-2 py-2 text-right font-mono">{r.runs}</td>
                        <td className="px-2 py-2 text-right font-mono">{r.balls_faced}</td>
                        <td className="px-2 py-2 text-right font-mono">{r.fours}</td>
                        <td className="px-2 py-2 text-right font-mono">{r.sixes}</td>
                        <td className="px-2 py-2 text-right font-mono">{sr}</td>
                        <td className="px-4 py-2 text-right font-mono text-xs">
                          {r.wickets} ({overs} / {r.runs_conceded} / {econ})
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-foreground/10 bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-base">{value}</div>
    </div>
  );
}
