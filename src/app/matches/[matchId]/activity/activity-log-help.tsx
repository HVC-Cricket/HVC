"use client";

import { useState } from "react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * "How does this work?" toggle for the Activity Log header. Mirrors
 * the pattern used by the MVP tab's formula card — a small text link
 * the admin can tap to reveal a detailed explanation of what the log
 * tracks, what each column means, and why it matters.
 *
 * Folded in here because scorers + organizers seeing the log for the
 * first time were asking "what is this?". Keeping the answer one tap
 * away avoids the support burden.
 */
export function ActivityLogHelp() {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-primary underline-offset-4 hover:underline"
      >
        {open ? "Hide explanation" : "How does this work?"}
      </button>

      {open && (
        <Card>
          <CardHeader className="border-b border-foreground/5">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-base">
                What is the Activity Log?
              </CardTitle>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 py-4 text-xs leading-relaxed text-muted-foreground">
            <p className="text-foreground">
              An audit trail of every scoring action taken on this match
              — like a <strong>git log</strong> for the scorecard.
              Every ball recorded, every ball voided, and every match-
              level admin action (toss, XI changes, innings transitions,
              POTM picks) is captured here with a timestamp and who did
              it.
            </p>

            <div>
              <div className="mb-1 font-semibold uppercase tracking-wide text-foreground">
                What each column means
              </div>
              <ul className="ml-4 list-disc space-y-1">
                <li>
                  <strong>When</strong> — exact timestamp the action was
                  taken
                </li>
                <li>
                  <strong>Event</strong> — <em>RECORDED</em> means a
                  ball was added; <em>VOIDED</em> means a previously-
                  recorded ball was undone
                </li>
                <li>
                  <strong>Innings</strong> — innings number + batting
                  team (e.g. <code>I2 · RS</code> = innings 2, RS
                  batting)
                </li>
                <li>
                  <strong>Over</strong> — over and ball number (e.g.{" "}
                  <code>1.6</code> = over 1, ball 6)
                </li>
                <li>
                  <strong>Ball</strong> — what happened: runs, extras,
                  wickets, batter, bowler
                </li>
                <li>
                  <strong>Scorer</strong> — which admin entered the
                  action
                </li>
              </ul>
            </div>

            <div>
              <div className="mb-1 font-semibold uppercase tracking-wide text-foreground">
                Strike-through rows
              </div>
              <p>
                A row whose ball description is{" "}
                <span className="line-through">struck through</span>{" "}
                means that ball was later voided. The corresponding{" "}
                <em>VOIDED</em> row sits just above it. The struck-
                through entry stays visible so the history is complete.
              </p>
            </div>

            <div>
              <div className="mb-1 font-semibold uppercase tracking-wide text-foreground">
                Blue rows
              </div>
              <p>
                Tinted-blue rows are <strong>match-level events</strong>
                {" "}
                — not balls. Toss set, XI changed, innings 2 started,
                match completed, Player of the Match picked. Useful for
                tracking who made non-scoring decisions.
              </p>
            </div>

            <div>
              <div className="mb-1 font-semibold uppercase tracking-wide text-foreground">
                Why it&apos;s useful
              </div>
              <ul className="ml-4 list-disc space-y-1">
                <li>
                  <strong>Dispute resolution</strong> — &ldquo;did the
                  scorer give that boundary as a 4 or a 6?&rdquo; — look
                  here for the source of truth
                </li>
                <li>
                  <strong>Catching mistakes</strong> — see when a wrong
                  ball was recorded and voided. If the void itself was a
                  mistake, you can spot it and re-record.
                </li>
                <li>
                  <strong>Accountability</strong> — every change has a
                  person attached. No anonymous edits.
                </li>
                <li>
                  <strong>Debugging</strong> — if a score looks wrong,
                  the log lets you reconstruct exactly what happened in
                  what order.
                </li>
              </ul>
            </div>

            <div>
              <div className="mb-1 font-semibold uppercase tracking-wide text-foreground">
                Who can see this
              </div>
              <p>
                Tournament <strong>organizers and scorers</strong>{" "}
                only. The page is admin-gated; public spectators do not
                see it.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
