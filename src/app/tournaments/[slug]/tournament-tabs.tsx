"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useMemo, type ReactNode } from "react";

type TabId = "matches" | "table" | "stats" | "teams";

const TABS: { id: TabId; label: string }[] = [
  { id: "matches", label: "Matches" },
  { id: "table", label: "Table" },
  { id: "stats", label: "Stats" },
  { id: "teams", label: "Teams" },
];

/**
 * Cricbuzz-style tab nav for the tournament detail page. Mirrors the
 * match-page MatchTabs component — all panels are server-rendered in
 * parallel and we toggle visibility on the client, so switching is
 * instant with no refetch. Active tab is stored in `?tab=...` so it
 * survives refresh / sharing.
 */
export function TournamentTabs({
  matches,
  table,
  stats,
  teams,
}: {
  matches: ReactNode;
  table: ReactNode;
  stats: ReactNode;
  teams: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const active: TabId = useMemo(() => {
    const t = searchParams.get("tab");
    if (t === "table" || t === "stats" || t === "teams") return t;
    return "matches";
  }, [searchParams]);

  const setTab = useCallback(
    (id: TabId) => {
      const params = new URLSearchParams(searchParams);
      if (id === "matches") params.delete("tab");
      else params.set("tab", id);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const panels: Record<TabId, ReactNode> = {
    matches,
    table,
    stats,
    teams,
  };

  return (
    <div className="space-y-4">
      <nav
        role="tablist"
        className="-mx-4 flex overflow-x-auto border-b border-foreground/10 px-4 sm:mx-0 sm:px-0"
      >
        {TABS.map((t) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => setTab(t.id)}
              className={
                "-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition " +
                (isActive
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {TABS.map((t) => (
        <div key={t.id} role="tabpanel" hidden={active !== t.id}>
          {panels[t.id]}
        </div>
      ))}
    </div>
  );
}
