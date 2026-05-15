"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type MvpEntry = {
  player_id: string;
  name: string;
  cat: number | null;
  team: string;
  /** Resolved player photo: player.photo_url || linked-user avatar || null. */
  photo: string | null;
  matches: number;
  battingPts: number;
  bowlingPts: number;
  fieldingPts: number;
  teamPts: number;
  total: number;
};

type CategoryFilter = "all" | "1" | "2" | "3";

const CATEGORY_CHIPS: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "1", label: "Cat 1" },
  { id: "2", label: "Cat 2" },
  { id: "3", label: "Cat 3" },
];

export function TournamentMvpView({
  all,
  cat1,
  cat2,
  cat3,
}: {
  all: MvpEntry[];
  cat1: MvpEntry[];
  cat2: MvpEntry[];
  cat3: MvpEntry[];
}) {
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [showFormula, setShowFormula] = useState(false);

  const data: MvpEntry[] =
    filter === "1"
      ? cat1
      : filter === "2"
        ? cat2
        : filter === "3"
          ? cat3
          : all;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
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
        <button
          type="button"
          onClick={() => setShowFormula((v) => !v)}
          className="text-xs text-primary underline-offset-4 hover:underline"
        >
          How is MVP calculated?
        </button>
      </div>

      {showFormula && <FormulaCard onClose={() => setShowFormula(false)} />}

      {data.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No MVP data for this category yet.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <ul className="divide-y divide-foreground/10">
              {data.map((e, idx) => (
                <MvpRow
                  key={e.player_id}
                  idx={idx}
                  entry={e}
                  isOpen={openId === e.player_id}
                  onToggle={() =>
                    setOpenId(openId === e.player_id ? null : e.player_id)
                  }
                />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MvpRow({
  idx,
  entry,
  isOpen,
  onToggle,
}: {
  idx: number;
  entry: MvpEntry;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-muted/30"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span
            className={
              "inline-flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold tabular-nums " +
              (idx === 0
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground")
            }
          >
            {idx + 1}
          </span>
          {entry.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={entry.photo}
              alt=""
              className="size-9 shrink-0 rounded-full border border-foreground/10 object-cover"
            />
          ) : (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold uppercase text-primary">
              {entry.name
                .split(/\s+/)
                .map((s) => s[0])
                .filter(Boolean)
                .slice(0, 2)
                .join("")
                .toUpperCase() || "?"}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium capitalize">
                {entry.name}
              </span>
              {entry.cat && (
                <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                  C{entry.cat}
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">
              <span className="font-mono uppercase tracking-wide">
                {entry.team}
              </span>
              <span className="mx-1 text-foreground/20">·</span>
              <span>
                {entry.matches} match{entry.matches === 1 ? "" : "es"}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xl font-semibold tabular-nums">
            {entry.total}
          </span>
          <ChevronDown
            className={
              "size-4 text-muted-foreground transition " +
              (isOpen ? "rotate-180" : "")
            }
          />
        </div>
      </button>
      {isOpen && (
        <div className="bg-muted/30 px-4 py-2.5 text-[11px] text-muted-foreground">
          <span className="font-mono">
            Bat:{" "}
            <span className="font-semibold text-foreground">
              {entry.battingPts}
            </span>
            {" + Bowl: "}
            <span className="font-semibold text-foreground">
              {entry.bowlingPts}
            </span>
            {" + Field: "}
            <span className="font-semibold text-foreground">
              {entry.fieldingPts}
            </span>
            {" + Team: "}
            <span className="font-semibold text-foreground">
              {entry.teamPts}
            </span>
            {" = "}
            <span className="font-semibold text-foreground">
              {entry.total}
            </span>
          </span>
        </div>
      )}
    </li>
  );
}

function FormulaCard({ onClose }: { onClose: () => void }) {
  return (
    <Card>
      <CardHeader className="border-b border-foreground/5">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base">How MVP is calculated</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 py-4 text-xs leading-relaxed text-muted-foreground">
        <p>
          MVP = sum of per-match scores. Each match gets a flat,
          transparent point total — same formula as the Player of the
          Match award. Thresholds are tuned for box cricket (small
          ground, run rates 18+, SR 200+ is par).
        </p>
        <div>
          <div className="mb-1 font-semibold uppercase tracking-wide text-foreground">
            Batting
          </div>
          <ul className="ml-4 list-disc space-y-0.5">
            <li>+1 per run · +2 per four · +5 per six</li>
            <li>+6 at 25 · +20 at 50 · +40 at 75</li>
            <li>
              SR bonus (≥6 balls): +2 at 150 SR · +4 at 200 · +8 at 250 ·
              +12 at 300
            </li>
            <li>+5 not-out finisher (15+ runs)</li>
            <li>−3 duck</li>
          </ul>
        </div>
        <div>
          <div className="mb-1 font-semibold uppercase tracking-wide text-foreground">
            Bowling
          </div>
          <ul className="ml-4 list-disc space-y-0.5">
            <li>+20 per wicket</li>
            <li>Haul: +5 for 2 · +15 for 3 · +30 for 4+</li>
            <li>+12 per maiden · +1 per dot</li>
            <li>
              Econ bonus (≥6 balls): +12 if &lt;10 · +8 if &lt;12 · +5
              if &lt;14 · +2 if &lt;16
            </li>
          </ul>
        </div>
        <div>
          <div className="mb-1 font-semibold uppercase tracking-wide text-foreground">
            Fielding
          </div>
          <ul className="ml-4 list-disc space-y-0.5">
            <li>+8 per catch · +8 per run-out · +12 per stumping</li>
            <li>+5 bonus for 3+ catches in a match</li>
          </ul>
        </div>
        <div>
          <div className="mb-1 font-semibold uppercase tracking-wide text-foreground">
            Team
          </div>
          <ul className="ml-4 list-disc space-y-0.5">
            <li>+10 if on the winning side</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
