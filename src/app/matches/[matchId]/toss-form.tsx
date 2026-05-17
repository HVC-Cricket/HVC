"use client";

import { Check, Pencil } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { setToss } from "@/app/tournaments/[slug]/matches/actions";

type Props = {
  matchId: string;
  teamA: { id: string; name: string };
  teamB: { id: string; name: string };
  current: { toss_winner_id: string; toss_decision: "bat" | "bowl" } | null;
};

export function TossForm({ matchId, teamA, teamB, current }: Props) {
  const [winner, setWinner] = useState<string>(current?.toss_winner_id ?? "");
  const [decision, setDecision] = useState<"" | "bat" | "bowl">(
    current?.toss_decision ?? "",
  );
  const [savedWinner, setSavedWinner] = useState(current?.toss_winner_id ?? "");
  const [savedDecision, setSavedDecision] = useState<"" | "bat" | "bowl">(
    current?.toss_decision ?? "",
  );
  // `editing` is true until the user has saved at least once OR they
  // explicitly tap Edit after a save. Lets the same component double as
  // both the initial picker and the read-only summary.
  const [editing, setEditing] = useState(!current);
  const [pending, startTransition] = useTransition();

  // Auto-save when both selects are filled and the pair differs from
  // whatever the server already has. No 'Save toss' button — the form
  // commits on change once the picks are complete.
  const inFlight = useRef(false);
  useEffect(() => {
    if (!editing) return;
    if (!winner || !decision) return;
    if (winner === savedWinner && decision === savedDecision) return;
    if (inFlight.current) return;
    inFlight.current = true;
    startTransition(async () => {
      const result = await setToss({
        matchId,
        toss_winner_id: winner,
        toss_decision: decision,
      });
      inFlight.current = false;
      if (result && !result.ok) {
        toast.error(result.error);
        return;
      }
      setSavedWinner(winner);
      setSavedDecision(decision);
      // Collapse to the summary as soon as a fresh save lands. User
      // can tap Edit to reopen.
      setEditing(false);
      toast.success("Toss saved");
    });
  }, [winner, decision, savedWinner, savedDecision, matchId, editing]);

  const savedTeamName =
    savedWinner === teamA.id
      ? teamA.name
      : savedWinner === teamB.id
        ? teamB.name
        : null;

  if (!editing && savedTeamName && savedDecision) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-foreground/10 bg-muted/30 px-3 py-2 text-sm">
        <span className="flex items-center gap-2">
          <Check className="size-4 text-emerald-600 dark:text-emerald-400" />
          <span className="capitalize">
            <span className="font-medium">{savedTeamName}</span>
            <span className="mx-1.5 text-muted-foreground">·</span>
            <span>{savedDecision === "bat" ? "bat first" : "bowl first"}</span>
          </span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setEditing(true)}
          className="gap-1"
        >
          <Pencil className="size-3.5" />
          Edit
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Select value={winner || undefined} onValueChange={setWinner}>
        <SelectTrigger className="capitalize">
          <SelectValue placeholder="Toss winner…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={teamA.id} className="capitalize">
            {teamA.name}
          </SelectItem>
          <SelectItem value={teamB.id} className="capitalize">
            {teamB.name}
          </SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={decision || undefined}
        onValueChange={(v) => setDecision(v as "bat" | "bowl")}
      >
        <SelectTrigger>
          <SelectValue placeholder="Decision…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="bat">Bat first</SelectItem>
          <SelectItem value="bowl">Bowl first</SelectItem>
        </SelectContent>
      </Select>
      <p className="col-span-full text-xs text-muted-foreground">
        {pending
          ? "Saving…"
          : !winner || !decision
            ? "Pick the toss winner and what they chose — saves automatically."
            : "Saved."}
      </p>
    </div>
  );
}
