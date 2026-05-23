import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { isTournamentOrganizer, requireTournamentAdmin } from "@/lib/auth";

import { findCategoryGaps, type TeamXISummary } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";

import { TossForm } from "../toss-form";
import { XISection } from "../xi-section";
import { InningsBreakPanel } from "./innings-break-panel";
import { InningsFinishPanel } from "./innings-finish-panel";
import { getScoringLockStatus } from "./lock-actions";
import { MatchCompletePanel } from "./match-complete-panel";
import { Scoreboard } from "./scoreboard";
import { ScoringLockGate } from "./scoring-lock-gate";
import { StartMatchPanel } from "./start-match-panel";
import { SuperOverPanel } from "./super-over-panel";
import { loadScoreboardState } from "./state";

export const dynamic = "force-dynamic";

export default async function ScorePage(props: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await props.params;
  const state = await loadScoreboardState(matchId);
  const ctx = await requireTournamentAdmin(state.tournament.id);
  // `requireTournamentAdmin` lets scorers in too. The match-settings
  // route (`/matches/[id]/edit`) is organizer-only and redirects
  // scorers to `/`, so any link pointing at it must be gated to
  // organizers here — otherwise tapping it kicks the scorer off the
  // scoring page mid-session.
  const canManage = await isTournamentOrganizer(state.tournament.id, ctx);

  // Multi-scorer lock state at page-load time. The client gate
  // refines this on mount and keeps it fresh via heartbeat.
  const initialLockStatus = await getScoringLockStatus(matchId);

  // Gating: toss set + both XIs picked. `state.xi` includes every
  // match_players row (subs too), so its length isn't a faithful
  // "playing XI count" — a team with 5 subs + 0 picked would pass a
  // `length >= 2` check even though the playing XI is empty. Pull a
  // strict non-sub count straight from `match_players` instead, and
  // require it to hit the configured `players_per_side`.
  const supabaseForCounts = await createClient();
  // Pull both the count fields AND the player's category in one query
  // so the playing-XI count and the category-coverage check stay
  // consistent. `state.xi` would have worked for the count but it
  // also includes substitutes, and EnginePlayer drops `is_substitute`
  // so we can't filter — re-fetch and filter properly here.
  const { data: xiCountRows } = await supabaseForCounts
    .from("match_players")
    .select("team_id, is_substitute, player:players(category)")
    .eq("match_id", matchId);
  type XICountRow = {
    team_id: string;
    is_substitute: boolean;
    player: { category: number | null } | null;
  };
  const rows = (xiCountRows ?? []) as unknown as XICountRow[];
  const xiACount = rows.filter(
    (r) => r.team_id === state.teamA.id && !r.is_substitute,
  ).length;
  const xiBCount = rows.filter(
    (r) => r.team_id === state.teamB.id && !r.is_substitute,
  ).length;
  const hasToss = !!state.match.toss_winner_id && !!state.match.toss_decision;
  const xisReady =
    xiACount >= state.match.players_per_side &&
    xiBCount >= state.match.players_per_side;

  // Category pre-flight. For each over flagged Cat 1 / Cat 3 by the
  // effective rules (tournament + match override merged in
  // `loadScoreboardState`), every team's PLAYING XI (subs excluded)
  // must include at least one player of that category. Subs intentionally
  // don't count — they aren't on the field at innings start.
  const catsByTeam = new Map<string, Set<1 | 2 | 3>>();
  for (const r of rows) {
    if (r.is_substitute) continue;
    const cat = r.player?.category;
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
      team_id: state.teamA.id,
      team_name: state.teamA.name,
      categories_in_xi: catsByTeam.get(state.teamA.id) ?? new Set(),
    },
    {
      team_id: state.teamB.id,
      team_name: state.teamB.name,
      categories_in_xi: catsByTeam.get(state.teamB.id) ?? new Set(),
    },
  ];
  const categoryGaps = findCategoryGaps(state.rules, teamSummaries);
  const categoryReady = categoryGaps.length === 0;

  // XI is locked once any non-voided ball exists in any innings.
  // `state.allInnings` has the aggregate totals (kept in sync by the
  // recompute_innings trigger), so we can skip a balls round-trip
  // here. Undo-all-balls drops these totals back to zero, which
  // re-opens "Edit XI" — exactly the workflow the user described.
  const xiLocked = (state.allInnings ?? []).some(
    (i) =>
      (i.total_legal_balls ?? 0) > 0 ||
      (i.total_runs ?? 0) > 0 ||
      (i.total_wickets ?? 0) > 0,
  );

  return (
    <main className="flex-1 p-3">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link
              href={`/matches/${state.match.id}`}
              className="hover:underline"
            >
              ← Match
            </Link>
            <span> · </span>
            <Link
              href={`/tournaments/${state.tournament.slug}`}
              className="hover:underline"
            >
              {state.tournament.name}
            </Link>
          </p>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h1 className="text-2xl font-semibold">
              {state.teamA.short_name} vs {state.teamB.short_name} — Score
            </h1>
            {/* Quick-access shortcuts so the scorer can fix the XI or
                (organizer only) tweak the match rules without
                bouncing to /matches/[id] and navigating from there. */}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {/* "Edit XI" is hidden once any ball is recorded —
                  changing the XI mid-match would invalidate
                  match_players references in balls / innings. Undo
                  every ball back to the start to re-open editing. */}
              {!xiLocked && (
                <Link
                  href={`/matches/${state.match.id}/xi`}
                  className="hover:underline hover:text-foreground"
                >
                  Edit XI
                </Link>
              )}
              {canManage && (
                <Link
                  href={`/matches/${state.match.id}/edit`}
                  className="hover:underline hover:text-foreground"
                >
                  Match settings
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Pre-scoring checklist. The scorer lands here from the match
            page's 'Start scoring' CTA and needs both toss + both XIs
            before the StartMatchPanel can fire — surface those steps
            inline instead of bouncing them back to the match page. */}
        {(!hasToss || !xisReady) && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Toss</CardTitle>
                <CardDescription>
                  Who won the toss and what did they choose?
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TossForm
                  matchId={state.match.id}
                  teamA={{ id: state.teamA.id, name: state.teamA.name }}
                  teamB={{ id: state.teamB.id, name: state.teamB.name }}
                  current={
                    state.match.toss_winner_id && state.match.toss_decision
                      ? {
                          toss_winner_id: state.match.toss_winner_id,
                          toss_decision: state.match.toss_decision as
                            | "bat"
                            | "bowl",
                        }
                      : null
                  }
                />
              </CardContent>
            </Card>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold">Playing XI</h2>
                <span className="text-xs text-muted-foreground">
                  {xiACount} / {state.match.players_per_side} ·{" "}
                  {xiBCount} / {state.match.players_per_side}
                </span>
              </div>
              <XISection
                matchId={state.match.id}
                tournamentId={state.tournament.id}
                playersPerSide={state.match.players_per_side}
                teamA={{
                  id: state.teamA.id,
                  name: state.teamA.name,
                  short_name: state.teamA.short_name,
                }}
                teamB={{
                  id: state.teamB.id,
                  name: state.teamB.name,
                  short_name: state.teamB.short_name,
                }}
                canManage
                xiLocked={xiLocked}
              />
            </div>
          </div>
        )}

        {/* Category pre-flight gate. Renders when toss + XIs are
            ready but the playing XIs can't satisfy the configured
            Cat 1 / Cat 3 schedule. Lists each (team, over, missing
            category) tuple so the organizer can either pick a Cat-N
            player into the XI or change the rule on the match-edit
            page. Blocks StartMatchPanel below until resolved. */}
        {hasToss && xisReady && !categoryReady && state.phase === "pre_match" && (
          <Card className="border-amber-500/30 bg-amber-500/5 dark:border-amber-400/20 dark:bg-amber-400/5">
            <CardHeader>
              <CardTitle className="text-base">
                Category coverage missing
              </CardTitle>
              <CardDescription>
                The Cat 1 / Cat 3 schedule for this match requires players
                you haven&apos;t picked into the playing XI yet. Either pick
                a matching player or change the rule on the match edit page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1.5 text-sm">
                {categoryGaps.map((g) => (
                  <li
                    key={`${g.team_id}-${g.over_number}-${g.required_category}`}
                    className="flex items-baseline gap-2"
                  >
                    <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                      Over {g.over_number}
                    </span>
                    <span>
                      <span className="font-medium capitalize">
                        {g.team_name}
                      </span>{" "}
                      has no Cat {g.required_category} player in the XI.
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                {canManage && (
                  <>
                    <Link
                      href={`/matches/${state.match.id}/edit`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Edit match rules →
                    </Link>
                    <span className="text-xs text-muted-foreground">·</span>
                  </>
                )}
                <Link
                  href={`/matches/${state.match.id}/xi`}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Edit playing XI →
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {hasToss && xisReady && categoryReady && state.phase === "pre_match" && (
          <StartMatchPanel state={state} />
        )}

        {(state.phase === "innings_1" ||
          state.phase === "innings_2" ||
          state.phase === "super_over_1" ||
          state.phase === "super_over_2") &&
          state.innings && (
            <ScoringLockGate
              matchId={matchId}
              initialStatus={initialLockStatus}
            >
              <Scoreboard state={state} />
            </ScoringLockGate>
          )}

        {state.phase === "innings_1_pending_finish" && (
          <InningsFinishPanel state={state} />
        )}

        {state.phase === "innings_break" && (
          <InningsBreakPanel state={state} />
        )}

        {(state.phase === "tied_pending_super_over" ||
          state.phase === "super_over_break") && (
          <SuperOverPanel state={state} />
        )}

        {(state.phase === "match_complete" ||
          state.phase === "super_over_decided" ||
          state.phase === "super_over_tied") && (
          <MatchCompletePanel state={state} />
        )}
      </div>
    </main>
  );
}
