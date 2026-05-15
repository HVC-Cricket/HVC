"use client";

import { useEffect, useState, type ReactNode } from "react";

type TabId = "matches" | "table" | "stats" | "mvp" | "teams";

const TABS: { id: TabId; label: string }[] = [
  { id: "matches", label: "Matches" },
  { id: "table", label: "Table" },
  { id: "stats", label: "Stats" },
  { id: "mvp", label: "MVP" },
  { id: "teams", label: "Teams" },
];

/**
 * Cricbuzz-style tab nav for the tournament detail page. Mirrors the
 * match-page MatchTabs component — all panels are server-rendered in
 * parallel and we toggle visibility on the client, so switching is
 * instant with no refetch.
 *
 * Active tab uses local state + window.history.replaceState to mirror
 * to the URL. Earlier version used router.replace which (on
 * force-dynamic routes) re-ran every server component on every tab
 * click — felt sluggish on the match list / stats roll-ups. The mirror
 * keeps the URL shareable and refresh-safe without a network roundtrip
 * per click.
 */
export function TournamentTabs({
  matches,
  table,
  stats,
  mvp,
  teams,
}: {
  matches: ReactNode;
  table: ReactNode;
  stats: ReactNode;
  mvp: ReactNode;
  teams: ReactNode;
}) {
  const [active, setActive] = useState<TabId>(() => readTabFromURL());

  const setTab = (id: TabId) => {
    setActive(id);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (id === "matches") url.searchParams.delete("tab");
    else url.searchParams.set("tab", id);
    window.history.replaceState({}, "", url.toString());
  };

  // Keep state in sync if someone uses browser back/forward.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => setActive(readTabFromURL());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const panels: Record<TabId, ReactNode> = {
    matches,
    table,
    stats,
    mvp,
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

function readTabFromURL(): TabId {
  if (typeof window === "undefined") return "matches";
  const t = new URL(window.location.href).searchParams.get("tab");
  if (t === "table" || t === "stats" || t === "mvp" || t === "teams") return t;
  return "matches";
}
