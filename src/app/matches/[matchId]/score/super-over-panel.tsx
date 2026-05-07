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

import { startSuperOverInnings } from "./actions";
import type { ScoreboardState } from "./state";

/**
 * Shown when the match is tied and a super over is needed.
 *
 * Phase mapping:
 *  - "tied_pending_super_over" → start super-over innings 3.
 *    Team that batted second in the main match bats first.
 *  - "super_over_break"        → start super-over innings 4.
 *    The other team bats; chase target = so1.runs + 1.
 *
 * HVC: each side may nominate up to 3 batters before the super over
 * begins. We don't enforce that yet — the scorer picks from the XI and
 * the 2-wicket cap (engine-enforced) makes the practical cap kick in
 * naturally.
 */
export function SuperOverPanel({ state }: { state: ScoreboardState }) {
  const [pending, startTransition] = useTransition();
  const [striker, setStriker] = useState("");
  const [nonStriker, setNonStriker] = useState("");
  const [bowler, setBowler] = useState("");

  const i2 = state.allInnings.find((i) => i.innings_number === 2);
  const so1 = state.allInnings.find((i) => i.innings_number === 3);

  const isInnings3 = state.phase === "tied_pending_super_over";
  const isInnings4 = state.phase === "super_over_break";
  if (!isInnings3 && !isInnings4) return null;
  if (!i2) return null;

  const battingTeamId = isInnings3
    ? i2.batting_team_id
    : (so1?.bowling_team_id ?? "");
  const bowlingTeamId =
    battingTeamId === state.teamA.id ? state.teamB.id : state.teamA.id;

  const battingTeam =
    battingTeamId === state.teamA.id ? state.teamA : state.teamB;
  const bowlingTeam =
    bowlingTeamId === state.teamA.id ? state.teamA : state.teamB;
  const battingXi = state.xi[battingTeamId] ?? [];
  const bowlingXi = state.xi[bowlingTeamId] ?? [];

  const target = isInnings4 && so1 ? so1.total_runs + 1 : null;

  const onStart = () => {
    if (!striker || !nonStriker || !bowler) {
      toast.error("Pick striker, non-striker, and bowler");
      return;
    }
    if (striker === nonStriker) {
      toast.error("Striker and non-striker must be different");
      return;
    }
    startTransition(async () => {
      const result = await startSuperOverInnings({
        matchId: state.match.id,
        inningsNumber: isInnings3 ? 3 : 4,
        striker_id: striker,
        non_striker_id: nonStriker,
        bowler_id: bowler,
      });
      if (result && !result.ok) toast.error(result.error);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {isInnings3 ? "Match tied — super over" : "Super over · innings 4"}
        </CardTitle>
        <CardDescription>
          {isInnings3 ? (
            <>
              {battingTeam.name} bats first in the super over (the side that
              batted second in the main match). Each team plays 1 over with a
              2-wicket cap.
            </>
          ) : (
            <>
              {battingTeam.name} chase{" "}
              <strong>{target}</strong> in 1 over (or until 2 wickets fall).
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
        />
        <Pick
          label={`Non-striker (${battingTeam.short_name})`}
          options={battingXi.filter((p) => p.id !== striker)}
          value={nonStriker}
          onChange={setNonStriker}
        />
        <Pick
          label={`Bowler (${bowlingTeam.short_name})`}
          options={bowlingXi}
          value={bowler}
          onChange={setBowler}
        />
        <Button onClick={onStart} disabled={pending} className="w-full">
          {pending
            ? "Starting…"
            : isInnings3
              ? "Start super over"
              : `Start chase — ${target}`}
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
}: {
  label: string;
  options: { id: string; display_name: string; category: 1 | 2 | 3 | null }[];
  value: string;
  onChange: (v: string) => void;
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
          </option>
        ))}
      </select>
    </label>
  );
}
