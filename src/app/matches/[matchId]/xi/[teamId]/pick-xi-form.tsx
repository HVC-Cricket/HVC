"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { savePlayingXI } from "./actions";

type Row = {
  player_id: string;
  display_name: string;
  category: 1 | 2 | 3 | null;
  roster_role: string;
  included: boolean;
  batting_order: number | null;
  is_captain: boolean;
  is_keeper: boolean;
  is_substitute: boolean;
};

type Props = {
  matchId: string;
  teamId: string;
  playersPerSide: number;
  rows: Row[];
  /** Label for the save button. Defaults to "Save XI". */
  saveLabel?: string;
  /**
   * Override what happens after a successful save. Defaults to
   * `router.back()` (returns the scorer to the page they came from).
   * The combined Pick-XI-tabs flow uses this to switch to the next
   * team's tab instead of leaving.
   */
  onSaveSuccess?: () => void;
  /** When true, scoring has begun (at least one non-voided ball
   *  exists) — the form is read-only and Save is disabled. Server
   *  action re-checks the same gate. */
  locked?: boolean;
};

export function PickXIForm({
  matchId,
  teamId,
  playersPerSide,
  rows,
  saveLabel = "Save XI",
  onSaveSuccess,
  locked = false,
}: Props) {
  const router = useRouter();
  const [state, setState] = useState<Row[]>(rows);
  const [pending, startTransition] = useTransition();

  const update = (playerId: string, patch: Partial<Row>) => {
    setState((s) =>
      s.map((r) => (r.player_id === playerId ? { ...r, ...patch } : r)),
    );
  };

  const includedRows = state.filter((r) => r.included && !r.is_substitute);
  const overFilled = includedRows.length > playersPerSide;
  const underFilled = includedRows.length < playersPerSide;

  const allIncluded = state.length > 0 && state.every((r) => r.included);
  const noneIncluded = state.every((r) => !r.included);
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = !allIncluded && !noneIncluded;
    }
  }, [allIncluded, noneIncluded]);

  const toggleAll = (checked: boolean) => {
    setState((s) =>
      s.map((r) =>
        checked
          ? { ...r, included: true }
          : {
              ...r,
              included: false,
              is_captain: false,
              is_keeper: false,
              is_substitute: false,
              batting_order: null,
            },
      ),
    );
  };

  const onSave = () => {
    startTransition(async () => {
      const result = await savePlayingXI({
        matchId,
        teamId,
        entries: state
          .filter((r) => r.included)
          .map((r) => ({
            player_id: r.player_id,
            batting_order: r.batting_order ?? null,
            is_captain: !!r.is_captain,
            is_keeper: !!r.is_keeper,
            is_substitute: !!r.is_substitute,
          })),
      });
      if (result && !result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("XI saved");
      if (onSaveSuccess) {
        onSaveSuccess();
      } else {
        // Default: navigate explicitly to the match page (parent of
        // /xi). Earlier we used `router.back()`, but that's coupled to
        // browser history — users reaching the picker via a direct
        // URL, redirect chain, or post-auth navigation could end up
        // on home instead of the match. The match page is readable
        // by every role so it's always a safe destination.
        router.push(`/matches/${matchId}`);
      }
    });
  };

  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-2 py-2 font-medium">
              <label className="flex items-center gap-1.5 normal-case">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allIncluded}
                  disabled={locked}
                  onChange={(e) => toggleAll(e.target.checked)}
                  aria-label="Select all players"
                />
                <span>In</span>
              </label>
            </th>
            <th className="px-2 py-2 font-medium">Player</th>
            <th className="px-2 py-2 font-medium">Sub</th>
          </tr>
        </thead>
        <tbody>
          {state.map((r) => (
            <tr key={r.player_id} className="border-t border-foreground/10">
              <td className="px-2 py-2">
                <input
                  type="checkbox"
                  checked={r.included}
                  disabled={locked}
                  onChange={(e) =>
                    update(r.player_id, {
                      included: e.target.checked,
                      ...(e.target.checked
                        ? {}
                        : {
                            is_captain: false,
                            is_keeper: false,
                            is_substitute: false,
                            batting_order: null,
                          }),
                    })
                  }
                />
              </td>
              <td className="px-2 py-2">
                <span className="flex items-center gap-1.5">
                  <span className="capitalize">{r.display_name}</span>
                  <CategoryBadge category={r.category} />
                </span>
              </td>
              <td className="px-2 py-2">
                <input
                  type="checkbox"
                  checked={r.is_substitute}
                  disabled={!r.included || locked}
                  onChange={(e) =>
                    update(r.player_id, { is_substitute: e.target.checked })
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Save bar — full-width primary action below a clear status
          line. Beats the old side-by-side layout where the save
          button sat in the bottom-right corner looking like a
          tertiary action. Sticky-positioned so it stays in thumb
          reach even on rosters longer than the viewport. */}
      <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-foreground/10 bg-background/95 px-4 pb-[env(safe-area-inset-bottom)] pt-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <p className="text-center text-sm text-muted-foreground">
          {includedRows.length} / {playersPerSide} playing
          {overFilled && " · over the limit (mark extras as sub)"}
          {underFilled && ` · need ${playersPerSide - includedRows.length} more`}
        </p>
        <Button
          onClick={onSave}
          disabled={pending || locked}
          className="w-full"
        >
          {pending ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}

function CategoryBadge({ category }: { category: 1 | 2 | 3 | null }) {
  // Same accents the rest of the app uses — amber Cat 1, sky Cat 3,
  // muted Cat 2, destructive "no cat" so an uncategorised player
  // sticks out (organisers should fix that on /players/[id]/edit).
  if (category == null) {
    return (
      <span className="rounded-full border border-destructive/30 bg-destructive/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-destructive">
        no cat
      </span>
    );
  }
  const cls =
    category === 1
      ? "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300"
      : category === 3
        ? "border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300"
        : "border-foreground/15 bg-muted text-muted-foreground";
  return (
    <span
      className={
        "shrink-0 rounded-full border px-1.5 py-px font-mono text-[10px] " +
        cls
      }
    >
      C{category}
    </span>
  );
}
