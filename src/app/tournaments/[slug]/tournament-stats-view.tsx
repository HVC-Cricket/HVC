"use client";

import { useState } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type LeaderRow = {
  name: string;
  team: string;
  cat: number | null;
  /** Stat values, one per column in the parent table's `cols` array. */
  values: string[];
};

export type LeaderboardTable = {
  /** Short headers shown above each stat column (excluding the sticky
   * name column). */
  cols: string[];
  rows: LeaderRow[];
};

export type Leaderboards = {
  topRuns: LeaderboardTable;
  topWickets: LeaderboardTable;
  topHighestScores: LeaderboardTable;
  topBoundaries: LeaderboardTable;
  topSR: LeaderboardTable;
  topEcon: LeaderboardTable;
};

type CategoryFilter = "all" | "1" | "2" | "3";

const CATEGORY_CHIPS: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "1", label: "Cat 1" },
  { id: "2", label: "Cat 2" },
  { id: "3", label: "Cat 3" },
];

export function TournamentStatsView({
  all,
  cat1,
  cat2,
  cat3,
}: {
  all: Leaderboards;
  cat1: Leaderboards;
  cat2: Leaderboards;
  cat3: Leaderboards;
}) {
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const data: Leaderboards =
    filter === "1"
      ? cat1
      : filter === "2"
        ? cat2
        : filter === "3"
          ? cat3
          : all;

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        className="flex flex-wrap gap-1 rounded-full border border-foreground/10 bg-muted/30 p-1"
      >
        {CATEGORY_CHIPS.map((c) => {
          const isActive = filter === c.id;
          return (
            <button
              key={c.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => setFilter(c.id)}
              className={
                "rounded-full px-3 py-1.5 text-xs font-medium transition " +
                (isActive
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <div className="grid gap-4">
        <LeaderTable title="Most runs" table={data.topRuns} />
        <LeaderTable title="Most wickets" table={data.topWickets} />
        <LeaderTable title="Highest scores" table={data.topHighestScores} />
        <LeaderTable title="Most boundaries" table={data.topBoundaries} />
        <LeaderTable title="Best strike rate" table={data.topSR} />
        <LeaderTable title="Best economy" table={data.topEcon} />
      </div>
    </div>
  );
}

function LeaderTable({
  title,
  table,
}: {
  title: string;
  table: LeaderboardTable;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-foreground/5 bg-muted/30">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {table.rows.length === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            No data yet.
          </div>
        ) : (
          // Horizontal scroll for the stat columns; the player name
          // column stays pinned to the left via sticky positioning.
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-foreground/10 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th
                    scope="col"
                    className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium"
                  >
                    Player
                  </th>
                  {table.cols.map((c) => (
                    <th
                      key={c}
                      scope="col"
                      className="px-2 py-2 text-right font-medium"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, idx) => (
                  <tr
                    key={r.name + idx}
                    className="border-b border-foreground/5 last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-normal"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            "inline-flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold tabular-nums " +
                            (idx === 0
                              ? "bg-primary/15 text-primary"
                              : "bg-muted text-muted-foreground")
                          }
                        >
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1">
                            <span className="truncate font-medium capitalize">
                              {r.name}
                            </span>
                            {r.cat && (
                              <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                                C{r.cat}
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                            {r.team}
                          </div>
                        </div>
                      </div>
                    </th>
                    {r.values.map((v, ci) => (
                      <td
                        key={ci}
                        className={
                          "px-2 py-2 text-right font-mono tabular-nums " +
                          (ci === 0 ? "font-semibold" : "text-muted-foreground")
                        }
                      >
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
