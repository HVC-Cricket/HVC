import { CalendarDays, MapPin, Trophy, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { LogoPhoto } from "@/components/logo-photo";
import { RefreshButton } from "@/components/refresh-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSessionContext, isTournamentOrganizer } from "@/lib/auth";
import {
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
import { formatDateRange } from "@/lib/format";
import { computeStandings } from "@/lib/standings";
import { createClient } from "@/lib/supabase/server";
import { getTeamInitials } from "@/lib/utils";

import { PointsTableSection } from "./points-table-section";
import { TournamentChampion } from "./tournament-champion";
import {
  TournamentMatchesList,
  type MatchRow,
} from "./tournament-matches-list";
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
        "id, match_number, stage, status, scheduled_at, team_a_id, team_b_id, winner_id, win_margin, result_type, umpire_1, umpire_2, scorer",
      )
      .eq("tournament_id", tournament.id)
      .order("match_number", { ascending: true }),
    ctx
      ? isTournamentOrganizer(tournament.id, ctx)
      : Promise.resolve(false),
  ]);

  const teams = teamsRes.data ?? [];
  const matches: MatchRow[] = matchesRes.data ?? [];

  // Player counts per team — single query, group client side.
  // Also pluck out which teams the signed-in user is on (via their
  // linked player) so the matches tab can offer a "My team" filter.
  const teamIds = teams.map((t) => t.id);
  const playerCountByTeam = new Map<string, number>();
  const myTeamIds: string[] = [];
  if (teamIds.length > 0) {
    const { data: memberships } = await supabase
      .from("team_players")
      .select("team_id, players!inner(linked_user_id)")
      .in("team_id", teamIds);
    const seenMyTeam = new Set<string>();
    for (const m of memberships ?? []) {
      playerCountByTeam.set(
        m.team_id,
        (playerCountByTeam.get(m.team_id) ?? 0) + 1,
      );
      // Supabase types the `!inner` join as either a single row or an
      // array depending on cardinality; we declared it inner so it's a
      // single object at runtime, but accept either to keep TS happy.
      const linked = (
        Array.isArray(m.players) ? m.players[0] : m.players
      ) as { linked_user_id: string | null } | null | undefined;
      if (
        ctx &&
        linked?.linked_user_id === ctx.user.id &&
        !seenMyTeam.has(m.team_id)
      ) {
        seenMyTeam.add(m.team_id);
        myTeamIds.push(m.team_id);
      }
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

  // Playoff seeding: once every group match is complete on a
  // round-robin-playoff format, the standings are locked in and we
  // can fill the TBC placeholders with actual top-4 team IDs (1 vs
  // 2 for Q1, 3 vs 4 for Eliminator). Mid-league the seedings can
  // still shift, so we leave the placeholders empty until then.
  // Q2 / Final stay TBC even after this — they depend on actual
  // playoff outcomes the organizer hasn't scored yet.
  const groupMatches = matches.filter((m) => m.stage === "group");
  const leagueComplete =
    groupMatches.length > 0 &&
    groupMatches.every((m) => m.status === "completed");
  let playoffSeedingTeamIds: string[] = [];
  if (fmt === "round_robin_playoff_final" && leagueComplete) {
    const standings = await computeStandings(supabase, tournament.id);
    playoffSeedingTeamIds = standings.slice(0, 4).map((s) => s.team_id);
  }

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
              <LogoPhoto
                imageUrl={tournament.logo_url}
                name={tournament.name}
                fallback={<Trophy className="size-6" />}
                className="size-14 shrink-0 border border-foreground/10 bg-muted text-muted-foreground"
              />
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
            <div className="flex shrink-0 items-center gap-1.5">
              {/* Tournament page is force-dynamic but has no live
                  subscription (intentional — adds ~10 queries × N
                  spectators per ball burst, too heavy for the Mumbai
                  pool during a live tournament). RefreshButton lets
                  anyone manually re-fetch the active tab's data when
                  they want fresh numbers, without a full page reload.
                  See HANDOFF 2026-05-24. */}
              <RefreshButton label="Refresh tournament" />
              {canManage && (
                <>
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
                </>
              )}
            </div>
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
            <TournamentMatchesList
              tournamentSlug={tournament.slug}
              tournamentFormat={fmt}
              matches={matches}
              teams={teams}
              canManage={canManage}
              myTeamIds={myTeamIds}
              playoffSeedingTeamIds={playoffSeedingTeamIds}
            />
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
                        <LogoPhoto
                          imageUrl={team.logo_url}
                          name={team.name}
                          fallback={
                            <span className="text-[10px] font-semibold">
                              {getTeamInitials(team.short_name)}
                            </span>
                          }
                          className="size-11 shrink-0 border border-foreground/10 bg-muted text-muted-foreground"
                        />
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


