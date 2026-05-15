"use client";

import { useEffect, useState, type ReactNode } from "react";

type TabId = "scorecard" | "commentary" | "info";

const TABS: { id: TabId; label: string }[] = [
  { id: "scorecard", label: "Scorecard" },
  { id: "commentary", label: "Commentary" },
  { id: "info", label: "Info" },
];

/**
 * Tabbed sections for the match detail page — Cricbuzz-style. All three
 * panels are rendered server-side (so their data fetches happen in
 * parallel during initial render) and we toggle visibility on the client,
 * so tab switching is instant with no refetch.
 *
 * Active tab is stored in local state + mirrored to the URL via
 * window.history.replaceState (NOT router.replace, which would trigger
 * a full RSC refetch on every tab click for force-dynamic routes —
 * that was making tab switching feel sluggish). The mirror lets a
 * refresh keep the active tab and the URL stay shareable without
 * costing us a network roundtrip per click.
 */
export function MatchTabs({
  scorecard,
  commentary,
  info,
}: {
  scorecard: ReactNode;
  commentary: ReactNode;
  info: ReactNode;
}) {
  // Default to "scorecard" on both server and first-client render to keep
  // hydration matched. After mount, sync from the URL — if someone landed
  // on ?tab=commentary, useEffect will swap them over in a single paint.
  const [active, setActive] = useState<TabId>("scorecard");

  const setTab = (id: TabId) => {
    setActive(id);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (id === "scorecard") url.searchParams.delete("tab");
    else url.searchParams.set("tab", id);
    // history.replaceState updates the bar without notifying the
    // Next.js router; no server roundtrip, no re-render.
    window.history.replaceState({}, "", url.toString());
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    setActive(readTabFromURL());
    const onPop = () => setActive(readTabFromURL());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className="space-y-4">
      <nav
        role="tablist"
        className="sticky top-0 z-20 -mx-4 flex overflow-x-auto border-b border-foreground/10 bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/75 sm:mx-0 sm:px-0"
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
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      <div role="tabpanel" hidden={active !== "scorecard"}>
        {scorecard}
      </div>
      <div role="tabpanel" hidden={active !== "commentary"}>
        {commentary}
      </div>
      <div role="tabpanel" hidden={active !== "info"}>
        {info}
      </div>
    </div>
  );
}

function readTabFromURL(): TabId {
  if (typeof window === "undefined") return "scorecard";
  const t = new URL(window.location.href).searchParams.get("tab");
  if (t === "commentary" || t === "info") return t;
  return "scorecard";
}
