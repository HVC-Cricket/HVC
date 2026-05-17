import { ChevronLeft, ChevronRight, Play } from "lucide-react";
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
  type MatchStatus,
} from "@/lib/constants/match";
import { createClient } from "@/lib/supabase/server";

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

  const showStartScoringBar = canManage && ms === "scheduled";

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div
        className={
          "mx-auto max-w-3xl space-y-6 " +
          // Reserve room at the bottom of the scrollable content so the
          // sticky CTA bar doesn't sit on top of the last card.
          (showStartScoringBar ? "pb-24 sm:pb-28" : "")
        }
      >
        <Link
          href={`/tournaments/${tournament.slug}`}
          prefetch
          className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base font-semibold capitalize leading-tight text-foreground transition hover:opacity-80 sm:text-xl"
        >
          <ChevronLeft className="size-4 self-center text-muted-foreground sm:size-5" />
          <span>{teamA?.name ?? "?"}</span>
          <span className="text-xs font-normal text-muted-foreground sm:text-sm">
            vs
          </span>
          <span>{teamB?.name ?? "?"}</span>
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <span>Match {match.match_number}</span>
              <span aria-hidden>·</span>
              <span className="capitalize">
                {match.stage.replace(/_/g, " ")}
              </span>
              <span
                className={
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium " +
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
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(ms === "live" || ms === "innings_break") && (
              <NotifyButton matchId={match.id} />
            )}
            {canManage && (
              <>
                {/* For scheduled matches the primary CTA is rendered as
                    a full-width card below — pairing it with Activity /
                    Edit in this row reads like a tab strip and scorers
                    miss that it navigates away. Live / innings_break
                    keep the compact 'Score' here since the match is
                    clearly already in motion. */}
                {(ms === "live" || ms === "innings_break") && (
                  <Link href={`/matches/${match.id}/score`} prefetch>
                    <Button size="sm">Score</Button>
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
          <MatchTabs
            live={
              <div className="space-y-4">
                <Suspense fallback={<SectionSkeleton lines={4} />}>
                  <LiveScorePanel matchId={match.id} />
                </Suspense>
                {ms === "completed" && (
                  <Suspense fallback={<SectionSkeleton lines={2} />}>
                    <MatchAwards matchId={match.id} canManage={canManage} />
                  </Suspense>
                )}
              </div>
            }
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

      {/* Sticky Start-scoring CTA — pinned to the bottom of the viewport
          for scheduled matches so it stays in thumb reach no matter how
          far the scorer scrolls. The inner container clamps to the same
          max-w as the page so the bar lines up with the rest of the
          layout on desktop. */}
      {showStartScoringBar && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
          <div className="pointer-events-auto border-t border-foreground/10 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="mx-auto max-w-3xl p-3 sm:p-4">
              <Link
                href={`/matches/${match.id}/score`}
                prefetch
                className="group flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/15 px-4 py-3 text-sm font-medium text-primary transition hover:bg-primary/20"
              >
                <span className="flex items-center gap-2">
                  <Play className="size-4 fill-current" />
                  Start scoring this match
                </span>
                <ChevronRight className="size-4 transition group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        </div>
      )}
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
