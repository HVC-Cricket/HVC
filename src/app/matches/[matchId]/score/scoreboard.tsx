"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  countTasksForMatch,
  deleteTask,
  enqueueTask,
  listTasksForMatch,
  type ScoreTask,
  type ScoreTaskKind,
} from "@/lib/offline-queue";

import { recordBall, voidLastBall, voidLastN } from "./actions";
import type { ScoreboardState } from "./state";

type WicketType =
  | "bowled"
  | "caught"
  | "caught_and_bowled"
  | "run_out"
  | "stumped"
  | "hit_wicket"
  | "retired"
  | "obstructing"
  | "timed_out";

type DrainOutcome = "ok" | "validation" | "network";

type OptimisticBall = {
  /** Stable local id used as the React key in the recent-balls strip. */
  key: string;
  /** Player attribution — needed so per-player stats lines also move
   *  on the instant the scorer taps, not only after the server confirms. */
  striker_id: string;
  non_striker_id: string;
  bowler_id: string;
  player_out_id: string | null;
  runs_off_bat: number;
  extras: number;
  extra_type: "wide" | "no_ball" | "bye" | null;
  is_wicket: boolean;
  is_legal: boolean;
};

function makeOptimistic(input: Parameters<typeof recordBall>[0]): OptimisticBall {
  const extraType = (input.extra_type ?? null) as OptimisticBall["extra_type"];
  // Wides and no-balls don't advance the legal-ball count; everything else
  // (including byes) does — matches the engine's classification.
  const isLegal = extraType !== "wide" && extraType !== "no_ball";
  return {
    key: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    striker_id: input.striker_id,
    non_striker_id: input.non_striker_id,
    bowler_id: input.bowler_id,
    player_out_id: input.player_out_id ?? null,
    runs_off_bat: input.runs_off_bat,
    extras: input.extras ?? 0,
    extra_type: extraType,
    is_wicket: input.is_wicket ?? false,
    is_legal: isLegal,
  };
}

type PendingUndo = {
  /** Server-side ball id; used to filter the recent-balls strip + as a React key. */
  ballId: string;
  runs_off_bat: number;
  extras: number;
  is_wicket: boolean;
  is_legal: boolean;
};

function makePendingUndo(b: {
  id: string;
  runs_off_bat: number;
  extras: number;
  extra_type: string | null;
  is_wicket: boolean;
}): PendingUndo {
  return {
    ballId: b.id,
    runs_off_bat: b.runs_off_bat,
    extras: b.extras,
    is_wicket: b.is_wicket,
    is_legal: b.extra_type !== "wide" && b.extra_type !== "no_ball",
  };
}

export function Scoreboard({ state }: { state: ScoreboardState }) {
  const innings = state.innings!;
  const isComplete = innings.is_complete;

  const playersById = useMemo(() => {
    const m = new Map<string, { id: string; display_name: string; category: 1 | 2 | 3 | null; team_id: string }>();
    for (const team of [state.teamA.id, state.teamB.id]) {
      for (const p of state.xi[team] ?? []) m.set(p.id, p);
    }
    return m;
  }, [state]);

  const battingTeam =
    innings.batting_team_id === state.teamA.id ? state.teamA : state.teamB;
  const bowlingTeam =
    innings.bowling_team_id === state.teamA.id ? state.teamA : state.teamB;

  const overs =
    `${Math.floor(innings.total_legal_balls / 6)}.${innings.total_legal_balls % 6}` +
    ` / ${state.rules.overs_per_innings}`;

  // Active state. If no balls yet, fall back to whoever opened the innings.
  const [strikerId, setStrikerId] = useState<string>(
    state.active.striker_id ?? state.balls[0]?.batter_id ?? "",
  );
  const [nonStrikerId, setNonStrikerId] = useState<string>(
    state.active.non_striker_id ?? state.balls[0]?.non_striker_id ?? "",
  );
  const [bowlerId, setBowlerId] = useState<string>(
    state.active.bowler_id ?? state.balls[0]?.bowler_id ?? "",
  );

  // Mobile-data realities + service-worker offline support: every write is
  // persisted to IndexedDB before the network attempt, so the queue
  // survives page reloads, tab closes, and offline gaps of any length.
  // The drain loop runs serially: on success we drop the task; on a network
  // throw we pause and resume on the `online` event (or the safety tick).
  const matchId = state.match.id;
  const [pendingCount, setPendingCount] = useState(0);
  const [isOffline, setIsOffline] = useState(false);
  const drainingRef = useRef(false);

  // Optimistic recordBall entries — pushed instantly on tap so the score
  // updates without waiting for the server. We reconcile in two ways:
  //   (1) when state.balls.length advances (server confirmed), shift the
  //       front of the queue by however many balls landed.
  //   (2) when a task is dropped due to validation rejection, also shift
  //       the front. Network errors leave optimistic entries in place so
  //       the score stays consistent until reconnect.
  const [optimistic, setOptimistic] = useState<OptimisticBall[]>([]);

  // Pending undo entries — the inverse of optimistic. When the user taps
  // "Undo" and there's nothing in the optimistic queue, we capture the
  // most recent SERVER ball and subtract it from the displayed totals
  // immediately. The server processes voidLast in the background; when
  // state.balls regresses, the matching entry pops off the front.
  const [pendingUndos, setPendingUndos] = useState<PendingUndo[]>([]);
  const serverBallsRef = useRef(state.balls.length);

  const runTask = async (task: ScoreTask): Promise<DrainOutcome> => {
    try {
      let result;
      switch (task.kind) {
        case "recordBall":
          result = await recordBall(
            task.payload as Parameters<typeof recordBall>[0],
          );
          break;
        case "voidLastBall":
          result = await voidLastBall(
            task.payload as Parameters<typeof voidLastBall>[0],
          );
          break;
        case "voidLastN":
          result = await voidLastN(
            task.payload as Parameters<typeof voidLastN>[0],
          );
          break;
      }
      if (result && !result.ok) {
        toast.error(result.error);
        return "validation";
      }
      return "ok";
    } catch {
      // Network / fetch failure — keep the task in IDB and let the drain
      // loop pause until the browser comes back online.
      return "network";
    }
  };

  const drain = async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const tasks = await listTasksForMatch(matchId);
        if (tasks.length === 0) break;
        const next = tasks[0];
        const outcome = await runTask(next);
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

        // On validation rejection, drop the matching optimistic entry —
        // server didn't accept the ball so it shouldn't stay on-screen.
        // On success, state.balls will advance/regress and the
        // reconciliation effect below clears it for us instead.
        if (outcome === "validation") {
          if (next.kind === "recordBall") {
            setOptimistic((q) => q.slice(1));
          } else if (next.kind === "voidLastBall") {
            setPendingUndos((q) => q.slice(1));
          } else if (next.kind === "voidLastN") {
            const c = (next.payload as { count?: number }).count ?? 1;
            setPendingUndos((q) => q.slice(c));
          }
        }
      }
    } finally {
      drainingRef.current = false;
    }
  };

  // Reconcile optimistic + pendingUndo queues with server state. When
  // state.balls grows (recordBall confirmed), shift optimistic from the
  // front. When it shrinks (voidLast confirmed), shift pendingUndos
  // from the front. Either way we never double-count.
  useEffect(() => {
    const prev = serverBallsRef.current;
    const cur = state.balls.length;
    if (cur > prev) {
      const advance = cur - prev;
      setOptimistic((q) => q.slice(advance));
    } else if (cur < prev) {
      const regress = prev - cur;
      setPendingUndos((q) => q.slice(regress));
    }
    serverBallsRef.current = cur;
  }, [state.balls.length]);

  // Sync the slot picks with the engine's post-rotation view ONLY when
  // a new ball lands (or one is undone). state.balls.length changing is
  // the unambiguous signal — between balls, the scorer's manual picks
  // are preserved. Bowler at over boundary is `null` server-side; we
  // clear locally so the slot tile shows "—" and the scorer has to
  // pick the next bowler before tapping a run (and recordBall rejects
  // it server-side if they don't).
  const ballsLengthSyncRef = useRef(state.balls.length);
  useEffect(() => {
    if (state.balls.length === ballsLengthSyncRef.current) return;
    ballsLengthSyncRef.current = state.balls.length;
    setStrikerId(state.active.striker_id ?? "");
    setNonStrikerId(state.active.non_striker_id ?? "");
    setBowlerId(state.active.bowler_id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.balls.length]);

  const enqueue = async (kind: ScoreTaskKind, payload: unknown) => {
    setPendingCount((c) => c + 1);
    try {
      await enqueueTask({ matchId, kind, payload });
    } catch (err) {
      console.error("[hvc-scoring] failed to persist queued task", err);
      // IDB unavailable (private mode etc.) — fall through and run inline.
      // We've already incremented the count, so make sure runTask still
      // takes the slot back.
      const outcome = await runTask({ matchId, kind, payload, createdAt: Date.now() });
      setPendingCount((c) => Math.max(0, c - 1));
      if (outcome === "network") {
        toast.error("Couldn't reach server. Check your connection.");
      }
      return;
    }
    void drain();
  };

  // On mount: load any tasks left over from a previous session and start
  // draining. Hook the online/offline events and a 15s safety tick.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  const striker = playersById.get(strikerId);
  const nonStriker = playersById.get(nonStrikerId);
  const bowler = playersById.get(bowlerId);

  const overEnded =
    state.active.legal_balls_in_over === 0 && state.balls.length > 0;

  const submit = (
    overrides: Partial<Parameters<typeof recordBall>[0]>,
  ) => {
    if (isComplete) {
      toast.error("Innings complete");
      return;
    }
    const missing: string[] = [];
    if (!strikerId) missing.push("striker");
    if (!nonStrikerId) missing.push("non-striker");
    if (!bowlerId) missing.push("bowler");
    if (missing.length > 0) {
      const list =
        missing.length === 1
          ? missing[0]
          : missing.length === 2
            ? `${missing[0]} and ${missing[1]}`
            : `${missing.slice(0, -1).join(", ")}, and ${missing[missing.length - 1]}`;
      toast.error(`Pick the ${list} first`);
      return;
    }
    const input = {
      matchId: state.match.id,
      inningsId: innings.id,
      striker_id: strikerId,
      non_striker_id: nonStrikerId,
      bowler_id: bowlerId,
      runs_off_bat: 0,
      extras: 0,
      extra_type: null,
      is_wicket: false,
      ...overrides,
    };
    // Push the optimistic ball BEFORE awaiting anything — this is the
    // whole point of the fix: the score updates the instant the tap
    // lands, not after the server roundtrip.
    setOptimistic((q) => [...q, makeOptimistic(input)]);
    void enqueue("recordBall", input);
  };

  const undo = () => {
    // If there's an optimistic ball waiting, drop it immediately so the
    // UI follows the user's intent without lag. The queued recordBall +
    // upcoming voidLast still execute on the server and net to nothing.
    if (optimistic.length > 0) {
      setOptimistic((q) => q.slice(0, -1));
    } else {
      // Pure server-side undo — capture the most recent confirmed ball
      // (skipping anything already in the pending-undo queue) so the
      // displayed score drops instantly.
      const idx = state.balls.length - 1 - pendingUndos.length;
      const ball = idx >= 0 ? state.balls[idx] : undefined;
      if (ball) {
        setPendingUndos((q) => [...q, makePendingUndo(ball)]);
      }
    }
    void enqueue("voidLastBall", {
      matchId: state.match.id,
      inningsId: innings.id,
    });
  };

  const undoMany = (count: number) => {
    if (count <= 0) {
      toast.error("Nothing to undo");
      return;
    }
    const fromOpt = Math.min(optimistic.length, count);
    const fromServer = count - fromOpt;
    if (fromOpt > 0) {
      setOptimistic((q) => q.slice(0, q.length - fromOpt));
    }
    if (fromServer > 0) {
      const startIdx = state.balls.length - pendingUndos.length - fromServer;
      const additions: PendingUndo[] = [];
      for (let i = 0; i < fromServer; i++) {
        const b = state.balls[startIdx + i];
        if (b) additions.push(makePendingUndo(b));
      }
      if (additions.length > 0) {
        setPendingUndos((q) => [...q, ...additions]);
      }
    }
    void enqueue("voidLastN", {
      matchId: state.match.id,
      inningsId: innings.id,
      count,
    });
  };

  // Combine the server-confirmed innings totals with the optimistic +
  // pending-undo queues so the headline numbers move the instant the
  // scorer taps a run / wicket / extra / undo.
  const optimisticRuns = optimistic.reduce(
    (sum, b) => sum + b.runs_off_bat + b.extras,
    0,
  );
  const optimisticWickets = optimistic.reduce(
    (sum, b) => sum + (b.is_wicket ? 1 : 0),
    0,
  );
  const optimisticLegalBalls = optimistic.reduce(
    (sum, b) => sum + (b.is_legal ? 1 : 0),
    0,
  );
  const undoRuns = pendingUndos.reduce(
    (sum, b) => sum + b.runs_off_bat + b.extras,
    0,
  );
  const undoWickets = pendingUndos.reduce(
    (sum, b) => sum + (b.is_wicket ? 1 : 0),
    0,
  );
  const undoLegalBalls = pendingUndos.reduce(
    (sum, b) => sum + (b.is_legal ? 1 : 0),
    0,
  );
  const displayRuns = innings.total_runs + optimisticRuns - undoRuns;
  const displayWickets = innings.total_wickets + optimisticWickets - undoWickets;
  const displayLegalBalls =
    innings.total_legal_balls + optimisticLegalBalls - undoLegalBalls;
  // Format "X.Y / Z ov" — standard cricket notation where X.Y is
  // completed-overs.balls-into-next-over (NOT a decimal). The trailing
  // "ov" disambiguates the slash, otherwise it looks like a fraction.
  const displayOvers =
    `${Math.floor(displayLegalBalls / 6)}.${displayLegalBalls % 6}` +
    ` / ${state.rules.overs_per_innings} ov`;

  // Hide server balls that are pending undo from the recent-balls strip
  // so the user sees them disappear the moment they tap Undo.
  const hiddenBallIds = new Set(pendingUndos.map((p) => p.ballId));
  const visibleServerCurrent = state.currentOverBalls.filter(
    (b) => !hiddenBallIds.has(b.id),
  );
  const visibleServerPrevious = state.previousOverBalls.filter(
    (b) => !hiddenBallIds.has(b.id),
  );

  // Render the optimistic balls onto the end of the current-over strip.
  // Over-boundary recompute is left to the server — the strip flicks to
  // the correct over the moment revalidation lands.
  const optimisticRenderBalls = optimistic.map((b) => ({
    id: b.key,
    runs_off_bat: b.runs_off_bat,
    extras: b.extras,
    extra_type: b.extra_type,
    is_wicket: b.is_wicket,
    is_optimistic: true,
  }));

  const visibleBalls =
    state.balls.length + optimistic.length - pendingUndos.length;
  const visibleThisOver =
    visibleServerCurrent.length + optimisticRenderBalls.length;

  return (
    <div className="space-y-4">
      {/* Top scoreboard */}
      <Card className={state.active.free_hit_pending ? "ring-2 ring-yellow-400" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-baseline gap-3">
            <span className="font-mono text-3xl">
              {displayRuns}/{displayWickets}
            </span>
            <span className="text-base font-normal text-muted-foreground">
              {displayOvers}
            </span>
            {state.active.free_hit_pending && (
              <span className="text-xs font-medium uppercase text-yellow-600">
                Free hit
              </span>
            )}
            {state.active.is_special_over && (
              <span className="text-xs font-medium uppercase text-blue-600">
                {state.active.is_special_over.toUpperCase()} over
              </span>
            )}
          </CardTitle>
          <CardDescription>
            {battingTeam.name} batting · {bowlingTeam.name} bowling · innings{" "}
            {innings.innings_number}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          {/* Slot tiles double as the picker — tap a tile, native mobile
              picker opens, pick a player, done. No second "Who's batting"
              card; that was confusing duplication. Stats line below
              each name surfaces the player's current contribution so
              the scorer always has context. */}
          <SlotPicker
            label="Striker"
            value={strikerId}
            options={state.xi[innings.batting_team_id] ?? []}
            onChange={setStrikerId}
            statsLine={formatBatterStats(state.balls, strikerId, optimistic)}
          />
          <SlotPicker
            label="Non-striker"
            value={nonStrikerId}
            options={state.xi[innings.batting_team_id] ?? []}
            onChange={setNonStrikerId}
            statsLine={formatBatterStats(state.balls, nonStrikerId, optimistic)}
          />
          <SlotPicker
            label="Bowler"
            value={bowlerId}
            options={state.xi[innings.bowling_team_id] ?? []}
            onChange={setBowlerId}
            highlightCat={
              state.active.is_special_over === "cat1"
                ? 1
                : state.active.is_special_over === "cat3"
                  ? 3
                  : 2
            }
            statsLine={formatBowlerStats(state.balls, bowlerId, optimistic)}
          />
        </CardContent>
      </Card>

      {/* Recent balls strip — optimistic balls render at the end of the
          current over so the dot/4/6 pill appears the moment you tap;
          pending-undo balls drop from the strip the moment Undo lands. */}
      {(visibleServerCurrent.length > 0 ||
        visibleServerPrevious.length > 0 ||
        optimisticRenderBalls.length > 0) && (
        <RecentBalls
          current={[...visibleServerCurrent, ...optimisticRenderBalls]}
          previous={visibleServerPrevious}
        />
      )}

      {/* Ball entry */}
      {!isComplete && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              <span>Record ball</span>
              <span className="flex items-center gap-2">
                {isOffline && (
                  <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-normal text-destructive">
                    Offline · queuing
                  </span>
                )}
                {pendingCount > 0 && (
                  <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs font-normal text-yellow-700">
                    Saving {pendingCount} ball{pendingCount === 1 ? "" : "s"}…
                  </span>
                )}
              </span>
            </CardTitle>
            <CardDescription className="text-xs">
              Saved on-device first; syncs the moment signal returns.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* Primary action: runs off the bat. Bigger taps; one row on
                desktop, two rows on phone. Active state gives haptic-y
                press feedback for fast scoring. */}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {[0, 1, 2, 3, 4, 6].map((n) => (
                <Button
                  key={n}
                  variant="outline"
                  className="h-20 text-3xl font-mono active:scale-[0.97] active:bg-muted/60"
                  onClick={() => submit({ runs_off_bat: n })}
                >
                  {n}
                </Button>
              ))}
            </div>
            {/* Wides: penalty 1 + N additional wide runs (overthrows / boundary off wide) */}
            <div className="grid grid-cols-4 gap-2">
              {[0, 1, 2, 4].map((n) => (
                <Button
                  key={n}
                  variant="outline"
                  className="h-11 active:scale-[0.97] active:bg-muted/60"
                  onClick={() =>
                    submit({
                      runs_off_bat: 0,
                      extras: 1 + n,
                      extra_type: "wide",
                    })
                  }
                >
                  {n === 0 ? "Wide" : `Wide +${n}`}
                </Button>
              ))}
            </div>

            {/* No-balls: penalty 1 + N runs off the bat */}
            <div className="grid grid-cols-5 gap-2">
              {[0, 1, 2, 4, 6].map((n) => (
                <Button
                  key={n}
                  variant="outline"
                  className="h-11 active:scale-[0.97] active:bg-muted/60"
                  onClick={() =>
                    submit({
                      runs_off_bat: n,
                      extras: 1,
                      extra_type: "no_ball",
                    })
                  }
                >
                  {n === 0 ? "No-ball" : `NB +${n}`}
                </Button>
              ))}
            </div>

            {/* Byes: scorer chooses 1–4 */}
            {state.rules.extras.byes && (
              <div className="grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((n) => (
                  <Button
                    key={n}
                    variant="outline"
                    className="h-11 active:scale-[0.97] active:bg-muted/60"
                    onClick={() =>
                      submit({
                        runs_off_bat: 0,
                        extras: n,
                        extra_type: "bye",
                      })
                    }
                  >
                    Bye {n}
                  </Button>
                ))}
              </div>
            )}

            {/* Wicket — its own row so the inline panel has space */}
            <div className="grid grid-cols-1 gap-2">
              <WicketButton
                onSubmit={(wt, outId, fielderId) =>
                  submit({
                    is_wicket: true,
                    wicket_type: wt,
                    player_out_id: outId ?? strikerId,
                    fielder_id: fielderId ?? null,
                  })
                }
                allowed={state.rules.allowed_wicket_types as WicketType[]}
                onFreeHit={state.active.free_hit_pending}
                freeHitDismissals={state.rules.free_hit.out_dismissals as WicketType[]}
                striker={striker?.display_name}
                nonStriker={nonStriker?.display_name}
                strikerId={strikerId}
                nonStrikerId={nonStrikerId}
                bowlingXi={state.xi[innings.bowling_team_id] ?? []}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={undo}
                  disabled={visibleBalls === 0}
                >
                  Undo last ball
                </Button>
                <ConfirmButton
                  title="Undo last 3 balls?"
                  description={`${Math.min(3, visibleBalls)} ball${Math.min(3, visibleBalls) === 1 ? "" : "s"} will be voided. Innings totals recompute automatically.`}
                  confirmLabel="Undo"
                  destructive
                  onConfirm={() => undoMany(Math.min(3, visibleBalls))}
                  triggerProps={{
                    variant: "ghost",
                    size: "sm",
                    disabled: visibleBalls === 0,
                  }}
                >
                  Undo last 3
                </ConfirmButton>
                <ConfirmButton
                  title="Undo this over?"
                  description={`${visibleThisOver} ball${visibleThisOver === 1 ? "" : "s"} from the current over will be voided.`}
                  confirmLabel="Undo over"
                  destructive
                  onConfirm={() => undoMany(visibleThisOver)}
                  triggerProps={{
                    variant: "ghost",
                    size: "sm",
                    disabled: visibleThisOver === 0,
                  }}
                >
                  Undo this over
                </ConfirmButton>
              </div>
              {overEnded && (
                <p className="text-xs text-muted-foreground">
                  Over complete — change bowler before next ball.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {isComplete && (
        <Card>
          <CardHeader>
            <CardTitle>Innings complete</CardTitle>
            <CardDescription>
              Final: {displayRuns}/{displayWickets} in {displayOvers}.
              Use Undo if this finished prematurely.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="ghost" onClick={undo}>
              Undo last ball
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Combined display + picker for the three active slots (striker, non-
 * striker, bowler). Tile shows the current player + category badge, but
 * the whole tile is a native `<select>` — on mobile this triggers the OS
 * wheel picker, which is the fastest possible swap in box-cricket pace.
 * The previous "Who's batting / bowling?" card was just a duplicate of
 * this in editable form, so it's gone.
 */
function SlotPicker({
  label,
  value,
  options,
  onChange,
  highlightCat,
  statsLine,
}: {
  label: string;
  value: string;
  options: { id: string; display_name: string; category: 1 | 2 | 3 | null }[];
  onChange: (v: string) => void;
  highlightCat?: 1 | 2 | 3;
  statsLine?: string | null;
}) {
  const selected = options.find((p) => p.id === value);
  return (
    <label className="relative block rounded-md border border-foreground/10 bg-muted/30 px-3 py-2 cursor-pointer hover:bg-muted/50 transition">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        {selected?.category && (
          <span className="rounded bg-foreground/10 px-1 text-[10px] font-mono">
            C{selected.category}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-1 font-medium">
        <span className="truncate">{selected?.display_name ?? "—"}</span>
        <span className="text-xs text-muted-foreground">▾</span>
      </div>
      {statsLine && (
        <div className="text-[11px] font-mono text-muted-foreground">
          {statsLine}
        </div>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
        aria-label={label}
      >
        <option value="">—</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.display_name}
            {p.category ? ` · C${p.category}` : ""}
            {highlightCat && p.category === highlightCat ? " ⭑" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Compact batting stat line for the slot tile — `runs(balls) · SR` once
 * the batter has faced at least one ball. Returns null when they
 * haven't faced anything yet so the tile stays clean. Optimistic balls
 * are folded in so the line updates the instant the scorer taps,
 * matching the headline.
 */
function formatBatterStats(
  balls: ScoreboardState["balls"],
  playerId: string,
  optimistic?: OptimisticBall[],
): string | null {
  if (!playerId) return null;
  let runs = 0;
  let bf = 0;
  let fours = 0;
  let sixes = 0;
  for (const b of balls) {
    if (b.batter_id !== playerId) continue;
    runs += b.runs_off_bat;
    if (b.extra_type !== "wide") bf += 1;
    if (b.runs_off_bat === 4) fours += 1;
    if (b.runs_off_bat === 6) sixes += 1;
  }
  for (const o of optimistic ?? []) {
    if (o.striker_id !== playerId) continue;
    runs += o.runs_off_bat;
    if (o.extra_type !== "wide") bf += 1;
    if (o.runs_off_bat === 4) fours += 1;
    if (o.runs_off_bat === 6) sixes += 1;
  }
  if (bf === 0 && runs === 0) return null;
  const sr = bf > 0 ? ((runs / bf) * 100).toFixed(0) : "—";
  const boundaries =
    fours > 0 || sixes > 0
      ? ` · ${fours}×4${sixes > 0 ? ` ${sixes}×6` : ""}`
      : "";
  return `${runs}(${bf}) · SR ${sr}${boundaries}`;
}

/**
 * Compact bowling stat line for the bowler tile — `W/R (O.B) · econ`.
 * Returns null until the bowler has bowled at least one delivery.
 * Folds in optimistic balls for the same instant-update behaviour as
 * the batter line above.
 */
function formatBowlerStats(
  balls: ScoreboardState["balls"],
  playerId: string,
  optimistic?: OptimisticBall[],
): string | null {
  if (!playerId) return null;
  let legal = 0;
  let conceded = 0;
  let wickets = 0;
  const wicketBowler = new Set([
    "bowled",
    "caught",
    "caught_and_bowled",
    "stumped",
    "hit_wicket",
  ]);
  let touched = false;
  for (const b of balls) {
    if (b.bowler_id !== playerId) continue;
    touched = true;
    const isLegal = b.extra_type !== "wide" && b.extra_type !== "no_ball";
    if (isLegal) legal += 1;
    conceded += b.runs_off_bat;
    if (b.extra_type === "wide" || b.extra_type === "no_ball") {
      conceded += b.extras;
    }
    if (b.is_wicket && b.wicket_type && wicketBowler.has(b.wicket_type)) {
      wickets += 1;
    }
  }
  for (const o of optimistic ?? []) {
    if (o.bowler_id !== playerId) continue;
    touched = true;
    if (o.is_legal) legal += 1;
    conceded += o.runs_off_bat;
    if (o.extra_type === "wide" || o.extra_type === "no_ball") {
      conceded += o.extras;
    }
    // Wicket attribution for optimistic: assume bowler-credited types
    // unless the scorer flagged otherwise. The optimistic queue is a
    // best-effort preview; the server-confirmed wicket_type is the
    // truth post-revalidation.
    if (o.is_wicket) wickets += 1;
  }
  if (!touched) return null;
  const overs = `${Math.floor(legal / 6)}.${legal % 6}`;
  const econ = legal > 0 ? ((conceded / legal) * 6).toFixed(1) : "—";
  return `${wickets}/${conceded} (${overs}) · econ ${econ}`;
}

function WicketButton({
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
    player_out_id?: string,
    fielder_id?: string,
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

  const types = onFreeHit ? freeHitDismissals : allowed;
  // Fielder is meaningful for caught / run_out / stumped / caught_and_bowled.
  const showFielder = ["caught", "run_out", "stumped", "caught_and_bowled"].includes(
    wicketType,
  );

  return (
    <>
      <Button
        variant="destructive"
        className="h-12"
        onClick={() => setOpen((v) => !v)}
      >
        Wicket
      </Button>
      {open && (
        <div className="col-span-full rounded-md border border-foreground/10 bg-muted/30 p-3 text-sm space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Type</span>
              <select
                value={wicketType}
                onChange={(e) => setWicketType(e.target.value as WicketType)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3"
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
                onChange={(e) => setWhoOut(e.target.value as "striker" | "non_striker")}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3"
              >
                <option value="striker">Striker — {striker ?? "?"}</option>
                <option value="non_striker">Non-striker — {nonStriker ?? "?"}</option>
              </select>
            </label>
          </div>
          {showFielder && (
            <label className="space-y-1 block">
              <span className="text-xs text-muted-foreground">
                Fielder{" "}
                <span className="text-muted-foreground/70">
                  ({wicketType === "stumped" ? "wicket-keeper" : "who took it"})
                </span>
              </span>
              <select
                value={fielder}
                onChange={(e) => setFielder(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3"
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
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onSubmit(
                  wicketType,
                  whoOut === "striker" ? strikerId : nonStrikerId,
                  showFielder && fielder ? fielder : undefined,
                );
                setOpen(false);
                setFielder("");
              }}
            >
              Save wicket
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

type RenderBall = {
  id: string;
  runs_off_bat: number;
  extras: number;
  extra_type: string | null;
  is_wicket: boolean;
  is_free_hit?: boolean;
  is_optimistic?: boolean;
};

function RecentBalls({
  current,
  previous,
}: {
  current: RenderBall[];
  previous: ScoreboardState["previousOverBalls"];
}) {
  const renderBall = (b: RenderBall) => {
    let label = String(b.runs_off_bat + b.extras);
    if (b.is_wicket) label = "W";
    // `extras` already includes the wide penalty, so don't add another 1.
    else if (b.extra_type === "wide") label = `${b.extras}wd`;
    // For a no-ball, show the total runs off the delivery (batter + 1
    // penalty), matching scorecard convention.
    else if (b.extra_type === "no_ball") label = `${b.runs_off_bat + b.extras}nb`;
    else if (b.extra_type === "bye") label = `${b.extras}b`;
    const base =
      "inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-foreground/10 px-1.5 text-xs font-mono ";
    const colour = b.is_wicket
      ? "bg-destructive/15 text-destructive"
      : "bg-muted/40";
    // Optimistic balls render at reduced opacity until the server
    // confirms — gives the scorer a visual cue that the tap is in flight
    // without slowing the headline number down.
    const pending = b.is_optimistic ? "opacity-60 italic" : "";
    const ring = b.is_free_hit ? "ring-2 ring-yellow-400" : "";
    return (
      <span
        key={b.id}
        className={base + colour + " " + pending + " " + ring}
      >
        {label}
      </span>
    );
  };
  return (
    <Card>
      <CardContent className="space-y-2 p-3 text-sm">
        {previous.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs text-muted-foreground">Prev over</span>
            <span className="flex flex-wrap gap-1">
              {previous.map(renderBall)}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="w-16 text-xs text-muted-foreground">This over</span>
          <span className="flex flex-wrap gap-1">{current.map(renderBall)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
