import { CalendarDays, Trophy } from "lucide-react";
import Link from "next/link";

import { LiveRefresh } from "@/components/live-refresh";
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

type UpcomingMatchView = {
  id: string;
  tournament: { slug: string; name: string };
  matchNumber: number;
  scheduledAt: string;
  teamA: TeamView;
  teamB: TeamView;
};

type RecentMatchView = {
  id: string;
  tournament: { slug: string; name: string };
  matchNumber: number;
  teamA: TeamView;
  teamB: TeamView;
  innings1: InningsScore | null;
  innings2: InningsScore | null;
};

export default async function Home() {
  const supabase = await createClient();

  const now = new Date();
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Three independent match queries in parallel.
  const [liveRes, upcomingRes, recentRes] = await Promise.all([
    supabase
      .from("matches")
      .select(
        "id, tournament_id, team_a_id, team_b_id, status, current_innings_id, started_at, match_number, overs_per_innings",
      )
      .in("status", ["live", "innings_break"])
      .order("started_at", { ascending: false }),
    supabase
      .from("matches")
      .select(
        "id, tournament_id, team_a_id, team_b_id, scheduled_at, match_number",
      )
      .eq("status", "scheduled")
      .gte("scheduled_at", now.toISOString())
      .lte("scheduled_at", next24h.toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(5),
    supabase
      .from("matches")
      .select(
        "id, tournament_id, team_a_id, team_b_id, status, started_at, match_number",
      )
      .eq("status", "completed")
      .order("started_at", { ascending: false })
      .limit(5),
  ]);

  const liveRows = liveRes.data ?? [];
  const upcomingRows = upcomingRes.data ?? [];
  const recentRows = recentRes.data ?? [];

  const allRows = [...liveRows, ...upcomingRows, ...recentRows];
  const tournamentIds = [...new Set(allRows.map((m) => m.tournament_id))];
  const teamIds = [
    ...new Set(allRows.flatMap((m) => [m.team_a_id, m.team_b_id])),
  ];
  const inningsMatchIds = [
    ...new Set([...liveRows, ...recentRows].map((m) => m.id)),
  ];

  // Fetch shared deps in parallel — tournaments + teams + innings.
  const [tournamentsRes, teamsRes, inningsRes] =
    allRows.length > 0
      ? await Promise.all([
          supabase
            .from("tournaments")
            .select("id, slug, name")
            .in("id", tournamentIds),
          supabase
            .from("teams")
            .select("id, name, short_name, logo_url")
            .in("id", teamIds),
          inningsMatchIds.length > 0
            ? supabase
                .from("innings")
                .select(
                  "id, match_id, innings_number, batting_team_id, total_runs, total_wickets, total_legal_balls, target",
                )
                .in("match_id", inningsMatchIds)
            : Promise.resolve({ data: [] }),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];

  const tournamentById = new Map(
    (tournamentsRes.data ?? []).map((t) => [t.id, t]),
  );
  const teamById = new Map(
    (teamsRes.data ?? []).map((t) => [t.id, t as TeamView]),
  );
  const inningsByMatch = new Map<string, InningsScore[]>();
  for (const inn of inningsRes.data ?? []) {
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

  const hasDeps = (m: { tournament_id: string; team_a_id: string; team_b_id: string }) =>
    tournamentById.has(m.tournament_id) &&
    teamById.has(m.team_a_id) &&
    teamById.has(m.team_b_id);

  const liveMatches: LiveMatchView[] = liveRows.filter(hasDeps).map((m) => {
    const t = tournamentById.get(m.tournament_id)!;
    const mInns = inningsByMatch.get(m.id) ?? [];
    return {
      id: m.id,
      status: m.status as "live" | "innings_break",
      tournament: { slug: t.slug, name: t.name },
      matchNumber: m.match_number,
      oversPerInnings: m.overs_per_innings,
      teamA: teamById.get(m.team_a_id)!,
      teamB: teamById.get(m.team_b_id)!,
      innings1: mInns.find((i) => i.innings_number === 1) ?? null,
      innings2: mInns.find((i) => i.innings_number === 2) ?? null,
    };
  });

  const upcomingMatches: UpcomingMatchView[] = upcomingRows
    .filter(hasDeps)
    .map((m) => {
      const t = tournamentById.get(m.tournament_id)!;
      return {
        id: m.id,
        tournament: { slug: t.slug, name: t.name },
        matchNumber: m.match_number,
        scheduledAt: m.scheduled_at!,
        teamA: teamById.get(m.team_a_id)!,
        teamB: teamById.get(m.team_b_id)!,
      };
    });

  const recentMatches: RecentMatchView[] = recentRows
    .filter(hasDeps)
    .map((m) => {
      const t = tournamentById.get(m.tournament_id)!;
      const mInns = inningsByMatch.get(m.id) ?? [];
      return {
        id: m.id,
        tournament: { slug: t.slug, name: t.name },
        matchNumber: m.match_number,
        teamA: teamById.get(m.team_a_id)!,
        teamB: teamById.get(m.team_b_id)!,
        innings1: mInns.find((i) => i.innings_number === 1) ?? null,
        innings2: mInns.find((i) => i.innings_number === 2) ?? null,
      };
    });

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-8">
        {liveMatches.length > 0 && <LiveRefresh />}

        {/* Hero */}
        <header className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5 sm:p-7">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            HVC Tournament Scoring
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Box-cricket — live ball-by-ball scoring &amp; spectator view.
          </p>
        </header>

        {liveMatches.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
              </span>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
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

        {upcomingMatches.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                Up next
              </h2>
              <span className="text-xs text-muted-foreground">
                · within 24 hours
              </span>
            </div>
            <div className="space-y-2">
              {upcomingMatches.map((m) => (
                <UpcomingMatchRow key={m.id} match={m} />
              ))}
            </div>
          </section>
        )}

        {recentMatches.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Trophy className="size-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                Recent results
              </h2>
            </div>
            <div className="space-y-2">
              {recentMatches.map((m) => (
                <RecentMatchRow key={m.id} match={m} />
              ))}
            </div>
          </section>
        )}

        <footer className="border-t border-foreground/10 pt-6 text-center text-xs text-muted-foreground">
          <p>HVC Tournament Scoring · Box-cricket scoring app</p>
        </footer>
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
      className="group flex flex-col overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-sm transition hover:border-primary/40 hover:shadow-md"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 border-b border-foreground/5 bg-emerald-500/5 px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
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

      {/* CTA — primary brand colour, matches every other primary button. */}
      <div className="bg-primary px-3 py-2.5 text-center text-sm font-semibold text-primary-foreground transition group-hover:bg-primary/90">
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
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
            {team.short_name.slice(0, 2).toUpperCase()}
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

function UpcomingMatchRow({ match }: { match: UpcomingMatchView }) {
  return (
    <Link
      href={`/matches/${match.id}`}
      className="group flex items-center gap-3 rounded-lg border border-foreground/10 bg-background px-3 py-2.5 transition hover:border-primary/30 hover:bg-primary/5"
    >
      <TeamBadge team={match.teamA} />
      <span className="text-xs font-medium text-muted-foreground">vs</span>
      <TeamBadge team={match.teamB} />
      <div className="ml-auto text-right text-[11px] text-muted-foreground">
        <div className="font-medium text-foreground">
          {formatUpcomingTime(match.scheduledAt)}
        </div>
        <div className="capitalize">{match.tournament.name}</div>
      </div>
    </Link>
  );
}

function RecentMatchRow({ match }: { match: RecentMatchView }) {
  const aScore = match.innings1?.batting_team_id === match.teamA.id
    ? match.innings1
    : match.innings2?.batting_team_id === match.teamA.id
      ? match.innings2
      : null;
  const bScore = match.innings1?.batting_team_id === match.teamB.id
    ? match.innings1
    : match.innings2?.batting_team_id === match.teamB.id
      ? match.innings2
      : null;
  const aRuns = aScore?.runs ?? 0;
  const bRuns = bScore?.runs ?? 0;
  const winnerId =
    aRuns > bRuns ? match.teamA.id : bRuns > aRuns ? match.teamB.id : null;

  return (
    <Link
      href={`/matches/${match.id}`}
      className="group flex items-center gap-3 rounded-lg border border-foreground/10 bg-background px-3 py-2.5 transition hover:border-primary/30 hover:bg-primary/5"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <ResultLine team={match.teamA} score={aScore} won={winnerId === match.teamA.id} />
        <ResultLine team={match.teamB} score={bScore} won={winnerId === match.teamB.id} />
      </div>
      <div className="shrink-0 text-right text-[10px] uppercase tracking-wide text-muted-foreground">
        <span className="capitalize">{match.tournament.name}</span>
        <span> · #{match.matchNumber}</span>
      </div>
    </Link>
  );
}

function ResultLine({
  team,
  score,
  won,
}: {
  team: TeamView;
  score: InningsScore | null;
  won: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {team.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={team.logo_url}
          alt=""
          className="size-5 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[8px] font-semibold text-primary">
          {team.short_name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span
        className={
          "font-mono text-xs font-semibold uppercase " +
          (won ? "text-foreground" : "text-muted-foreground")
        }
      >
        {team.short_name}
      </span>
      {won && (
        <Trophy className="size-3 text-amber-500" aria-label="Winner" />
      )}
      <span className="ml-auto font-mono tabular-nums">
        {score ? `${score.runs}/${score.wickets}` : "—"}
        {score && (
          <span className="ml-1 text-[10px] text-muted-foreground">
            ({score.overs})
          </span>
        )}
      </span>
    </div>
  );
}

function TeamBadge({ team }: { team: TeamView }) {
  return (
    <span className="flex items-center gap-1.5">
      {team.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={team.logo_url}
          alt=""
          className="size-6 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary">
          {team.short_name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span className="font-mono text-xs font-semibold uppercase">
        {team.short_name}
      </span>
    </span>
  );
}

function formatUpcomingTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `in ${diffMin} min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `in ${diffHr}h`;
  return d.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}
