import { Trophy } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { computeBatterStats, computeBowlerStats } from "@/lib/scoring";

import { AutoRefresh } from "./auto-refresh";
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
      {/* Auto-refresh while the match is in flight; once completed, no need */}
      {live && <AutoRefresh intervalMs={2500} />}

      {completed && (
        <Card className="overflow-hidden border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
          <CardContent className="flex items-center gap-3 p-4 sm:p-5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Trophy className="size-5" />
            </div>
            <div className="min-w-0">
              {state.match.winner_id ? (
                <>
                  <div className="truncate text-lg font-semibold capitalize sm:text-xl">
                    {teamName(state.match.winner_id)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {state.match.win_margin ?? "won the match"}
                  </div>
                </>
              ) : (
                <div className="text-lg font-semibold">
                  {state.match.result_type === "tie"
                    ? "Match tied"
                    : "Match complete"}
                </div>
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

      {/* Innings 1 summary when innings 2 is in progress or done */}
      {i1 && i2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <span className="capitalize">
                {teamName(i1.batting_team_id)}
              </span>
              <span className="ml-2 text-xs font-normal uppercase tracking-wide text-muted-foreground">
                1st innings
              </span>
            </CardTitle>
            <CardDescription className="font-mono">
              {i1.total_runs}/{i1.total_wickets} in{" "}
              {Math.floor(i1.total_legal_balls / 6)}.
              {i1.total_legal_balls % 6} ov
            </CardDescription>
          </CardHeader>
        </Card>
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
          <span className="font-mono text-3xl">
            {innings.total_runs}/{innings.total_wickets}
          </span>
          <span className="text-base font-normal text-muted-foreground">
            {overs} ov
          </span>
          <span className="ml-auto text-sm font-normal text-muted-foreground">
            RR {runRate}
          </span>
        </CardTitle>
        <CardDescription>
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
          {!completed && state.active.free_hit_pending && (
            <span className="ml-2 rounded bg-yellow-500/15 px-1.5 py-0.5 text-xs text-yellow-700">
              Free hit
            </span>
          )}
          {!completed && state.active.is_special_over && (
            <span className="ml-2 rounded bg-blue-500/15 px-1.5 py-0.5 text-xs text-blue-700">
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
              label="Striker"
              name={strikerId ? playerById.get(strikerId)?.display_name : null}
              cat={
                strikerId ? playerById.get(strikerId)?.category ?? null : null
              }
              stats={sIdStats}
            />
            <BatsmanRow
              label="Non-striker"
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
  label,
  name,
  cat,
  stats,
}: {
  label: string;
  name?: string | null;
  cat?: 1 | 2 | 3 | null;
  stats: ReturnType<typeof computeBatterStats> | null;
}) {
  return (
    <div className="rounded-md border border-foreground/10 bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <span className="font-medium capitalize">{name ?? "—"}</span>
        {cat && (
          <span className="rounded bg-foreground/10 px-1 text-[10px] font-mono">
            C{cat}
          </span>
        )}
      </div>
      {stats && (
        <div className="mt-1 grid grid-cols-5 gap-2 text-[11px] text-muted-foreground">
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
    <div className="rounded-md border border-foreground/10 bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">Bowler</div>
      <div className="flex items-center gap-2">
        <span className="font-medium capitalize">{name ?? "—"}</span>
        {cat && (
          <span className="rounded bg-foreground/10 px-1 text-[10px] font-mono">
            C{cat}
          </span>
        )}
      </div>
      {stats && (
        <div className="mt-1 grid grid-cols-6 gap-2 text-[11px] text-muted-foreground">
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
    <span className="flex flex-col">
      <span className="text-[9px] uppercase">{k}</span>
      <span className="text-[12px] font-mono text-foreground">{v}</span>
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
    const colour = b.is_wicket
      ? "bg-destructive/15 text-destructive"
      : "bg-muted/40";
    // is_free_hit is stored on the ball — show a yellow ring so the
    // ball pill is obvious in the strip without needing the badge.
    const ring = b.is_free_hit ? "ring-2 ring-yellow-400" : "";
    return (
      <span
        key={b.id}
        className={
          "inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-foreground/10 px-1.5 text-xs font-mono " +
          colour +
          " " +
          ring
        }
      >
        {label}
      </span>
    );
  };
  if (current.length === 0 && previous.length === 0) return null;
  return (
    <div className="space-y-2 pt-1 text-sm">
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
