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

type TeamView = {
  id: string;
  name: string;
  short_name: string;
  logo_url: string | null;
};

type InningsScore = {
  innings_number: number;
  batting_team_id: string;
  runs: number;
  wickets: number;
  overs: string; // X.Y notation
  target: number | null;
  legal_balls: number;
};

type LiveMatchView = {
  id: string;
  status: "live" | "innings_break";
  tournament: { slug: string; name: string };
  matchNumber: number;
  oversPerInnings: number;
  teamA: TeamView;
  teamB: TeamView;
  innings1: InningsScore | null;
  innings2: InningsScore | null;
};

export default async function Home() {
  const supabase = await createClient();

  const { data: liveRows } = await supabase
    .from("matches")
    .select(
      "id, tournament_id, team_a_id, team_b_id, status, current_innings_id, started_at, match_number, overs_per_innings",
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
    const matchIds = matches.map((m) => m.id);

    const [tournaments, teams, innings] = await Promise.all([
      supabase
        .from("tournaments")
        .select("id, slug, name")
        .in("id", tournamentIds),
      supabase
        .from("teams")
        .select("id, name, short_name, logo_url")
        .in("id", teamIds),
      supabase
        .from("innings")
        .select(
          "id, match_id, innings_number, batting_team_id, total_runs, total_wickets, total_legal_balls, target",
        )
        .in("match_id", matchIds),
    ]);

    const tournamentById = new Map(
      (tournaments.data ?? []).map((t) => [t.id, t]),
    );
    const teamById = new Map(
      (teams.data ?? []).map((t) => [t.id, t as TeamView]),
    );
    const inningsByMatch = new Map<string, InningsScore[]>();
    for (const inn of innings.data ?? []) {
      const list = inningsByMatch.get(inn.match_id) ?? [];
      list.push({
        innings_number: inn.innings_number,
        batting_team_id: inn.batting_team_id,
        runs: inn.total_runs,
        wickets: inn.total_wickets,
        overs: `${Math.floor(inn.total_legal_balls / 6)}.${inn.total_legal_balls % 6}`,
        target: inn.target,
        legal_balls: inn.total_legal_balls,
      });
      inningsByMatch.set(inn.match_id, list);
    }

    liveMatches = matches
      .filter(
        (m) =>
          tournamentById.has(m.tournament_id) &&
          teamById.has(m.team_a_id) &&
          teamById.has(m.team_b_id),
      )
      .map((m) => {
        const t = tournamentById.get(m.tournament_id)!;
        const a = teamById.get(m.team_a_id)!;
        const b = teamById.get(m.team_b_id)!;
        const mInns = inningsByMatch.get(m.id) ?? [];
        return {
          id: m.id,
          status: m.status as "live" | "innings_break",
          tournament: { slug: t.slug, name: t.name },
          matchNumber: m.match_number,
          oversPerInnings: m.overs_per_innings,
          teamA: a,
          teamB: b,
          innings1: mInns.find((i) => i.innings_number === 1) ?? null,
          innings2: mInns.find((i) => i.innings_number === 2) ?? null,
        };
      });
  }

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-8">
        {liveMatches.length > 0 && <AutoRefresh intervalMs={5000} />}

        {/* Hero */}
        <header className="space-y-2 pt-2">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            HVC Tournament Scoring
          </h1>
          <p className="text-sm text-muted-foreground">
            Box-cricket — live ball-by-ball scoring &amp; spectator view.
          </p>
        </header>

        {liveMatches.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-destructive" />
              </span>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-destructive">
                Live now
              </h2>
              <span className="text-xs text-muted-foreground">
                · {liveMatches.length}{" "}
                {liveMatches.length === 1 ? "match" : "matches"} in flight
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {liveMatches.map((m) => (
                <LiveMatchCard key={m.id} match={m} />
              ))}
            </div>
          </section>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                No matches live right now
              </CardTitle>
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

function LiveMatchCard({ match }: { match: LiveMatchView }) {
  // Active innings is the one whose batting team is currently batting.
  // Innings break: innings 2 hasn't started yet but we have a target.
  const currentInnings =
    match.innings2 ?? match.innings1 ?? null;
  const battingTeamId = currentInnings?.batting_team_id ?? null;

  const target =
    match.innings1 && !match.innings2
      ? match.innings1.runs + 1
      : (match.innings2?.target ?? null);

  // Chase context — only when innings 2 is in progress.
  let chaseLine: string | null = null;
  if (match.innings2 && target !== null) {
    const runsNeeded = target - match.innings2.runs;
    const ballsLeft = match.oversPerInnings * 6 - match.innings2.legal_balls;
    if (runsNeeded > 0 && ballsLeft > 0) {
      chaseLine = `Need ${runsNeeded} off ${ballsLeft} ball${ballsLeft === 1 ? "" : "s"}`;
    }
  } else if (match.status === "innings_break" && target !== null) {
    chaseLine = `Chase: ${target} to win in ${match.oversPerInnings} overs`;
  }

  return (
    <Link
      href={`/matches/${match.id}`}
      prefetch
      className="group flex flex-col overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-sm transition hover:border-destructive/40 hover:shadow-md"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 border-b border-foreground/5 bg-destructive/5 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-destructive opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-destructive" />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-destructive">
            {match.status === "live" ? "Live" : "Innings break"}
          </span>
        </div>
        <span className="truncate text-[11px] capitalize text-muted-foreground">
          {match.tournament.name} · #{match.matchNumber}
        </span>
      </div>

      {/* Team rows */}
      <div className="space-y-2 px-3 py-3">
        <TeamLine
          team={match.teamA}
          innings={
            match.innings1?.batting_team_id === match.teamA.id
              ? match.innings1
              : match.innings2?.batting_team_id === match.teamA.id
                ? match.innings2
                : null
          }
          isCurrentBatting={battingTeamId === match.teamA.id}
        />
        <TeamLine
          team={match.teamB}
          innings={
            match.innings1?.batting_team_id === match.teamB.id
              ? match.innings1
              : match.innings2?.batting_team_id === match.teamB.id
                ? match.innings2
                : null
          }
          isCurrentBatting={battingTeamId === match.teamB.id}
        />
      </div>

      {/* Chase context */}
      {chaseLine && (
        <div className="border-t border-foreground/5 bg-muted/30 px-3 py-1.5 text-center text-[11px] font-medium text-foreground">
          {chaseLine}
        </div>
      )}

      {/* CTA */}
      <div className="border-t border-foreground/5 bg-muted/40 px-3 py-2 text-center text-xs font-medium text-foreground/80 transition group-hover:bg-destructive/10 group-hover:text-destructive">
        Watch live →
      </div>
    </Link>
  );
}

function TeamLine({
  team,
  innings,
  isCurrentBatting,
}: {
  team: TeamView;
  innings: InningsScore | null;
  isCurrentBatting: boolean;
}) {
  return (
    <div
      className={
        "flex items-center justify-between gap-3 " +
        (isCurrentBatting ? "" : "opacity-70")
      }
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {team.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={team.logo_url}
            alt=""
            width={32}
            height={32}
            className="size-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
            {team.short_name.slice(0, 2)}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-medium capitalize leading-tight">
            {team.name}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {team.short_name}
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        {innings ? (
          <>
            <div className="font-mono text-xl font-semibold leading-none">
              {innings.runs}
              <span className="text-foreground/40">/</span>
              {innings.wickets}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {innings.overs} ov
            </div>
          </>
        ) : (
          <div className="text-[11px] text-muted-foreground">
            yet to bat
          </div>
        )}
      </div>
    </div>
  );
}
