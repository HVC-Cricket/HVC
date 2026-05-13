import Link from "next/link";

import { AutoRefresh } from "@/app/matches/[matchId]/auto-refresh";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type LiveMatchView = {
  id: string;
  status: "live" | "innings_break";
  tournament: { slug: string; name: string };
  teamA: { short_name: string };
  teamB: { short_name: string };
  /** Current innings score; null if no innings has been created yet. */
  score: {
    battingShort: string;
    runs: number;
    wickets: number;
    overs: string;
    target: number | null;
  } | null;
};

export default async function Home() {
  const supabase = await createClient();

  // Anything in flight: a scorer is mid-innings or between innings.
  const { data: liveRows } = await supabase
    .from("matches")
    .select(
      "id, tournament_id, team_a_id, team_b_id, status, current_innings_id, started_at",
    )
    .in("status", ["live", "innings_break"])
    .order("started_at", { ascending: false });
  const matches = liveRows ?? [];

  let liveMatches: LiveMatchView[] = [];
  if (matches.length > 0) {
    const tournamentIds = [...new Set(matches.map((m) => m.tournament_id))];
    const teamIds = [
      ...new Set(matches.flatMap((m) => [m.team_a_id, m.team_b_id])),
    ];
    const inningsIds = matches
      .map((m) => m.current_innings_id)
      .filter((id): id is string => !!id);

    const [tournaments, teams, innings] = await Promise.all([
      supabase
        .from("tournaments")
        .select("id, slug, name")
        .in("id", tournamentIds),
      supabase
        .from("teams")
        .select("id, short_name, name")
        .in("id", teamIds),
      inningsIds.length
        ? supabase
            .from("innings")
            .select(
              "id, batting_team_id, total_runs, total_wickets, total_legal_balls, target",
            )
            .in("id", inningsIds)
        : Promise.resolve({ data: [] as Array<{
            id: string;
            batting_team_id: string;
            total_runs: number;
            total_wickets: number;
            total_legal_balls: number;
            target: number | null;
          }> }),
    ]);

    const tournamentById = new Map(
      (tournaments.data ?? []).map((t) => [t.id, t]),
    );
    const teamById = new Map((teams.data ?? []).map((t) => [t.id, t]));
    const inningsById = new Map(
      (innings.data ?? []).map((i) => [i.id, i]),
    );

    liveMatches = matches
      .filter(
        (m) =>
          tournamentById.has(m.tournament_id) &&
          teamById.has(m.team_a_id) &&
          teamById.has(m.team_b_id),
      )
      .map((m) => {
        const inn = m.current_innings_id
          ? inningsById.get(m.current_innings_id)
          : null;
        const t = tournamentById.get(m.tournament_id)!;
        const a = teamById.get(m.team_a_id)!;
        const b = teamById.get(m.team_b_id)!;
        const battingShort = inn
          ? (teamById.get(inn.batting_team_id)?.short_name ?? "?")
          : "";
        const overs = inn
          ? `${Math.floor(inn.total_legal_balls / 6)}.${inn.total_legal_balls % 6}`
          : "";
        return {
          id: m.id,
          status: m.status as "live" | "innings_break",
          tournament: { slug: t.slug, name: t.name },
          teamA: { short_name: a.short_name },
          teamB: { short_name: b.short_name },
          score: inn
            ? {
                battingShort,
                runs: inn.total_runs,
                wickets: inn.total_wickets,
                overs,
                target: inn.target,
              }
            : null,
        };
      });
  }

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Keep the homepage live while there are matches in flight. */}
        {liveMatches.length > 0 && <AutoRefresh intervalMs={5000} />}

        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">HVC Tournament Scoring</h1>
          <p className="text-sm text-muted-foreground">
            Box-cricket tournament — live scoring &amp; spectator view.
          </p>
        </header>

        {liveMatches.length > 0 ? (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <span
                  aria-hidden
                  className="size-2.5 animate-pulse rounded-full bg-destructive"
                />
                Live now
                <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-normal uppercase tracking-wide text-destructive">
                  {liveMatches.length}{" "}
                  {liveMatches.length === 1 ? "match" : "matches"}
                </span>
              </CardTitle>
              <CardDescription>
                Updates every few seconds. Tap any card to follow ball-by-ball.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {liveMatches.map((m) => (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="block rounded-md border border-foreground/10 bg-background p-3 transition hover:border-destructive/40 hover:bg-destructive/5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {m.teamA.short_name} vs {m.teamB.short_name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {m.tournament.name}
                      </div>
                    </div>
                    <span
                      className={
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase " +
                        (m.status === "live"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-yellow-500/15 text-yellow-700")
                      }
                    >
                      {m.status === "live" ? "Live" : "Innings break"}
                    </span>
                  </div>
                  {m.score && (
                    <div className="mt-1 flex items-baseline gap-2 font-mono text-sm">
                      <span className="font-semibold">
                        {m.score.battingShort} {m.score.runs}/{m.score.wickets}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        ({m.score.overs} ov)
                      </span>
                      {m.score.target !== null && (
                        <span className="text-xs text-muted-foreground">
                          · target {m.score.target}
                        </span>
                      )}
                    </div>
                  )}
                </Link>
              ))}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No matches live right now</CardTitle>
              <CardDescription>
                Browse tournaments or set up the next match to get started.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Link href="/tournaments">
                <Button size="sm">Browse tournaments</Button>
              </Link>
              <Link href="/players">
                <Button variant="ghost" size="sm">
                  Players
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
