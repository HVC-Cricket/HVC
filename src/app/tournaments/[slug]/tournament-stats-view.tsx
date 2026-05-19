"use client";

import { useMemo, useState } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const PAGE_SIZE = 10;

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

/**
 * Cricheroes' leaderboard splits into three top-level sections (BAT /
 * BOWL / FIELD) and within each section a "Style" dropdown picks a
 * specific leaderboard — we mirror that layout.
 *
 * Fielding tables are optional: cricheroes-imported seasons have no
 * per-ball fielder credits, so the FIELD section is hidden entirely
 * for those tournaments.
 */
export type Leaderboards = {
  // BAT
  topRuns: LeaderboardTable;
  topHighestScores: LeaderboardTable;
  topBattingSR: LeaderboardTable;
  topBattingAvg: LeaderboardTable;
  topFours: LeaderboardTable;
  topSixes: LeaderboardTable;
  topFifties: LeaderboardTable;
  // BOWL
  topWickets: LeaderboardTable;
  topBowlingAvg: LeaderboardTable;
  topEconomy: LeaderboardTable;
  topBowlingSR: LeaderboardTable;
  topBBI: LeaderboardTable;
  topMaidens: LeaderboardTable;
  topDots: LeaderboardTable;
  // FIELD (live-scored only)
  topCatches?: LeaderboardTable;
  topRunOuts?: LeaderboardTable;
  topStumpings?: LeaderboardTable;
  // MISC — matches played + player-of-the-match awards
  topMatches?: LeaderboardTable;
  topPOM?: LeaderboardTable;
};

type Section = "bat" | "bowl" | "field" | "misc";

type StyleOption = {
  id: keyof Leaderboards;
  label: string;
  section: Section;
};

const STYLE_OPTIONS: StyleOption[] = [
  // BAT
  { id: "topRuns", label: "Top Runs Scorers", section: "bat" },
  { id: "topHighestScores", label: "Highest Individual Scores", section: "bat" },
  { id: "topBattingSR", label: "Highest Strike Rates", section: "bat" },
  { id: "topBattingAvg", label: "Highest Averages", section: "bat" },
  { id: "topSixes", label: "Most Sixes", section: "bat" },
  { id: "topFours", label: "Most Fours", section: "bat" },
  { id: "topFifties", label: "Most Fifties", section: "bat" },
  // BOWL
  { id: "topWickets", label: "Most Wickets", section: "bowl" },
  { id: "topBowlingAvg", label: "Best Averages", section: "bowl" },
  { id: "topEconomy", label: "Best Economy", section: "bowl" },
  { id: "topBowlingSR", label: "Best Strike Rates", section: "bowl" },
  { id: "topBBI", label: "Best Bowling in an Innings", section: "bowl" },
  { id: "topMaidens", label: "Most Maiden Overs", section: "bowl" },
  { id: "topDots", label: "Most Dot Balls", section: "bowl" },
  // FIELD
  { id: "topCatches", label: "Most Catches", section: "field" },
  { id: "topRunOuts", label: "Most Run Outs", section: "field" },
  { id: "topStumpings", label: "Most Stumpings", section: "field" },
  // MISC
  { id: "topMatches", label: "Most Matches Played", section: "misc" },
  { id: "topPOM", label: "Most Player-of-the-Match", section: "misc" },
];

type CategoryFilter = "all" | "1" | "2" | "3";

const CATEGORY_CHIPS: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "1", label: "Cat 1" },
  { id: "2", label: "Cat 2" },
  { id: "3", label: "Cat 3" },
];

const SECTION_CHIPS: { id: Section; label: string }[] = [
  { id: "bat", label: "BAT" },
  { id: "bowl", label: "BOWL" },
  { id: "field", label: "FIELD" },
  { id: "misc", label: "MISC" },
];

export function TournamentStatsView({
  all,
  cat1,
  cat2,
  cat3,
  showTeam = true,
}: {
  all: Leaderboards;
  cat1: Leaderboards;
  cat2: Leaderboards;
  cat3: Leaderboards;
  /**
   * Whether to render the small team-short-name line under each
   * player. Per-tournament Stats wants it (one team per player per
   * tournament). The all-time `/stats` page hides it because players
   * switch teams across seasons — showing one is misleading and
   * showing all would clutter the row. Defaults to true.
   */
  showTeam?: boolean;
}) {
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [section, setSection] = useState<Section>("bat");
  const [styleId, setStyleId] = useState<keyof Leaderboards>("topRuns");

  const data: Leaderboards =
    filter === "1"
      ? cat1
      : filter === "2"
        ? cat2
        : filter === "3"
          ? cat3
          : all;

  // Hide FIELD entirely when the dataset has no fielding tables
  // (cricheroes-imported seasons). FIELD becomes available again the
  // moment a season is scored in our app. Same for MISC — when the
  // caller didn't pass match-played / POM data, hide the section.
  const hasFielding = Boolean(all.topCatches);
  const hasMisc = Boolean(all.topMatches);
  const sections = SECTION_CHIPS.filter((s) => {
    if (s.id === "field") return hasFielding;
    if (s.id === "misc") return hasMisc;
    return true;
  });

  // Style options filtered to the current section, omitting any
  // optional (fielding) tables the dataset doesn't include.
  const sectionStyles = useMemo(
    () =>
      STYLE_OPTIONS.filter(
        (o) => o.section === section && data[o.id] != null,
      ),
    [section, data],
  );

  // If the user switches section and the previously-selected style
  // belongs to a different section, snap to that section's first style.
  const activeStyle =
    STYLE_OPTIONS.find((o) => o.id === styleId && o.section === section) ??
    sectionStyles[0];
  const table = activeStyle ? data[activeStyle.id] : undefined;

  return (
    <div className="space-y-4">
      {/* Category filter (existing) */}
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

      {/* Section pills + style dropdown (cricheroes-like layout) */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          role="tablist"
          className="flex gap-1 rounded-full border border-foreground/10 bg-muted/30 p-1"
        >
          {sections.map((s) => {
            const isActive = section === s.id;
            return (
              <button
                key={s.id}
                role="tab"
                type="button"
                aria-selected={isActive}
                onClick={() => {
                  setSection(s.id);
                  // Snap style to first available in the new section.
                  const first = STYLE_OPTIONS.find(
                    (o) => o.section === s.id && data[o.id] != null,
                  );
                  if (first) setStyleId(first.id);
                }}
                className={
                  "rounded-full px-3 py-1.5 text-xs font-semibold tracking-wide transition " +
                  (isActive
                    ? "bg-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <select
          value={activeStyle?.id ?? ""}
          onChange={(e) => setStyleId(e.target.value as keyof Leaderboards)}
          className="ml-auto rounded-md border border-foreground/10 bg-card px-3 py-1.5 text-xs font-medium"
          aria-label="Pick a leaderboard"
        >
          {sectionStyles.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {table && activeStyle ? (
        // Remount on (filter, style) change so the per-table pagination
        // state resets to page 1 without an effect inside LeaderTable.
        <LeaderTable
          key={`${filter}:${activeStyle.id}`}
          title={activeStyle.label}
          table={table}
          showTeam={showTeam}
        />
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No data for this leaderboard yet.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function LeaderTable({
  title,
  table,
  showTeam,
}: {
  title: string;
  table: LeaderboardTable;
  showTeam: boolean;
}) {
  const [page, setPage] = useState(0);
  const totalRows = table.rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, totalRows);
  const visibleRows = table.rows.slice(start, end);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-foreground/5 bg-muted/30">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {totalRows === 0 ? (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            No data yet.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-foreground/10 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th
                      scope="col"
                      className="sticky left-0 z-10 w-[140px] max-w-[140px] bg-card px-3 py-2 text-left font-medium sm:w-[200px] sm:max-w-[200px]"
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
                  {visibleRows.map((r, idx) => {
                    const globalRank = start + idx + 1;
                    return (
                      <tr
                        key={r.name + globalRank}
                        className="border-b border-foreground/5 last:border-b-0"
                      >
                        <th
                          scope="row"
                          className="sticky left-0 z-10 w-[140px] max-w-[140px] bg-card px-3 py-2 text-left font-normal sm:w-[200px] sm:max-w-[200px]"
                        >
                          <div className="flex items-start gap-2">
                            <span
                              className={
                                "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold tabular-nums " +
                                (globalRank === 1
                                  ? "bg-primary/15 text-primary"
                                  : "bg-muted text-muted-foreground")
                              }
                            >
                              {globalRank}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0">
                                <span className="font-medium capitalize leading-tight break-words">
                                  {r.name}
                                </span>
                                {r.cat && (
                                  <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                                    C{r.cat}
                                  </span>
                                )}
                              </div>
                              {showTeam && (
                                <div className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                                  {r.team}
                                </div>
                              )}
                            </div>
                          </div>
                        </th>
                        {r.values.map((v, ci) => (
                          <td
                            key={ci}
                            className={
                              "px-2 py-2 text-right font-mono tabular-nums " +
                              (ci === 0
                                ? "font-semibold"
                                : "text-muted-foreground")
                            }
                          >
                            {v}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-2 border-t border-foreground/10 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-mono tabular-nums">
                  {start + 1}–{end} of {totalRows}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    className="rounded-md border border-foreground/10 bg-card px-2.5 py-1 font-medium transition hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Previous page"
                  >
                    Prev
                  </button>
                  <span className="px-1.5 font-mono tabular-nums">
                    {safePage + 1} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setPage((p) => Math.min(totalPages - 1, p + 1))
                    }
                    disabled={safePage >= totalPages - 1}
                    className="rounded-md border border-foreground/10 bg-card px-2.5 py-1 font-medium transition hover:bg-muted/30 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Next page"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
