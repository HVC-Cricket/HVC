"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Suggested by performance
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {suggestions.map((s, i) => {
              const selected = value === s.id;
              const rank = i + 1;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => save(s.id)}
                  disabled={pending}
                  className={
                    "group flex w-full items-start gap-2.5 rounded-md border px-3 py-2 text-left transition " +
                    (selected
                      ? "border-amber-500/60 bg-amber-500/10 ring-1 ring-amber-500/40"
                      : "border-foreground/15 hover:border-foreground/30 hover:bg-muted")
                  }
                >
                  <span
                    className={
                      "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold " +
                      (rank === 1
                        ? "bg-amber-500 text-white"
                        : rank === 2
                          ? "bg-slate-400 text-white"
                          : "bg-amber-700/70 text-white")
                    }
                    aria-hidden
                  >
                    {rank}
                  </span>
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="flex items-center gap-1.5 text-xs font-medium">
                      <span className="truncate capitalize">
                        {s.display_name}
                      </span>
                      <span className="shrink-0 rounded bg-foreground/10 px-1 font-mono text-[9px]">
                        {s.team_short}
                      </span>
                      {s.category && (
                        <span className="shrink-0 rounded bg-foreground/10 px-1 font-mono text-[9px]">
                          C{s.category}
                        </span>
                      )}
                    </span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">
                      {s.reason}
                    </span>
                  </span>
                  <span className="shrink-0 rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {s.score}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Or pick someone else
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Select
            value={value || undefined}
            onValueChange={(v) => save(v)}
            disabled={pending}
          >
            <SelectTrigger className="min-w-[12rem] flex-1 capitalize sm:flex-none">
              <SelectValue placeholder="— use auto-pick —" />
            </SelectTrigger>
            <SelectContent>
              {options.map((p) => (
                <SelectItem
                  key={p.id}
                  value={p.id}
                  className="capitalize"
                >
                  {p.display_name} · {p.team_short}
                  {p.category ? ` · C${p.category}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
