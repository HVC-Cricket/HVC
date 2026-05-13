"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export type WicketType =
  | "bowled"
  | "caught"
  | "caught_and_bowled"
  | "run_out"
  | "stumped"
  | "hit_wicket"
  | "retired"
  | "obstructing"
  | "timed_out";

export type WicketDelivery = "legal" | "no_ball" | "wide" | "bye";

/**
 * The red "Wicket" button on the scoring page + the modal it opens.
 * Encapsulates the type / player-out / delivery / fielder selection so
 * the parent `Scoreboard` only deals with the submit payload.
 *
 * Modal behaviours:
 *  - Bottom-sheet on phones, centred dialog on tablet+
 *  - Backdrop click + Escape key + × button all close
 *  - Body scroll locked while open
 *  - Fielder picker only shown for `caught` / `run_out` / `stumped`
 *    (c&b credits the bowler implicitly)
 */
export function WicketButton({
  onSubmit,
  allowed,
  onFreeHit,
  freeHitDismissals,
  striker,
  nonStriker,
  strikerId,
  nonStrikerId,
  bowlingXi,
}: {
  onSubmit: (
    wicket_type: WicketType,
    player_out_id: string | undefined,
    fielder_id: string | undefined,
    delivery: WicketDelivery,
  ) => void;
  allowed: WicketType[];
  onFreeHit: boolean;
  freeHitDismissals: WicketType[];
  striker?: string;
  nonStriker?: string;
  strikerId: string;
  nonStrikerId: string;
  bowlingXi: { id: string; display_name: string; category: 1 | 2 | 3 | null }[];
}) {
  const [open, setOpen] = useState(false);
  const [wicketType, setWicketType] = useState<WicketType>("bowled");
  const [whoOut, setWhoOut] = useState<"striker" | "non_striker">("striker");
  const [fielder, setFielder] = useState("");
  const [delivery, setDelivery] = useState<WicketDelivery>("legal");

  const types = onFreeHit ? freeHitDismissals : allowed;
  // Fielder picker is only meaningful for `caught`, `run_out`, and
  // `stumped`. `caught_and_bowled` is, by definition, the bowler
  // catching off their own delivery — the fielder is implicit and
  // POTM scoring credits the catch to the bowler.
  const showFielder = ["caught", "run_out", "stumped"].includes(wicketType);

  const close = () => {
    setOpen(false);
    setFielder("");
    setDelivery("legal");
  };

  // Lock body scroll + escape-to-close while the modal is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <Button
        variant="destructive"
        className="h-12"
        onClick={() => setOpen(true)}
      >
        Wicket
      </Button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Record wicket"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-md space-y-3 rounded-t-xl bg-background p-4 shadow-xl sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Record wicket</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={close}
                className="rounded p-1 text-xl leading-none text-muted-foreground hover:bg-muted"
              >
                ×
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Type</span>
                <select
                  value={wicketType}
                  onChange={(e) => setWicketType(e.target.value as WicketType)}
                  className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  {types.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Player out</span>
                <select
                  value={whoOut}
                  onChange={(e) =>
                    setWhoOut(e.target.value as "striker" | "non_striker")
                  }
                  className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="striker">Striker — {striker ?? "?"}</option>
                  <option value="non_striker">
                    Non-striker — {nonStriker ?? "?"}
                  </option>
                </select>
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className="text-xs text-muted-foreground">Delivery</span>
                <select
                  value={delivery}
                  onChange={(e) =>
                    setDelivery(e.target.value as WicketDelivery)
                  }
                  className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="legal">Legal ball</option>
                  <option value="no_ball">No-ball (+1 penalty)</option>
                  <option value="wide">Wide (+1 penalty)</option>
                  <option value="bye">Bye (+1)</option>
                </select>
              </label>
            </div>

            {showFielder && (
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">
                  Fielder{" "}
                  <span className="text-muted-foreground/70">
                    ({wicketType === "stumped" ? "wicket-keeper" : "who took it"})
                  </span>
                </span>
                <select
                  value={fielder}
                  onChange={(e) => setFielder(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">—</option>
                  {bowlingXi.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.display_name}
                      {p.category ? ` · C${p.category}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  onSubmit(
                    wicketType,
                    whoOut === "striker" ? strikerId : nonStrikerId,
                    showFielder && fielder ? fielder : undefined,
                    delivery,
                  );
                  close();
                }}
              >
                Save wicket
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
