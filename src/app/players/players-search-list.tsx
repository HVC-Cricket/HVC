"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { getInitials } from "@/lib/utils";

export type PlayerRow = {
  id: string;
  display_name: string;
  category: number | null;
  /** Joined batting + bowling style for the row's subline. */
  style_text: string;
  /** Pre-resolved photo URL (player.photo_url || linked auth avatar || null). */
  photo: string | null;
  /** /me when this is the signed-in user's linked record; /players/[id] otherwise. */
  href: string;
};

export function PlayersSearchList({ rows }: { rows: PlayerRow[] }) {
  const [query, setQuery] = useState("");
  // useDeferredValue keeps the input responsive when the list re-renders
  // — for 64 rows it's overkill but cheap insurance if the registry grows.
  const deferredQuery = useDeferredValue(query);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) => p.display_name.toLowerCase().includes(q));
  }, [rows, deferredQuery]);

  return (
    <div className="space-y-3">
      {/* Flex-row search shell instead of an absolutely-positioned icon
          on top of <Input> — the base component sets px-2.5 and Tailwind
          merge wasn't reliably overriding it on Tailwind v4, so the icon
          and the placeholder sat at the same x position. */}
      <label
        className="flex h-10 items-center gap-2 rounded-lg border border-input bg-transparent px-3 text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
      >
        <Search
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search players by name…"
          aria-label="Search players"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
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

      {query && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} match{filtered.length === 1 ? "" : "es"} for{" "}
          <span className="font-medium text-foreground">
            &ldquo;{query}&rdquo;
          </span>
        </p>
      )}

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No players match &ldquo;{query}&rdquo;.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <ul className="divide-y divide-foreground/10">
              {filtered.map((p) => (
                <li key={p.id}>
                  <Link
                    href={p.href}
                    prefetch
                    className="group flex items-center gap-3 px-4 py-3 transition hover:bg-muted/30"
                  >
                    {p.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.photo}
                        alt=""
                        className="size-11 shrink-0 rounded-full border border-foreground/10 object-cover"
                      />
                    ) : (
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                        {getInitials(p.display_name)}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium capitalize">
                          {p.display_name}
                        </span>
                        {p.category ? (
                          <span className="shrink-0 rounded-full border border-foreground/15 bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                            C{p.category}
                          </span>
                        ) : (
                          <span className="shrink-0 rounded-full border border-destructive/30 bg-destructive/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-destructive">
                            no cat
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11px] capitalize text-muted-foreground">
                        {p.style_text || "—"}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground transition group-hover:text-foreground">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
