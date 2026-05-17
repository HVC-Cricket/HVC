import { CalendarDays, MapPin, Trophy, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionContext, isTournamentOrganizer } from "@/lib/auth";
import {
  MATCH_STATUS_CLASSES,
  MATCH_STATUS_LABEL,
  type MatchStage,
  type MatchStatus,
} from "@/lib/constants/match";
import {
  deriveTournamentStatus,
  FORMAT_LABEL,
  STATUS_CLASSES,
  STATUS_LABEL,
  type TournamentFormat,
} from "@/lib/constants/tournament";
import { createClient } from "@/lib/supabase/server";

import { PointsTableSection } from "./points-table-section";
import { TournamentChampion } from "./tournament-champion";
import { TournamentMvp } from "./tournament-mvp";
import { TournamentStats } from "./tournament-stats";
import { TournamentTabs } from "./tournament-tabs";

export const dynamic = "force-dynamic";

export default async function TournamentDetailPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const supabase = await createClient();
  const ctx = await getSessionContext();

  const { data: tournament, error } = await supabase
    .from("tournaments")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error || !tournament) notFound();

  const [teamsRes, matchesRes, canManage] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, short_name, logo_url")
      .eq("tournament_id", tournament.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("matches")
      .select(
        "id, match_number, stage, status, scheduled_at, team_a_id, team_b_id",
      )
      .eq("tournament_id", tournament.id)
      .order("match_number", { ascending: true }),
    ctx
      ? isTournamentOrganizer(tournament.id, ctx)
      : Promise.resolve(false),
  ]);

  const teams = teamsRes.data ?? [];
  const matches = matchesRes.data ?? [];
  const teamLookup = new Map(teams.map((t) => [t.id, t]));

  // Player counts per team — single query, group client side.
  const teamIds = teams.map((t) => t.id);
  const playerCountByTeam = new Map<string, number>();
  if (teamIds.length > 0) {
    const { data: memberships } = await supabase
      .from("team_players")
      .select("team_id")
      .in("team_id", teamIds);
    for (const m of memberships ?? []) {
      playerCountByTeam.set(
        m.team_id,
        (playerCountByTeam.get(m.team_id) ?? 0) + 1,
      );
    }
  }

  const fmt = tournament.format as TournamentFormat;
  // Derive the badge status from the matches — stored value is just the
  // admin's initial pick (defaults to `draft`) and rarely matches
  // reality once scoring starts. `archived` is preserved as-is.
  const status = deriveTournamentStatus(
    tournament.status,
    matches.map((m) => ({
      stage: m.stage as MatchStage,
      status: m.status as MatchStatus,
    })),
    fmt,
  );

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <header className="space-y-4">
          {tournament.banner_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tournament.banner_url}
              alt=""
              className="h-32 w-full rounded-xl border border-foreground/10 object-cover sm:h-44"
            />
          )}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              {tournament.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={tournament.logo_url}
                  alt=""
                  className="size-14 shrink-0 rounded-lg border border-foreground/10 object-cover"
                />
              ) : (
                <div className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Trophy className="size-6" />
                </div>
              )}
              <div className="min-w-0 space-y-1.5">
                <h1 className="truncate text-2xl font-semibold capitalize sm:text-3xl">
                  {tournament.name}
                </h1>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                      STATUS_CLASSES[status]
                    }
                  >
                    {status === "active" && (
                      <span className="relative flex size-1.5">
                        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                        <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                      </span>
                    )}
                    {STATUS_LABEL[status]}
                  </span>
                  <span className="inline-flex items-center rounded-full border border-foreground/15 bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {FORMAT_LABEL[fmt]}
                  </span>
                </div>
                {tournament.description && (
                  <p className="pt-1 text-sm text-muted-foreground">
                    {tournament.description}
                  </p>
                )}
              </div>
            </div>
            {canManage && (
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/tournaments/${tournament.slug}/admins`}
                  prefetch
                >
                  <Button variant="ghost" size="sm">
                    Admins
                  </Button>
                </Link>
                <Link href={`/tournaments/${tournament.slug}/edit`} prefetch>
                  <Button variant="ghost" size="sm">
                    Edit
                  </Button>
                </Link>
              </div>
            )}
          </div>

          {/* Quick stats */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Teams" value={teams.length} />
            <Stat label="Matches" value={matches.length} />
            <Stat
              label="Overs / innings"
              value={tournament.default_overs_per_innings}
            />
            <Stat
              label="Players / side"
              value={tournament.default_players_per_side}
            />
          </div>

          {/* Venue / dates */}
          {(tournament.venue ||
            tournament.start_date ||
            tournament.end_date) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {tournament.venue && (
                <span className="inline-flex items-center gap-1.5 capitalize">
                  <MapPin className="size-3.5" />
                  {tournament.venue}
                </span>
              )}
              {(tournament.start_date || tournament.end_date) && (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-3.5" />
                  {formatDateRange(
                    tournament.start_date,
                    tournament.end_date,
                  )}
                </span>
              )}
            </div>
          )}
        </header>

        <Suspense fallback={null}>
          <TournamentChampion tournamentId={tournament.id} />
        </Suspense>

        <TournamentTabs
          matches={
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Matches</h2>
                {canManage && (
                  <Link
                    href={`/tournaments/${tournament.slug}/matches/new`}
                    prefetch
                  >
                    <Button size="sm">New match</Button>
                  </Link>
                )}
              </div>
              {matches.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    No matches scheduled yet
                    {canManage
                      ? ". Add the first one with the button above."
                      : "."}
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {matches.map((m) => {
                    const a = teamLookup.get(m.team_a_id);
                    const b = teamLookup.get(m.team_b_id);
                    const ms = m.status as MatchStatus;
                    return (
                      <Link
                        key={m.id}
                        href={`/matches/${m.id}`}
                        prefetch
                        className="group flex items-center justify-between gap-3 rounded-lg border border-foreground/10 bg-background p-3 transition hover:border-foreground/25 hover:bg-muted/30"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs text-muted-foreground">
                            #{m.match_number}
                          </span>
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <TeamMini team={a} />
                              <span className="text-xs text-muted-foreground">
                                vs
                              </span>
                              <TeamMini team={b} />
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                              <span className="capitalize">
                                {m.stage.replace(/_/g, " ")}
                              </span>
                              {m.scheduled_at && (
                                <>
                                  <span className="text-foreground/20">·</span>
                                  <span>
                                    {formatMatchTime(m.scheduled_at)}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <span
                          className={
                            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                            MATCH_STATUS_CLASSES[ms]
                          }
                        >
                          {ms === "live" && (
                            <span className="relative flex size-1.5">
                              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                            </span>
                          )}
                          {MATCH_STATUS_LABEL[ms]}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          }
          table={
            <PointsTableSection
              tournamentId={tournament.id}
              teams={teams}
            />
          }
          stats={
            <Suspense
              fallback={
                <Card>
                  <CardContent className="space-y-2 py-6">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-3 animate-pulse rounded bg-muted"
                        style={{ width: `${100 - i * 10}%` }}
                      />
                    ))}
                  </CardContent>
                </Card>
              }
            >
              <TournamentStats tournamentId={tournament.id} />
            </Suspense>
          }
          mvp={
            <Suspense
              fallback={
                <Card>
                  <CardContent className="space-y-2 py-6">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-3 animate-pulse rounded bg-muted"
                        style={{ width: `${100 - i * 10}%` }}
                      />
                    ))}
                  </CardContent>
                </Card>
              }
            >
              <TournamentMvp tournamentId={tournament.id} />
            </Suspense>
          }
          teams={
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Teams</h2>
                {canManage && (
                  <Link
                    href={`/tournaments/${tournament.slug}/teams/new`}
                    prefetch
                  >
                    <Button size="sm">Add team</Button>
                  </Link>
                )}
              </div>
              {teams.length === 0 ? (
                <Card className="border-dashed">
                  <CardContent className="py-8 text-center text-sm text-muted-foreground">
                    No teams yet
                    {canManage
                      ? ". Add the first one with the button above."
                      : "."}
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {teams.map((team) => {
                    const playerCount = playerCountByTeam.get(team.id) ?? 0;
                    return (
                      <Link
                        key={team.id}
                        href={`/tournaments/${tournament.slug}/teams/${team.id}`}
                        prefetch
                        className="group flex items-center gap-3 rounded-xl border border-foreground/10 bg-background p-3 transition hover:border-foreground/25 hover:bg-muted/30"
                      >
                        {team.logo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={team.logo_url}
                            alt=""
                            className="size-11 shrink-0 rounded-lg border border-foreground/10 object-cover"
                          />
                        ) : (
                          <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] font-semibold text-muted-foreground">
                            {team.short_name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium capitalize">
                            {team.name}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="font-mono uppercase">
                              {team.short_name}
                            </span>
                            <span className="text-foreground/20">·</span>
                            <span className="inline-flex items-center gap-1">
                              <Users className="size-3" />
                              {playerCount}{" "}
                              {playerCount === 1 ? "player" : "players"}
                            </span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          }
        />
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="border-foreground/10">
      <CardContent className="space-y-0.5 py-3 text-center">
        <div className="font-mono text-2xl font-semibold leading-none tabular-nums">
          {value}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
      </CardContent>
    </Card>
  );
}

function displayTeamName(name: string): string {
  // Strip the "Team " prefix that some imported tournaments (Season 1
  // Thirtharu names) carry. Leaves "Vadiraja Thirtharu" instead of
  // "Team Vadiraja Thirtharu", which fits the match row better and reads
  // like a team name rather than a placeholder.
  return name.replace(/^team\s+/i, "");
}

function TeamMini({
  team,
}: {
  team?: { name: string; short_name: string; logo_url: string | null };
}) {
  if (!team)
    return <span className="text-sm font-medium text-muted-foreground">?</span>;
  const label = displayTeamName(team.name);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {team.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={team.logo_url}
          alt=""
          className="size-5 shrink-0 rounded-full border border-foreground/10 object-cover"
        />
      ) : (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-semibold text-muted-foreground">
          {team.short_name.slice(0, 2).toUpperCase()}
        </span>
      )}
      <span
        className="truncate text-sm font-medium capitalize"
        title={team.name}
      >
        {label}
      </span>
    </span>
  );
}

function formatDateRange(
  start: string | null,
  end: string | null,
): string {
  if (!start && !end) return "TBD";
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    if (s.toDateString() === e.toDateString()) return fmt(start);
    const sameMonth =
      s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth();
    if (sameMonth) {
      return `${s.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${e.getDate()}, ${e.getFullYear()}`;
    }
    return `${fmt(start)} – ${fmt(end)}`;
  }
  return `${start ? fmt(start) : "TBD"} – ${end ? fmt(end) : "TBD"}`;
}

function formatMatchTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}
