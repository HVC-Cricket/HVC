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

import { startSecondInnings } from "./actions";
import type { ScoreboardState } from "./state";

export function InningsBreakPanel({ state }: { state: ScoreboardState }) {
  const [pending, startTransition] = useTransition();
  const [striker, setStriker] = useState("");
  const [nonStriker, setNonStriker] = useState("");
  const [bowler, setBowler] = useState("");

  const innings1 = state.allInnings.find((i) => i.innings_number === 1);
  if (!innings1) return null;

  // Sides flip for innings 2
  const battingTeamId = innings1.bowling_team_id;
  const bowlingTeamId = innings1.batting_team_id;
  const battingTeam =
    battingTeamId === state.teamA.id ? state.teamA : state.teamB;
  const bowlingTeam =
    bowlingTeamId === state.teamA.id ? state.teamA : state.teamB;
  const battingXi = state.xi[battingTeamId] ?? [];
  const bowlingXi = state.xi[bowlingTeamId] ?? [];

  const target = innings1.total_runs + 1;
  const overs =
    `${Math.floor(innings1.total_legal_balls / 6)}.${innings1.total_legal_balls % 6}` +
    ` overs`;

  const onStart = () => {
    if (!striker || !nonStriker || !bowler) {
      toast.error("Pick striker, non-striker, and opening bowler");
      return;
    }
    if (striker === nonStriker) {
      toast.error("Striker and non-striker must be different");
      return;
    }
    if (ruleEnabled) {
      const strikerPlayer = battingXi.find((p) => p.id === striker);
      const bowlerPlayer = bowlingXi.find((p) => p.id === bowler);
      if (strikerPlayer?.category === 1 && bowlerPlayer?.category !== 1) {
        toast.error(
          "First over: a Category 1 striker must face a Category 1 bowler",
        );
        return;
      }
    }
    startTransition(async () => {
      const result = await startSecondInnings({
        matchId: state.match.id,
        striker_id: striker,
        non_striker_id: nonStriker,
        bowler_id: bowler,
      });
      if (result && !result.ok) toast.error(result.error);
    });
  };

  const ruleEnabled = state.rules.categories.enabled;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Innings break</CardTitle>
        <CardDescription>
          {bowlingTeam.short_name} scored{" "}
          <strong>
            {innings1.total_runs}/{innings1.total_wickets}
          </strong>{" "}
          in {overs}.{" "}
          <strong>
            {battingTeam.short_name} need {target} to win
          </strong>{" "}
          in {state.rules.overs_per_innings} overs.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Pick
          label={`Opening striker (${battingTeam.short_name})`}
          options={battingXi}
          value={striker}
          onChange={setStriker}
          highlightCat={ruleEnabled ? 1 : undefined}
        />
        <Pick
          label={`Opening non-striker (${battingTeam.short_name})`}
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
        <Button onClick={onStart} disabled={pending} className="w-full">
          {pending ? "Starting…" : `Start innings 2 — chase ${target}`}
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
