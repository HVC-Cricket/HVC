"use client";

import { useEffect, useState, type ReactNode } from "react";

type TabId = "members" | "matches" | "broadcast" | "storage" | "activity";

const TABS: { id: TabId; label: string }[] = [
  { id: "members", label: "Members" },
  { id: "matches", label: "Matches" },
  { id: "broadcast", label: "Broadcast" },
  { id: "storage", label: "Storage" },
  { id: "activity", label: "Activity" },
];

/**
 * Three-tab admin layout. All panels are rendered server-side (their
 * queries run in parallel during initial render) and we toggle
 * visibility on the client — switching tabs is instant with no
 * refetch. Active tab mirrors to `?tab=…` via history.replaceState
 * so refresh keeps the position and links are shareable, but without
 * the RSC refetch cost of router.replace on a force-dynamic route.
 *
 * Pattern lifted from `MatchTabs`; same hydration story.
 */
export function AdminTabs({
  members,
  matches,
  broadcast,
  storage,
  activity,
}: {
  members: ReactNode;
  matches: ReactNode;
  broadcast: ReactNode;
  storage: ReactNode;
  activity: ReactNode;
}) {
  const [active, setActive] = useState<TabId>("members");

  const setTab = (id: TabId) => {
    setActive(id);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (id === "members") url.searchParams.delete("tab");
    else url.searchParams.set("tab", id);
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

      <div role="tabpanel" hidden={active !== "members"}>
        {members}
      </div>
      <div role="tabpanel" hidden={active !== "matches"}>
        {matches}
      </div>
      <div role="tabpanel" hidden={active !== "broadcast"}>
        {broadcast}
      </div>
      <div role="tabpanel" hidden={active !== "storage"}>
        {storage}
      </div>
      <div role="tabpanel" hidden={active !== "activity"}>
        {activity}
      </div>
    </div>
  );
}

function readTabFromURL(): TabId {
  if (typeof window === "undefined") return "members";
  const t = new URL(window.location.href).searchParams.get("tab");
  if (
    t === "matches" ||
    t === "broadcast" ||
    t === "storage" ||
    t === "activity"
  ) {
    return t;
  }
  return "members";
}
