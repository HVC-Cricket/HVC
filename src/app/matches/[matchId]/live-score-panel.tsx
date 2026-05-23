import { Trophy } from "lucide-react";
import Link from "next/link";

import { LiveRefresh } from "@/components/live-refresh";

import { BallCelebration } from "./ball-celebration";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { computeBatterStats, computeBowlerStats } from "@/lib/scoring";
import {
  computeProjectedScore,
  computeWinProbability,
} from "@/lib/scoring/win-probability";
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

  const latestBall = state.balls[state.balls.length - 1] ?? null;

  return (
    <>
      {/* Live updates via Supabase Realtime while the match is in flight;
          once completed, no subscriber is needed. */}
      {(live || state.match.status === "innings_break") && (
        <LiveRefresh matchId={state.match.id} />
      )}

      {/* Full-screen FOUR! / SIX! / WICKET! flash on the next live
          delivery. Skipped on completed matches — there's no new
          ball arriving. */}
      {(live || state.match.status === "innings_break") && latestBall && (
        <BallCelebration
          latestBall={{
            id: latestBall.id,
            runs_off_bat: latestBall.runs_off_bat,
            is_wicket: latestBall.is_wicket,
            scored_at: latestBall.scored_at,
          }}
        />
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

  // Super-over innings get the 1-over cap; regular innings use the
  // tournament's overs_per_innings.
  const isSuperOver = innings.innings_number > 2;
  const inningsOversCap = isSuperOver
    ? state.rules.super_over.overs
    : state.rules.overs_per_innings;

  // Chase context
  const target = innings.target ?? null;
  const ballsRemaining = inningsOversCap * 6 - innings.total_legal_balls;
  const runsNeeded = target != null ? target - innings.total_runs : null;
  const reqRR =
    target != null && ballsRemaining > 0
      ? ((runsNeeded! / ballsRemaining) * 6).toFixed(2)
      : null;

  const teamShort = (id: string) =>
    id === state.teamA.id ? state.teamA.short_name : state.teamB.short_name;
  const teamName = (id: string) =>
    id === state.teamA.id ? state.teamA.name : state.teamB.name;

  // Small batting-team caption that sits above the 93/3 score, e.g.
  // "Wodeyars The Kings (1st inn)" — same style as the scoring page's
  // top-of-card label. Super overs (innings 3/4) just read "super over".
  const inningsTag =
    innings.innings_number === 1
      ? "1st inn"
      : innings.innings_number === 2
        ? "2nd inn"
        : `super over ${Math.ceil((innings.innings_number - 2) / 2)}`;

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

  // Projected final score for innings 1 only. For innings 2 the target
  // is already on the card and projection during a chase is just "will
  // they get there", which the win-probability bar already shows.
  const projected =
    !completed && innings.innings_number === 1
      ? computeProjectedScore({
          inningsNumber: innings.innings_number,
          runsScored: innings.total_runs,
          wickets: innings.total_wickets,
          legalBalls: innings.total_legal_balls,
          target: null,
          oversCap: inningsOversCap,
          playersPerSide: state.rules.players_per_side,
          lastManStanding: state.rules.last_man_standing,
          isSuperOver,
        })
      : null;

  return (
    <Card>
      <CardHeader className="px-3 sm:px-4">
        <div className="text-xs font-medium capitalize text-muted-foreground">
          {teamName(innings.batting_team_id)}{" "}
          <span className="font-normal text-muted-foreground/70">
            ({inningsTag})
          </span>
        </div>
        <CardTitle className="flex items-baseline gap-3">
          <span className="font-mono text-3xl tabular-nums sm:text-4xl">
            {innings.total_runs}/{innings.total_wickets}
          </span>
          <span className="font-mono text-base font-normal text-muted-foreground">
            {overs} ov
          </span>
        </CardTitle>
        {/* Extras strip — wd / nb / b breakdown sits right under the
            score so spectators can verify byes are landing in the team
            total but not the batter's column. Hidden when no extras
            have been conceded yet. */}
        {(() => {
          const extras =
            innings.extras_wides +
            innings.extras_no_balls +
            innings.extras_byes;
          if (extras === 0) return null;
          return (
            <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
              <span>
                Extras{" "}
                <span className="font-mono font-semibold tabular-nums text-foreground">
                  {extras}
                </span>
              </span>
              <span className="text-[11px] opacity-80">
                (wd {innings.extras_wides} · nb {innings.extras_no_balls}{" "}
                · b {innings.extras_byes})
              </span>
            </div>
          );
        })()}
        {/* Team-batting caption + chase summary previously lived here
            ("WK batting", "WK innings · chased 95"). Removed at the
            scorer's request — full team name + (1st inn / 2nd inn) is
            now in the small line above the score, and the trophy /
            winner card above already shows the chase result for
            completed matches. Only the in-flight pills (free hit,
            CAT1/CAT3 over) survive. */}
        {!completed &&
          (state.active.free_hit_pending || state.active.is_special_over) && (
            <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {state.active.free_hit_pending && (
                <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-xs text-yellow-700 dark:text-yellow-300">
                  Free hit
                </span>
              )}
              {state.active.is_special_over && (
                <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-xs text-blue-700 dark:text-blue-300">
                  {state.active.is_special_over.toUpperCase()} over
                </span>
              )}
            </CardDescription>
          )}
        {/* Prominent chase strip — only when innings 2 is in progress
            with runs left to chase. Sits inside the card header so it's
            unmissable. */}
        {!completed &&
          target != null &&
          runsNeeded != null &&
          runsNeeded > 0 &&
          ballsRemaining > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-900 dark:text-amber-200">
              <ChaseStat label="Need" value={runsNeeded} />
              <span aria-hidden className="text-amber-500/40">·</span>
              <ChaseStat label="Balls left" value={ballsRemaining} />
              <span aria-hidden className="text-amber-500/40">·</span>
              <ChaseStat label="Req RR" value={reqRR ?? "—"} />
            </div>
          )}

        {/* Live win-probability bar — only while the match is in
            flight. Completed matches already get the trophy / winner
            card above, and a fixed 100/0 reading there would feel
            like dead weight. */}
        {!completed && (
          <WinProbabilityBar
            battingShort={teamShort(innings.batting_team_id)}
            bowlingShort={teamShort(
              innings.batting_team_id === state.teamA.id
                ? state.teamB.id
                : state.teamA.id,
            )}
            probability={computeWinProbability({
              inningsNumber: innings.innings_number,
              runsScored: innings.total_runs,
              wickets: innings.total_wickets,
              legalBalls: innings.total_legal_balls,
              target,
              oversCap: inningsOversCap,
              playersPerSide: state.rules.players_per_side,
              lastManStanding: state.rules.last_man_standing,
              isSuperOver,
            })}
          />
        )}
      </CardHeader>
      {/* Live-only sections — striker/bowler/balls are meaningless once
          the match is over. Completed matches use the scorecard tab
          below for full per-player breakdown. */}
      {!completed && (
        <CardContent className="space-y-4 px-3 sm:px-4">
          {/* Partnership · CRR strip. CRR = current overall run rate
              (total_runs / overs). Required RR is rendered in the amber
              chase strip above for the 2nd innings, so it isn't
              duplicated here. */}
          {(partnership.runs > 0 ||
            partnership.balls > 0 ||
            oversFloat > 0 ||
            target != null ||
            projected != null) && (
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
              {oversFloat > 0 && (
                <span className="text-muted-foreground">
                  <span className="font-medium uppercase">CRR:</span>{" "}
                  <span className="font-mono text-foreground">{runRate}</span>
                </span>
              )}
              {projected != null && (
                <span className="text-muted-foreground">
                  <span className="font-medium uppercase">
                    Predicted score:
                  </span>{" "}
                  <span className="font-mono text-foreground">{projected}</span>
                </span>
              )}
              {target != null && (
                <span className="text-muted-foreground">
                  <span className="font-medium uppercase">Target:</span>{" "}
                  <span className="font-mono text-foreground">{target}</span>
                </span>
              )}
            </div>
          )}

          {/* Compact batter + bowler table — one row per player, with
              section headers naming the stat columns (Batter R B 4s 6s
              SR · Bowler O M R W ER). Replaces the previous stacked
              colour-coded cards. Striker gets an asterisk + green
              accent; bowler row gets an amber accent. */}
          <div className="overflow-hidden rounded-md border border-foreground/10">
            <PlayerTableHeader
              label="Batter"
              stats={["R", "B", "4s", "6s", "SR"]}
            />
            <BatterTableRow
              striker
              playerId={strikerId}
              name={strikerId ? playerById.get(strikerId)?.display_name : null}
              cat={
                strikerId ? playerById.get(strikerId)?.category ?? null : null
              }
              photo={strikerId ? state.playerPhotos[strikerId] ?? null : null}
              stats={sIdStats}
            />
            <BatterTableRow
              playerId={nonStrikerId}
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
              photo={
                nonStrikerId
                  ? state.playerPhotos[nonStrikerId] ?? null
                  : null
              }
              stats={nsIdStats}
            />
            <PlayerTableHeader
              label="Bowler"
              stats={["O", "M", "R", "W", "ER"]}
            />
            <BowlerTableRow
              playerId={bowlerId}
              name={bowlerId ? playerById.get(bowlerId)?.display_name : null}
              cat={bowlerId ? playerById.get(bowlerId)?.category ?? null : null}
              photo={bowlerId ? state.playerPhotos[bowlerId] ?? null : null}
              stats={bIdStats}
            />
          </div>

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

// Shared grid template so the header + every row line up. Name column
// is flexible; each stat column is a fixed narrow track so the numbers
// stay aligned but the name keeps as much room as possible — was
// wider before, which truncated 8+ char names on phones. `minmax(0, 1fr)`
// still lets the name truncate when it really has to.
const TABLE_GRID_COLS =
  "grid-cols-[minmax(0,1fr)_1.5rem_1.5rem_1.5rem_1.5rem_2.25rem]";

/**
 * Tiny 18px avatar slot used inside the batter / bowler rows of the
 * Live tab. shrink-0 keeps the name column responsive — when a name
 * is long enough to force a truncate, the avatar holds its slot and
 * the name ellipsises around it. Plain <img> (no lightbox wrapper);
 * the dedicated player profile is one tap away via the name link if
 * a spectator wants a closer look.
 */
function PanelAvatar({
  photo,
  name,
}: {
  photo: string | null;
  name: string;
}) {
  if (photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photo}
        alt=""
        className="size-[18px] shrink-0 rounded-full border border-foreground/10 object-cover"
      />
    );
  }
  return (
    <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-primary/10 text-[8px] font-semibold text-primary">
      {(name.charAt(0) || "?").toUpperCase()}
    </span>
  );
}

function PlayerTableHeader({
  label,
  stats,
}: {
  label: string;
  stats: string[];
}) {
  return (
    <div
      className={cn(
        "grid gap-x-1.5 border-b border-foreground/10 bg-muted/30 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
        TABLE_GRID_COLS,
      )}
    >
      <span>{label}</span>
      {stats.map((s) => (
        <span key={s} className="text-right">
          {s}
        </span>
      ))}
    </div>
  );
}

function BatterTableRow({
  striker,
  playerId,
  name,
  cat,
  photo,
  stats,
}: {
  striker?: boolean;
  /** When set, the name is wrapped in a Link to /players/[id] so a
   *  spectator can tap through to the batter's profile. Name-only
   *  click target (not the whole row) keeps surrounding stats
   *  non-interactive. */
  playerId?: string | null;
  name?: string | null;
  cat?: 1 | 2 | 3 | null;
  /** Resolved photo URL — already in state.playerPhotos, no extra
   *  fetch. Falls back to a single-initial chip when null. */
  photo?: string | null;
  stats: ReturnType<typeof computeBatterStats> | null;
}) {
  const sr =
    stats && stats.balls_faced > 0
      ? ((stats.runs / stats.balls_faced) * 100).toFixed(1)
      : "—";
  const nameClass = cn(
    "truncate font-medium capitalize",
    striker && "text-emerald-700 dark:text-emerald-400",
  );
  return (
    <div
      className={cn(
        "grid items-center gap-x-1.5 border-b border-foreground/10 px-3 py-2 last:border-b-0",
        TABLE_GRID_COLS,
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <PanelAvatar photo={photo ?? null} name={name ?? ""} />
        {playerId && name ? (
          <Link
            href={`/players/${playerId}`}
            prefetch={false}
            className={cn(nameClass, "hover:underline")}
          >
            {name}
          </Link>
        ) : (
          <span className={nameClass}>{name ?? "—"}</span>
        )}
        {striker && name && (
          <span
            className="font-mono leading-none text-emerald-700 dark:text-emerald-400"
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
      <span className="text-right font-mono tabular-nums">
        {stats?.runs ?? 0}
      </span>
      <span className="text-right font-mono tabular-nums">
        {stats?.balls_faced ?? 0}
      </span>
      <span className="text-right font-mono tabular-nums">
        {stats?.fours ?? 0}
      </span>
      <span className="text-right font-mono tabular-nums">
        {stats?.sixes ?? 0}
      </span>
      <span className="text-right font-mono tabular-nums">{sr}</span>
    </div>
  );
}

function BowlerTableRow({
  playerId,
  name,
  cat,
  photo,
  stats,
}: {
  /** Tap-through to /players/[id] when set — same pattern as the
   *  batter row. */
  playerId?: string | null;
  name?: string | null;
  cat?: 1 | 2 | 3 | null;
  photo?: string | null;
  stats: ReturnType<typeof computeBowlerStats> | null;
}) {
  const overs = stats
    ? `${Math.floor(stats.legal_balls / 6)}.${stats.legal_balls % 6}`
    : "—";
  const econ =
    stats && stats.legal_balls > 0
      ? ((stats.runs_conceded / stats.legal_balls) * 6).toFixed(2)
      : "—";
  const nameClass =
    "truncate font-medium capitalize text-amber-700 dark:text-amber-400";
  return (
    <div
      className={cn(
        "grid items-center gap-x-1.5 px-3 py-2",
        TABLE_GRID_COLS,
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <PanelAvatar photo={photo ?? null} name={name ?? ""} />
        {playerId && name ? (
          <Link
            href={`/players/${playerId}`}
            prefetch={false}
            className={cn(nameClass, "hover:underline")}
          >
            {name}
          </Link>
        ) : (
          <span className={nameClass}>{name ?? "—"}</span>
        )}
        {cat && (
          <span className="shrink-0 rounded bg-foreground/10 px-1 font-mono text-[10px]">
            C{cat}
          </span>
        )}
      </div>
      <span className="text-right font-mono tabular-nums">{overs}</span>
      <span className="text-right font-mono tabular-nums">
        {stats?.maidens ?? 0}
      </span>
      <span className="text-right font-mono tabular-nums">
        {stats?.runs_conceded ?? 0}
      </span>
      <span className="text-right font-mono tabular-nums">
        {stats?.wickets ?? 0}
      </span>
      <span className="text-right font-mono tabular-nums">{econ}</span>
    </div>
  );
}

function ChaseStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide opacity-70">
        {label}
      </span>
      <span className="font-mono text-sm font-semibold tabular-nums">
        {value}
      </span>
    </div>
  );
}

function WinProbabilityBar({
  battingShort,
  bowlingShort,
  probability,
}: {
  battingShort: string;
  bowlingShort: string;
  probability: ReturnType<typeof computeWinProbability>;
}) {
  const { battingPct, bowlingPct, mode } = probability;
  const label =
    mode === "pre_match"
      ? "Match starts even"
      : mode === "innings_1"
        ? "Innings 1 outlook"
        : mode === "innings_2"
          ? "Chase outlook"
          : mode === "super_over"
            ? "Super over"
            : "Final";

  // Round once for display; keep raw value for the bar width so the
  // split is faithful to the calc even when the displayed numbers
  // would sum to 99 or 101.
  const battingDisplay = Math.round(battingPct);
  const bowlingDisplay = Math.round(bowlingPct);
  const battingAhead = battingPct >= bowlingPct;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Win probability</span>
        <span className="opacity-70">{label}</span>
      </div>
      <div
        className="relative flex h-6 overflow-hidden rounded-md border border-foreground/10"
        // The two halves share the bar via flex-grow; transition on
        // width makes the shift between balls feel alive rather than
        // jumping discretely.
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={battingDisplay}
        aria-label={`${battingShort} win probability`}
      >
        <div
          className={cn(
            "flex items-center justify-start gap-1.5 px-2 text-[11px] font-semibold tabular-nums transition-[flex-grow] duration-500 ease-out",
            battingAhead
              ? "bg-primary text-primary-foreground"
              : "bg-primary/30 text-foreground",
          )}
          style={{ flexGrow: battingPct }}
        >
          {battingPct >= 18 && (
            <>
              <span className="truncate uppercase opacity-90">
                {battingShort}
              </span>
              <span className="ml-auto">{battingDisplay}%</span>
            </>
          )}
        </div>
        <div
          className={cn(
            "flex items-center justify-end gap-1.5 px-2 text-[11px] font-semibold tabular-nums transition-[flex-grow] duration-500 ease-out",
            !battingAhead
              ? "bg-foreground text-background"
              : "bg-foreground/15 text-foreground",
          )}
          style={{ flexGrow: bowlingPct }}
        >
          {bowlingPct >= 18 && (
            <>
              <span>{bowlingDisplay}%</span>
              <span className="ml-auto truncate uppercase opacity-90">
                {bowlingShort}
              </span>
            </>
          )}
        </div>
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
      <div className="flex items-start gap-2">
        <span className="w-16 shrink-0 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          This over
        </span>
        <div className="flex flex-wrap gap-1">{current.map(renderBall)}</div>
      </div>
      {previous.length > 0 && (
        <div className="flex items-start gap-2">
          <span className="w-16 shrink-0 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Prev over
          </span>
          <div className="flex flex-wrap gap-1">{previous.map(renderBall)}</div>
        </div>
      )}
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

