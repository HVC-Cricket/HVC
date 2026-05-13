"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  countTasksForMatch,
  deleteTask,
  enqueueTask,
  listTasksForMatch,
  type ScoreTask,
  type ScoreTaskKind,
} from "@/lib/offline-queue";

export type DrainOutcome = "ok" | "validation" | "network";

export type UseOfflineQueueOptions = {
  matchId: string;
  /** Called for each task at the head of the IDB queue. Returns:
   *   - "ok" → server accepted, drop the task
   *   - "validation" → server rejected (user-fixable), drop the task
   *   - "network" → couldn't reach server, leave in IDB + pause drain
   */
  runTask: (task: ScoreTask) => Promise<DrainOutcome>;
  /** Called after a task is dropped (outcome "ok" or "validation").
   *  Lets the caller react — e.g. shifting the optimistic queue on a
   *  successful recordBall, or popping pendingUndos on a void. */
  onTaskComplete?: (task: ScoreTask, outcome: DrainOutcome) => void;
};

/**
 * IndexedDB-backed write queue with a drain loop. Survives reloads,
 * tab close, and offline gaps of any length. The hook owns:
 *   - pendingCount (number of tasks still in IDB)
 *   - isOffline flag (last drain hit a network error, or
 *     navigator.onLine is false)
 *   - the drain loop (runs serially, pauses on network error)
 *   - online/offline event listeners + a 15s safety tick
 *
 * Domain-specific logic (which optimistic ball to pop on validation
 * rejection, etc.) belongs in the caller's `onTaskComplete` handler.
 */
export function useOfflineQueue({
  matchId,
  runTask,
  onTaskComplete,
}: UseOfflineQueueOptions) {
  const [pendingCount, setPendingCount] = useState(0);
  const [isOffline, setIsOffline] = useState(false);
  const drainingRef = useRef(false);

  // The drain loop captures `runTask` / `onTaskComplete` via refs so a
  // change in the caller's closures doesn't force a new drain function
  // (which would re-run useEffect below and double-bootstrap).
  const runTaskRef = useRef(runTask);
  const onTaskCompleteRef = useRef(onTaskComplete);
  useEffect(() => {
    runTaskRef.current = runTask;
    onTaskCompleteRef.current = onTaskComplete;
  }, [runTask, onTaskComplete]);

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const tasks = await listTasksForMatch(matchId);
        if (tasks.length === 0) break;
        const next = tasks[0];
        const outcome = await runTaskRef.current(next);
        if (outcome === "network") {
          setIsOffline(true);
          break;
        }
        if (next.id != null) {
          try {
            await deleteTask(next.id);
          } catch {
            /* ignore — next drain will retry the delete */
          }
        }
        setPendingCount((c) => Math.max(0, c - 1));
        setIsOffline(false);
        onTaskCompleteRef.current?.(next, outcome);
      }
    } finally {
      drainingRef.current = false;
    }
  }, [matchId]);

  const enqueue = useCallback(
    async (kind: ScoreTaskKind, payload: unknown) => {
      setPendingCount((c) => c + 1);
      try {
        await enqueueTask({ matchId, kind, payload });
      } catch (err) {
        console.error("[hvc-scoring] failed to persist queued task", err);
        // IDB unavailable (private mode etc.) — fall through and run
        // inline. We've already incremented the count, so make sure
        // runTask still takes the slot back.
        const outcome = await runTaskRef.current({
          matchId,
          kind,
          payload,
          createdAt: Date.now(),
        });
        setPendingCount((c) => Math.max(0, c - 1));
        if (outcome === "network") {
          toast.error("Couldn't reach server. Check your connection.");
        }
        return;
      }
      void drain();
    },
    [matchId, drain],
  );

  // Bootstrap: load any tasks left from a previous session and kick
  // off a drain. Hook the online/offline events + a 15s safety tick.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const count = await countTasksForMatch(matchId);
        if (!cancelled) setPendingCount(count);
      } catch (err) {
        console.error("[hvc-scoring] could not read offline queue", err);
      }
      void drain();
    })();

    const onOnline = () => {
      setIsOffline(false);
      void drain();
    };
    const onOffline = () => setIsOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setIsOffline(true);
    }

    const tick = setInterval(() => {
      if (!drainingRef.current) void drain();
    }, 15_000);

    return () => {
      cancelled = true;
      clearInterval(tick);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [matchId, drain]);

  return { enqueue, pendingCount, isOffline };
}
