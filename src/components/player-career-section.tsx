import Link from "next/link";

import { RefreshButton } from "@/components/refresh-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  loadCareerRankBadges,
  type CareerRankBadge,
} from "@/lib/stats/career-ranks";
import { createClient } from "@/lib/supabase/server";

type StatRow = {
  tournament_id: string;
  player_id: string;
  display_name: string;
  runs: number;
  balls_faced: number;
  fours: number;
  sixes: number;
  wickets: number;
  runs_conceded: number;
  legal_balls_bowled: number;
};

type MatchRow = {
  match_id: string;
  matches: { tournament_id: string };
};

type HistBattingRow = {
  match_id: string;
  innings_number: number;
  matches: { tournament_id: string };
};

/**
 * Career + By-tournament block for a player. Used identically on
 * /players/[id] (the public profile) and /me (the linked user's
 * dashboard) so a linked spectator sees the same numbers in the same
 * layout no matter which route they came through. All data sourcing
 * lives here, not in the page — keeps the two callers thin.
 */
export async function PlayerCareerSection({
  playerId,
}: {
  playerId: string;
}) {
  const supabase = await createClient();

  const [
    { data: rows },
    { data: matchRows },
    { data: ballsAsBatter },
    { data: ballsAsNonStriker },
    { data: historicalBattingRows },
    badges,
  ] = await Promise.all([
    supabase
      .from("v_player_tournament_stats" as never)
      .select("*")
      .eq("player_id", playerId),
    supabase
      .from("match_players")
      .select("match_id, matches!inner(tournament_id)")
      .eq("player_id", playerId),
    supabase
      .from("balls")
      .select("innings_id")
      .eq("batter_id", playerId)
      .eq("is_voided", false),
    supabase
      .from("balls")
      .select("innings_id")
      .eq("non_striker_id", playerId)
      .eq("is_voided", false),
    supabase
      .from("historical_match_batting")
      .select("match_id, innings_number, matches!inner(tournament_id)")
      .eq("player_id", playerId),
    // Career-rank badges: pulled in parallel with the per-player
    // career fetches so the extra ranking pass doesn't bottleneck
    // the render.
    loadCareerRankBadges(playerId),
  ]);

  const stats = (rows as unknown as StatRow[] | null) ?? [];

  const playedMatchIds = new Set<string>();
  const matchesByTournament = new Map<string, Set<string>>();
  const tournamentByMatch = new Map<string, string>();
  for (const r of (matchRows ?? []) as unknown as MatchRow[]) {
    playedMatchIds.add(r.match_id);
    const tid = r.matches.tournament_id;
    if (!tid) continue;
    tournamentByMatch.set(r.match_id, tid);
    let s = matchesByTournament.get(tid);
    if (!s) {
      s = new Set();
      matchesByTournament.set(tid, s);
    }
    s.add(r.match_id);
  }
  const matchesPlayed = playedMatchIds.size;

  const battedInningsIds = new Set<string>();
  for (const r of ballsAsBatter ?? []) battedInningsIds.add(r.innings_id);
  for (const r of ballsAsNonStriker ?? [])
    battedInningsIds.add(r.innings_id);

  const historicalInningsKeys = new Set<string>();
  for (const r of (historicalBattingRows ??
    []) as unknown as HistBattingRow[]) {
    historicalInningsKeys.add(`${r.match_id}:${r.innings_number}`);
  }

  const tournamentIds = Array.from(
    new Set(stats.map((s) => s.tournament_id)),
  );
  const [inningsRowsRes, tournamentsRes] = await Promise.all([
    battedInningsIds.size > 0
      ? supabase
          .from("innings")
          .select("id, match_id")
          .in("id", [...battedInningsIds])
      : Promise.resolve({
          data: [] as { id: string; match_id: string }[],
        }),
    tournamentIds.length > 0
      ? supabase
          .from("tournaments")
          .select("id, slug, name")
          .in("id", tournamentIds)
      : Promise.resolve({
          data: [] as { id: string; slug: string; name: string }[],
        }),
  ]);

  const inningsByTournament = new Map<string, Set<string>>();
  for (const r of inningsRowsRes.data ?? []) {
    const tid = tournamentByMatch.get(r.match_id);
    if (!tid) continue;
    let s = inningsByTournament.get(tid);
    if (!s) {
      s = new Set();
      inningsByTournament.set(tid, s);
    }
    s.add(r.id);
  }
  for (const r of (historicalBattingRows ??
    []) as unknown as HistBattingRow[]) {
    const tid = r.matches.tournament_id;
    if (!tid) continue;
    let s = inningsByTournament.get(tid);
    if (!s) {
      s = new Set();
      inningsByTournament.set(tid, s);
    }
    s.add(`${r.match_id}:${r.innings_number}`);
  }
  const inningsBatted = battedInningsIds.size + historicalInningsKeys.size;

  const tournamentById = new Map(
    (tournamentsRes.data ?? []).map((t) => [t.id, t]),
  );

  const career = stats.reduce(
    (acc, r) => ({
      runs: acc.runs + (r.runs ?? 0),
      balls_faced: acc.balls_faced + (r.balls_faced ?? 0),
      fours: acc.fours + (r.fours ?? 0),
      sixes: acc.sixes + (r.sixes ?? 0),
      wickets: acc.wickets + (r.wickets ?? 0),
      runs_conceded: acc.runs_conceded + (r.runs_conceded ?? 0),
      legal_balls_bowled: acc.legal_balls_bowled + (r.legal_balls_bowled ?? 0),
    }),
    {
      runs: 0,
      balls_faced: 0,
      fours: 0,
      sixes: 0,
      wickets: 0,
      runs_conceded: 0,
      legal_balls_bowled: 0,
    },
  );

  const careerSR =
    career.balls_faced > 0
      ? ((career.runs / career.balls_faced) * 100).toFixed(1)
      : "—";
  const careerEcon =
    career.legal_balls_bowled > 0
      ? ((career.runs_conceded / career.legal_balls_bowled) * 6).toFixed(2)
      : "—";

  const playedRows = stats.filter(
    (r) =>
      r.runs > 0 ||
      r.balls_faced > 0 ||
      r.wickets > 0 ||
      r.legal_balls_bowled > 0,
  );

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base">Career</CardTitle>
              <CardDescription>
                Aggregated across every HVC Heroes tournament.
              </CardDescription>
            </div>
            <RefreshButton label="Refresh career stats" />
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Stat label="Matches" value={matchesPlayed} />
          <Stat label="Innings" value={inningsBatted} />
          <Stat label="Runs" value={career.runs} />
          <Stat label="4s" value={career.fours} />
          <Stat label="6s" value={career.sixes} />
          <Stat label="SR" value={careerSR} />
          <Stat label="Wickets" value={career.wickets} />
          <Stat
            label="Overs bowled"
            value={`${Math.floor(career.legal_balls_bowled / 6)}.${career.legal_balls_bowled % 6}`}
          />
          <Stat label="Econ" value={careerEcon} />
        </CardContent>
      </Card>

      {badges.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All-time ranks</CardTitle>
            <CardDescription>
              Where this player ranks across every HVC season. Top 10
              only — anyone outside the top 10 in a metric doesn&apos;t
              show a badge for it.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {badges.map((b) => (
              <RankBadge key={b.metric} badge={b} />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">By tournament</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {playedRows.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No matches played yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr className="border-y border-foreground/10">
                    <th className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-medium">
                      Tournament
                    </th>
                    <th className="px-2 py-2 text-right font-medium">M</th>
                    <th className="px-2 py-2 text-right font-medium">I</th>
                    <th className="px-2 py-2 text-right font-medium">R</th>
                    <th className="px-2 py-2 text-right font-medium">4s</th>
                    <th className="px-2 py-2 text-right font-medium">6s</th>
                    <th className="px-2 py-2 text-right font-medium">SR</th>
                    <th className="px-2 py-2 text-right font-medium">W</th>
                    <th className="px-2 py-2 text-right font-medium">Ov</th>
                    <th className="px-4 py-2 text-right font-medium">Econ</th>
                  </tr>
                </thead>
                <tbody>
                  {playedRows.map((r) => {
                    const t = tournamentById.get(r.tournament_id);
                    const sr =
                      r.balls_faced > 0
                        ? ((r.runs / r.balls_faced) * 100).toFixed(1)
                        : "—";
                    const overs = `${Math.floor(r.legal_balls_bowled / 6)}.${r.legal_balls_bowled % 6}`;
                    const econ =
                      r.legal_balls_bowled > 0
                        ? ((r.runs_conceded / r.legal_balls_bowled) * 6).toFixed(2)
                        : "—";
                    return (
                      <tr
                        key={r.tournament_id}
                        className="border-b border-foreground/5 last:border-b-0"
                      >
                        <th
                          scope="row"
                          className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-normal"
                        >
                          {t ? (
                            <Link
                              href={`/tournaments/${t.slug}`}
                              prefetch
                              className="capitalize hover:underline"
                            >
                              {t.name}
                            </Link>
                          ) : (
                            "(unknown)"
                          )}
                        </th>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">
                          {matchesByTournament.get(r.tournament_id)?.size ?? 0}
                        </td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">
                          {inningsByTournament.get(r.tournament_id)?.size ?? 0}
                        </td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">
                          {r.runs}
                        </td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">
                          {r.fours}
                        </td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">
                          {r.sixes}
                        </td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">
                          {sr}
                        </td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">
                          {r.wickets}
                        </td>
                        <td className="px-2 py-2 text-right font-mono tabular-nums">
                          {r.legal_balls_bowled > 0 ? overs : "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-mono tabular-nums">
                          {econ}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-md border border-foreground/10 bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-base">{value}</div>
    </div>
  );
}

function RankBadge({ badge }: { badge: CareerRankBadge }) {
  // Rank 1 gets a gold accent (primary), rank 2-3 silver-ish
  // (foreground), rank 4-10 muted. Same visual hierarchy as
  // CricHeroes' "Top N" pills.
  const tone =
    badge.rank === 1
      ? "border-primary/40 bg-primary/15 text-primary"
      : badge.rank <= 3
        ? "border-foreground/20 bg-foreground/5 text-foreground"
        : "border-foreground/10 bg-muted/40 text-muted-foreground";
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium " +
        tone
      }
    >
      <span className="font-mono tabular-nums">#{badge.rank}</span>
      <span>{badge.label}</span>
    </span>
  );
}
