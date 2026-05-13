"use client";

import { useTransition } from "react";
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
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const winner = String(fd.get("toss_winner_id") || "");
        const decision = String(fd.get("toss_decision") || "");
        if (!winner) {
          toast.error("Pick toss winner");
          return;
        }
        if (decision !== "bat" && decision !== "bowl") {
          toast.error("Pick toss decision");
          return;
        }
        startTransition(async () => {
          const result = await setToss({
            matchId,
            toss_winner_id: winner,
            toss_decision: decision,
          });
          if (result && !result.ok) {
            toast.error(result.error);
          } else {
            toast.success("Toss saved");
          }
        });
      }}
    >
      <Select
        name="toss_winner_id"
        defaultValue={current?.toss_winner_id ?? undefined}
      >
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
        name="toss_decision"
        defaultValue={current?.toss_decision ?? undefined}
      >
        <SelectTrigger>
          <SelectValue placeholder="Decision…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="bat">Bat first</SelectItem>
          <SelectItem value="bowl">Bowl first</SelectItem>
        </SelectContent>
      </Select>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Saving…" : current ? "Update toss" : "Save toss"}
      </Button>
    </form>
  );
}
