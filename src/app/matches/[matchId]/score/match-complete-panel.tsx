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
  const so1 = state.allInnings.find((i) => i.innings_number === 3);
  const so2 = state.allInnings.find((i) => i.innings_number === 4);

  const teamName = (id: string) =>
    id === state.teamA.id ? state.teamA.name : state.teamB.name;
  const teamShort = (id: string) =>
    id === state.teamA.id ? state.teamA.short_name : state.teamB.short_name;

  const finished = state.match.status === "completed";

  let title = "Match complete (pending finalize)";
  if (finished) {
    if (state.match.winner_id) {
      title = `${teamName(state.match.winner_id)} ${state.match.win_margin ?? "won"}`;
    } else if (state.match.result_type === "tie") {
      title = "Match tied";
    } else {
      title = "Match complete";
    }
  } else if (state.phase === "super_over_decided") {
    title = "Super over decided — finalize to record the result";
  } else if (state.phase === "super_over_tied") {
    title = "Super over also tied";
  }

  const onFinalize = () => {
    startTransition(async () => {
      const result = await finalizeMatch({ matchId: state.match.id });
      if (result && !result.ok) toast.error(result.error);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {state.match.result_type === "super_over"
            ? "Decided in the super over"
            : state.match.result_type === "tie"
              ? "Result: tie"
              : state.match.win_margin ?? "Final scores below."}
        </CardDescription>
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
        {so1 && (
          <Row
            label={`${teamShort(so1.batting_team_id)} (super over)`}
            value={`${so1.total_runs}/${so1.total_wickets} in ${Math.floor(so1.total_legal_balls / 6)}.${so1.total_legal_balls % 6}`}
          />
        )}
        {so2 && (
          <Row
            label={`${teamShort(so2.batting_team_id)} (super over)`}
            value={`${so2.total_runs}/${so2.total_wickets} in ${Math.floor(so2.total_legal_balls / 6)}.${so2.total_legal_balls % 6}`}
          />
        )}
        {!finished && (
          <Button onClick={onFinalize} disabled={pending} className="w-full">
            {pending ? "Finalizing…" : "Finalize match"}
          </Button>
        )}
        {state.phase === "super_over_tied" && (
          <p className="pt-2 text-muted-foreground">
            HVC rules don&apos;t yet specify a tiebreaker beyond a single
            super over. Treating it as a final tie. If a second super over is
            needed, the schema can support innings 5/6 — wire it up in a
            follow-up.
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
