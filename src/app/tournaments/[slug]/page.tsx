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
import { formatDateRange, formatEnumLabel, formatMatchTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getTeamInitials } from "@/lib/utils";

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
        "id, match_number, stage, status, scheduled_at, team_a_id, team_b_id, winner_id, win_margin, result_type",
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
              <div className="min-w-0 space-y-1">
                <h1 className="truncate text-lg font-semibold capitalize leading-tight sm:text-xl">
                  {tournament.name}
                </h1>
                {/* Venue + date moved up here so the spectator gets
                    the "where + when" without scrolling past the
                    stat tiles. Faint gray, small icons — meta line,
                    not a section header. */}
                {(tournament.venue ||
                  tournament.start_date ||
                  tournament.end_date) && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {tournament.venue && (
                      <span className="inline-flex items-center gap-1 capitalize">
                        <MapPin className="size-3" />
                        {tournament.venue}
                      </span>
                    )}
                    {(tournament.start_date || tournament.end_date) && (
                      <span className="inline-flex items-center gap-1">
                        <CalendarDays className="size-3" />
                        {formatDateRange(
                          tournament.start_date,
                          tournament.end_date,
                        )}
                      </span>
                    )}
                  </div>
                )}
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

          {/* Quick stats — single row at every breakpoint. Labels
              wrap onto two lines on the narrowest phones (≤360 px)
              but the four tiles never break across rows. */}
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
            <Stat label="Matches" value={matches.length} />
            <Stat label="Teams" value={teams.length} />
            <Stat
              label="Overs / innings"
              value={tournament.default_overs_per_innings}
            />
            <Stat
              label="Players / side"
              value={tournament.default_players_per_side}
            />
          </div>

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
                    const winner = m.winner_id
                      ? teamLookup.get(m.winner_id)
                      : null;
                    // `win_margin` is stored with the "won by" prefix
                    // baked in (see score/actions.ts), so we just
                    // concatenate winner + margin verbatim.
                    const resultLine =
                      ms === "completed"
                        ? winner && m.win_margin
                          ? `${displayTeamName(winner.name)} ${m.win_margin}`
                          : m.result_type === "tie"
                            ? "Match tied"
                            : m.result_type === "no_result"
                              ? "No result"
                              : null
                        : null;
                    return (
                      <Link
                        key={m.id}
                        href={`/matches/${m.id}`}
                        prefetch
                        // Stacked layout (matches the cricket-app
                        // reference): row 1 = date + time on the left,
                        // status pill on the right; row 2 = #N · stage;
                        // rows 3-4 = each team logo + name; final row
                        // (completed matches only) = result line.
                        className="group block rounded-lg border border-foreground/10 bg-background p-3 transition hover:border-foreground/25 hover:bg-muted/30"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 truncate text-xs font-medium text-foreground/80">
                            {m.scheduled_at
                              ? formatMatchTime(m.scheduled_at)
                              : "Time TBD"}
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
                        </div>
                        <div className="mt-1 truncate text-[11px] capitalize text-muted-foreground">
                          #{m.match_number}
                          <span className="px-1 text-foreground/20">·</span>
                          {formatEnumLabel(m.stage)}
                        </div>
                        <div className="mt-2 space-y-1.5">
                          <TeamRow team={a} />
                          <TeamRow team={b} />
                        </div>
                        {resultLine && (
                          <div className="mt-2 truncate text-xs font-medium capitalize text-primary">
                            {resultLine}
                          </div>
                        )}
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
                            {getTeamInitials(team.short_name)}
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
  // `size="sm"` (Card → py-3) + `!py-1` on the Card overrides the
  // primitive's default vertical padding all the way down to 4 px
  // top + bottom. CardContent then adds zero vertical padding so
  // the value + label sit tight. `px-2` keeps the longer labels
  // ("Overs / innings", "Players / side") readable at 4-up on a
  // 360-px phone.
  return (
    <Card size="sm" className="border-foreground/10 !py-1">
      <CardContent className="space-y-0.5 px-2 py-0 text-center">
        <div className="font-mono text-xl font-semibold leading-none tabular-nums">
          {value}
        </div>
        <div className="text-[10px] uppercase leading-tight tracking-wide text-muted-foreground">
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

function TeamRow({
  team,
}: {
  team?: { name: string; short_name: string; logo_url: string | null };
}) {
  if (!team)
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        ?
      </div>
    );
  const label = displayTeamName(team.name);
  return (
    <div className="flex min-w-0 items-center gap-2">
      {team.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={team.logo_url}
          alt=""
          className="size-6 shrink-0 rounded-full border border-foreground/10 object-cover"
        />
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground">
          {getTeamInitials(team.short_name)}
        </span>
      )}
      <span
        className="truncate text-sm font-medium capitalize"
        title={team.name}
      >
        {label}
      </span>
    </div>
  );
}

