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
      .select("id, name, short_name")
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
                <Link href={`/matches/${match.id}/score`} prefetch>
                  <Button size="sm">
                    {ms === "scheduled" ? "Start scoring" : "Score"}
                  </Button>
                </Link>
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
                      value={
                        match.scheduled_at
                          ? new Date(match.scheduled_at).toLocaleString()
                          : "TBD"
                      }
                    />
                    <Row label="Venue" value={match.venue ?? "—"} />
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
                    <CardDescription className="capitalize">
                      {match.toss_winner_id && match.toss_decision
                        ? `${tossWinnerName(match.toss_winner_id, teamA, teamB)} won the toss and chose to ${match.toss_decision}.`
                        : "Not yet decided."}
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

        {/* For scheduled / abandoned matches, no tabs — just show info inline. */}
        {ms !== "live" && ms !== "innings_break" && ms !== "completed" && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
                <Row
                  label="Scheduled"
                  value={
                    match.scheduled_at
                      ? new Date(match.scheduled_at).toLocaleString()
                      : "TBD"
                  }
                />
                <Row label="Venue" value={match.venue ?? "—"} />
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
                <CardDescription className="capitalize">
                  {match.toss_winner_id && match.toss_decision
                    ? `${tossWinnerName(match.toss_winner_id, teamA, teamB)} won the toss and chose to ${match.toss_decision}.`
                    : "Not yet decided."}
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
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
