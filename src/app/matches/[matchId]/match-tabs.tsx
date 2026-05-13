"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useCallback, useMemo, type ReactNode } from "react";

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
 * Active tab is stored in the URL (`?tab=...`) so it survives refresh,
 * is shareable, and back/forward works.
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const active: TabId = useMemo(() => {
    const t = searchParams.get("tab");
    if (t === "commentary" || t === "info") return t;
    return "scorecard";
  }, [searchParams]);

  const setTab = useCallback(
    (id: TabId) => {
      const params = new URLSearchParams(searchParams);
      if (id === "scorecard") params.delete("tab");
      else params.set("tab", id);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

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
