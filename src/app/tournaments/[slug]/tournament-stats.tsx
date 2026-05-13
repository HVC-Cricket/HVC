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

/**
 * Tournament-wide leaderboards: top batters, top bowlers, most
 * boundaries, best strike rates / economies. Aggregated across every
 * non-voided ball in every completed/live match of the tournament.
 *
 * Single bulk fetch — balls in this tournament + the players + teams
 * lookup — then in-memory rollup. With a 20-match tournament that's
 * ~12k ball rows; fine for a Server Component render.
 */
export async function TournamentStats({
  tournamentId,
}: {
  tournamentId: string;
}) {
  const supabase = await createClient();

  // 1. Matches in this tournament (only ones that have started — no
  //    point pulling rows for scheduled fixtures).
  const { data: matches } = await supabase
    .from("matches")
    .select("id, status")
    .eq("tournament_id", tournamentId)
    .in("status", ["live", "innings_break", "completed"]);

  if (!matches || matches.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          Stats unlock once a match has started.
        </CardContent>
      </Card>
    );
  }

  const matchIds = matches.map((m) => m.id);

  // 2. All innings → for the match_id → team mapping that drives the
  //    "X bats for HH" lookup later. We also use it to constrain the
  //    balls query.
  const { data: innings } = await supabase
    .from("innings")
    .select("id, match_id, batting_team_id, bowling_team_id")
    .in("match_id", matchIds);

  if (!innings || innings.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No balls bowled yet.
        </CardContent>
      </Card>
    );
  }

  const inningsIds = innings.map((i) => i.id);
  const inningsById = new Map(innings.map((i) => [i.id, i]));

  // 3. All balls (non-voided) across this tournament.
  const { data: ballsRows } = await supabase
    .from("balls")
    .select("*")
    .in("innings_id", inningsIds)
    .eq("is_voided", false)
    .order("scored_at", { ascending: true });
  const allBalls = (ballsRows ?? []) as BallRow[];

  if (allBalls.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No balls bowled yet.
        </CardContent>
      </Card>
    );
  }

  // 4. All player IDs we touched + the team they bat for, derived from
  //    innings.batting_team_id (the team they bat for is whatever team
  //    they were a batter for first).
  const playerToTeam = new Map<string, string>();
  for (const b of allBalls) {
    if (!playerToTeam.has(b.batter_id)) {
      const inn = inningsById.get(b.innings_id);
      if (inn) playerToTeam.set(b.batter_id, inn.batting_team_id);
    }
    if (!playerToTeam.has(b.non_striker_id)) {
      const inn = inningsById.get(b.innings_id);
      if (inn) playerToTeam.set(b.non_striker_id, inn.batting_team_id);
    }
    if (!playerToTeam.has(b.bowler_id)) {
      const inn = inningsById.get(b.innings_id);
      if (inn) playerToTeam.set(b.bowler_id, inn.bowling_team_id);
    }
  }

  const playerIds = [...new Set(playerToTeam.keys())];
  const teamIds = [...new Set(playerToTeam.values())];

  const [{ data: players }, { data: teams }] = await Promise.all([
    supabase
      .from("players")
      .select("id, display_name, category")
      .in("id", playerIds),
    supabase
      .from("teams")
      .select("id, short_name")
      .in("id", teamIds),
  ]);
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));
  const teamShortById = new Map(
    (teams ?? []).map((t) => [t.id, t.short_name]),
  );

  // 5. Roll up batting + bowling stats per player using the shared
  //    helpers (same code paths as the per-match scorecard).
  type BatRow = {
    player_id: string;
    name: string;
    team: string;
    cat: number | null;
    runs: number;
    balls_faced: number;
    fours: number;
    sixes: number;
    strikeRate: number;
  };
  type BowlRow = {
    player_id: string;
    name: string;
    team: string;
    cat: number | null;
    wickets: number;
    runs_conceded: number;
    legal_balls: number;
    economy: number;
    dots: number;
  };

  const batRows: BatRow[] = [];
  const bowlRows: BowlRow[] = [];

  for (const pid of playerIds) {
    const p = playerById.get(pid);
    if (!p) continue;
    const teamId = playerToTeam.get(pid)!;
    const team = teamShortById.get(teamId) ?? "?";

    const bat = computeBatterStats(allBalls, pid);
    if (bat.balls_faced > 0 || bat.runs > 0) {
      batRows.push({
        player_id: pid,
        name: p.display_name,
        team,
        cat: p.category,
        runs: bat.runs,
        balls_faced: bat.balls_faced,
        fours: bat.fours,
        sixes: bat.sixes,
        strikeRate:
          bat.balls_faced > 0 ? (bat.runs / bat.balls_faced) * 100 : 0,
      });
    }

    const bowl = computeBowlerStats(allBalls, pid);
    if (bowl.legal_balls > 0) {
      bowlRows.push({
        player_id: pid,
        name: p.display_name,
        team,
        cat: p.category,
        wickets: bowl.wickets,
        runs_conceded: bowl.runs_conceded,
        legal_balls: bowl.legal_balls,
        economy: (bowl.runs_conceded / bowl.legal_balls) * 6,
        dots: bowl.dots,
      });
    }
  }

  // 6. Rank: top 5 in each category. SR + Econ require a minimum
  //    sample so a 1-ball 6 doesn't top the strike-rate chart.
  const topRuns = [...batRows].sort((a, b) => b.runs - a.runs).slice(0, 5);
  const topBoundaries = [...batRows]
    .map((r) => ({ ...r, boundaries: r.fours + r.sixes }))
    .filter((r) => r.boundaries > 0)
    .sort((a, b) =>
      b.boundaries === a.boundaries
        ? b.sixes - a.sixes // tiebreak: more sixes wins
        : b.boundaries - a.boundaries,
    )
    .slice(0, 5);
  const topSR = [...batRows]
    .filter((r) => r.balls_faced >= 12) // 2 overs faced minimum
    .sort((a, b) => b.strikeRate - a.strikeRate)
    .slice(0, 5);

  const topWickets = [...bowlRows]
    .sort((a, b) =>
      b.wickets === a.wickets ? a.economy - b.economy : b.wickets - a.wickets,
    )
    .slice(0, 5);
  const topEcon = [...bowlRows]
    .filter((r) => r.legal_balls >= 12) // 2 overs bowled minimum
    .sort((a, b) => a.economy - b.economy)
    .slice(0, 5);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <BatLeaderCard
        title="Most runs"
        rows={topRuns.map((r) => ({
          name: r.name,
          team: r.team,
          cat: r.cat,
          primary: `${r.runs}`,
          secondary: `(${r.balls_faced})`,
        }))}
      />
      <BowlLeaderCard
        title="Most wickets"
        rows={topWickets.map((r) => {
          const overs = `${Math.floor(r.legal_balls / 6)}.${r.legal_balls % 6}`;
          return {
            name: r.name,
            team: r.team,
            cat: r.cat,
            primary: `${r.wickets}`,
            secondary: `(${overs}, econ ${r.economy.toFixed(2)})`,
          };
        })}
      />
      <BatLeaderCard
        title="Most boundaries"
        rows={topBoundaries.map((r) => ({
          name: r.name,
          team: r.team,
          cat: r.cat,
          primary: `${r.boundaries}`,
          secondary: `(${r.fours}×4, ${r.sixes}×6)`,
        }))}
      />
      <BatLeaderCard
        title="Best strike rate"
        rows={topSR.map((r) => ({
          name: r.name,
          team: r.team,
          cat: r.cat,
          primary: r.strikeRate.toFixed(1),
          secondary: `(${r.runs} off ${r.balls_faced})`,
        }))}
        emptyHint="At least 12 balls faced."
      />
      <BowlLeaderCard
        title="Best economy"
        rows={topEcon.map((r) => {
          const overs = `${Math.floor(r.legal_balls / 6)}.${r.legal_balls % 6}`;
          return {
            name: r.name,
            team: r.team,
            cat: r.cat,
            primary: r.economy.toFixed(2),
            secondary: `(${r.runs_conceded}/${overs}, ${r.wickets}w)`,
          };
        })}
        emptyHint="At least 2 overs bowled."
      />
    </div>
  );
}

type Row = {
  name: string;
  team: string;
  cat: number | null;
  primary: string;
  secondary: string;
};

function BatLeaderCard({
  title,
  rows,
  emptyHint,
}: {
  title: string;
  rows: Row[];
  emptyHint?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {emptyHint && rows.length === 0 && (
          <CardDescription>{emptyHint}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="px-6 pb-6 text-sm text-muted-foreground">
            No data yet.
          </div>
        ) : (
          <ul className="divide-y divide-foreground/10">
            {rows.map((r, idx) => (
              <LeaderRow key={r.name + idx} idx={idx} row={r} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function BowlLeaderCard({
  title,
  rows,
  emptyHint,
}: {
  title: string;
  rows: Row[];
  emptyHint?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {emptyHint && rows.length === 0 && (
          <CardDescription>{emptyHint}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="px-6 pb-6 text-sm text-muted-foreground">
            No data yet.
          </div>
        ) : (
          <ul className="divide-y divide-foreground/10">
            {rows.map((r, idx) => (
              <LeaderRow key={r.name + idx} idx={idx} row={r} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function LeaderRow({ idx, row }: { idx: number; row: Row }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold tabular-nums " +
            (idx === 0
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground")
          }
        >
          {idx + 1}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium capitalize">{row.name}</span>
            {row.cat && (
              <span className="font-mono text-[9px] text-muted-foreground">
                C{row.cat}
              </span>
            )}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {row.team}
          </div>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-base font-semibold leading-none tabular-nums">
          {row.primary}
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          {row.secondary}
        </div>
      </div>
    </li>
  );
}
