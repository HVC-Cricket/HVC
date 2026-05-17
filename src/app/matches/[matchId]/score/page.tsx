import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireTournamentAdmin } from "@/lib/auth";

import { TossForm } from "../toss-form";
import { XISection } from "../xi-section";
import { InningsBreakPanel } from "./innings-break-panel";
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
  await requireTournamentAdmin(state.tournament.id);

  // Multi-scorer lock state at page-load time. The client gate
  // refines this on mount and keeps it fresh via heartbeat.
  const initialLockStatus = await getScoringLockStatus(matchId);

  // Gating: toss set + both XIs picked.
  const hasToss = !!state.match.toss_winner_id && !!state.match.toss_decision;
  const xiACount = state.xi[state.teamA.id]?.length ?? 0;
  const xiBCount = state.xi[state.teamB.id]?.length ?? 0;
  const xisReady = xiACount >= 2 && xiBCount >= 2;

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
          <h1 className="text-2xl font-semibold">
            {state.teamA.short_name} vs {state.teamB.short_name} — Score
          </h1>
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
              />
            </div>
          </div>
        )}

        {hasToss && xisReady && state.phase === "pre_match" && (
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
