import { Card, CardContent } from "@/components/ui/card";
import { fetchLinkedAvatars } from "@/lib/players/fetch-linked-avatars";
import { computeMatchMvp, type MvpBreakdown } from "@/lib/scoring/mvp";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";
import type { BallRow } from "@/lib/supabase/row-types";

import { TournamentMvpView, type MvpEntry } from "./tournament-mvp-view";

/**
 * Tournament MVP — sum of per-match MVP scores across every match the
 * player appeared in. Same scoring rules as the per-match Player-of-
 * the-Match award (see @/lib/scoring/mvp), so the leaderboard is just
 * a season aggregate of those.
 *
 * Historical (CricHeroes-imported) tournaments don't have ball-by-ball
 * data, so we can't run our formula over them — instead we render
 * cricheroes' published MVP leaderboard verbatim from
 * historical_tournament_mvp. See migration 20260517000000.
 */
export async function TournamentMvp({
  tournamentId,
}: {
  tournamentId: string;
}) {
  const supabase = await createClient();

  // Historical fallback: cricheroes-imported tournaments have rows in
  // historical_tournament_mvp. Render those directly and skip the
  // ball-by-ball compute.
  const historical = await loadHistoricalMvp(supabase, tournamentId);
  if (historical) return historical;

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

  // xi + balls + innings(id,match_id) all depend only on matchIds.
  // The balls fetch paginates via fetchAllRows so PostgREST's max-rows
  // cap (1000 by default) doesn't silently truncate — S7 crossed 1000
  // balls at match 11 and without pagination match 12+ silently
  // disappeared from the MVP aggregation (Pranav's match-12 60-run
  // knock didn't contribute to his bat-points). `.limit()` from the
  // JS client doesn't help — it sets PostgREST's Range header, which
  // is bounded by max-rows server-side.
  //
  // The `innings!inner(match_id)` join keeps the filter server-side
  // so we don't drag every ball in the DB across the wire; pagination
  // walks just this tournament's rows.
  const [{ data: xi }, allBalls, { data: inningsRows }] = await Promise.all([
    supabase
      .from("match_players")
      .select("match_id, team_id, player_id, is_substitute")
      .in("match_id", matchIds),
    // Trimmed column list — `computeMatchMvp` only reads
    // batter/non_striker/bowler/fielder/player_out IDs, runs_off_bat,
    // extras, extra_type, is_wicket, wicket_type, and over_number
    // (for maiden detection). Previously selected `*` which pulled
    // all ~22 ball columns per row including raw event metadata
    // (shot_type, shot_zone, pitch_x/y, custom_data jsonb, etc.) the
    // MVP rollup never touches. Halves the wire bytes per fetch.
    fetchAllRows<BallRow>((from, to) =>
      supabase
        .from("balls")
        .select(
          "innings_id, over_number, batter_id, non_striker_id, bowler_id, fielder_id, player_out_id, runs_off_bat, extras, extra_type, is_wicket, wicket_type, innings!inner(match_id)",
        )
        .in("innings.match_id", matchIds)
        .eq("is_voided", false)
        .order("scored_at", { ascending: true })
        .range(from, to) as PromiseLike<{ data: BallRow[] | null }>,
    ),
    supabase
      .from("innings")
      .select("id, match_id")
      .in("match_id", matchIds),
  ]);
  const ballsByMatch = new Map<string, BallRow[]>();
  if (allBalls.length > 0) {
    const matchByInnings = new Map(
      (inningsRows ?? []).map((i) => [i.id, i.match_id]),
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
  // Raw stats are summed alongside the points contribution so the MVP
  // row can show the cricbuzz-style breakdown (runs/balls, wkts/runs,
  // catches) next to the points — clears up "Bat: 144" being misread
  // as 144 runs when it's actually 144 points from batting.
  type Agg = {
    player_id: string;
    team_id: string;
    matches: number;
    battingPts: number;
    bowlingPts: number;
    fieldingPts: number;
    teamPts: number;
    total: number;
    runs: number;
    balls_faced: number;
    fours: number;
    sixes: number;
    wickets: number;
    runs_conceded: number;
    legal_balls: number;
    catches: number;
    run_outs: number;
    stumpings: number;
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
          runs: 0,
          balls_faced: 0,
          fours: 0,
          sixes: 0,
          wickets: 0,
          runs_conceded: 0,
          legal_balls: 0,
          catches: 0,
          run_outs: 0,
          stumpings: 0,
        };
        agg.set(p.player_id, a);
      }
      a.matches += 1;
      a.battingPts += p.battingPts;
      a.bowlingPts += p.bowlingPts;
      a.fieldingPts += p.fieldingPts;
      a.teamPts += p.teamPts;
      a.total += p.total;
      a.runs += p.runs;
      a.balls_faced += p.balls_faced;
      a.fours += p.fours;
      a.sixes += p.sixes;
      a.wickets += p.wickets;
      a.runs_conceded += p.runs_conceded;
      a.legal_balls += p.legal_balls;
      a.catches += p.catches;
      a.run_outs += p.run_outs;
      a.stumpings += p.stumpings;
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
      .select("id, display_name, category, photo_url, linked_user_id")
      .in("id", playerIds),
    supabase.from("teams").select("id, short_name").in("id", teamIds),
  ]);
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));
  const teamShortById = new Map(
    (teams ?? []).map((t) => [t.id, t.short_name]),
  );

  // Avatar fallback: when a player has no photo_url but linked their
  // auth account, use that account's avatar so the MVP list shows
  // their face. Matches the same fallback used by player list / POTM.
  const avatarByUserId = await fetchLinkedAvatars(supabase, players ?? []);

  const entries: MvpEntry[] = [...agg.values()]
    .map((a) => {
      const p = playerById.get(a.player_id);
      const photo =
        p?.photo_url ??
        (p?.linked_user_id ? avatarByUserId.get(p.linked_user_id) : null) ??
        null;
      return {
        player_id: a.player_id,
        name: p?.display_name ?? "(unknown)",
        cat: p?.category ?? null,
        team: teamShortById.get(a.team_id) ?? "?",
        photo,
        matches: a.matches,
        battingPts: a.battingPts,
        bowlingPts: a.bowlingPts,
        fieldingPts: a.fieldingPts,
        teamPts: a.teamPts,
        total: a.total,
        runs: a.runs,
        balls_faced: a.balls_faced,
        fours: a.fours,
        sixes: a.sixes,
        wickets: a.wickets,
        runs_conceded: a.runs_conceded,
        legal_balls: a.legal_balls,
        catches: a.catches,
        run_outs: a.run_outs,
        stumpings: a.stumpings,
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

/**
 * Returns the rendered cricheroes-MVP view if this tournament has
 * historical MVP rows; otherwise `null` so the caller falls through
 * to the ball-by-ball compute path.
 */
async function loadHistoricalMvp(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tournamentId: string,
) {
  const { data: rows } = await supabase
    .from("historical_tournament_mvp")
    .select(
      "player_id, player_name, team_id, rank, matches, batting_points, bowling_points, fielding_points, total_points",
    )
    .eq("tournament_id", tournamentId)
    .order("rank", { ascending: true });
  if (!rows || rows.length === 0) return null;

  // Resolve player + team metadata. player_id can be null (e.g. a
  // cricheroes player who never got mapped to one of ours); in that
  // case fall back to the preserved player_name and skip the photo.
  const playerIds = rows
    .map((r) => r.player_id)
    .filter((v): v is string => v != null);
  const teamIds = [
    ...new Set(rows.map((r) => r.team_id).filter((v): v is string => v != null)),
  ];
  const [{ data: players }, { data: teams }] = await Promise.all([
    playerIds.length > 0
      ? supabase
          .from("players")
          .select("id, display_name, category, photo_url, linked_user_id")
          .in("id", playerIds)
      : Promise.resolve({ data: [] as Array<{
          id: string;
          display_name: string;
          category: number | null;
          photo_url: string | null;
          linked_user_id: string | null;
        }> }),
    teamIds.length > 0
      ? supabase.from("teams").select("id, short_name").in("id", teamIds)
      : Promise.resolve({ data: [] as Array<{ id: string; short_name: string }> }),
  ]);
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));
  const teamShortById = new Map(
    (teams ?? []).map((t) => [t.id, t.short_name]),
  );
  const avatarByUserId = await fetchLinkedAvatars(supabase, players ?? []);

  const entries: MvpEntry[] = rows.map((r) => {
    const p = r.player_id ? playerById.get(r.player_id) : undefined;
    const photo =
      p?.photo_url ??
      (p?.linked_user_id ? avatarByUserId.get(p.linked_user_id) : null) ??
      null;
    return {
      player_id: r.player_id ?? `historical:${r.rank}`,
      name: p?.display_name ?? r.player_name,
      cat: p?.category ?? null,
      team: r.team_id ? teamShortById.get(r.team_id) ?? "?" : "?",
      photo,
      matches: r.matches,
      battingPts: Number(r.batting_points),
      bowlingPts: Number(r.bowling_points),
      fieldingPts: Number(r.fielding_points),
      teamPts: 0,
      total: Number(r.total_points),
      // Cricheroes published only the points breakdown, not the raw
      // per-player stats. Zero-fill so the row shape is consistent;
      // the view hides the Stats line on `source="cricheroes"`.
      runs: 0,
      balls_faced: 0,
      fours: 0,
      sixes: 0,
      wickets: 0,
      runs_conceded: 0,
      legal_balls: 0,
      catches: 0,
      run_outs: 0,
      stumpings: 0,
    };
  });

  return (
    <TournamentMvpView
      source="cricheroes"
      all={entries}
      cat1={[]}
      cat2={[]}
      cat3={[]}
    />
  );
}
