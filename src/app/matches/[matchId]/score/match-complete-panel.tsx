"use client";

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

import { finalizeMatch } from "./actions";
import type { ScoreboardState } from "./state";

export function MatchCompletePanel({ state }: { state: ScoreboardState }) {
  const [pending, startTransition] = useTransition();

  const i1 = state.allInnings.find((i) => i.innings_number === 1);
  const i2 = state.allInnings.find((i) => i.innings_number === 2);

  const teamName = (id: string) =>
    id === state.teamA.id ? state.teamA.name : state.teamB.name;
  const teamShort = (id: string) =>
    id === state.teamA.id ? state.teamA.short_name : state.teamB.short_name;

  const tied = state.phase === "tied_pending_super_over";
  const finished = state.match.status === "completed";

  const onFinalize = () => {
    startTransition(async () => {
      const result = await finalizeMatch({ matchId: state.match.id });
      if (result && !result.ok) toast.error(result.error);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {finished
            ? state.match.winner_id
              ? `${teamName(state.match.winner_id)} ${state.match.win_margin ?? "won"}`
              : tied
                ? "Match tied"
                : "Match complete"
            : tied
              ? "Match tied — super over needed"
              : "Match complete (pending finalize)"}
        </CardTitle>
        <CardDescription>
          {state.match.result_type === "tie"
            ? "Result: tie"
            : state.match.win_margin ?? "Final scores below."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
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
        {!finished && i2 && (
          <Button onClick={onFinalize} disabled={pending} className="w-full">
            {pending ? "Finalizing…" : "Finalize match"}
          </Button>
        )}
        {tied && finished && (
          <p className="text-muted-foreground">
            Super over is the next step. Scoring UI for super over isn't built
            yet — bookmark this for follow-up.
          </p>
        )}
      </CardContent>
    </Card>
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
