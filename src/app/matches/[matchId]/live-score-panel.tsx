import { Trophy } from "lucide-react";

import { BallIcon, BatIcon } from "@/components/cricket-icons";
import { LiveRefresh } from "@/components/live-refresh";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { computeBatterStats, computeBowlerStats } from "@/lib/scoring";
import { cn } from "@/lib/utils";

import type { ScoreboardState } from "./score/state";
import { loadScoreboardState } from "./score/state";

type Ball = ScoreboardState["balls"][number];
type EnginePlayer = ScoreboardState["xi"][string][number];

export async function LiveScorePanel({ matchId }: { matchId: string }) {
  const state = await loadScoreboardState(matchId);
  if (state.allInnings.length === 0) return null;

  const i1 = state.allInnings.find((i) => i.innings_number === 1);
  const i2 = state.allInnings.find((i) => i.innings_number === 2);
  const completed = state.match.status === "completed";
  const live = state.match.status === "live";

  const playerById = new Map<string, EnginePlayer>();
  for (const teamId of [state.teamA.id, state.teamB.id]) {
    for (const p of state.xi[teamId] ?? []) playerById.set(p.id, p);
  }

  const teamShort = (id: string) =>
    id === state.teamA.id ? state.teamA.short_name : state.teamB.short_name;
  const teamName = (id: string) =>
    id === state.teamA.id ? state.teamA.name : state.teamB.name;

  return (
    <>
      {/* Live updates via Supabase Realtime while the match is in flight;
          once completed, no subscriber is needed. */}
      {(live || state.match.status === "innings_break") && (
        <LiveRefresh matchId={state.match.id} />
      )}

      {completed && (
        <Card className="relative overflow-hidden border-primary/30 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
          {/* Subtle decorative blur in the corner — feels celebratory
              without being loud. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full bg-primary/15 blur-2xl"
          />
          <CardContent className="relative flex items-center gap-4 p-4 sm:p-5">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary shadow-sm sm:size-14">
              <Trophy className="size-6 sm:size-7" />
            </div>
            <div className="min-w-0 flex-1">
              {state.match.winner_id ? (
                <>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-primary">
                    Winner
                  </div>
                  <div className="truncate text-xl font-semibold capitalize leading-tight sm:text-2xl">
                    {teamName(state.match.winner_id)}
                  </div>
                  {state.match.win_margin && (
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {state.match.win_margin}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Result
                  </div>
                  <div className="text-xl font-semibold sm:text-2xl">
                    {state.match.result_type === "tie"
                      ? "Match tied"
                      : "Match complete"}
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {state.innings && (
        <InningsCard
          state={state}
          balls={state.balls}
          playerById={playerById}
          completed={completed}
        />
      )}

      {/* Innings 1 summary when innings 2 is in progress or done.
          Slim strip — a full Card was overweight for a single fact. */}
      {i1 && i2 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-foreground/10 bg-muted/30 px-3 py-2 text-sm">
          <span className="flex items-center gap-2">
            <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide">
              1st inn
            </span>
            <span className="font-medium capitalize">
              {teamName(i1.batting_team_id)}
            </span>
          </span>
          <span className="font-mono text-muted-foreground">
            <span className="text-foreground">
              {i1.total_runs}/{i1.total_wickets}
            </span>{" "}
            ({Math.floor(i1.total_legal_balls / 6)}.
            {i1.total_legal_balls % 6} ov)
          </span>
        </div>
      )}
    </>
  );
}

function InningsCard({
  state,
  balls,
  playerById,
  completed,
}: {
  state: ScoreboardState;
  balls: Ball[];
  playerById: Map<string, EnginePlayer>;
  completed: boolean;
}) {
  const innings = state.innings!;

  const overs = `${Math.floor(innings.total_legal_balls / 6)}.${innings.total_legal_balls % 6}`;
  const oversFloat =
    Math.floor(innings.total_legal_balls / 6) +
    (innings.total_legal_balls % 6) / 6;
  const runRate =
    oversFloat > 0 ? (innings.total_runs / oversFloat).toFixed(2) : "—";

  // Chase context
  const target = innings.target ?? null;
  const ballsRemaining =
    state.rules.overs_per_innings * 6 - innings.total_legal_balls;
  const runsNeeded = target != null ? target - innings.total_runs : null;
  const reqRR =
    target != null && ballsRemaining > 0
      ? ((runsNeeded! / ballsRemaining) * 6).toFixed(2)
      : null;

  const teamShort = (id: string) =>
    id === state.teamA.id ? state.teamA.short_name : state.teamB.short_name;

  // Active batsmen are striker + non-striker per the latest ball (or initial)
  const last = balls[balls.length - 1];
  const strikerId = state.active.striker_id ?? last?.batter_id ?? null;
  const nonStrikerId =
    state.active.non_striker_id ?? last?.non_striker_id ?? null;
  const bowlerId = state.active.bowler_id ?? last?.bowler_id ?? null;

  const batsmanStats = (playerId: string) => computeBatterStats(balls, playerId);
  const bowlerStats = (playerId: string) => computeBowlerStats(balls, playerId);

  const sIdStats = strikerId ? batsmanStats(strikerId) : null;
  const nsIdStats = nonStrikerId ? batsmanStats(nonStrikerId) : null;
  const bIdStats = bowlerId ? bowlerStats(bowlerId) : null;

  // Current partnership: runs/balls accrued since the most recent wicket
  // (or from the start of the innings if there hasn't been one).
  const partnership = computeCurrentPartnership(balls);

  // Recent run rate over the last 5 overs (or all overs if innings is
  // shorter). Useful chase context — a chase looking ahead at 7 RPO
  // means a different thing when the last 5 overs went at 12 vs at 3.
  const recentRR = computeRecentRR(balls, 5);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-baseline gap-3">
          <span className="font-mono text-3xl tabular-nums sm:text-4xl">
            {innings.total_runs}/{innings.total_wickets}
          </span>
          <span className="font-mono text-base font-normal text-muted-foreground">
            {overs} ov
          </span>
          <span className="ml-auto flex items-baseline gap-1 text-sm font-normal text-muted-foreground">
            <span className="text-[10px] uppercase tracking-wide">RR</span>
            <span className="font-mono text-foreground">{runRate}</span>
          </span>
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            <span className="capitalize">
              {teamShort(innings.batting_team_id)}
            </span>{" "}
            {completed ? "innings" : "batting"}
            {completed && target != null && (
              <>
                {" · "}
                <span className="text-foreground">chased {target}</span>
              </>
            )}
          </span>
          {!completed && state.active.free_hit_pending && (
            <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-xs text-yellow-700 dark:text-yellow-300">
              Free hit
            </span>
          )}
          {!completed && state.active.is_special_over && (
            <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-xs text-blue-700 dark:text-blue-300">
              {state.active.is_special_over.toUpperCase()} over
            </span>
          )}
        </CardDescription>
        {/* Prominent chase strip — only when innings 2 is in progress
            with runs left to chase. Sits inside the card header so it's
            unmissable. */}
        {!completed &&
          target != null &&
          runsNeeded != null &&
          runsNeeded > 0 &&
          ballsRemaining > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-900 dark:text-amber-200">
              <ChaseStat label="Need" value={runsNeeded} />
              <ChaseStat label="Balls left" value={ballsRemaining} />
              <ChaseStat label="Req RR" value={reqRR ?? "—"} />
            </div>
          )}
      </CardHeader>
      {/* Live-only sections — striker/bowler/balls are meaningless once
          the match is over. Completed matches use the scorecard tab
          below for full per-player breakdown. */}
      {!completed && (
        <CardContent className="space-y-4">
          {/* Partnership + recent RR strip */}
          {(partnership.runs > 0 || partnership.balls > 0 || recentRR) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              {(partnership.runs > 0 || partnership.balls > 0) && (
                <span className="text-muted-foreground">
                  <span className="font-medium uppercase">Partnership:</span>{" "}
                  <span className="font-mono text-foreground">
                    {partnership.runs}
                  </span>
                  {" ("}
                  <span className="font-mono text-foreground">
                    {partnership.balls}
                  </span>
                  {")"}
                </span>
              )}
              {recentRR && (
                <span className="text-muted-foreground">
                  <span className="font-medium uppercase">
                    Last {recentRR.overs} ov:
                  </span>{" "}
                  <span className="font-mono text-foreground">
                    {recentRR.runs}
                  </span>
                  {" runs · RR "}
                  <span className="font-mono text-foreground">
                    {recentRR.rr}
                  </span>
                </span>
              )}
            </div>
          )}

          {/* Batsmen */}
          <div className="grid gap-2 sm:grid-cols-2">
            <BatsmanRow
              striker
              name={strikerId ? playerById.get(strikerId)?.display_name : null}
              cat={
                strikerId ? playerById.get(strikerId)?.category ?? null : null
              }
              stats={sIdStats}
            />
            <BatsmanRow
              name={
                nonStrikerId
                  ? playerById.get(nonStrikerId)?.display_name
                  : null
              }
              cat={
                nonStrikerId
                  ? playerById.get(nonStrikerId)?.category ?? null
                  : null
              }
              stats={nsIdStats}
            />
          </div>

          {/* Bowler */}
          <BowlerRow
            name={bowlerId ? playerById.get(bowlerId)?.display_name : null}
            cat={bowlerId ? playerById.get(bowlerId)?.category ?? null : null}
            stats={bIdStats}
          />

          {/* Recent balls */}
          <RecentBalls
            current={state.currentOverBalls}
            previous={state.previousOverBalls}
          />
        </CardContent>
      )}
    </Card>
  );
}

function BatsmanRow({
  striker,
  name,
  cat,
  stats,
}: {
  striker?: boolean;
  name?: string | null;
  cat?: 1 | 2 | 3 | null;
  stats: ReturnType<typeof computeBatterStats> | null;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2",
        striker
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-foreground/10 bg-muted/30",
      )}
    >
      <div className="flex items-center gap-2">
        <BatIcon
          dim={!striker}
          className={
            striker
              ? "size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
              : undefined
          }
        />
        <span className="truncate font-medium capitalize">{name ?? "—"}</span>
        {striker && name && (
          <span
            className="font-mono text-base leading-none text-emerald-600 dark:text-emerald-400"
            aria-label="on strike"
            title="On strike"
          >
            *
          </span>
        )}
        {cat && (
          <span className="shrink-0 rounded bg-foreground/10 px-1 font-mono text-[10px]">
            C{cat}
          </span>
        )}
      </div>
      {stats && (
        <div className="mt-1.5 grid grid-cols-5 gap-2 text-muted-foreground">
          <Stat k="R" v={stats.runs} />
          <Stat k="B" v={stats.balls_faced} />
          <Stat k="4s" v={stats.fours} />
          <Stat k="6s" v={stats.sixes} />
          <Stat
            k="SR"
            v={
              stats.balls_faced > 0
                ? ((stats.runs / stats.balls_faced) * 100).toFixed(1)
                : "—"
            }
          />
        </div>
      )}
    </div>
  );
}

function BowlerRow({
  name,
  cat,
  stats,
}: {
  name?: string | null;
  cat?: 1 | 2 | 3 | null;
  stats: ReturnType<typeof computeBowlerStats> | null;
}) {
  const overs = stats
    ? `${Math.floor(stats.legal_balls / 6)}.${stats.legal_balls % 6}`
    : "—";
  const econ =
    stats && stats.legal_balls > 0
      ? ((stats.runs_conceded / stats.legal_balls) * 6).toFixed(2)
      : "—";
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
      <div className="flex items-center gap-2">
        <BallIcon className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="truncate font-medium capitalize">{name ?? "—"}</span>
        {cat && (
          <span className="shrink-0 rounded bg-foreground/10 px-1 font-mono text-[10px]">
            C{cat}
          </span>
        )}
      </div>
      {stats && (
        <div className="mt-1.5 grid grid-cols-6 gap-2 text-muted-foreground">
          <Stat k="O" v={overs} />
          <Stat k="M" v={stats.maidens} />
          <Stat k="R" v={stats.runs_conceded} />
          <Stat k="W" v={stats.wickets} />
          <Stat k="Dots" v={stats.dots} />
          <Stat k="Econ" v={econ} />
        </div>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string | number }) {
  return (
    <span className="flex flex-col leading-tight">
      <span className="text-[9px] uppercase tracking-wide">{k}</span>
      <span className="font-mono text-[13px] tabular-nums text-foreground">
        {v}
      </span>
    </span>
  );
}

function ChaseStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wide opacity-80">
        {label}
      </div>
      <div className="font-mono text-lg font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}

function RecentBalls({
  current,
  previous,
}: {
  current: Ball[];
  previous: Ball[];
}) {
  const renderBall = (b: Ball) => {
    // Compute the extras-style suffix first so we can combine it with
    // a "W" when the wicket fell on a wide / no-ball / bye delivery.
    // `extras` already includes the wide / no-ball penalty.
    const extraSuffix =
      b.extra_type === "wide"
        ? `${b.extras}wd`
        : b.extra_type === "no_ball"
          ? `${b.runs_off_bat + b.extras}nb`
          : b.extra_type === "bye"
            ? `${b.extras}b`
            : null;
    let label: string;
    if (b.is_wicket && extraSuffix) label = `${extraSuffix}+W`;
    else if (b.is_wicket) label = "W";
    else if (extraSuffix) label = extraSuffix;
    else label = String(b.runs_off_bat + b.extras);
    const total = b.runs_off_bat + b.extras;
    const colour = b.is_wicket
      ? "border-destructive/40 bg-destructive/15 text-destructive"
      : total >= 6
        ? "border-primary/40 bg-primary/15 text-primary"
        : total >= 4
          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : b.extra_type
            ? "border-foreground/10 bg-muted/60 text-muted-foreground"
            : "border-foreground/10 bg-muted/40";
    const ring = b.is_free_hit ? "ring-2 ring-yellow-400" : "";
    return (
      <span
        key={b.id}
        className={cn(
          "inline-flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 font-mono text-xs tabular-nums",
          colour,
          ring,
        )}
      >
        {label}
      </span>
    );
  };
  if (current.length === 0 && previous.length === 0) return null;
  return (
    <div className="space-y-1.5 border-t border-foreground/10 pt-3">
      {previous.length > 0 && (
        <div className="flex items-start gap-3">
          <span className="w-12 shrink-0 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Prev
          </span>
          <div className="flex flex-wrap gap-1">{previous.map(renderBall)}</div>
        </div>
      )}
      <div className="flex items-start gap-3">
        <span className="w-12 shrink-0 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          This
        </span>
        <div className="flex flex-wrap gap-1">{current.map(renderBall)}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live-only derivations from balls. Shared batter / bowler stats live in
// `@/lib/scoring/stats` and are imported above.
// ---------------------------------------------------------------------------

/**
 * Runs and legal balls accrued since the most recent wicket (or from
 * the start of the innings if no wickets have fallen). Mirrors the
 * "Partnership" line on a live cricket scorecard.
 */
function computeCurrentPartnership(balls: Ball[]) {
  let runs = 0;
  let bf = 0;
  // Find the last wicket — partnership counts from the ball AFTER it.
  let startIdx = 0;
  for (let i = balls.length - 1; i >= 0; i--) {
    if (balls[i].is_wicket) {
      startIdx = i + 1;
      break;
    }
  }
  for (let i = startIdx; i < balls.length; i++) {
    const b = balls[i];
    runs += b.runs_off_bat + b.extras;
    if (b.extra_type !== "wide" && b.extra_type !== "no_ball") bf += 1;
  }
  return { runs, balls: bf };
}

/**
 * Runs scored in the most-recent N overs (capped to however many overs
 * actually exist) plus the rolling RR. Returns null when fewer than 1
 * over has been bowled — too little signal to display.
 */
function computeRecentRR(
  balls: Ball[],
  windowOvers: number,
): { runs: number; overs: number; rr: string } | null {
  if (balls.length === 0) return null;
  const latestOver = balls[balls.length - 1].over_number;
  if (latestOver < 2) return null;
  const fromOver = Math.max(1, latestOver - windowOvers + 1);
  let runs = 0;
  let legalBalls = 0;
  for (const b of balls) {
    if (b.over_number < fromOver) continue;
    runs += b.runs_off_bat + b.extras;
    if (b.extra_type !== "wide" && b.extra_type !== "no_ball") legalBalls += 1;
  }
  const oversCount = legalBalls / 6;
  if (oversCount <= 0) return null;
  return {
    runs,
    overs: latestOver - fromOver + 1,
    rr: (runs / oversCount).toFixed(2),
  };
}
