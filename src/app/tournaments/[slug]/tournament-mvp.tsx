import { Card, CardContent } from "@/components/ui/card";
import { computeMatchMvp, type MvpBreakdown } from "@/lib/scoring/mvp";
import { createClient } from "@/lib/supabase/server";
import type { BallRow } from "@/lib/supabase/row-types";

import { TournamentMvpView, type MvpEntry } from "./tournament-mvp-view";

/**
 * Tournament MVP — sum of per-match MVP scores across every match the
 * player appeared in. Same scoring rules as the per-match Player-of-
 * the-Match award (see @/lib/scoring/mvp), so the leaderboard is just
 * a season aggregate of those.
 */
export async function TournamentMvp({
  tournamentId,
}: {
  tournamentId: string;
}) {
  const supabase = await createClient();

  const { data: matches } = await supabase
    .from("matches")
    .select("id, winner_id, status")
    .eq("tournament_id", tournamentId)
    .in("status", ["live", "innings_break", "completed"]);

  if (!matches || matches.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          MVP unlocks once a match has started.
        </CardContent>
      </Card>
    );
  }

  const matchIds = matches.map((m) => m.id);

  const [{ data: xi }, { data: ballsRows }] = await Promise.all([
    supabase
      .from("match_players")
      .select("match_id, team_id, player_id, is_substitute")
      .in("match_id", matchIds),
    supabase
      .from("balls")
      .select("*")
      .in(
        "innings_id",
        // Resolve innings IDs separately to keep this query cheap.
        (
          await supabase
            .from("innings")
            .select("id")
            .in("match_id", matchIds)
        ).data?.map((i) => i.id) ?? [],
      )
      .eq("is_voided", false)
      .order("scored_at", { ascending: true }),
  ]);

  const allBalls = (ballsRows ?? []) as BallRow[];
  const ballsByMatch = new Map<string, BallRow[]>();
  if (allBalls.length > 0) {
    // Need the innings_id → match_id mapping to bucket balls per match.
    const inningsRes = await supabase
      .from("innings")
      .select("id, match_id")
      .in("match_id", matchIds);
    const matchByInnings = new Map(
      (inningsRes.data ?? []).map((i) => [i.id, i.match_id]),
    );
    for (const b of allBalls) {
      const mid = matchByInnings.get(b.innings_id);
      if (!mid) continue;
      const list = ballsByMatch.get(mid) ?? [];
      list.push(b);
      ballsByMatch.set(mid, list);
    }
  }

  const xiByMatch = new Map<
    string,
    { player_id: string; team_id: string }[]
  >();
  for (const row of xi ?? []) {
    if (row.is_substitute) continue;
    const list = xiByMatch.get(row.match_id) ?? [];
    list.push({ player_id: row.player_id, team_id: row.team_id });
    xiByMatch.set(row.match_id, list);
  }

  // Aggregate: walk every match, compute per-player MVP, sum by player.
  type Agg = {
    player_id: string;
    team_id: string;
    matches: number;
    battingPts: number;
    bowlingPts: number;
    fieldingPts: number;
    teamPts: number;
    total: number;
  };
  const agg = new Map<string, Agg>();

  for (const m of matches) {
    const xiForMatch = xiByMatch.get(m.id) ?? [];
    const ballsForMatch = ballsByMatch.get(m.id) ?? [];
    if (xiForMatch.length === 0) continue;
    const perMatch: MvpBreakdown[] = computeMatchMvp(
      ballsForMatch,
      xiForMatch,
      m.winner_id,
    );
    for (const p of perMatch) {
      // Filter out zero-contribution rows for players who didn't even
      // bat or bowl — their team-bonus alone shouldn't put them on the
      // MVP list. Players with any individual action stay.
      const hadAction =
        p.battingPts !== 0 ||
        p.bowlingPts !== 0 ||
        p.fieldingPts !== 0;
      if (!hadAction && p.teamPts === 0) continue;
      let a = agg.get(p.player_id);
      if (!a) {
        a = {
          player_id: p.player_id,
          team_id: p.team_id,
          matches: 0,
          battingPts: 0,
          bowlingPts: 0,
          fieldingPts: 0,
          teamPts: 0,
          total: 0,
        };
        agg.set(p.player_id, a);
      }
      a.matches += 1;
      a.battingPts += p.battingPts;
      a.bowlingPts += p.bowlingPts;
      a.fieldingPts += p.fieldingPts;
      a.teamPts += p.teamPts;
      a.total += p.total;
    }
  }

  // Resolve player + team metadata for display.
  const playerIds = [...agg.keys()];
  const teamIds = [...new Set([...agg.values()].map((a) => a.team_id))];

  if (playerIds.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No MVP data yet.
        </CardContent>
      </Card>
    );
  }

  const [{ data: players }, { data: teams }] = await Promise.all([
    supabase
      .from("players")
      .select("id, display_name, category")
      .in("id", playerIds),
    supabase.from("teams").select("id, short_name").in("id", teamIds),
  ]);
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));
  const teamShortById = new Map(
    (teams ?? []).map((t) => [t.id, t.short_name]),
  );

  const entries: MvpEntry[] = [...agg.values()]
    .map((a) => {
      const p = playerById.get(a.player_id);
      return {
        player_id: a.player_id,
        name: p?.display_name ?? "(unknown)",
        cat: p?.category ?? null,
        team: teamShortById.get(a.team_id) ?? "?",
        matches: a.matches,
        battingPts: a.battingPts,
        bowlingPts: a.bowlingPts,
        fieldingPts: a.fieldingPts,
        teamPts: a.teamPts,
        total: a.total,
      };
    })
    .sort((a, b) => b.total - a.total);

  // Pre-bucket by category for the chip filter (matches Stats tab UX).
  const cat1 = entries
    .filter((e) => e.cat === 1)
    .slice(0, 25);
  const cat2 = entries
    .filter((e) => e.cat === 2)
    .slice(0, 25);
  const cat3 = entries
    .filter((e) => e.cat === 3)
    .slice(0, 25);
  const all = entries.slice(0, 25);

  return <TournamentMvpView all={all} cat1={cat1} cat2={cat2} cat3={cat3} />;
}
