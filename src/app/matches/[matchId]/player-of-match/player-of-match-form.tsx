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

type Suggestion = Option & {
  reason: string;
  score: number;
};

export function PlayerOfMatchForm({
  matchId,
  current,
  suggestions,
  options,
}: {
  matchId: string;
  current: string | null;
  suggestions: Suggestion[];
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
        setValue(current ?? "");
      } else if (next === "") {
        toast.success("Reverted to auto-pick");
      } else {
        toast.success("Player of the match saved");
      }
    });
  };

  return (
    <div className="space-y-3">
      {suggestions.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs uppercase text-muted-foreground">
            Suggested by performance
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, i) => {
              const selected = value === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => save(s.id)}
                  disabled={pending}
                  className={
                    "flex flex-col items-start gap-0.5 rounded-md border px-3 py-1.5 text-left text-xs transition " +
                    (selected
                      ? "border-foreground bg-foreground/10"
                      : "border-foreground/15 hover:bg-muted")
                  }
                >
                  <span className="font-medium">
                    {i === 0 && "🏆 "}
                    {s.display_name}
                    <span className="ml-1 text-muted-foreground">
                      · {s.team_short}
                      {s.category ? ` · C${s.category}` : ""}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {s.reason}
                    <span className="ml-1 font-mono text-foreground/70">
                      [{s.score}]
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="text-xs uppercase text-muted-foreground">
          Or pick someone else
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            value={value}
            onChange={(e) => save(e.target.value)}
            disabled={pending}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
          >
            <option value="">— use auto-pick —</option>
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
              Use auto-pick
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
