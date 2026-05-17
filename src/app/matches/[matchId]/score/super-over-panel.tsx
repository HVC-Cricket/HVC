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

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  if (!i2) return null;

  const isFirstLeg = state.phase === "tied_pending_super_over";
  const isSecondLeg = state.phase === "super_over_break";
  if (!isFirstLeg && !isSecondLeg) return null;

  // Figure out which innings we're about to start. For the first leg
  // of a super over, that's the next odd innings ≥ 3 (the most recent
  // existing super-over innings + 1, or 3 if none yet). For the second
  // leg it's the most recent + 1 (always even).
  const superInnings = state.allInnings
    .filter((i) => i.innings_number >= 3)
    .sort((a, b) => a.innings_number - b.innings_number);
  const lastSuper = superInnings[superInnings.length - 1];
  const inningsNumber = isFirstLeg
    ? (lastSuper?.innings_number ?? 2) + 1
    : (lastSuper?.innings_number ?? 2) + 1;
  // Super over pair index for the label ("super over 1", "super over 2"
  // …) — innings 3/4 → 1, innings 5/6 → 2, etc.
  const superPairIndex = Math.ceil((inningsNumber - 2) / 2);

  // Batting / bowling team: first leg → batting team of the most recent
  // existing innings (innings 2 for first ever super over; second leg
  // of the previous super over otherwise). Second leg → flip.
  const referenceInnings = isFirstLeg
    ? (lastSuper ?? i2)
    : (lastSuper ?? i2);
  const battingTeamId = isFirstLeg
    ? referenceInnings.batting_team_id
    : referenceInnings.bowling_team_id;
  const bowlingTeamId =
    battingTeamId === state.teamA.id ? state.teamB.id : state.teamA.id;

  const battingTeam =
    battingTeamId === state.teamA.id ? state.teamA : state.teamB;
  const bowlingTeam =
    bowlingTeamId === state.teamA.id ? state.teamA : state.teamB;
  const battingXi = state.xi[battingTeamId] ?? [];
  const bowlingXi = state.xi[bowlingTeamId] ?? [];

  const target =
    isSecondLeg && lastSuper ? lastSuper.total_runs + 1 : null;

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
        inningsNumber,
        striker_id: striker,
        non_striker_id: nonStriker,
        bowler_id: bowler,
      });
      if (result && !result.ok) toast.error(result.error);
    });
  };

  const headlineFirstLeg =
    superPairIndex === 1
      ? "Match tied — super over"
      : `Super over ${superPairIndex} — previous tied`;
  const headlineSecondLeg = `Super over ${superPairIndex} · chase ${target}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {isFirstLeg ? headlineFirstLeg : headlineSecondLeg}
        </CardTitle>
        <CardDescription>
          {isFirstLeg ? (
            <>
              {battingTeam.name} bats first. Each team plays 1 over with a
              2-wicket cap. No category restrictions apply.
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
            : isFirstLeg
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
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="capitalize">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((p) => (
            <SelectItem key={p.id} value={p.id} className="capitalize">
              {p.display_name}
              {p.category ? ` · C${p.category}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
