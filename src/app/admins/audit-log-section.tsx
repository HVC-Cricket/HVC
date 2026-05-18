"use client";

import { Activity, Search, X } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type AuditEvent = {
  id: string;
  eventType: string;
  matchId: string;
  matchSummary: {
    matchNumber: number | null;
    tournamentName: string;
    tournamentSlug: string;
    teamA: string;
    teamB: string;
  } | null;
  createdAt: string;
  actorName: string | null;
  payload: Record<string, unknown> | null;
};

export function AuditLogSection({ events }: { events: AuditEvent[] }) {
  const [eventTypeFilter, setEventTypeFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  // Event-type chips come from whatever's in the loaded set, ordered
  // by frequency descending so the most common ones lead.
  const eventTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of events) {
      counts.set(e.eventType, (counts.get(e.eventType) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [events]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return events.filter((e) => {
      if (eventTypeFilter && e.eventType !== eventTypeFilter) return false;
      if (q) {
        const actor = e.actorName?.toLowerCase() ?? "";
        const tournament = e.matchSummary?.tournamentName.toLowerCase() ?? "";
        const teams = e.matchSummary
          ? `${e.matchSummary.teamA} ${e.matchSummary.teamB}`.toLowerCase()
          : "";
        if (
          !actor.includes(q) &&
          !tournament.includes(q) &&
          !teams.includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [events, eventTypeFilter, deferredQuery]);

  const hasFilter = eventTypeFilter !== null || query !== "";

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4 text-muted-foreground" />
            Recent activity
          </CardTitle>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {hasFilter
              ? `${filtered.length} of ${events.length}`
              : `Last ${events.length}`}
          </span>
        </div>
        <label className="flex h-10 items-center gap-2 rounded-lg border border-input bg-transparent px-3 text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
          <Search
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by actor, tournament, or team…"
            aria-label="Search activity"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none [&::-ms-clear]:hidden [&::-ms-reveal]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="-mr-1 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </label>
        {eventTypeCounts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <FilterChip
              label="All"
              count={events.length}
              active={eventTypeFilter === null}
              onClick={() => setEventTypeFilter(null)}
            />
            {eventTypeCounts.map(([type, count]) => (
              <FilterChip
                key={type}
                label={type}
                count={count}
                active={eventTypeFilter === type}
                onClick={() =>
                  setEventTypeFilter(eventTypeFilter === type ? null : type)
                }
              />
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <p className="px-6 pb-6 pt-2 text-sm text-muted-foreground">
            {events.length === 0
              ? "No match audit events recorded yet."
              : "No events match the current filter."}
          </p>
        ) : (
          <ul className="divide-y divide-foreground/10">
            {filtered.map((e) => (
              <li
                key={e.id}
                className="grid grid-cols-[8rem_1fr] items-center gap-3 px-4 py-2.5 text-sm sm:px-6"
              >
                <span className="truncate rounded bg-muted px-1.5 py-0.5 text-center font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {e.eventType}
                </span>
                <div className="min-w-0">
                  <Link
                    href={`/matches/${e.matchId}`}
                    className="block truncate font-medium capitalize hover:underline"
                  >
                    {e.matchSummary
                      ? `${e.matchSummary.tournamentName} · ${e.matchSummary.teamA} vs ${e.matchSummary.teamB}`
                      : e.matchId}
                  </Link>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {e.actorName ?? "System"} · {formatRelative(e.createdAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      onClick={onClick}
      className="h-7 gap-1.5 px-2 font-mono text-[10px]"
    >
      <span className="uppercase tracking-wide">{label}</span>
      <span
        className={cn(
          "tabular-nums",
          active ? "text-white/80" : "text-muted-foreground",
        )}
      >
        {count}
      </span>
    </Button>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}
