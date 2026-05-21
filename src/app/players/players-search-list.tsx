"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn, getInitials } from "@/lib/utils";

export type PlayerRow = {
  id: string;
  display_name: string;
  category: number | null;
  /** True when the player row has a `linked_user_id`. Drives the
   *  "Unlinked" filter chip — toggling that chip hides every player
   *  who has an auth account attached. */
  is_linked: boolean;
  /** Joined batting + bowling style for the row's subline. */
  style_text: string;
  /** Pre-resolved photo URL (player.photo_url || linked auth avatar || null). */
  photo: string | null;
  /** /me when this is the signed-in user's linked record; /players/[id] otherwise. */
  href: string;
};

/** Category filter state. `null` = no category filter (show all);
 *  `"none"` = only players with `category == null`; `1 | 2 | 3` =
 *  exact match. */
type CategoryFilter = null | 1 | 2 | 3 | "none";

export function PlayersSearchList({ rows }: { rows: PlayerRow[] }) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(null);
  // Orthogonal to category — toggling this chip hides linked players
  // regardless of which category chip is active, so you can scope to
  // e.g. "Cat 2 + unlinked" for targeted dedup / linking work.
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);
  // useDeferredValue keeps the input responsive when the list re-renders
  // — for 64 rows it's overkill but cheap insurance if the registry grows.
  const deferredQuery = useDeferredValue(query);

  // Per-bucket counts for the filter chips — computed off the raw
  // `rows`, not the filtered set, so each chip always shows its total.
  const counts = useMemo(() => {
    const c = { all: rows.length, 1: 0, 2: 0, 3: 0, none: 0, unlinked: 0 };
    for (const p of rows) {
      if (p.category === 1) c[1] += 1;
      else if (p.category === 2) c[2] += 1;
      else if (p.category === 3) c[3] += 1;
      else c.none += 1;
      if (!p.is_linked) c.unlinked += 1;
    }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return rows.filter((p) => {
      if (q && !p.display_name.toLowerCase().includes(q)) return false;
      if (unlinkedOnly && p.is_linked) return false;
      if (categoryFilter === null) return true;
      if (categoryFilter === "none") return p.category == null;
      return p.category === categoryFilter;
    });
  }, [rows, deferredQuery, categoryFilter, unlinkedOnly]);

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

      {/* Category filter chip row. "All" + Cat 1/2/3 + No cat — clicking
          a chip toggles it on/off (re-clicking the active one clears).
          Counts come off the unfiltered list so each chip shows its
          total regardless of what's currently selected. */}
      <div className="flex flex-wrap gap-1.5">
        <FilterChip
          label="All"
          count={counts.all}
          active={categoryFilter === null}
          onClick={() => setCategoryFilter(null)}
        />
        <FilterChip
          label="Cat 1"
          count={counts[1]}
          active={categoryFilter === 1}
          tone="cat1"
          onClick={() => setCategoryFilter(categoryFilter === 1 ? null : 1)}
        />
        <FilterChip
          label="Cat 2"
          count={counts[2]}
          active={categoryFilter === 2}
          tone="cat2"
          onClick={() => setCategoryFilter(categoryFilter === 2 ? null : 2)}
        />
        <FilterChip
          label="Cat 3"
          count={counts[3]}
          active={categoryFilter === 3}
          tone="cat3"
          onClick={() => setCategoryFilter(categoryFilter === 3 ? null : 3)}
        />
        {counts.none > 0 && (
          <FilterChip
            label="No cat"
            count={counts.none}
            active={categoryFilter === "none"}
            tone="warn"
            onClick={() =>
              setCategoryFilter(categoryFilter === "none" ? null : "none")
            }
          />
        )}
        {/* Orthogonal toggle — hides players who already have an auth
            account linked. Useful when reconciling new sign-ups against
            the registry or hunting unlinked historical imports. */}
        {counts.unlinked > 0 && (
          <FilterChip
            label="Unlinked"
            count={counts.unlinked}
            active={unlinkedOnly}
            tone="warn"
            onClick={() => setUnlinkedOnly((v) => !v)}
          />
        )}
      </div>

      {(query || categoryFilter !== null || unlinkedOnly) && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} match{filtered.length === 1 ? "" : "es"}
          {query && (
            <>
              {" "}for{" "}
              <span className="font-medium text-foreground">
                &ldquo;{query}&rdquo;
              </span>
            </>
          )}
          {categoryFilter !== null && (
            <>
              {" "}
              in{" "}
              <span className="font-medium text-foreground">
                {categoryFilter === "none"
                  ? "uncategorised"
                  : `Cat ${categoryFilter}`}
              </span>
            </>
          )}
          {unlinkedOnly && (
            <>
              {" "}
              <span className="font-medium text-foreground">
                without a linked account
              </span>
            </>
          )}
        </p>
      )}

      {filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No players match the current filter.
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

function FilterChip({
  label,
  count,
  active,
  tone,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  /** Color accent when active — keeps the chip visually tied to the
   *  Cat-N badges used elsewhere in the app (amber Cat 1, sky Cat 3,
   *  destructive for uncategorised). */
  tone?: "cat1" | "cat2" | "cat3" | "warn";
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      onClick={onClick}
      className={cn(
        "h-8 gap-1.5 px-2.5 text-xs",
        active && tone === "cat1" && "bg-amber-500 text-white hover:bg-amber-500/90",
        active && tone === "cat3" && "bg-sky-500 text-white hover:bg-sky-500/90",
        active && tone === "warn" &&
          "bg-destructive text-white hover:bg-destructive/90",
      )}
    >
      <span>{label}</span>
      <span
        className={cn(
          "rounded font-mono text-[10px] tabular-nums",
          active ? "text-white/80" : "text-muted-foreground",
        )}
      >
        {count}
      </span>
    </Button>
  );
}
