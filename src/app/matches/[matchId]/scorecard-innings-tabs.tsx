"use client";

import { useState, type ReactNode } from "react";

type Tab = {
  id: string;
  /** Short label shown in the tab — e.g. "HH" or "RS". */
  label: string;
  /** Eyebrow text under the label — e.g. "1st innings · 109/2". */
  sub: string;
  panel: ReactNode;
};

/**
 * Sub-tabs for the per-innings scorecard. The full scorecard had both
 * innings stacked vertically, which on mobile turned into a 2000px
 * scroll. Now each innings is its own tab; default tab is the most
 * recent (last in the list).
 */
export function ScorecardInningsTabs({ tabs }: { tabs: Tab[] }) {
  const [active, setActive] = useState<string>(
    tabs[tabs.length - 1]?.id ?? tabs[0]?.id ?? "",
  );

  if (tabs.length === 0) return null;
  if (tabs.length === 1) return <>{tabs[0].panel}</>;

  return (
    <div className="space-y-3">
      <nav
        role="tablist"
        className="grid gap-1 rounded-lg border border-foreground/10 bg-muted/30 p-1"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((t) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => setActive(t.id)}
              className={
                "rounded-md px-3 py-2 text-left transition " +
                (isActive
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              <div className="truncate text-sm font-semibold capitalize">
                {t.label}
              </div>
              <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                {t.sub}
              </div>
            </button>
          );
        })}
      </nav>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={active !== t.id}>
          {t.panel}
        </div>
      ))}
    </div>
  );
}
