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

// 30 s tick handles both heartbeat (only when "mine") and status
// refresh (always). Server expiry is 120 s — 4× the tick gives
// generous network slack.
const TICK_MS = 30_000;

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

  // Periodic tick: heartbeat (if mine) + refresh status (always).
  useEffect(() => {
    const tick = setInterval(async () => {
      const current = statusRef.current;
      if (current.status === "mine") {
        const r = await heartbeatScoringLock({ matchId });
        if (!r.ok) {
          // Lost the lock — re-check status.
          const next = await getScoringLockStatus(matchId);
          setStatus(next);
          if (next.status !== "mine") {
            toast.error("You lost the scoring lock");
          }
          return;
        }
      }
      const next = await getScoringLockStatus(matchId);
      // Only push state if something meaningful changed — avoids the
      // server-action call triggering an extra render on each tick.
      if (
        next.status !== current.status ||
        JSON.stringify(next) !== JSON.stringify(current)
      ) {
        setStatus(next);
      }
    }, TICK_MS);
    return () => clearInterval(tick);
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
  // request against me, slot a sticky banner above with Allow / Deny.
  if (status.status === "mine") {
    return (
      <>
        {status.pendingRequest && (
          <Card className="border-yellow-500/40 bg-yellow-500/10">
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
