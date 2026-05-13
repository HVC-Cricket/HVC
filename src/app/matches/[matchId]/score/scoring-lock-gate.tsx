"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

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
  forceTakeoverScoringLock,
  heartbeatScoringLock,
  releaseScoringLock,
} from "./lock-actions";
import type { LockStatus } from "./lock-types";

// 45s heartbeat against the 120s server expiry — 2.5 ticks of grace
// before someone else can claim, even on flaky networks.
const HEARTBEAT_INTERVAL_MS = 45_000;

/**
 * Wraps the Scoreboard with a multi-scorer lock. The lock is held by
 * one tournament admin at a time:
 *  - On mount, this component tries to acquire the lock.
 *  - While holding, it heartbeats every 45s so it doesn't expire.
 *  - On unmount, it releases (best-effort — the 2-minute server-side
 *    expiry catches closed-tab scenarios).
 *
 * If another admin already holds it, the children aren't rendered —
 * instead the user sees a "View only" banner with a "Take over"
 * button. Recording is paused until they take over (or the holder
 * times out).
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

  // On mount: if we don't already hold the lock, try to claim. The
  // server will succeed if it's free, ours, or expired.
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

  // Heartbeat while we hold the lock. If the heartbeat fails (e.g.
  // someone else took over), re-query so we drop into the read-only
  // banner.
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    if (status.status !== "mine") return;
    const tick = setInterval(async () => {
      const result = await heartbeatScoringLock({ matchId });
      if (!result.ok) {
        const next = await acquireScoringLock({ matchId });
        if (next.status !== statusRef.current.status) {
          setStatus(next);
          if (next.status !== "mine") {
            toast.error("Another scorer took over this match");
          }
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(tick);
  }, [status.status, matchId]);

  // Release on unmount — best-effort. Browsers don't always run async
  // cleanup on tab close; the 2-minute server expiry is the safety
  // net for that case.
  useEffect(() => {
    return () => {
      void releaseScoringLock({ matchId });
    };
  }, [matchId]);

  const onTakeover = useCallback(async () => {
    setBusy(true);
    try {
      const next = await forceTakeoverScoringLock({ matchId });
      setStatus(next);
      if (next.status === "mine") {
        toast.success("You're the active scorer now");
      } else {
        toast.error("Couldn't take over — try again");
      }
    } finally {
      setBusy(false);
    }
  }, [matchId]);

  if (status.status === "mine") {
    return <>{children}</>;
  }

  if (status.status === "free") {
    // Mid-acquire (or the server reported free at render time and the
    // useEffect-driven acquire is in flight). Render a thin placeholder
    // so layout doesn't jump.
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connecting…</CardTitle>
          <CardDescription>Claiming the scoring lock.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // status === "held"
  const minutesAgo = Math.floor(status.secondsAgo / 60);
  const heartbeatLabel =
    minutesAgo > 0
      ? `${minutesAgo} min ago`
      : `${status.secondsAgo} sec ago`;
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
          <strong>{status.holderName ?? "Another scorer"}</strong> is recording
          this match. Last activity {heartbeatLabel}.
          {status.expired && (
            <> Their session looks idle — taking over should be safe.</>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ConfirmButton
          title="Take over scoring?"
          description={`${status.holderName ?? "The other scorer"}'s session will be cancelled and any ball they tap from here on will be rejected. Use this only if they've walked away or you're sure.`}
          confirmLabel="Take over"
          destructive
          onConfirm={onTakeover}
          triggerProps={{
            size: "sm",
            disabled: busy,
          }}
        >
          {busy ? "Taking over…" : "Take over"}
        </ConfirmButton>
        <Link
          href={`/matches/${matchId}`}
          className="ml-3 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          View live scorecard instead
        </Link>
      </CardContent>
    </Card>
  );
}
