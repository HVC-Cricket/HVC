import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireTournamentAdmin } from "@/lib/auth";

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

        {!hasToss && (
          <Card>
            <CardHeader>
              <CardTitle>Toss not set</CardTitle>
              <CardDescription>
                Set the toss on the{" "}
                <Link
                  href={`/matches/${state.match.id}`}
                  className="underline underline-offset-4"
                >
                  match page
                </Link>{" "}
                before scoring.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {hasToss && !xisReady && (
          <Card>
            <CardHeader>
              <CardTitle>Both XIs need to be picked</CardTitle>
              <CardDescription>
                {state.teamA.short_name}: {xiACount} ·{" "}
                {state.teamB.short_name}: {xiBCount}. Pick XI on the{" "}
                <Link
                  href={`/matches/${state.match.id}`}
                  className="underline underline-offset-4"
                >
                  match page
                </Link>
                .
              </CardDescription>
            </CardHeader>
          </Card>
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
