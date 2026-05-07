import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  type EnginePlayer,
  type RuleSet,
  getRuleSet,
} from "@/lib/scoring";

import type { Database } from "@/lib/supabase/database.types";

type BallRow = Database["public"]["Tables"]["balls"]["Row"];
type MatchRow = Database["public"]["Tables"]["matches"]["Row"];

export type ScoreboardState = {
  match: MatchRow;
  tournament: { id: string; slug: string; name: string };
  rules: RuleSet;
  teamA: { id: string; name: string; short_name: string };
  teamB: { id: string; name: string; short_name: string };
  /** XI for both teams keyed by team_id */
  xi: Record<string, EnginePlayer[]>;
  innings: {
    id: string;
    innings_number: number;
    batting_team_id: string;
    bowling_team_id: string;
    total_runs: number;
    total_wickets: number;
    total_legal_balls: number;
    extras_wides: number;
    extras_no_balls: number;
    extras_byes: number;
    is_complete: boolean;
  } | null;
  /** all non-voided balls of the active innings, in order */
  balls: BallRow[];
  /** balls within the current (in-progress) over */
  currentOverBalls: BallRow[];
  /** the previous over's balls, useful for the recent-balls strip */
  previousOverBalls: BallRow[];
  /** active state derived from latest ball + rules */
  active: {
    over_number: number;
    legal_balls_in_over: number;
    striker_id: string | null;
    non_striker_id: string | null;
    bowler_id: string | null;
    free_hit_pending: boolean;
    is_special_over: "cat1" | "cat3" | null;
  };
};

export async function loadScoreboardState(matchId: string): Promise<ScoreboardState> {
  const supabase = await createClient();

  const { data: match } = await supabase
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .single();
  if (!match) notFound();

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("id, slug, name, rules")
    .eq("id", match.tournament_id)
    .single();
  if (!tournament) notFound();

  const rules = getRuleSet(tournament.rules);

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, short_name")
    .in("id", [match.team_a_id, match.team_b_id]);
  const teamA = teams?.find((t) => t.id === match.team_a_id);
  const teamB = teams?.find((t) => t.id === match.team_b_id);
  if (!teamA || !teamB) notFound();

  // Playing XI for both teams + player metadata
  const { data: xiRows } = await supabase
    .from("match_players")
    .select("player_id, team_id, batting_order, is_substitute")
    .eq("match_id", match.id);
  const xiPlayerIds = (xiRows ?? []).map((r) => r.player_id);
  const { data: playerRows } = xiPlayerIds.length
    ? await supabase
        .from("players")
        .select("id, display_name, category")
        .in("id", xiPlayerIds)
    : { data: [] as { id: string; display_name: string; category: 1 | 2 | 3 | null }[] };
  const playerById = new Map(
    (playerRows ?? []).map((p) => [p.id, p]),
  );
  const xi: Record<string, EnginePlayer[]> = {
    [teamA.id]: [],
    [teamB.id]: [],
  };
  for (const r of xiRows ?? []) {
    const p = playerById.get(r.player_id);
    if (!p) continue;
    xi[r.team_id]?.push({
      id: p.id,
      display_name: p.display_name,
      category: p.category,
      team_id: r.team_id,
    });
  }

  // Active innings
  let innings: ScoreboardState["innings"] = null;
  let balls: BallRow[] = [];
  if (match.current_innings_id) {
    const { data: i } = await supabase
      .from("innings")
      .select(
        "id, innings_number, batting_team_id, bowling_team_id, total_runs, total_wickets, total_legal_balls, extras_wides, extras_no_balls, extras_byes, is_complete",
      )
      .eq("id", match.current_innings_id)
      .single();
    if (i) innings = i;

    const { data: ballRows } = await supabase
      .from("balls")
      .select("*")
      .eq("innings_id", match.current_innings_id)
      .eq("is_voided", false)
      .order("scored_at", { ascending: true });
    balls = ballRows ?? [];
  }

  // Derive active state. We rely on the per-ball striker/non-striker/bowler
  // already stored on the most recent ball, then advance from there.
  const ballsPerOver = 6;
  const last = balls[balls.length - 1];
  let over_number = 1;
  let legal_balls_in_over = 0;
  let striker_id: string | null = null;
  let non_striker_id: string | null = null;
  let bowler_id: string | null = null;
  let free_hit_pending = false;

  if (last) {
    over_number = last.over_number;
    legal_balls_in_over = last.legal_ball_seq != null ? last.ball_in_over : last.ball_in_over;
    // If the last ball completed the over, the next ball starts a new over.
    if (last.legal_ball_seq != null && last.ball_in_over === ballsPerOver) {
      over_number += 1;
      legal_balls_in_over = 0;
    }
    striker_id = last.batter_id;
    non_striker_id = last.non_striker_id;
    bowler_id = last.bowler_id;

    // Free-hit pending: the last NO-BALL hasn't been followed by a legal ball.
    if (rules.no_ball.causes_free_hit) {
      // Find the last no-ball; was there a legal ball after it?
      let pending = false;
      for (let i = balls.length - 1; i >= 0; i--) {
        const b = balls[i];
        if (b.extra_type === "no_ball") {
          pending = true;
          break;
        }
        const isLegal = !b.extra_type || b.extra_type === "bye";
        if (isLegal) break;
      }
      free_hit_pending = pending;
    }
  } else if (innings) {
    // No balls yet but innings exists. Striker/non-striker/bowler will be
    // chosen by the scorer before the first ball is recorded.
  }

  const currentOverBalls = balls.filter((b) => b.over_number === over_number);
  const previousOverBalls = balls.filter((b) => b.over_number === over_number - 1);

  // Special-over detection: depends on rules + striker's category.
  let is_special_over: "cat1" | "cat3" | null = null;
  if (rules.categories.enabled && striker_id) {
    const striker = (xi[innings?.batting_team_id ?? ""] ?? []).find(
      (p) => p.id === striker_id,
    );
    if (striker?.category === 1 && over_number === rules.categories.cat1_over) {
      is_special_over = "cat1";
    } else if (
      striker?.category === 3 &&
      over_number === rules.categories.cat3_over
    ) {
      is_special_over = "cat3";
    }
  }

  return {
    match,
    tournament: { id: tournament.id, slug: tournament.slug, name: tournament.name },
    rules,
    teamA,
    teamB,
    xi,
    innings,
    balls,
    currentOverBalls,
    previousOverBalls,
    active: {
      over_number,
      legal_balls_in_over,
      striker_id,
      non_striker_id,
      bowler_id,
      free_hit_pending,
      is_special_over,
    },
  };
}
