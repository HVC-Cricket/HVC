"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  acquireScoringLock,
  approveScoringTakeover,
  cancelScoringTakeoverRequest,
  denyScoringTakeover,
  getScoringLockStatus,
  heartbeatScoringLock,
  releaseScoringLock,
  requestScoringTakeover,
} from "./lock-actions";
import type { LockStatus } from "./lock-types";

// Heartbeat keeps the lock fresh on the holder's side — runs only when
// status === "mine". Server expiry is 120 s, so 30 s gives a 4× buffer.
const HEARTBEAT_MS = 30_000;

// Status poll is more aggressive — both sides need to see takeover
// requests / approvals / denials quickly, otherwise the holder can be
// mid-over before they notice a request banner appeared. 5 s feels
// instant in practice and the request is one cheap SELECT.
const POLL_MS = 5_000;

function formatAgo(seconds: number): string {
  if (seconds < 60) return `${seconds} sec ago`;
  const m = Math.floor(seconds / 60);
  return `${m} min ago`;
}

/**
 * Wraps the Scoreboard with a permission-based multi-scorer lock.
 *
 * - On mount: tries to acquire if the lock is free / mine / expired.
 *   If it's held by an active admin, renders the read-only banner.
 * - Held by active other → "Request takeover" button. Click files a
 *   request; the gate transitions to "waiting" state. The other tab's
 *   gate sees the request on its next tick and offers Allow / Deny.
 * - Holder side: when a pending request appears, a sticky banner sits
 *   above the Scoreboard with the requester's name + Allow / Deny.
 *   Scoring still works while the holder decides — no modal blocking.
 * - Heartbeats every TICK_MS while holding, so the holder doesn't
 *   time out mid-match. Status is also refreshed on every tick so
 *   both sides see each other's actions within 30 s.
 */
export function ScoringLockGate({
  matchId,
  initialStatus,
  children,
}: {
  matchId: string;
  initialStatus: LockStatus;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<LockStatus>(initialStatus);
  const [busy, setBusy] = useState(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  /**
   * Compare prev → next and surface transitions the user would
   * otherwise miss. Without this, both sides rely on a card silently
   * appearing / disappearing, which is easy to miss mid-keypad.
   */
  const announceTransitions = useCallback(
    (prev: LockStatus, next: LockStatus) => {
      // Holder side: a fresh request arrived (or a different requester
      // replaced the previous one).
      if (
        next.status === "mine" &&
        next.pendingRequest &&
        (prev.status !== "mine" ||
          !prev.pendingRequest ||
          prev.pendingRequest.requesterId !== next.pendingRequest.requesterId)
      ) {
        const who = next.pendingRequest.requesterName ?? "Another scorer";
        toast.warning(`${who} wants to take over scoring`, {
          duration: 8000,
        });
        // Short beep so the holder notices even if their eyes are on
        // the keypad. Falls back silently if autoplay is blocked.
        try {
          const ctx = new (window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = 880;
          gain.gain.value = 0.05;
          osc.start();
          setTimeout(() => {
            osc.stop();
            ctx.close();
          }, 180);
        } catch {
          /* autoplay blocked or AudioContext unavailable — silent */
        }
      }

      // Requester side: my pending request was approved (I'm now
      // holder). Distinct from a click-driven success toast — this
      // covers the case where I'm just polling and the holder taps
      // Allow on their phone.
      if (
        next.status === "mine" &&
        prev.status === "held" &&
        prev.myRequestPending
      ) {
        toast.success("Scoring handed over to you", { duration: 6000 });
      }

      // Requester side: my pending request is no longer pending.
      // Either the holder denied it OR the server lazy-cleared it
      // after 2 min idle. From the requester's perspective both
      // outcomes are identical (you're not in the queue anymore, you
      // can re-request), so we use a unified message instead of
      // pretending we can tell them apart.
      if (
        next.status === "held" &&
        !next.myRequestPending &&
        prev.status === "held" &&
        prev.myRequestPending
      ) {
        toast.error(
          "Your takeover request is no longer pending — try again if you still need to score",
          { duration: 6000 },
        );
      }

      // Holder side: a pending request against me disappeared without
      // my Allow / Deny click. (Click handlers update statusRef
      // synchronously via setStatus, so the next poll sees the
      // post-click state and this branch doesn't fire.) Either the
      // requester cancelled or the server auto-expired it. Quiet
      // info toast — the holder is scoring and doesn't need an alarm.
      if (
        next.status === "mine" &&
        !next.pendingRequest &&
        prev.status === "mine" &&
        prev.pendingRequest
      ) {
        toast.info("Takeover request withdrawn", { duration: 4000 });
      }

      // Old holder side: I went from "mine" to anything else — lock
      // was claimed (heartbeat expired) or transferred. One toast,
      // owned by the poll so we don't race the heartbeat path.
      if (prev.status === "mine" && next.status !== "mine") {
        toast.error("You're no longer the active scorer");
      }
    },
    [],
  );

  // On mount: try to claim the lock (succeeds if free / mine / expired).
  useEffect(() => {
    if (status.status === "mine") return;
    let cancelled = false;
    void acquireScoringLock({ matchId }).then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  // Fast poll for status transitions (5 s). Cheap — one SELECT per tick.
  useEffect(() => {
    const tick = setInterval(async () => {
      const current = statusRef.current;
      const next = await getScoringLockStatus(matchId);
      if (
        next.status !== current.status ||
        JSON.stringify(next) !== JSON.stringify(current)
      ) {
        announceTransitions(current, next);
        setStatus(next);
      }
    }, POLL_MS);
    return () => clearInterval(tick);
  }, [matchId, announceTransitions]);

  // Slow heartbeat (30 s) — only fires when I hold the lock. Detached
  // from the status poll so shortening one doesn't blow up the other.
  // Failures are silent here; the poll above detects the state
  // transition and owns the user-facing toast.
  useEffect(() => {
    const beat = setInterval(() => {
      if (statusRef.current.status !== "mine") return;
      void heartbeatScoringLock({ matchId });
    }, HEARTBEAT_MS);
    return () => clearInterval(beat);
  }, [matchId]);

  // Release on unmount (best-effort).
  useEffect(() => {
    return () => {
      void releaseScoringLock({ matchId });
    };
  }, [matchId]);

  const refresh = useCallback(async () => {
    setStatus(await getScoringLockStatus(matchId));
  }, [matchId]);

  const onRequestTakeover = useCallback(async () => {
    setBusy(true);
    try {
      const next = await requestScoringTakeover({ matchId });
      setStatus(next);
      if (next.status === "mine") {
        toast.success("You're the active scorer now");
      } else if (
        next.status === "held" &&
        next.otherRequestPending
      ) {
        toast.error(
          `${next.otherRequestPending.requesterName ?? "Another admin"} is already waiting`,
        );
      }
    } finally {
      setBusy(false);
    }
  }, [matchId]);

  const onCancelRequest = useCallback(async () => {
    setBusy(true);
    try {
      const next = await cancelScoringTakeoverRequest({ matchId });
      setStatus(next);
    } finally {
      setBusy(false);
    }
  }, [matchId]);

  const onApproveTakeover = useCallback(async () => {
    setBusy(true);
    try {
      const next = await approveScoringTakeover({ matchId });
      setStatus(next);
      toast.success("Scoring handed over");
    } finally {
      setBusy(false);
    }
  }, [matchId]);

  const onDenyTakeover = useCallback(async () => {
    setBusy(true);
    try {
      const next = await denyScoringTakeover({ matchId });
      setStatus(next);
      toast.success("Request denied");
    } finally {
      setBusy(false);
    }
  }, [matchId]);

  // I hold the lock. Render the scoreboard; if someone has a pending
  // request against me, slot a sticky banner above with Allow / Deny
  // — sticky positioning so it follows the scorer down the long
  // scoreboard instead of disappearing once they scroll.
  if (status.status === "mine") {
    return (
      <>
        {status.pendingRequest && (
          <Card
            className="sticky top-2 z-30 border-yellow-500/40 bg-yellow-500/15 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-yellow-500/10"
            role="alert"
            aria-live="polite"
          >
            <CardHeader>
              <CardTitle className="text-base">Takeover request</CardTitle>
              <CardDescription>
                <strong>
                  {status.pendingRequest.requesterName ?? "Another admin"}
                </strong>{" "}
                wants to take over scoring (asked{" "}
                {formatAgo(status.pendingRequest.secondsAgo)}). You can
                finish what you're doing first.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={onApproveTakeover}
              >
                {busy ? "Working…" : "Allow"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={onDenyTakeover}
              >
                Deny
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={refresh}
                title="Refresh state"
              >
                Refresh
              </Button>
            </CardContent>
          </Card>
        )}
        {children}
      </>
    );
  }

  if (status.status === "free") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connecting…</CardTitle>
          <CardDescription>Claiming the scoring lock.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // status === "held": someone else has the lock.
  const heartbeatLabel = formatAgo(status.secondsAgo);

  // 1. Lock is expired → safe to claim directly. Show a Claim button.
  if (status.expired) {
    return (
      <Card className="border-yellow-500/30 bg-yellow-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span>Idle</span>
            <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-normal uppercase tracking-wide text-yellow-700">
              View only
            </span>
          </CardTitle>
          <CardDescription>
            <strong>{status.holderName ?? "Another scorer"}</strong> hasn't
            heartbeat in {heartbeatLabel}. Their session looks closed — you
            can claim the lock without asking.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={onRequestTakeover}>
            {busy ? "Claiming…" : "Claim lock"}
          </Button>
          <Link
            href={`/matches/${matchId}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            View live scorecard instead
          </Link>
        </CardContent>
      </Card>
    );
  }

  // 2. My request is in flight → waiting for the holder.
  if (status.myRequestPending) {
    return (
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span>Waiting for permission</span>
          </CardTitle>
          <CardDescription>
            <strong>{status.holderName ?? "The current scorer"}</strong> has
            been asked to hand over. You'll switch to active scoring as soon
            as they tap <strong>Allow</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <ConfirmButton
            title="Cancel takeover request?"
            description="They won't be notified that you withdrew — you can ask again later."
            confirmLabel="Cancel request"
            onConfirm={onCancelRequest}
            triggerProps={{
              variant: "ghost",
              size: "sm",
              disabled: busy,
            }}
          >
            Cancel request
          </ConfirmButton>
          <Link
            href={`/matches/${matchId}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            View live scorecard instead
          </Link>
        </CardContent>
      </Card>
    );
  }

  // 3. Someone else already has a pending request.
  if (status.otherRequestPending) {
    return (
      <Card className="border-yellow-500/30 bg-yellow-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <span>Locked</span>
            <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-normal uppercase tracking-wide text-yellow-700">
              View only
            </span>
          </CardTitle>
          <CardDescription>
            <strong>{status.holderName ?? "Another scorer"}</strong> is
            recording. Last activity {heartbeatLabel}.{" "}
            <strong>
              {status.otherRequestPending.requesterName ?? "Another admin"}
            </strong>{" "}
            already has a pending takeover request — wait for that to
            resolve before asking yourself.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href={`/matches/${matchId}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            View live scorecard instead
          </Link>
        </CardContent>
      </Card>
    );
  }

  // 4. Default held-by-other: offer Request takeover.
  return (
    <Card className="border-yellow-500/30 bg-yellow-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span>Locked</span>
          <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-normal uppercase tracking-wide text-yellow-700">
            View only
          </span>
        </CardTitle>
        <CardDescription>
          <strong>{status.holderName ?? "Another scorer"}</strong> is
          recording this match. Last activity {heartbeatLabel}. To take
          over, ask their permission — they'll see a banner and decide.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={onRequestTakeover}>
          {busy ? "Sending…" : "Request takeover"}
        </Button>
        <Link
          href={`/matches/${matchId}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          View live scorecard instead
        </Link>
      </CardContent>
    </Card>
  );
}
