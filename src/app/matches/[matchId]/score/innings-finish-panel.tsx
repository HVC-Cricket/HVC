"use client";

import { Trophy } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { finalizeInnings, voidLastBall } from "./actions";
import type { ScoreboardState } from "./state";

/**
 * Pending-finalize panel for innings 1 — mirrors MatchCompletePanel.
 * Scorer either confirms (`finalizeInnings` → flips phase to
 * `innings_break`) or undoes the decisive ball (`voidLastBall` → re-
 * opens innings 1). Until they pick one, the innings 2 picker is held
 * back so they can't accidentally lock in a wrong final score.
 */
export function InningsFinishPanel({ state }: { state: ScoreboardState }) {
  const [pending, startTransition] = useTransition();
  const i1 = state.allInnings.find((i) => i.innings_number === 1);
  if (!i1) return null;

  const battingTeam =
    i1.batting_team_id === state.teamA.id ? state.teamA : state.teamB;
  const overs =
    `${Math.floor(i1.total_legal_balls / 6)}.${i1.total_legal_balls % 6}` +
    ` / ${state.rules.overs_per_innings} ov`;

  const onFinish = () => {
    startTransition(async () => {
      const result = await finalizeInnings({
        matchId: state.match.id,
        inningsId: i1.id,
      });
      if (result && !result.ok) toast.error(result.error);
    });
  };

  const onUndo = () => {
    startTransition(async () => {
      const result = await voidLastBall({
        matchId: state.match.id,
        inningsId: i1.id,
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
            <div className="truncate text-lg font-semibold sm:text-xl">
              1st innings complete
            </div>
            <div className="text-sm text-muted-foreground">
              Pending finalize.
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Innings 1 final</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex justify-between gap-3 rounded-md border border-foreground/10 bg-muted/30 px-3 py-2">
            <span className="capitalize text-muted-foreground">
              {battingTeam.name}
            </span>
            <span className="font-mono">
              {i1.total_runs}/{i1.total_wickets} in {overs}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Tap <span className="font-medium">Finish innings</span> to move
            on to the 2nd innings setup. Use{" "}
            <span className="font-medium">Undo last ball</span> if the last
            delivery was recorded incorrectly.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={onFinish} disabled={pending} className="flex-1">
              {pending ? "Working…" : "Finish innings"}
            </Button>
            <Button
              onClick={onUndo}
              disabled={pending}
              variant="outline"
              className="flex-1"
            >
              Undo last ball
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
