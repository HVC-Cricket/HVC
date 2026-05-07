"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { recordBall, voidLastBall } from "./actions";
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
  const [pending, startTransition] = useTransition();

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
    if (!strikerId || !nonStrikerId || !bowlerId) {
      toast.error("Pick striker, non-striker, and bowler first");
      return;
    }
    startTransition(async () => {
      const result = await recordBall({
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
      });
      if (result && !result.ok) toast.error(result.error);
    });
  };

  const undo = () => {
    startTransition(async () => {
      const result = await voidLastBall({
        matchId: state.match.id,
        inningsId: innings.id,
      });
      if (result && !result.ok) toast.error(result.error);
    });
  };

  return (
    <div className="space-y-4">
      {/* Top scoreboard */}
      <Card className={state.active.free_hit_pending ? "ring-2 ring-yellow-400" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-baseline gap-3">
            <span className="font-mono text-3xl">
              {innings.total_runs}/{innings.total_wickets}
            </span>
            <span className="text-base font-normal text-muted-foreground">
              {overs}
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
          <Slot
            label="Striker"
            value={striker?.display_name}
            cat={striker?.category}
          />
          <Slot
            label="Non-striker"
            value={nonStriker?.display_name}
            cat={nonStriker?.category}
          />
          <Slot
            label="Bowler"
            value={bowler?.display_name}
            cat={bowler?.category}
          />
        </CardContent>
      </Card>

      {/* Recent balls strip */}
      {(state.currentOverBalls.length > 0 ||
        state.previousOverBalls.length > 0) && (
        <RecentBalls
          current={state.currentOverBalls}
          previous={state.previousOverBalls}
        />
      )}

      {/* Pre-ball pickers (let scorer correct any drift; defaults from active state) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Who's batting / bowling?</CardTitle>
          <CardDescription>
            Defaults follow the engine. Override here if you need to swap a
            batter or change bowler at end of over.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <PickerSelect
            label="Striker"
            value={strikerId}
            options={state.xi[innings.batting_team_id] ?? []}
            onChange={setStrikerId}
          />
          <PickerSelect
            label="Non-striker"
            value={nonStrikerId}
            options={state.xi[innings.batting_team_id] ?? []}
            onChange={setNonStrikerId}
          />
          <PickerSelect
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
          />
        </CardContent>
      </Card>

      {/* Ball entry */}
      {!isComplete && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Record ball</CardTitle>
            <CardDescription>
              Tap the outcome. Engine validates against the ruleset before
              writing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {[0, 1, 2, 3, 4, 6].map((n) => (
                <Button
                  key={n}
                  variant="outline"
                  className="h-16 text-2xl font-mono"
                  disabled={pending}
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
                  className="h-12"
                  disabled={pending}
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
                  className="h-12"
                  disabled={pending}
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
                    className="h-12"
                    disabled={pending}
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
                disabled={pending}
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
            <div className="flex items-center justify-between gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={undo}
                disabled={pending || state.balls.length === 0}
              >
                Undo last ball
              </Button>
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
              Final: {innings.total_runs}/{innings.total_wickets} in {overs}.
              Use Undo if this finished prematurely.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="ghost" onClick={undo} disabled={pending}>
              Undo last ball
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Slot({
  label,
  value,
  cat,
}: {
  label: string;
  value?: string;
  cat?: 1 | 2 | 3 | null;
}) {
  return (
    <div className="rounded-md border border-foreground/10 bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <span className="font-medium">{value ?? "—"}</span>
        {cat && (
          <span className="rounded bg-foreground/10 px-1 text-[10px] font-mono">
            C{cat}
          </span>
        )}
      </div>
    </div>
  );
}

function PickerSelect({
  label,
  value,
  options,
  onChange,
  highlightCat,
}: {
  label: string;
  value: string;
  options: { id: string; display_name: string; category: 1 | 2 | 3 | null }[];
  onChange: (v: string) => void;
  highlightCat?: 1 | 2 | 3;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
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

function ExtraButton({
  label,
  onSubmit,
  disabled,
}: {
  label: string;
  onSubmit: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="outline"
      className="h-12"
      disabled={disabled}
      onClick={onSubmit}
    >
      {label}
    </Button>
  );
}

function WicketButton({
  onSubmit,
  disabled,
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
  disabled?: boolean;
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
        disabled={disabled}
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
              disabled={disabled}
            >
              Save wicket
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

function RecentBalls({
  current,
  previous,
}: {
  current: ScoreboardState["currentOverBalls"];
  previous: ScoreboardState["previousOverBalls"];
}) {
  const renderBall = (b: ScoreboardState["balls"][number]) => {
    let label = String(b.runs_off_bat + b.extras);
    if (b.is_wicket) label = "W";
    else if (b.extra_type === "wide") label = `${1 + b.extras}wd`;
    else if (b.extra_type === "no_ball") label = `${1 + b.extras}nb`;
    else if (b.extra_type === "bye") label = `${b.extras}b`;
    return (
      <span
        key={b.id}
        className={
          "inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-foreground/10 px-1.5 text-xs font-mono " +
          (b.is_wicket ? "bg-destructive/15 text-destructive" : "bg-muted/40")
        }
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
