import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import type { Database } from "@/lib/supabase/database.types";

type BallRow = Database["public"]["Tables"]["balls"]["Row"];

/**
 * Full per-innings scorecard for completed matches. Renders two tables per
 * innings — batting and bowling — derived directly from `balls` rows and
 * the playing XI. Mirrors what the SQL views (v_innings_batting,
 * v_innings_bowling) compute, but inline so the page stays a single
 * server-component round-trip.
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
  const teamById = new Map(
    (teams ?? []).map((t) => [t.id, t]),
  );

  // Pull all players from match_players + players for both teams in one shot
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
    : { data: [] as { id: string; display_name: string; category: number | null }[] };
  const playerById = new Map((playerRows ?? []).map((p) => [p.id, p]));

  // Pull all balls for both innings
  const inningsIds = innings.map((i) => i.id);
  const { data: ballsRows } = await supabase
    .from("balls")
    .select("*")
    .in("innings_id", inningsIds)
    .eq("is_voided", false)
    .order("scored_at", { ascending: true });
  const allBalls = (ballsRows ?? []) as BallRow[];

  return (
    <div className="space-y-6">
      {innings.map((i) => {
        const battingTeam = teamById.get(i.batting_team_id);
        const bowlingTeam = teamById.get(i.bowling_team_id);
        const inningsBalls = allBalls.filter((b) => b.innings_id === i.id);
        const battingXi = (xi ?? []).filter((r) => r.team_id === i.batting_team_id);
        const bowlingXi = (xi ?? []).filter((r) => r.team_id === i.bowling_team_id);

        const overs = `${Math.floor(i.total_legal_balls / 6)}.${i.total_legal_balls % 6}`;

        return (
          <Card key={i.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {battingTeam?.name ?? "?"} — Innings {i.innings_number}
              </CardTitle>
              <CardDescription>
                {i.total_runs}/{i.total_wickets} ({overs} overs)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 p-0">
              <BattingTable
                balls={inningsBalls}
                xi={battingXi}
                playerById={playerById}
              />
              <ExtrasRow innings={i} />
              <BowlingTable
                balls={inningsBalls}
                xi={bowlingXi}
                playerById={playerById}
                bowlingTeamName={bowlingTeam?.name}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function BattingTable({
  balls,
  xi,
  playerById,
}: {
  balls: BallRow[];
  xi: { player_id: string; batting_order: number | null }[];
  playerById: Map<string, { id: string; display_name: string; category: number | null }>;
}) {
  // Determine batting order: prefer match_players.batting_order;
  // fall back to first-appearance order in balls.
  const firstAppearance = new Map<string, number>();
  balls.forEach((b, idx) => {
    if (!firstAppearance.has(b.batter_id)) firstAppearance.set(b.batter_id, idx);
    if (!firstAppearance.has(b.non_striker_id))
      firstAppearance.set(b.non_striker_id, idx);
  });

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

  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase text-muted-foreground">
        <tr className="border-y border-foreground/10">
          <th className="px-4 py-2 text-left font-medium">Batter</th>
          <th className="px-2 py-2 text-left font-medium">Out</th>
          <th className="px-2 py-2 text-right font-medium">R</th>
          <th className="px-2 py-2 text-right font-medium">B</th>
          <th className="px-2 py-2 text-right font-medium">4s</th>
          <th className="px-2 py-2 text-right font-medium">6s</th>
          <th className="px-4 py-2 text-right font-medium">SR</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => {
          const p = playerById.get(row.player_id);
          const stats = computeBatterStats(balls, row.player_id);
          const dismissal = computeDismissal(balls, row.player_id, playerById);
          const battedAtAll =
            firstAppearance.get(row.player_id) !== undefined ||
            stats.runs > 0 ||
            stats.balls_faced > 0;
          return (
            <tr
              key={row.player_id}
              className="border-b border-foreground/5 last:border-b-0"
            >
              <td className="px-4 py-2">
                <span className="font-medium">{p?.display_name ?? "(unknown)"}</span>
                {p?.category && (
                  <span className="ml-2 text-[10px] font-mono text-muted-foreground">
                    C{p.category}
                  </span>
                )}
              </td>
              <td className="px-2 py-2 text-xs text-muted-foreground">
                {!battedAtAll
                  ? "did not bat"
                  : dismissal ?? "not out"}
              </td>
              <td className="px-2 py-2 text-right font-mono">{stats.runs}</td>
              <td className="px-2 py-2 text-right font-mono">
                {stats.balls_faced}
              </td>
              <td className="px-2 py-2 text-right font-mono">{stats.fours}</td>
              <td className="px-2 py-2 text-right font-mono">{stats.sixes}</td>
              <td className="px-4 py-2 text-right font-mono">
                {stats.balls_faced > 0
                  ? ((stats.runs / stats.balls_faced) * 100).toFixed(1)
                  : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
  const extras = innings.extras_wides + innings.extras_no_balls + innings.extras_byes;
  return (
    <div className="border-y border-foreground/10 px-4 py-2 text-sm">
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">
          Extras
          <span className="ml-2 text-xs">
            (wd {innings.extras_wides} · nb {innings.extras_no_balls} · b {innings.extras_byes})
          </span>
        </span>
        <span className="font-mono">{extras}</span>
      </div>
      <div className="flex justify-between gap-3 pt-1 text-xs text-muted-foreground">
        <span>
          Total — {innings.total_wickets} wickets in{" "}
          {Math.floor(innings.total_legal_balls / 6)}.
          {innings.total_legal_balls % 6} overs
        </span>
        <span className="font-mono text-foreground">{innings.total_runs}</span>
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
  playerById: Map<string, { id: string; display_name: string; category: number | null }>;
  bowlingTeamName?: string;
}) {
  // Show only bowlers who actually bowled
  const bowlerIds = new Set(balls.map((b) => b.bowler_id));
  const bowlers = xi.filter((r) => bowlerIds.has(r.player_id));

  if (bowlers.length === 0) return null;

  return (
    <>
      <div className="px-4 py-2 text-xs uppercase text-muted-foreground">
        {bowlingTeamName ?? "Bowling"}
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-muted-foreground">
          <tr className="border-y border-foreground/10">
            <th className="px-4 py-2 text-left font-medium">Bowler</th>
            <th className="px-2 py-2 text-right font-medium">O</th>
            <th className="px-2 py-2 text-right font-medium">R</th>
            <th className="px-2 py-2 text-right font-medium">W</th>
            <th className="px-2 py-2 text-right font-medium">Wd</th>
            <th className="px-2 py-2 text-right font-medium">Nb</th>
            <th className="px-4 py-2 text-right font-medium">Econ</th>
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
            return (
              <tr
                key={row.player_id}
                className="border-b border-foreground/5 last:border-b-0"
              >
                <td className="px-4 py-2">
                  <span className="font-medium">{p?.display_name ?? "(unknown)"}</span>
                  {p?.category && (
                    <span className="ml-2 text-[10px] font-mono text-muted-foreground">
                      C{p.category}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right font-mono">{overs}</td>
                <td className="px-2 py-2 text-right font-mono">{stats.runs_conceded}</td>
                <td className="px-2 py-2 text-right font-mono">{stats.wickets}</td>
                <td className="px-2 py-2 text-right font-mono">{stats.wides}</td>
                <td className="px-2 py-2 text-right font-mono">{stats.no_balls}</td>
                <td className="px-4 py-2 text-right font-mono">{econ}</td>
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

function computeBatterStats(balls: BallRow[], playerId: string) {
  let runs = 0;
  let balls_faced = 0;
  let fours = 0;
  let sixes = 0;
  for (const b of balls) {
    if (b.batter_id !== playerId) continue;
    runs += b.runs_off_bat;
    if (b.extra_type !== "wide") balls_faced += 1;
    if (b.runs_off_bat === 4) fours += 1;
    if (b.runs_off_bat === 6) sixes += 1;
  }
  return { runs, balls_faced, fours, sixes };
}

function computeBowlerStats(balls: BallRow[], playerId: string) {
  let legal_balls = 0;
  let runs_conceded = 0;
  let wickets = 0;
  let wides = 0;
  let no_balls = 0;
  const wicketBowler = new Set([
    "bowled",
    "caught",
    "caught_and_bowled",
    "lbw",
    "stumped",
    "hit_wicket",
  ]);
  for (const b of balls) {
    if (b.bowler_id !== playerId) continue;
    if (b.extra_type !== "wide" && b.extra_type !== "no_ball") {
      legal_balls += 1;
    }
    runs_conceded += b.runs_off_bat;
    if (b.extra_type === "wide" || b.extra_type === "no_ball") {
      runs_conceded += b.extras;
    }
    if (b.extra_type === "wide") wides += 1;
    if (b.extra_type === "no_ball") no_balls += 1;
    if (b.is_wicket && b.wicket_type && wicketBowler.has(b.wicket_type)) {
      wickets += 1;
    }
  }
  return { legal_balls, runs_conceded, wickets, wides, no_balls };
}

function computeDismissal(
  balls: BallRow[],
  playerId: string,
  playerById: Map<string, { id: string; display_name: string; category: number | null }>,
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
