"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { type ScoreTask } from "@/lib/offline-queue";
import { computeBatterStats, computeBowlerStats } from "@/lib/scoring";

import { recordBall, voidLastBall, voidLastN } from "./actions";
import type { ScoreboardState } from "./state";
import { type DrainOutcome, useOfflineQueue } from "./use-offline-queue";
import { type WicketType, WicketButton } from "./wicket-button";

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

function defaultOverCategory(overNumber: number): 1 | 2 | 3 {
  if (overNumber === 1) return 1;
  if (overNumber === 2) return 3;
  return 2;
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

  // Inline picker state for Wide / No-ball / Bye / Overthrow. Tapping
  // the top-level button opens a sub-picker; tapping a number submits
  // the ball and closes the picker. `noBallByesPick` is scoped to the
  // No-ball picker — when on, the chosen runs go to extras (byes)
  // instead of `runs_off_bat`, so the striker isn't credited.
  const [extraPicker, setExtraPicker] = useState<
    "wide" | "no_ball" | "bye" | "overthrow" | null
  >(null);
  const [noBallByesPick, setNoBallByesPick] = useState(false);
  const openExtraPicker = (
    kind: "wide" | "no_ball" | "bye" | "overthrow",
  ) => {
    setNoBallByesPick(false);
    setExtraPicker(kind);
  };
  const closeExtraPicker = () => {
    setExtraPicker(null);
    setNoBallByesPick(false);
  };

  // Mobile-data realities + service-worker offline support: every write
  // is persisted to IndexedDB before the network attempt, so the queue
  // survives page reloads, tab close, and offline gaps of any length.
  // `useOfflineQueue` owns the drain loop + online/offline events;
  // scorecard-specific concerns (optimistic balls, pending undos) live
  // below and are reconciled through `onTaskComplete`.
  const matchId = state.match.id;

  // Optimistic recordBall entries — pushed instantly on tap so the score
  // updates without waiting for the server.
  const [optimistic, setOptimistic] = useState<OptimisticBall[]>([]);

  // Pending undo entries — the inverse of optimistic.
  const [pendingUndos, setPendingUndos] = useState<PendingUndo[]>([]);
  const serverBallsRef = useRef(state.balls.length);

  const runTask = useCallback(
    async (task: ScoreTask): Promise<DrainOutcome> => {
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
        // Network / fetch failure — keep the task in IDB and let the
        // drain loop pause until the browser comes back online.
        return "network";
      }
    },
    [],
  );

  // On validation rejection, drop the matching optimistic entry — the
  // server didn't accept the ball so it shouldn't stay on-screen. On
  // success, state.balls will advance/regress and the reconciliation
  // effect below clears it for us instead.
  const onTaskComplete = useCallback(
    (task: ScoreTask, outcome: DrainOutcome) => {
      if (outcome !== "validation") return;
      if (task.kind === "recordBall") {
        setOptimistic((q) => q.slice(1));
      } else if (task.kind === "voidLastBall") {
        setPendingUndos((q) => q.slice(1));
      } else if (task.kind === "voidLastN") {
        const c = (task.payload as { count?: number }).count ?? 1;
        setPendingUndos((q) => q.slice(c));
      }
    },
    [],
  );

  const { enqueue, pendingCount, isOffline } = useOfflineQueue({
    matchId,
    runTask,
    onTaskComplete,
  });

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

  // Per-over category restriction. Default: over 1 → Cat 1, over 2 →
  // Cat 2, over 3+ → Cat 3. Scorer can override within an over; we
  // re-default on the next over boundary. Cat 2 = open (no filter).
  const [overCategory, setOverCategory] = useState<1 | 2 | 3>(
    defaultOverCategory(state.active.over_number),
  );
  const lastOverRef = useRef(state.active.over_number);
  useEffect(() => {
    if (state.active.over_number === lastOverRef.current) return;
    lastOverRef.current = state.active.over_number;
    setOverCategory(defaultOverCategory(state.active.over_number));
  }, [state.active.over_number]);

  const battingXi = state.xi[innings.batting_team_id] ?? [];
  const bowlingXi = state.xi[innings.bowling_team_id] ?? [];
  const catBlockedStrikerIds =
    overCategory === 2
      ? new Set<string>()
      : new Set(
          battingXi
            .filter((p) => p.category !== overCategory)
            .map((p) => p.id),
        );
  const catBlockedBowlerIds =
    overCategory === 2
      ? new Set<string>()
      : new Set(
          bowlingXi
            .filter((p) => p.category !== overCategory)
            .map((p) => p.id),
        );


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
    if (overCategory !== 2) {
      const strikerCat = playersById.get(strikerId)?.category ?? null;
      const bowlerCat = playersById.get(bowlerId)?.category ?? null;
      if (strikerCat !== overCategory || bowlerCat !== overCategory) {
        toast.error(
          `Cat ${overCategory} over: striker and bowler must both be Category ${overCategory}`,
        );
        return;
      }
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
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs uppercase text-muted-foreground">
              Category
            </span>
            <select
              value={overCategory}
              onChange={(e) =>
                setOverCategory(Number(e.target.value) as 1 | 2 | 3)
              }
              className="h-8 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm"
              aria-label="Over category"
            >
              <option value={1}>Cat 1</option>
              <option value={2}>Cat 2</option>
              <option value={3}>Cat 3</option>
            </select>
            <span className="text-xs text-muted-foreground">
              {overCategory === 2
                ? "Any striker / any bowler"
                : `Striker + bowler must both be Cat ${overCategory}`}
            </span>
          </div>
          {/* Slot tiles double as the picker — tap a tile, native mobile
              picker opens, pick a player, done. No second "Who's batting"
              card; that was confusing duplication. Stats line below
              each name surfaces the player's current contribution so
              the scorer always has context.
              Mobile: 2 columns — Striker + Non-striker share a row,
              Bowler spans both. Desktop: all 3 in one row. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <SlotPicker
              label="Striker"
              value={strikerId}
              options={battingXi}
              onChange={setStrikerId}
              highlightCat={overCategory === 2 ? undefined : overCategory}
              statsLine={formatBatterStats(state.balls, strikerId, optimistic)}
              // Already-dismissed players (can't bat again this innings),
              // the non-striker (can't be at both ends), and players
              // outside the over's category restriction are disabled.
              disabledIds={
                new Set(
                  [
                    ...state.active.dismissed_ids,
                    nonStrikerId,
                    ...catBlockedStrikerIds,
                  ].filter(Boolean) as string[],
                )
              }
              dismissedIds={new Set(state.active.dismissed_ids)}
            />
            <SlotPicker
              label="Non-striker"
              value={nonStrikerId}
              options={battingXi}
              onChange={setNonStrikerId}
              statsLine={formatBatterStats(state.balls, nonStrikerId, optimistic)}
              disabledIds={
                new Set(
                  [...state.active.dismissed_ids, strikerId].filter(
                    Boolean,
                  ) as string[],
                )
              }
              dismissedIds={new Set(state.active.dismissed_ids)}
            />
            <div className="col-span-2 sm:col-span-1">
              <SlotPicker
                label="Bowler"
                value={bowlerId}
                options={bowlingXi}
                onChange={setBowlerId}
                highlightCat={overCategory === 2 ? undefined : overCategory}
                disabledIds={catBlockedBowlerIds}
                statsLine={formatBowlerStats(state.balls, bowlerId, optimistic)}
                footer={
                  visibleServerCurrent.length > 0 ||
                  optimisticRenderBalls.length > 0 ? (
                    <BallStrip
                      balls={[
                        ...visibleServerCurrent,
                        ...optimisticRenderBalls,
                      ]}
                    />
                  ) : null
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* This-over strip now lives inside the Bowler slot tile via
          its `footer` prop; the previous-over strip moved to the
          bottom of this card stack (see below). */}

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
            {/* Extras: one button each for Wide / No-ball / Bye /
                Overthrow. Tap opens an inline sub-picker. No-ball
                picker also surfaces a "runs are byes" toggle. */}
            <div
              className={
                "grid gap-2 " +
                (state.rules.extras.byes ? "grid-cols-4" : "grid-cols-3")
              }
            >
              <Button
                variant={extraPicker === "wide" ? "default" : "outline"}
                className="h-11 active:scale-[0.97] active:bg-muted/60"
                onClick={() =>
                  extraPicker === "wide"
                    ? closeExtraPicker()
                    : openExtraPicker("wide")
                }
              >
                Wide
              </Button>
              <Button
                variant={extraPicker === "no_ball" ? "default" : "outline"}
                className="h-11 active:scale-[0.97] active:bg-muted/60"
                onClick={() =>
                  extraPicker === "no_ball"
                    ? closeExtraPicker()
                    : openExtraPicker("no_ball")
                }
              >
                No-ball
              </Button>
              {state.rules.extras.byes && (
                <Button
                  variant={extraPicker === "bye" ? "default" : "outline"}
                  className="h-11 active:scale-[0.97] active:bg-muted/60"
                  onClick={() =>
                    extraPicker === "bye"
                      ? closeExtraPicker()
                      : openExtraPicker("bye")
                  }
                >
                  Bye
                </Button>
              )}
              <Button
                variant={extraPicker === "overthrow" ? "default" : "outline"}
                className="h-11 active:scale-[0.97] active:bg-muted/60"
                onClick={() =>
                  extraPicker === "overthrow"
                    ? closeExtraPicker()
                    : openExtraPicker("overthrow")
                }
              >
                Overthrow
              </Button>
            </div>

            {extraPicker === "wide" && (
              <div className="space-y-2 rounded-md border border-foreground/10 bg-muted/20 p-2">
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <Button
                      key={n}
                      variant="outline"
                      className="h-11 active:scale-[0.97] active:bg-muted/60"
                      onClick={() => {
                        submit({
                          runs_off_bat: 0,
                          extras: 1 + n,
                          extra_type: "wide",
                        });
                        closeExtraPicker();
                      }}
                    >
                      WD +{n}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {extraPicker === "no_ball" && (
              <div className="space-y-2 rounded-md border border-foreground/10 bg-muted/20 p-2">
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <Button
                      key={n}
                      variant="outline"
                      className="h-11 active:scale-[0.97] active:bg-muted/60"
                      onClick={() => {
                        // With "byes" on, the chosen N goes to extras
                        // (alongside the 1-run penalty) so the striker
                        // isn't credited. Otherwise it's off the bat.
                        submit({
                          runs_off_bat: noBallByesPick ? 0 : n,
                          extras: noBallByesPick ? 1 + n : 1,
                          extra_type: "no_ball",
                        });
                        closeExtraPicker();
                      }}
                    >
                      NB +{n}
                    </Button>
                  ))}
                </div>
                <label className="flex items-center gap-2 pt-1 text-sm">
                  <input
                    type="checkbox"
                    checked={noBallByesPick}
                    onChange={(e) => setNoBallByesPick(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <span>Runs are byes (not off the bat)</span>
                </label>
              </div>
            )}

            {extraPicker === "bye" && state.rules.extras.byes && (
              <div className="space-y-2 rounded-md border border-foreground/10 bg-muted/20 p-2">
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <Button
                      key={n}
                      variant="outline"
                      className="h-11 active:scale-[0.97] active:bg-muted/60"
                      onClick={() => {
                        submit({
                          runs_off_bat: 0,
                          extras: n,
                          extra_type: "bye",
                        });
                        closeExtraPicker();
                      }}
                    >
                      B {n}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Overthrow: a hit + the fielder's return goes for extras.
                The runs all credit the batter (off-the-bat), so this is
                effectively a "runs off bat" picker for the unusual
                totals that the main 0–6 row doesn't cover (5, 7). */}
            {extraPicker === "overthrow" && (
              <div className="space-y-2 rounded-md border border-foreground/10 bg-muted/20 p-2">
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                    <Button
                      key={n}
                      variant="outline"
                      className="h-11 active:scale-[0.97] active:bg-muted/60"
                      onClick={() => {
                        submit({ runs_off_bat: n });
                        closeExtraPicker();
                      }}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {/* Wicket — its own row so the inline panel has space */}
            <div className="grid grid-cols-1 gap-2">
              <WicketButton
                onSubmit={(wt, outId, fielderId, delivery, runs, noBallByes) => {
                  const extra_type =
                    delivery === "no_ball"
                      ? "no_ball"
                      : delivery === "wide"
                        ? "wide"
                        : delivery === "bye"
                          ? "bye"
                          : null;
                  // Split the chosen runs into runs_off_bat vs extras
                  // per delivery convention:
                  //   - Legal: runs go to runs_off_bat (e.g. run-out for 1)
                  //   - No-ball: 1-run penalty + N off the bat (or +N byes
                  //     when the "Runs are byes" toggle is on — striker
                  //     isn't credited)
                  //   - Wide:    1-run penalty + N additional wide runs
                  //   - Bye:     N byes (no penalty)
                  let runs_off_bat = 0;
                  let extras = 0;
                  if (delivery === "legal") {
                    runs_off_bat = runs;
                  } else if (delivery === "no_ball") {
                    if (noBallByes) {
                      extras = 1 + runs;
                    } else {
                      runs_off_bat = runs;
                      extras = 1;
                    }
                  } else if (delivery === "wide") {
                    extras = 1 + runs;
                  } else if (delivery === "bye") {
                    extras = runs;
                  }
                  submit({
                    is_wicket: true,
                    wicket_type: wt,
                    player_out_id: outId ?? strikerId,
                    fielder_id: fielderId ?? null,
                    extra_type,
                    extras,
                    runs_off_bat,
                  });
                }}
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

      {visibleServerPrevious.length > 0 && (
        <Card>
          <CardContent className="space-y-1 p-3 text-sm">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Previous over
            </div>
            <BallStrip balls={visibleServerPrevious} />
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
  disabledIds,
  dismissedIds,
  footer,
}: {
  label: string;
  value: string;
  options: { id: string; display_name: string; category: 1 | 2 | 3 | null }[];
  onChange: (v: string) => void;
  highlightCat?: 1 | 2 | 3;
  statsLine?: string | null;
  /** Options that should be greyed out (e.g. already out, or the other
   *  batter who's at the opposite end). */
  disabledIds?: Set<string>;
  /** Subset of `disabledIds` that's specifically out — gets an "(out)"
   *  label so the scorer knows *why* the option is greyed. */
  dismissedIds?: Set<string>;
  /** Optional content rendered inside the tile below the stats line.
   *  Currently used by the bowler tile to surface the this-over
   *  pill strip. Pointer events bubble to the underlying select, so
   *  tapping the footer also opens the picker (acceptable trade-off
   *  for visual integration). */
  footer?: ReactNode;
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
      {footer && (
        <div className="mt-2 border-t border-foreground/10 pt-2">
          {footer}
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
          <option
            key={p.id}
            value={p.id}
            disabled={disabledIds?.has(p.id)}
          >
            {p.display_name}
            {p.category ? ` · C${p.category}` : ""}
            {highlightCat && p.category === highlightCat ? " ⭑" : ""}
            {dismissedIds?.has(p.id) ? " (out)" : ""}
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
  const base = computeBatterStats(balls, playerId);
  let { runs, balls_faced: bf, fours, sixes } = base;
  // Optimistic balls' striker_id IS the batter, so we shim the field
  // name to share the helper with server balls.
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
  const base = computeBowlerStats(balls, playerId);
  let legal = base.legal_balls;
  let conceded = base.runs_conceded;
  let wickets = base.wickets;
  let touched = legal > 0 || conceded > 0 || wickets > 0;
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

type RenderBall = {
  id: string;
  runs_off_bat: number;
  extras: number;
  extra_type: string | null;
  is_wicket: boolean;
  is_free_hit?: boolean;
  is_optimistic?: boolean;
};

function renderBallPill(b: RenderBall) {
  let label = String(b.runs_off_bat + b.extras);
  if (b.is_wicket) {
    // Wicket on a non-legal delivery (no-ball / wide / bye) keeps
    // both markers visible. When there are also runs on the
    // delivery, include the total so e.g. a no-ball + 2 off bat +
    // run-out shows as "W 3nb" instead of just "W nb".
    const total = b.runs_off_bat + b.extras;
    const suffix =
      b.extra_type === "no_ball"
        ? "nb"
        : b.extra_type === "wide"
          ? "wd"
          : b.extra_type === "bye"
            ? "b"
            : "";
    if (suffix) {
      label = total > 1 ? `W ${total}${suffix}` : `W ${suffix}`;
    } else {
      label = b.runs_off_bat > 0 ? `W ${b.runs_off_bat}` : "W";
    }
  }
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
}

function BallStrip({ balls }: { balls: RenderBall[] }) {
  if (balls.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">{balls.map(renderBallPill)}</span>
  );
}

