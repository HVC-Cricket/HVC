import { ChevronLeft } from "lucide-react";
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
import { createClient } from "@/lib/supabase/server";

type MatchStatus =
  | "scheduled"
  | "live"
  | "innings_break"
  | "completed"
  | "abandoned";

const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  scheduled: "Scheduled",
  live: "Live",
  innings_break: "Innings break",
  completed: "Completed",
  abandoned: "Abandoned",
};
const MATCH_STATUS_CLASSES: Record<MatchStatus, string> = {
  scheduled: "border-foreground/15 bg-muted text-muted-foreground",
  live: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  innings_break:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  completed:
    "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  abandoned: "border-destructive/30 bg-destructive/10 text-destructive",
};

import { CommentaryFeed } from "./commentary-feed";
import { FullScorecard } from "./full-scorecard";
import { LiveScorePanel } from "./live-score-panel";
import { MatchTabs } from "./match-tabs";
import { NotifyButton } from "./notify/notify-button";
import { MatchAwards } from "./player-of-match/match-awards";
import { TossForm } from "./toss-form";
import { XISection } from "./xi-section";

export const dynamic = "force-dynamic";

function SectionSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <Card>
      <CardContent className="space-y-2 py-6">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className="h-3 animate-pulse rounded bg-muted"
            style={{ width: `${100 - i * 10}%` }}
          />
        ))}
      </CardContent>
    </Card>
  );
}

export default async function MatchDetailPage(props: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await props.params;
  const supabase = await createClient();

  // Top-level fetches: ctx and match are independent — run in parallel.
  const [ctx, matchRes] = await Promise.all([
    getSessionContext(),
    supabase.from("matches").select("*").eq("id", matchId).single(),
  ]);
  const match = matchRes.data;
  if (!match) notFound();

  // Once we have match: tournament + teams are independent — run in parallel.
  const [tournamentRes, teamsRes] = await Promise.all([
    supabase
      .from("tournaments")
      .select("id, slug, name")
      .eq("id", match.tournament_id)
      .single(),
    supabase
      .from("teams")
      .select("id, name, short_name, logo_url")
      .in("id", [match.team_a_id, match.team_b_id]),
  ]);
  const tournament = tournamentRes.data;
  if (!tournament) notFound();
  const teamRows = teamsRes.data;
  const teamA = teamRows?.find((t) => t.id === match.team_a_id);
  const teamB = teamRows?.find((t) => t.id === match.team_b_id);

  const canManage = ctx
    ? await isTournamentOrganizer(tournament.id, ctx)
    : false;

  const ms = match.status as MatchStatus;

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <Link
          href={`/tournaments/${tournament.slug}`}
          prefetch
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          <span className="capitalize">{tournament.name}</span>
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Match {match.match_number}
              <span> · </span>
              <span className="capitalize">
                {match.stage.replace(/_/g, " ")}
              </span>
            </p>
            <h1 className="text-2xl font-semibold capitalize sm:text-3xl">
              {teamA?.name ?? "?"}
              <span className="px-2 text-muted-foreground">vs</span>
              {teamB?.name ?? "?"}
            </h1>
            <span
              className={
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
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
          <div className="flex shrink-0 items-center gap-2">
            {(ms === "live" || ms === "innings_break") && (
              <NotifyButton matchId={match.id} />
            )}
            {canManage && (
              <>
                {/* Score button only makes sense for matches still in progress
                    or scheduled — a completed match shouldn't be scored
                    further. Admin can still re-open via Edit if needed. */}
                {ms !== "completed" && ms !== "abandoned" && (
                  <Link href={`/matches/${match.id}/score`} prefetch>
                    <Button size="sm">
                      {ms === "scheduled" ? "Start scoring" : "Score"}
                    </Button>
                  </Link>
                )}
                <Link href={`/matches/${match.id}/activity`}>
                  <Button variant="ghost" size="sm">
                    Activity
                  </Button>
                </Link>
                <Link href={`/matches/${match.id}/edit`} prefetch>
                  <Button variant="ghost" size="sm">
                    Edit
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>

        {(ms === "live" ||
          ms === "innings_break" ||
          ms === "completed") && (
          <Suspense fallback={<SectionSkeleton lines={4} />}>
            <LiveScorePanel matchId={match.id} />
          </Suspense>
        )}

        {ms === "completed" && (
          <Suspense fallback={<SectionSkeleton lines={2} />}>
            <MatchAwards matchId={match.id} canManage={canManage} />
          </Suspense>
        )}

        {(ms === "live" ||
          ms === "innings_break" ||
          ms === "completed") && (
          <MatchTabs
            scorecard={
              <Suspense fallback={<SectionSkeleton lines={6} />}>
                <FullScorecard matchId={match.id} />
              </Suspense>
            }
            commentary={
              <Suspense fallback={<SectionSkeleton lines={3} />}>
                <CommentaryFeed matchId={match.id} />
              </Suspense>
            }
            info={
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Details</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
                    <Row
                      label="Scheduled"
                      value={formatScheduledAt(match.scheduled_at)}
                    />
                    <Row
                      label="Venue"
                      value={match.venue ?? "—"}
                      valueClassName="capitalize"
                    />
                    <Row
                      label="Overs / innings"
                      value={String(match.overs_per_innings)}
                    />
                    <Row
                      label="Players / side"
                      value={String(match.players_per_side)}
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Toss</CardTitle>
                    <CardDescription>
                      {match.toss_winner_id && match.toss_decision ? (
                        <>
                          <span className="capitalize">
                            {tossWinnerName(
                              match.toss_winner_id,
                              teamA,
                              teamB,
                            )}
                          </span>{" "}
                          won the toss and chose to {match.toss_decision}.
                        </>
                      ) : (
                        "Not yet decided."
                      )}
                    </CardDescription>
                  </CardHeader>
                  {canManage && teamA && teamB && (
                    <CardContent>
                      <TossForm
                        matchId={match.id}
                        teamA={{ id: teamA.id, name: teamA.name }}
                        teamB={{ id: teamB.id, name: teamB.name }}
                        current={
                          match.toss_winner_id && match.toss_decision
                            ? {
                                toss_winner_id: match.toss_winner_id,
                                toss_decision: match.toss_decision,
                              }
                            : null
                        }
                      />
                    </CardContent>
                  )}
                </Card>

                {teamA && teamB && (
                  <Suspense fallback={<SectionSkeleton lines={4} />}>
                    <XISection
                      matchId={match.id}
                      tournamentId={tournament.id}
                      playersPerSide={match.players_per_side}
                      teamA={teamA}
                      teamB={teamB}
                      canManage={canManage}
                    />
                  </Suspense>
                )}
              </div>
            }
          />
        )}

        {/* For scheduled / abandoned matches, no tabs — show preview + info inline. */}
        {ms !== "live" && ms !== "innings_break" && ms !== "completed" && (
          <div className="space-y-4">
            {teamA && teamB && (
              <FixturePreview
                teamA={teamA}
                teamB={teamB}
                scheduledAt={match.scheduled_at}
                venue={match.venue}
              />
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
                <Row
                  label="Scheduled"
                  value={formatScheduledAt(match.scheduled_at)}
                />
                <Row
                  label="Venue"
                  value={match.venue ?? "—"}
                  valueClassName="capitalize"
                />
                <Row
                  label="Overs / innings"
                  value={String(match.overs_per_innings)}
                />
                <Row
                  label="Players / side"
                  value={String(match.players_per_side)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Toss</CardTitle>
                <CardDescription>
                  {match.toss_winner_id && match.toss_decision ? (
                    <>
                      <span className="capitalize">
                        {tossWinnerName(match.toss_winner_id, teamA, teamB)}
                      </span>{" "}
                      won the toss and chose to {match.toss_decision}.
                    </>
                  ) : (
                    "Not yet decided."
                  )}
                </CardDescription>
              </CardHeader>
              {canManage && teamA && teamB && (
                <CardContent>
                  <TossForm
                    matchId={match.id}
                    teamA={{ id: teamA.id, name: teamA.name }}
                    teamB={{ id: teamB.id, name: teamB.name }}
                    current={
                      match.toss_winner_id && match.toss_decision
                        ? {
                            toss_winner_id: match.toss_winner_id,
                            toss_decision: match.toss_decision,
                          }
                        : null
                    }
                  />
                </CardContent>
              )}
            </Card>

            {teamA && teamB && (
              <Suspense fallback={<SectionSkeleton lines={4} />}>
                <XISection
                  matchId={match.id}
                  tournamentId={tournament.id}
                  playersPerSide={match.players_per_side}
                  teamA={teamA}
                  teamB={teamB}
                  canManage={canManage}
                />
              </Suspense>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function Row({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={"text-right " + (valueClassName ?? "")}>{value}</span>
    </div>
  );
}

function tossWinnerName(
  winnerId: string,
  a?: { id: string; name: string },
  b?: { id: string; name: string },
) {
  if (a && winnerId === a.id) return a.name;
  if (b && winnerId === b.id) return b.name;
  return "(unknown)";
}

function formatScheduledAt(iso: string | null): string {
  if (!iso) return "TBD";
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

function FixturePreview({
  teamA,
  teamB,
  scheduledAt,
  venue,
}: {
  teamA: { name: string; short_name: string; logo_url: string | null };
  teamB: { name: string; short_name: string; logo_url: string | null };
  scheduledAt: string | null;
  venue: string | null;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <TeamPreview team={teamA} align="end" />
          <span className="font-mono text-sm font-medium uppercase tracking-wide text-muted-foreground">
            vs
          </span>
          <TeamPreview team={teamB} align="start" />
        </div>
        {(scheduledAt || venue) && (
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-foreground/5 pt-3 text-xs text-muted-foreground">
            {scheduledAt && <span>{formatScheduledAt(scheduledAt)}</span>}
            {scheduledAt && venue && (
              <span className="text-foreground/20">·</span>
            )}
            {venue && <span className="capitalize">{venue}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TeamPreview({
  team,
  align,
}: {
  team: { name: string; short_name: string; logo_url: string | null };
  align: "start" | "end";
}) {
  return (
    <div
      className={
        "flex flex-col items-center gap-2 " +
        (align === "end" ? "sm:items-end" : "sm:items-start")
      }
    >
      {team.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={team.logo_url}
          alt=""
          className="size-14 rounded-full border border-foreground/10 object-cover sm:size-16"
        />
      ) : (
        <div className="flex size-14 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground sm:size-16">
          {team.short_name.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div
        className={
          "min-w-0 " +
          (align === "end"
            ? "text-center sm:text-right"
            : "text-center sm:text-left")
        }
      >
        <div className="truncate text-sm font-semibold capitalize">
          {team.name}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
          {team.short_name}
        </div>
      </div>
    </div>
  );
}
