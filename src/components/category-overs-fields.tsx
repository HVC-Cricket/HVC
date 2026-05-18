"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Two parallel rows of "over chips" (1..overs_per_innings). Each over
 * can be tagged as Cat 1 or Cat 3 (or neither = Cat 2). An over can't
 * be Cat 1 AND Cat 3 — tapping a chip clears the other slot first.
 *
 * Used by:
 *   - Tournament edit form (default rule for the whole tournament)
 *   - Match edit form (per-match override; pass `nullable` = true so
 *     callers can pick "use tournament default" by sending null)
 *
 * Parent owns the state. Returns full arrays via the two onChange
 * callbacks — empty arrays are fine (no Cat 1 / no Cat 3 overs).
 */
export function CategoryOversFields({
  overs,
  cat1Overs,
  cat3Overs,
  onChange,
  disabled,
}: {
  /** How many overs in the innings. Drives the chip count. */
  overs: number;
  cat1Overs: number[];
  cat3Overs: number[];
  onChange: (next: { cat1Overs: number[]; cat3Overs: number[] }) => void;
  disabled?: boolean;
}) {
  const overNumbers = Array.from({ length: overs }, (_, i) => i + 1);

  const toggle = (over: number, target: 1 | 3) => {
    if (disabled) return;
    const currentSet = target === 1 ? new Set(cat1Overs) : new Set(cat3Overs);
    const otherSet = target === 1 ? new Set(cat3Overs) : new Set(cat1Overs);
    if (currentSet.has(over)) {
      currentSet.delete(over);
    } else {
      currentSet.add(over);
      otherSet.delete(over);
    }
    const nextCat1 = [...(target === 1 ? currentSet : otherSet)].sort(
      (a, b) => a - b,
    );
    const nextCat3 = [...(target === 1 ? otherSet : currentSet)].sort(
      (a, b) => a - b,
    );
    onChange({ cat1Overs: nextCat1, cat3Overs: nextCat3 });
  };

  const hasAny = cat1Overs.length > 0 || cat3Overs.length > 0;

  return (
    <div className="space-y-3">
      <ChipRow
        label="Cat 1 overs"
        hint="Overs where a Cat 1 player must face + bowl."
        overs={overNumbers}
        selected={cat1Overs}
        target={1}
        onToggle={toggle}
        disabled={disabled}
      />
      <ChipRow
        label="Cat 3 overs"
        hint="Overs where a Cat 3 player must face + bowl."
        overs={overNumbers}
        selected={cat3Overs}
        target={3}
        onToggle={toggle}
        disabled={disabled}
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">
          Overs not picked here are Cat 2 — open to any player. An over
          can&apos;t be both Cat 1 and Cat 3.
        </p>
        {/* One-click reset for the "no Cat overs at all" case so the
            organiser doesn't have to untick every chip individually
            after toggling the override on (or for a tournament that
            doesn't use categories). Hidden when both rows are
            already empty. */}
        {hasAny && !disabled && (
          <button
            type="button"
            onClick={() => onChange({ cat1Overs: [], cat3Overs: [] })}
            className="shrink-0 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear both
          </button>
        )}
      </div>
    </div>
  );
}

function ChipRow({
  label,
  hint,
  overs,
  selected,
  target,
  onToggle,
  disabled,
}: {
  label: string;
  hint: string;
  overs: number[];
  selected: number[];
  target: 1 | 3;
  onToggle: (over: number, target: 1 | 3) => void;
  disabled?: boolean;
}) {
  const selectedSet = new Set(selected);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-[10px] text-muted-foreground">{hint}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {overs.map((n) => {
          const active = selectedSet.has(n);
          return (
            <Button
              key={n}
              type="button"
              variant={active ? "default" : "outline"}
              size="sm"
              disabled={disabled}
              onClick={() => onToggle(n, target)}
              className={cn(
                "h-8 min-w-10 font-mono tabular-nums",
                active && target === 1 &&
                  "bg-amber-500 text-white hover:bg-amber-500/90",
                active && target === 3 &&
                  "bg-sky-500 text-white hover:bg-sky-500/90",
              )}
            >
              {n}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
