"use client";

import { Trophy } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { finalizeMatch, voidLastBall } from "./actions";
import type { ScoreboardState } from "./state";

export function MatchCompletePanel({ state }: { state: ScoreboardState }) {
  const [pending, startTransition] = useTransition();

  const i1 = state.allInnings.find((i) => i.innings_number === 1);
  const i2 = state.allInnings.find((i) => i.innings_number === 2);
  // Super-over chain — innings 3+4 is SO1, 5+6 SO2, etc. All but the
  // last pair are tied (else the match would have ended already).
  const superOvers = state.allInnings
    .filter((i) => i.innings_number >= 3)
    .sort((a, b) => a.innings_number - b.innings_number);
  const lastSuperOver = superOvers[superOvers.length - 1];

  const teamName = (id: string) =>
    id === state.teamA.id ? state.teamA.name : state.teamB.name;
  const teamShort = (id: string) =>
    id === state.teamA.id ? state.teamA.short_name : state.teamB.short_name;

  const finished = state.match.status === "completed";

  // Split the headline from the margin so we can render them at
  // different sizes — previously both lines repeated the margin.
  let primary: string;
  let secondary: string | null = null;
  if (finished) {
    if (state.match.winner_id) {
      primary = teamName(state.match.winner_id);
      secondary =
        state.match.result_type === "super_over"
          ? `${state.match.win_margin ?? "won"} (super over)`
          : state.match.win_margin ?? "won the match";
    } else if (state.match.result_type === "tie") {
      primary = "Match tied";
    } else {
      primary = "Match complete";
    }
  } else if (state.phase === "super_over_decided") {
    primary = "Super over decided";
    secondary = "Finalize to record the result.";
  } else if (state.phase === "super_over_tied") {
    primary = "Super over also tied";
  } else {
    primary = "Match complete";
    secondary = "Pending finalize.";
  }

  const onFinalize = () => {
    startTransition(async () => {
      const result = await finalizeMatch({ matchId: state.match.id });
      if (result && !result.ok) toast.error(result.error);
    });
  };

  // The last decisive ball lives in whichever innings most recently ended.
  // Pick that innings so Undo reopens the right one (super-over takes
  // precedence over the chase if it exists).
  const lastInnings = lastSuperOver ?? i2 ?? i1 ?? null;
  const onUndoLastBall = () => {
    if (!lastInnings) return;
    startTransition(async () => {
      const result = await voidLastBall({
        matchId: state.match.id,
        inningsId: lastInnings.id,
      });
      if (result && !result.ok) toast.error(result.error);
    });
  };

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
        <CardContent className="flex items-center gap-3 p-4 sm:p-5">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Trophy className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold capitalize sm:text-xl">
              {primary}
            </div>
            {secondary && (
              <div className="text-sm text-muted-foreground">{secondary}</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Final scores</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {i1 && (
            <Row
              label={`${teamShort(i1.batting_team_id)} (1st innings)`}
              value={`${i1.total_runs}/${i1.total_wickets} in ${Math.floor(i1.total_legal_balls / 6)}.${i1.total_legal_balls % 6}`}
            />
          )}
          {i2 && (
            <Row
              label={`${teamShort(i2.batting_team_id)} (2nd innings)`}
              value={`${i2.total_runs}/${i2.total_wickets} in ${Math.floor(i2.total_legal_balls / 6)}.${i2.total_legal_balls % 6}`}
            />
          )}
          {superOvers.map((so) => {
            const pairIndex = Math.ceil((so.innings_number - 2) / 2);
            const legLabel =
              superOvers.length <= 2
                ? "super over"
                : `super over ${pairIndex}`;
            return (
              <Row
                key={so.innings_number}
                label={`${teamShort(so.batting_team_id)} (${legLabel})`}
                value={`${so.total_runs}/${so.total_wickets} in ${Math.floor(so.total_legal_balls / 6)}.${so.total_legal_balls % 6}`}
              />
            );
          })}
          {!finished && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={onFinalize}
                disabled={pending}
                className="flex-1"
              >
                {pending ? "Working…" : "Finish match"}
              </Button>
              <Button
                onClick={onUndoLastBall}
                disabled={pending || !lastInnings}
                variant="outline"
                className="flex-1"
              >
                Undo last ball
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {finished && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next steps</CardTitle>
            <CardDescription>
              Scoring is done. Use these to view the full breakdown or
              correct the result.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Link href={`/matches/${state.match.id}`}>
              <Button size="sm">View full scorecard</Button>
            </Link>
            <Link href={`/matches/${state.match.id}/activity`}>
              <Button variant="ghost" size="sm">
                Activity log
              </Button>
            </Link>
            <Link href={`/matches/${state.match.id}/edit`}>
              <Button variant="ghost" size="sm">
                Edit match
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {state.phase === "super_over_tied" && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            HVC rules don&apos;t yet specify a tiebreaker beyond a single
            super over. Treating it as a final tie. If a second super over
            is needed, the schema can support innings 5/6 — wire it up in a
            follow-up.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 rounded-md border border-foreground/10 bg-muted/30 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
