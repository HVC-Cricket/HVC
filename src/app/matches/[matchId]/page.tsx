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
import {
  getSessionContext,
  isTournamentAdmin,
  isTournamentOrganizer,
} from "@/lib/auth";
import {
  MATCH_STATUS_CLASSES,
  MATCH_STATUS_LABEL,
  type MatchStatus,
} from "@/lib/constants/match";
import { formatEnumLabel, formatScheduledAt } from "@/lib/format";
import { matchHasRecordedBalls } from "@/lib/match-balls";
import {
  applyRulesOverride,
  findCategoryGaps,
  getRuleSet,
  type RulesOverride,
  type TeamXISummary,
} from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import { getTeamInitials } from "@/lib/utils";

import { CommentaryFeed } from "./commentary-feed";
import { FullScorecard } from "./full-scorecard";
import { HighlightDialog } from "./highlight-dialog";
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
      .select("id, slug, name, rules")
      .eq("id", match.tournament_id)
      .single(),
    supabase
      .from("teams")
      .select("id, name, short_name, logo_url")
      .in("id", [match.team_a_id, match.team_b_id]),
  ]);
  const tournament = tournamentRes.data;
  const tournamentRulesRes = tournamentRes.data;
  if (!tournament) notFound();
  const teamRows = teamsRes.data;
  const teamA = teamRows?.find((t) => t.id === match.team_a_id);
  const teamB = teamRows?.find((t) => t.id === match.team_b_id);

  // canManage = organizer-only (Edit match, Toss form, XI picker).
  // canScore  = tournament admin = organizer OR scorer (Score CTA,
  //             Activity log, POTM pick — gated server-side on
  //             requireTournamentAdmin). Without this split a scorer
  //             couldn't even see the "Start scoring this match" CTA
  //             that they're authorised to use.
  const [canManage, canScore] = ctx
    ? await Promise.all([
        isTournamentOrganizer(tournament.id, ctx),
        isTournamentAdmin(tournament.id, ctx),
      ])
    : [false, false];

  const ms = match.status as MatchStatus;

  // XI lock: once any non-voided ball is recorded, "Pick playing XIs"
  // and the inline Add-player surfaces are frozen. Undoing every
  // ball back to the start unlocks (voiding clears the gate).
  // Always do the actual count check — the previous shortcut
  // `ms !== 'scheduled'` was wrong when an organizer reverted
  // status from live/completed back to scheduled via the edit form;
  // we'd report xiLocked=false while balls still existed and the
  // server action would then reject confusingly.
  const xiLocked = await matchHasRecordedBalls(supabase, match.id);

  // Promote the Score CTA to a full-width sticky card whenever the scorer
  // can act: scheduled (start), live (continue), or innings_break
  // (continue into innings 2). The header row keeps Notify / Activity /
  // Edit only — pairing a primary button with those ghost buttons
  // visually reads like a tab strip (see screenshot from 2026-05-17).
  const showScoringBar =
    canScore &&
    (ms === "scheduled" || ms === "live" || ms === "innings_break");

  // Pre-flight check for the CTA label. The score page already blocks
  // the actual scoring panel when toss / XIs aren't complete (it
  // shows the pick-XI form inline instead), but the bar used to
  // unconditionally read "Start scoring this match", which misled
  // scorers who hadn't picked an XI yet. Surface the next step in
  // the label so the button stays honest. Only run when we're about
  // to render the bar — saves one query for spectators.
  let scoringBarLabel: string;
  if (ms === "scheduled" && showScoringBar) {
    const hasToss = !!match.toss_winner_id && !!match.toss_decision;
    // Need both XI rows (for the count) AND each picked player's
    // category so the category-coverage check can run. Single query.
    const { data: xiRows } = await supabase
      .from("match_players")
      .select(
        "team_id, is_substitute, player:players(category)",
      )
      .eq("match_id", matchId);
    type XIRow = {
      team_id: string;
      is_substitute: boolean;
      player: { category: number | null } | null;
    };
    const rows = (xiRows ?? []) as unknown as XIRow[];
    const xiACount =
      rows.filter((r) => r.team_id === match.team_a_id && !r.is_substitute)
        .length;
    const xiBCount =
      rows.filter((r) => r.team_id === match.team_b_id && !r.is_substitute)
        .length;
    const xiAReady = xiACount >= match.players_per_side;
    const xiBReady = xiBCount >= match.players_per_side;

    // Category coverage. Merge tournament rules + match override
    // before checking — same logic the score page uses so both
    // surfaces gate identically.
    const baseRules = getRuleSet(tournamentRulesRes?.rules);
    const matchOverride =
      (match as { rules_override?: RulesOverride }).rules_override ?? null;
    const effectiveRules = applyRulesOverride(baseRules, matchOverride);
    const catsByTeam = new Map<string, Set<1 | 2 | 3>>();
    for (const r of rows) {
      if (r.is_substitute) continue;
      const cat = r.player?.category;
      if (cat == null) continue;
      if (cat !== 1 && cat !== 2 && cat !== 3) continue;
      let set = catsByTeam.get(r.team_id);
      if (!set) {
        set = new Set();
        catsByTeam.set(r.team_id, set);
      }
      set.add(cat as 1 | 2 | 3);
    }
    const teamSummaries: [TeamXISummary, TeamXISummary] = [
      {
        team_id: teamA?.id ?? match.team_a_id,
        team_name: teamA?.name ?? "",
        categories_in_xi: catsByTeam.get(match.team_a_id) ?? new Set(),
      },
      {
        team_id: teamB?.id ?? match.team_b_id,
        team_name: teamB?.name ?? "",
        categories_in_xi: catsByTeam.get(match.team_b_id) ?? new Set(),
      },
    ];
    const categoryGaps = findCategoryGaps(effectiveRules, teamSummaries);

    if (!hasToss) scoringBarLabel = "Set toss to start scoring";
    else if (!xiAReady || !xiBReady)
      scoringBarLabel = "Pick playing XIs to start scoring";
    else if (categoryGaps.length > 0)
      scoringBarLabel = "Resolve category coverage to start scoring";
    else scoringBarLabel = "Start scoring this match";
  } else {
    scoringBarLabel = ms === "scheduled" ? "Start scoring this match" : "Continue scoring";
  }

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div
        className={
          // Tight vertical rhythm on mobile (header → meta row → tab
          // strip stack with minimal gap), restored to the original
          // generous gap on tablets/desktop where there's more room.
          "mx-auto max-w-3xl space-y-2 sm:space-y-6 " +
          // Reserve room at the bottom of the scrollable content so the
          // sticky CTA bar doesn't sit on top of the last card.
          (showScoringBar ? "pb-24 sm:pb-28" : "")
        }
      >
        <Link
          href={`/tournaments/${tournament.slug}`}
          prefetch
          // Single-line header that scales the font down on narrow
          // phones so common HVC team names ("Vijayanagara Royals vs
          // Wodeyars The Kings") stay on one row. `clamp(min, vw,
          // max)` ties the size to viewport width, capped at the
          // existing desktop size; `whitespace-nowrap` + `flex-nowrap`
          // prevent the spans from wrapping.
          className="flex flex-nowrap items-baseline gap-x-2 whitespace-nowrap font-semibold capitalize leading-tight text-foreground transition hover:opacity-80 text-[clamp(0.8125rem,3.8vw,1.25rem)]"
        >
          <ChevronLeft className="size-4 shrink-0 self-center text-muted-foreground sm:size-5" />
          <span>{teamA?.name ?? "?"}</span>
          <span className="font-normal text-muted-foreground text-[0.7em]">
            vs
          </span>
          <span>{teamB?.name ?? "?"}</span>
        </Link>

        {/* Match meta on the left, action buttons on the right, single
            row at every breakpoint. `flex-nowrap` keeps them aligned;
            the left block carries `min-w-0` so the meta row inside
            gives up space gracefully if the viewport is very narrow. */}
        <div className="flex flex-nowrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs uppercase tracking-wide text-muted-foreground">
            <span>Match {match.match_number}</span>
            <span aria-hidden>·</span>
            <span className="capitalize">
              {formatEnumLabel(match.stage)}
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
          <div className="flex shrink-0 items-center gap-1">
            {(ms === "live" || ms === "innings_break") && (
              <NotifyButton matchId={match.id} />
            )}
            {ms === "completed" && (
              <HighlightDialog
                matchId={match.id}
                matchNumber={match.match_number}
                teamAShort={teamA?.short_name ?? ""}
                teamBShort={teamB?.short_name ?? ""}
              />
            )}
            {canScore && (
              <Link href={`/matches/${match.id}/activity`}>
                <Button variant="ghost" size="sm">
                  Activity
                </Button>
              </Link>
            )}
            {canManage && (
              <Link href={`/matches/${match.id}/edit`} prefetch>
                <Button variant="ghost" size="sm">
                  Edit
                </Button>
              </Link>
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
                    <MatchAwards matchId={match.id} canManage={canScore} />
                  </Suspense>
                )}
                <Suspense fallback={<SectionSkeleton lines={3} />}>
                  <CommentaryFeed matchId={match.id} />
                </Suspense>
              </div>
            }
            scorecard={
              <Suspense fallback={<SectionSkeleton lines={6} />}>
                <FullScorecard matchId={match.id} />
              </Suspense>
            }
            squads={
              teamA && teamB ? (
                <Suspense fallback={<SectionSkeleton lines={4} />}>
                  <XISection
                    matchId={match.id}
                    tournamentId={tournament.id}
                    playersPerSide={match.players_per_side}
                    teamA={teamA}
                    teamB={teamB}
                    canManage={canManage}
                    xiLocked={xiLocked}
                  />
                </Suspense>
              ) : null
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
                    {match.umpire_1 && (
                      <Row
                        label="Umpire 1"
                        value={match.umpire_1}
                        valueClassName="capitalize"
                      />
                    )}
                    {match.umpire_2 && (
                      <Row
                        label="Umpire 2"
                        value={match.umpire_2}
                        valueClassName="capitalize"
                      />
                    )}
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
                {match.umpire_1 && (
                  <Row
                    label="Umpire 1"
                    value={match.umpire_1}
                    valueClassName="capitalize"
                  />
                )}
                {match.umpire_2 && (
                  <Row
                    label="Umpire 2"
                    value={match.umpire_2}
                    valueClassName="capitalize"
                  />
                )}
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
                  xiLocked={xiLocked}
                />
              </Suspense>
            )}
          </div>
        )}
      </div>

      {/* Sticky Score CTA — pinned to the bottom of the viewport for any
          scoreable status (scheduled / live / innings_break) so it stays
          in thumb reach no matter how far the scorer scrolls. Inline-in-
          header reads like a tab strip; a full-width card removes that
          ambiguity. Label flips to "Continue scoring" once the match is
          underway. */}
      {showScoringBar && (
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
                  {scoringBarLabel}
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
          {getTeamInitials(team.short_name)}
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
