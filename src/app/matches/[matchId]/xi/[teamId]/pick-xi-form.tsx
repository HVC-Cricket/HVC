"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { savePlayingXI } from "./actions";

type Row = {
  player_id: string;
  display_name: string;
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
};

export function PickXIForm({
  matchId,
  teamId,
  playersPerSide,
  rows,
  saveLabel = "Save XI",
  onSaveSuccess,
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
        // Default: drop the scorer back where they came from (score
        // page or match page) so they don't have to navigate manually
        // after saving each side's XI.
        router.back();
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
              <td className="px-2 py-2">{r.display_name}</td>
              <td className="px-2 py-2">
                <input
                  type="checkbox"
                  checked={r.is_substitute}
                  disabled={!r.included}
                  onChange={(e) =>
                    update(r.player_id, { is_substitute: e.target.checked })
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          {includedRows.length} / {playersPerSide} playing
          {overFilled && " · over the limit (mark extras as sub)"}
          {underFilled && ` · need ${playersPerSide - includedRows.length} more`}
        </span>
        <Button onClick={onSave} disabled={pending}>
          {pending ? "Saving…" : saveLabel}
        </Button>
      </div>
    </div>
  );
}
