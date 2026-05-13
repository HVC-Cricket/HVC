import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { computeBatterStats, computeBowlerStats } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import type { BallRow } from "@/lib/supabase/row-types";

import { ScorecardInningsTabs } from "./scorecard-innings-tabs";
type PlayerLite = {
  id: string;
  display_name: string;
  category: number | null;
};

/**
 * Full per-innings scorecard for completed matches. Renders four blocks
 * per innings — batting, fall of wickets, bowling, partnerships —
 * derived directly from `balls` rows and the playing XI.
 */
export async function FullScorecard({ matchId }: { matchId: string }) {
  const supabase = await createClient();

  const { data: match } = await supabase
    .from("matches")
    .select("id, team_a_id, team_b_id")
    .eq("id", matchId)
    .single();
  if (!match) return null;

  const { data: innings } = await supabase
    .from("innings")
    .select(
      "id, innings_number, batting_team_id, bowling_team_id, total_runs, total_wickets, total_legal_balls, extras_wides, extras_no_balls, extras_byes",
    )
    .eq("match_id", match.id)
    .order("innings_number", { ascending: true });
  if (!innings || innings.length === 0) return null;

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, short_name")
    .in("id", [match.team_a_id, match.team_b_id]);
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]));

  const { data: xi } = await supabase
    .from("match_players")
    .select("player_id, team_id, batting_order, is_captain, is_keeper, is_substitute")
    .eq("match_id", match.id);
  const playerIds = (xi ?? []).map((r) => r.player_id);
  const { data: playerRows } = playerIds.length
    ? await supabase
        .from("players")
        .select("id, display_name, category")
        .in("id", playerIds)
    : { data: [] as PlayerLite[] };
  const playerById = new Map<string, PlayerLite>(
    (playerRows ?? []).map((p) => [p.id, p]),
  );

  const inningsIds = innings.map((i) => i.id);
  const { data: ballsRows } = await supabase
    .from("balls")
    .select("*")
    .in("innings_id", inningsIds)
    .eq("is_voided", false)
    .order("scored_at", { ascending: true });
  const allBalls = (ballsRows ?? []) as BallRow[];

  const tabs = innings.map((i) => {
    const battingTeam = teamById.get(i.batting_team_id);
    const bowlingTeam = teamById.get(i.bowling_team_id);
    const inningsBalls = allBalls.filter((b) => b.innings_id === i.id);
    const battingXi = (xi ?? []).filter(
      (r) => r.team_id === i.batting_team_id,
    );
    const bowlingXi = (xi ?? []).filter(
      (r) => r.team_id === i.bowling_team_id,
    );
    const overs = `${Math.floor(i.total_legal_balls / 6)}.${i.total_legal_balls % 6}`;
    const ordinal = ordinalInnings(i.innings_number);

    return {
      id: String(i.id),
      label: battingTeam?.short_name ?? "?",
      sub: `${ordinal} · ${i.total_runs}/${i.total_wickets} (${overs})`,
      panel: (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-foreground/5 bg-muted/30">
            <div className="flex items-baseline justify-between gap-2">
              <CardTitle className="text-base capitalize">
                {battingTeam?.name ?? "?"}
                <span className="ml-2 text-xs font-normal uppercase tracking-wide text-muted-foreground">
                  {ordinal}
                </span>
              </CardTitle>
              <CardDescription className="font-mono text-sm font-semibold text-foreground">
                {i.total_runs}/{i.total_wickets}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({overs} ov)
                </span>
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-0 p-0">
            <BattingTable
              balls={inningsBalls}
              xi={battingXi}
              playerById={playerById}
            />
            <FallOfWickets balls={inningsBalls} playerById={playerById} />
            <ExtrasRow innings={i} />
            <BowlingTable
              balls={inningsBalls}
              xi={bowlingXi}
              playerById={playerById}
              bowlingTeamName={bowlingTeam?.name}
            />
            <Partnerships balls={inningsBalls} playerById={playerById} />
          </CardContent>
        </Card>
      ),
    };
  });

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Scorecard</h2>
        <span className="text-xs text-muted-foreground">
          Per-player batting &amp; bowling
        </span>
      </div>
      <ScorecardInningsTabs tabs={tabs} />
    </section>
  );
}

function ordinalInnings(n: number): string {
  // Super overs (3, 4) show as "Super over 1", "Super over 2" so the
  // tab label is meaningful instead of "3rd / 4th innings".
  if (n === 1) return "1st innings";
  if (n === 2) return "2nd innings";
  if (n === 3) return "Super over 1";
  if (n === 4) return "Super over 2";
  return `Innings ${n}`;
}

function BattingTable({
  balls,
  xi,
  playerById,
}: {
  balls: BallRow[];
  xi: { player_id: string; batting_order: number | null }[];
  playerById: Map<string, PlayerLite>;
}) {
  // Determine batting order: prefer match_players.batting_order;
  // fall back to first-appearance order in balls.
  const firstAppearance = new Map<string, number>();
  balls.forEach((b, idx) => {
    if (!firstAppearance.has(b.batter_id)) firstAppearance.set(b.batter_id, idx);
    if (!firstAppearance.has(b.non_striker_id))
      firstAppearance.set(b.non_striker_id, idx);
  });

  const didBat = (playerId: string) => firstAppearance.has(playerId);

  const sorted = [...xi].sort((a, b) => {
    const aOrder = a.batting_order ?? null;
    const bOrder = b.batting_order ?? null;
    if (aOrder != null && bOrder != null) return aOrder - bOrder;
    if (aOrder != null) return -1;
    if (bOrder != null) return 1;
    const aFa = firstAppearance.get(a.player_id) ?? Infinity;
    const bFa = firstAppearance.get(b.player_id) ?? Infinity;
    return aFa - bFa;
  });

  const batters = sorted.filter((row) => didBat(row.player_id));
  const dnb = sorted.filter((row) => !didBat(row.player_id));

  // Currently at the crease — last legal ball's batter + non-striker.
  const lastBall = balls[balls.length - 1];
  const onStrike = lastBall?.batter_id ?? null;
  const nonStriker = lastBall?.non_striker_id ?? null;

  return (
    <>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-foreground/10 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 text-left font-medium">Batter</th>
            <th className="px-1.5 py-2 text-right font-medium">R</th>
            <th className="px-1.5 py-2 text-right font-medium">B</th>
            <th className="px-1.5 py-2 text-right font-medium">4s</th>
            <th className="px-1.5 py-2 text-right font-medium">6s</th>
            <th className="px-3 py-2 text-right font-medium">SR</th>
          </tr>
        </thead>
        <tbody>
          {batters.map((row) => {
            const p = playerById.get(row.player_id);
            const stats = computeBatterStats(balls, row.player_id);
            const dismissal = computeDismissal(
              balls,
              row.player_id,
              playerById,
            );
            const atCrease =
              onStrike === row.player_id || nonStriker === row.player_id;
            const isStriker = onStrike === row.player_id;
            return (
              <tr
                key={row.player_id}
                className={
                  "border-b border-foreground/5 last:border-b-0 " +
                  (atCrease ? "bg-emerald-500/5" : "")
                }
              >
                <td className="px-3 py-2">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-medium capitalize">
                      {p?.display_name ?? "(unknown)"}
                    </span>
                    {isStriker && (
                      <span
                        className="text-xs font-bold text-emerald-700 dark:text-emerald-300"
                        title="On strike"
                      >
                        *
                      </span>
                    )}
                    {!isStriker && atCrease && (
                      <span
                        className="text-[10px] text-emerald-700/80 dark:text-emerald-300/80"
                        title="At the crease"
                      >
                        •
                      </span>
                    )}
                    {p?.category && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        C{p.category}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {dismissal ?? (atCrease ? "batting" : "not out")}
                  </div>
                </td>
                <td className="px-1.5 py-2 text-right font-mono font-semibold tabular-nums">
                  {stats.runs}
                </td>
                <td className="px-1.5 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {stats.balls_faced}
                </td>
                <td className="px-1.5 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {stats.fours}
                </td>
                <td className="px-1.5 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {stats.sixes}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {stats.balls_faced > 0
                    ? ((stats.runs / stats.balls_faced) * 100).toFixed(1)
                    : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {dnb.length > 0 && (
        <div className="border-b border-foreground/10 px-3 py-2 text-[11px] text-muted-foreground">
          <span className="font-semibold uppercase tracking-wide">
            Did not bat:
          </span>{" "}
          <span className="capitalize">
            {dnb
              .map((row) => playerById.get(row.player_id)?.display_name ?? "?")
              .join(", ")}
          </span>
        </div>
      )}
    </>
  );
}

function FallOfWickets({
  balls,
  playerById,
}: {
  balls: BallRow[];
  playerById: Map<string, PlayerLite>;
}) {
  const fows = computeFallOfWickets(balls, playerById);
  if (fows.length === 0) return null;
  return (
    <div className="border-t border-foreground/10 px-3 py-2 text-[11px] leading-relaxed">
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">
        Fall of wickets
      </span>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {fows.map((w) => (
          <span
            key={w.wicketNum}
            className="inline-flex items-center gap-1 rounded-full border border-foreground/10 bg-muted/40 px-2 py-0.5"
          >
            <span className="font-mono font-semibold tabular-nums">
              {w.wicketNum}-{w.runs}
            </span>
            <span className="capitalize text-muted-foreground">{w.player}</span>
            <span className="font-mono text-muted-foreground tabular-nums">
              ({w.over})
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Partnerships({
  balls,
  playerById,
}: {
  balls: BallRow[];
  playerById: Map<string, PlayerLite>;
}) {
  const ps = computePartnerships(balls);
  if (ps.length === 0) return null;
  return (
    <>
      <div className="border-t border-foreground/10 bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Partnerships
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-foreground/10 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 text-left font-medium">Wkt</th>
            <th className="px-1.5 py-2 text-left font-medium">Batters</th>
            <th className="px-1.5 py-2 text-right font-medium">R</th>
            <th className="px-3 py-2 text-right font-medium">B</th>
          </tr>
        </thead>
        <tbody>
          {ps.map((p) => (
            <tr
              key={p.index}
              className="border-b border-foreground/5 last:border-b-0"
            >
              <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground">
                {p.index}
              </td>
              <td className="px-1.5 py-2 capitalize">
                {playerById.get(p.bat1)?.display_name ?? "?"}
                <span className="text-muted-foreground"> &amp; </span>
                {playerById.get(p.bat2)?.display_name ?? "?"}
              </td>
              <td className="px-1.5 py-2 text-right font-mono font-semibold tabular-nums">
                {p.runs}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {p.balls}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ExtrasRow({
  innings,
}: {
  innings: {
    extras_wides: number;
    extras_no_balls: number;
    extras_byes: number;
    total_runs: number;
    total_wickets: number;
    total_legal_balls: number;
  };
}) {
  const extras =
    innings.extras_wides + innings.extras_no_balls + innings.extras_byes;
  const overs = `${Math.floor(innings.total_legal_balls / 6)}.${innings.total_legal_balls % 6}`;
  return (
    <div className="border-t border-foreground/10 bg-muted/20 px-3 py-2 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">
          Extras
          <span className="ml-2 text-[11px]">
            wd {innings.extras_wides} · nb {innings.extras_no_balls} · b{" "}
            {innings.extras_byes}
          </span>
        </span>
        <span className="font-mono tabular-nums">{extras}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground">
        <span>
          Total — {innings.total_wickets} wkt
          {innings.total_wickets === 1 ? "" : "s"} in {overs} overs
        </span>
        <span className="font-mono font-semibold tabular-nums text-foreground">
          {innings.total_runs}
        </span>
      </div>
    </div>
  );
}

function BowlingTable({
  balls,
  xi,
  playerById,
  bowlingTeamName,
}: {
  balls: BallRow[];
  xi: { player_id: string }[];
  playerById: Map<string, PlayerLite>;
  bowlingTeamName?: string;
}) {
  const bowlerIds = new Set(balls.map((b) => b.bowler_id));
  const bowlers = xi.filter((r) => bowlerIds.has(r.player_id));
  if (bowlers.length === 0) return null;

  // Currently bowling — last legal ball's bowler.
  const lastBall = balls[balls.length - 1];
  const currentBowler = lastBall?.bowler_id ?? null;

  return (
    <>
      <div className="border-t border-foreground/10 bg-muted/30 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="capitalize">{bowlingTeamName ?? "Bowling"}</span> bowling
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-foreground/10 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 text-left font-medium">Bowler</th>
            <th className="px-1.5 py-2 text-right font-medium">O</th>
            <th className="px-1.5 py-2 text-right font-medium">R</th>
            <th className="px-1.5 py-2 text-right font-medium">W</th>
            <th className="px-3 py-2 text-right font-medium">Econ</th>
          </tr>
        </thead>
        <tbody>
          {bowlers.map((row) => {
            const p = playerById.get(row.player_id);
            const stats = computeBowlerStats(balls, row.player_id);
            const overs = `${Math.floor(stats.legal_balls / 6)}.${stats.legal_balls % 6}`;
            const econ =
              stats.legal_balls > 0
                ? ((stats.runs_conceded / stats.legal_balls) * 6).toFixed(2)
                : "—";
            const isCurrent = currentBowler === row.player_id;
            // Build subtitle from secondary stats; omit zeros to keep it tight.
            const extras: string[] = [];
            if (stats.maidens) extras.push(`${stats.maidens} mdn`);
            if (stats.wides) extras.push(`${stats.wides} wd`);
            if (stats.no_balls) extras.push(`${stats.no_balls} nb`);
            if (stats.dots) extras.push(`${stats.dots} dot`);
            return (
              <tr
                key={row.player_id}
                className={
                  "border-b border-foreground/5 last:border-b-0 " +
                  (isCurrent ? "bg-amber-500/5" : "")
                }
              >
                <td className="px-3 py-2">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-medium capitalize">
                      {p?.display_name ?? "(unknown)"}
                    </span>
                    {isCurrent && (
                      <span
                        className="text-xs font-bold text-amber-700 dark:text-amber-300"
                        title="Currently bowling"
                      >
                        *
                      </span>
                    )}
                    {p?.category && (
                      <span className="font-mono text-[10px] text-muted-foreground">
                        C{p.category}
                      </span>
                    )}
                  </div>
                  {extras.length > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      {extras.join(" · ")}
                    </div>
                  )}
                </td>
                <td className="px-1.5 py-2 text-right font-mono tabular-nums">
                  {overs}
                </td>
                <td className="px-1.5 py-2 text-right font-mono tabular-nums">
                  {stats.runs_conceded}
                </td>
                <td className="px-1.5 py-2 text-right font-mono font-semibold tabular-nums">
                  {stats.wickets}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {econ}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------------------
// Stat computation helpers (mirror the SQL views)
// ---------------------------------------------------------------------------


function computeDismissal(
  balls: BallRow[],
  playerId: string,
  playerById: Map<string, PlayerLite>,
): string | null {
  const dismissal = balls.find(
    (b) => b.is_wicket && b.player_out_id === playerId,
  );
  if (!dismissal || !dismissal.wicket_type) return null;

  const fielderName = dismissal.fielder_id
    ? playerById.get(dismissal.fielder_id)?.display_name
    : null;
  const bowlerName = playerById.get(dismissal.bowler_id)?.display_name;

  switch (dismissal.wicket_type) {
    case "bowled":
      return bowlerName ? `b ${bowlerName}` : "bowled";
    case "caught":
      return `c ${fielderName ?? "?"} b ${bowlerName ?? "?"}`;
    case "caught_and_bowled":
      return bowlerName ? `c & b ${bowlerName}` : "c & b";
    case "stumped":
      return `st ${fielderName ?? "?"} b ${bowlerName ?? "?"}`;
    case "run_out":
      return fielderName ? `run out (${fielderName})` : "run out";
    case "hit_wicket":
      return bowlerName ? `hit wicket b ${bowlerName}` : "hit wicket";
    case "retired":
      return "retired";
    case "obstructing":
      return "obstructing";
    case "timed_out":
      return "timed out";
    default:
      return dismissal.wicket_type.replace(/_/g, " ");
  }
}

function computeFallOfWickets(
  balls: BallRow[],
  playerById: Map<string, PlayerLite>,
) {
  const fows: {
    wicketNum: number;
    runs: number;
    player: string;
    over: string;
  }[] = [];
  let cum = 0;
  let wicketNum = 0;
  for (const b of balls) {
    cum += b.runs_off_bat + b.extras;
    if (b.is_wicket && b.player_out_id) {
      wicketNum += 1;
      fows.push({
        wicketNum,
        runs: cum,
        player: playerById.get(b.player_out_id)?.display_name ?? "?",
        // Cricket convention: "X.Y" = X completed overs + Y balls into the next.
        over: `${b.over_number - 1}.${b.ball_in_over}`,
      });
    }
  }
  return fows;
}

function computePartnerships(balls: BallRow[]) {
  if (balls.length === 0) return [];
  const ps: {
    index: number;
    bat1: string;
    bat2: string;
    runs: number;
    balls: number;
  }[] = [];
  let bat1 = balls[0].batter_id;
  let bat2 = balls[0].non_striker_id;
  let runs = 0;
  let bf = 0;

  const samePair = (
    a1: string,
    a2: string,
    b1: string,
    b2: string,
  ) => (a1 === b1 && a2 === b2) || (a1 === b2 && a2 === b1);

  for (const b of balls) {
    if (!samePair(bat1, bat2, b.batter_id, b.non_striker_id)) {
      ps.push({ index: ps.length + 1, bat1, bat2, runs, balls: bf });
      bat1 = b.batter_id;
      bat2 = b.non_striker_id;
      runs = 0;
      bf = 0;
    }
    runs += b.runs_off_bat + b.extras;
    if (b.extra_type !== "wide" && b.extra_type !== "no_ball") bf += 1;
  }
  ps.push({ index: ps.length + 1, bat1, bat2, runs, balls: bf });
  return ps;
}
