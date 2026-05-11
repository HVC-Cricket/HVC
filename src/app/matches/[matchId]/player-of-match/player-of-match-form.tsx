"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { setPlayerOfMatch } from "./actions";

type Option = {
  id: string;
  display_name: string;
  team_short: string;
  category: number | null;
};

export function PlayerOfMatchForm({
  matchId,
  current,
  options,
}: {
  matchId: string;
  current: string | null;
  options: Option[];
}) {
  const [value, setValue] = useState(current ?? "");
  const [pending, start] = useTransition();

  const save = (next: string) => {
    setValue(next);
    start(async () => {
      const result = await setPlayerOfMatch({
        matchId,
        playerId: next === "" ? null : next,
      });
      if (!result.ok) {
        toast.error(result.error);
        // revert
        setValue(current ?? "");
      } else {
        toast.success("Player of the match updated");
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs uppercase text-muted-foreground">
        Player of the match
      </span>
      <select
        value={value}
        onChange={(e) => save(e.target.value)}
        disabled={pending}
        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
      >
        <option value="">— pick a player —</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.display_name} · {p.team_short}
            {p.category ? ` · C${p.category}` : ""}
          </option>
        ))}
      </select>
      {value && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => save("")}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
