"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { startMatch } from "./actions";
import type { ScoreboardState } from "./state";

export function StartMatchPanel({ state }: { state: ScoreboardState }) {
  const [pending, startTransition] = useTransition();

  // Determine batting / bowling teams from toss.
  const tossWinnerId = state.match.toss_winner_id!;
  const tossDecision = state.match.toss_decision!;
  const battingTeamId =
    tossDecision === "bat"
      ? tossWinnerId
      : tossWinnerId === state.teamA.id
        ? state.teamB.id
        : state.teamA.id;
  const bowlingTeamId =
    battingTeamId === state.teamA.id ? state.teamB.id : state.teamA.id;

  const battingXi = state.xi[battingTeamId] ?? [];
  const bowlingXi = state.xi[bowlingTeamId] ?? [];
  const battingTeam =
    battingTeamId === state.teamA.id ? state.teamA : state.teamB;
  const bowlingTeam =
    bowlingTeamId === state.teamA.id ? state.teamA : state.teamB;

  const [striker, setStriker] = useState("");
  const [nonStriker, setNonStriker] = useState("");
  const [bowler, setBowler] = useState("");

  const onStart = () => {
    if (!striker || !nonStriker || !bowler) {
      toast.error("Pick striker, non-striker, and opening bowler");
      return;
    }
    if (striker === nonStriker) {
      toast.error("Striker and non-striker must be different");
      return;
    }
    startTransition(async () => {
      const result = await startMatch({
        matchId: state.match.id,
        striker_id: striker,
        non_striker_id: nonStriker,
        bowler_id: bowler,
      });
      if (result && !result.ok) toast.error(result.error);
      else toast.success("Match started");
    });
  };

  // HVC: over 1 should be bowled by Cat 1 → highlight Cat 1 bowlers.
  const ruleEnabled = state.rules.categories.enabled;
  const cat1Bowlers = bowlingXi.filter((p) => p.category === 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start match</CardTitle>
        <CardDescription>
          {battingTeam.name} bats first ({tossDecision} on toss). Pick the
          openers and the first-over bowler.
          {ruleEnabled && (
            <>
              {" "}
              For HVC, the first over should be bowled by a Category 1 bowler
              against a Category 1 batter.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Pick
          label={`Striker (${battingTeam.short_name})`}
          options={battingXi}
          value={striker}
          onChange={setStriker}
          highlightCat={ruleEnabled ? 1 : undefined}
        />
        <Pick
          label={`Non-striker (${battingTeam.short_name})`}
          options={battingXi.filter((p) => p.id !== striker)}
          value={nonStriker}
          onChange={setNonStriker}
        />
        <Pick
          label={`Opening bowler (${bowlingTeam.short_name})`}
          options={bowlingXi}
          value={bowler}
          onChange={setBowler}
          highlightCat={ruleEnabled ? 1 : undefined}
        />
        {ruleEnabled && cat1Bowlers.length === 0 && (
          <p className="text-sm text-destructive">
            No Cat 1 bowlers in {bowlingTeam.short_name}'s XI. Pick any bowler
            to start; you can correct categories later.
          </p>
        )}
        <Button onClick={onStart} disabled={pending} className="w-full">
          {pending ? "Starting…" : "Start match"}
        </Button>
      </CardContent>
    </Card>
  );
}

function Pick({
  label,
  options,
  value,
  onChange,
  highlightCat,
}: {
  label: string;
  options: { id: string; display_name: string; category: 1 | 2 | 3 | null }[];
  value: string;
  onChange: (v: string) => void;
  highlightCat?: 1 | 2 | 3;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
      >
        <option value="">Select…</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.display_name}
            {p.category ? ` · C${p.category}` : ""}
            {highlightCat && p.category === highlightCat ? " ⭑" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
