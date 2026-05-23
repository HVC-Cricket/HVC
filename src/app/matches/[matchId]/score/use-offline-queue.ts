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
  /** Optional batched task runner. When provided and the queue has
   *  multiple consecutive same-kind tasks at the head, the drain
   *  calls this with the batch instead of looping `runTask` one at
   *  a time. Should return outcomes positionally — `outcomes[i]`
   *  corresponds to `tasks[i]`. If `outcomes.length < tasks.length`,
   *  the unprocessed tasks are left in the queue for the next drain.
   *
   *  Network failures must signal `["network", "network", …]`
   *  (matching length, all "network") OR throw — both forms cause
   *  the drain to pause and keep every task. */
  runTaskBatch?: (tasks: ScoreTask[]) => Promise<DrainOutcome[]>;
  /** Called after a task is dropped (outcome "ok" or "validation").
   *  Lets the caller react — e.g. shifting the optimistic queue on a
   *  successful recordBall, or popping pendingUndos on a void. */
  onTaskComplete?: (task: ScoreTask, outcome: DrainOutcome) => void;
};

/** Max tasks to ship in one batched server call. Matches MAX_BATCH_BALLS
 *  on the server. Bigger batches help on slow networks but lengthen
 *  the wall-clock latency for the head task and put more work in one
 *  Vercel function invocation. 5 is a comfortable middle. */
const MAX_BATCH_TASKS = 5;

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
  runTaskBatch,
  onTaskComplete,
}: UseOfflineQueueOptions) {
  const [pendingCount, setPendingCount] = useState(0);
  const [isOffline, setIsOffline] = useState(false);
  const drainingRef = useRef(false);

  // The drain loop captures callbacks via refs so a change in the
  // caller's closures doesn't force a new drain function (which
  // would re-run useEffect below and double-bootstrap).
  const runTaskRef = useRef(runTask);
  const runTaskBatchRef = useRef(runTaskBatch);
  const onTaskCompleteRef = useRef(onTaskComplete);
  useEffect(() => {
    runTaskRef.current = runTask;
    runTaskBatchRef.current = runTaskBatch;
    onTaskCompleteRef.current = onTaskComplete;
  }, [runTask, runTaskBatch, onTaskComplete]);

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const tasks = await listTasksForMatch(matchId);
        if (tasks.length === 0) break;

        // Batched path: when the caller provides runTaskBatch AND the
        // head of the queue has multiple consecutive same-kind tasks,
        // ship them as one HTTP request. Cuts N round-trips down to 1
        // on slow networks where the round-trip is the dominant cost.
        // Falls through to the single-task path when there's only one
        // task ready or the caller didn't provide a batch runner.
        const batchKind = tasks[0].kind;
        const batchLimit = Math.min(tasks.length, MAX_BATCH_TASKS);
        let batchEnd = 1;
        while (batchEnd < batchLimit && tasks[batchEnd].kind === batchKind) {
          batchEnd += 1;
        }

        if (batchEnd > 1 && runTaskBatchRef.current) {
          const batch = tasks.slice(0, batchEnd);
          let outcomes: DrainOutcome[];
          try {
            outcomes = await runTaskBatchRef.current(batch);
          } catch {
            // Throw = treated as network for every task; keep them
            // all in IDB and pause the drain.
            setIsOffline(true);
            break;
          }
          // Walk results positionally. The first network outcome
          // pauses the drain — leave that task and everything after
          // it in IDB. ok / validation drops the task and fires the
          // per-task completion callback.
          let hitNetwork = false;
          for (let i = 0; i < outcomes.length; i++) {
            const task = batch[i];
            const outcome = outcomes[i];
            if (outcome === "network") {
              hitNetwork = true;
              break;
            }
            if (task.id != null) {
              try {
                await deleteTask(task.id);
              } catch {
                /* ignore — next drain will retry the delete */
              }
            }
            setPendingCount((c) => Math.max(0, c - 1));
            onTaskCompleteRef.current?.(task, outcome);
          }
          if (hitNetwork) {
            setIsOffline(true);
            break;
          }
          setIsOffline(false);
          // outcomes may be shorter than batch (server stopped early
          // on a validation failure — its handler already fired for
          // the failed task). Tasks after outcomes.length stay in
          // IDB; next drain iteration picks them up.
          continue;
        }

        // Single-task fallback — unchanged behaviour.
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
