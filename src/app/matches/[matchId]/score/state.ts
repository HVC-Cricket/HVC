import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  type EnginePlayer,
  type InningsState,
  type RuleSet,
  createEnginePlayerFactory,
  getRuleSet,
  replayInnings,
} from "@/lib/scoring";
import type { BallRow, MatchRow } from "@/lib/supabase/row-types";

export type InningsSummary = {
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
  target: number | null;
  is_complete: boolean;
  // The picks captured at innings-start. Used as the fallback when no
  // ball has been recorded yet so the scoreboard knows who's at the
  // crease without forcing the scorer to re-pick.
  initial_striker_id: string | null;
  initial_non_striker_id: string | null;
  initial_bowler_id: string | null;
};

export type MatchPhase =
  | "pre_match"
  | "innings_1"
  | "innings_break"
  | "innings_2"
  | "match_complete"
  | "tied_pending_super_over"
  | "super_over_1"
  | "super_over_break"
  | "super_over_2"
  | "super_over_decided"
  | "super_over_tied";

export type ScoreboardState = {
  match: MatchRow;
  tournament: { id: string; slug: string; name: string };
  rules: RuleSet;
  teamA: { id: string; name: string; short_name: string };
  teamB: { id: string; name: string; short_name: string };
  /** XI for both teams keyed by team_id */
  xi: Record<string, EnginePlayer[]>;
  /** all innings rows for this match, in order */
  allInnings: InningsSummary[];
  /** the active innings (per matches.current_innings_id) */
  innings: InningsSummary | null;
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
    /** Player IDs that have already been dismissed in this innings.
     *  Used by the scoreboard to grey them out of the striker /
     *  non-striker pickers. */
    dismissed_ids: string[];
  };
  phase: MatchPhase;
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

  // All innings for this match (so we can show innings-1 summary during break + final)
  const { data: allInningsRows } = await supabase
    .from("innings")
    .select(
      "id, innings_number, batting_team_id, bowling_team_id, total_runs, total_wickets, total_legal_balls, extras_wides, extras_no_balls, extras_byes, target, is_complete, initial_striker_id, initial_non_striker_id, initial_bowler_id",
    )
    .eq("match_id", match.id)
    .order("innings_number", { ascending: true });
  const allInnings = (allInningsRows ?? []) as InningsSummary[];

  // Active innings (per matches.current_innings_id)
  let innings: ScoreboardState["innings"] = null;
  let balls: BallRow[] = [];
  if (match.current_innings_id) {
    innings =
      allInnings.find((i) => i.id === match.current_innings_id) ?? null;

    const { data: ballRows } = await supabase
      .from("balls")
      .select("*")
      .eq("innings_id", match.current_innings_id)
      .eq("is_voided", false)
      .order("scored_at", { ascending: true });
    balls = ballRows ?? [];
  }

  // Replay the innings through the engine. We need this because the
  // *next* striker after a 1, 3, 5 (etc.) is the OPPOSITE batter from
  // the one who faced the last ball — the loader previously copied
  // `last.batter_id` straight through and never applied rotation, so
  // the slot tile lied about who was on strike. Engine state has the
  // correct post-rotation striker / non-striker / bowler / free-hit
  // status the moment a ball is confirmed.
  const teamByPlayer = new Map<string, string>();
  for (const r of xiRows ?? []) teamByPlayer.set(r.player_id, r.team_id);
  const toEnginePlayer = createEnginePlayerFactory(playerById, teamByPlayer);

  let engineState: InningsState | null = null;
  if (innings) {
    const seedStrikerId =
      innings.initial_striker_id ?? balls[0]?.batter_id ?? null;
    const seedNonStrikerId =
      innings.initial_non_striker_id ?? balls[0]?.non_striker_id ?? null;
    const seedBowlerId =
      innings.initial_bowler_id ?? balls[0]?.bowler_id ?? null;
    if (seedStrikerId && seedNonStrikerId && seedBowlerId) {
      const result = replayInnings({
        innings_number: innings.innings_number,
        batting_team_id: innings.batting_team_id,
        bowling_team_id: innings.bowling_team_id,
        is_super_over: innings.innings_number > 2,
        seedStriker: toEnginePlayer(seedStrikerId),
        seedNonStriker: toEnginePlayer(seedNonStrikerId),
        seedBowler: toEnginePlayer(seedBowlerId),
        balls,
        rules,
        toEnginePlayer,
      });
      if (result.ok) engineState = result.state;
    }
  }

  // over / ball counting comes from the last recorded ball — engine
  // state agrees but this is the simpler / known-stable path.
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
    legal_balls_in_over = last.ball_in_over;
    let atOverBoundary = false;
    if (last.legal_ball_seq != null && last.ball_in_over === ballsPerOver) {
      over_number += 1;
      legal_balls_in_over = 0;
      atOverBoundary = true;
    }
    // Engine-derived rotation — `last.batter_id` is who FACED the ball,
    // not who's on strike next.
    striker_id = engineState?.striker_id ?? last.batter_id;
    non_striker_id = engineState?.non_striker_id ?? last.non_striker_id;
    // BOWLER: must come from `last.bowler_id`, NOT engine state. The
    // engine's `applyBall` doesn't accept a bowler input, so during the
    // replay its `bowler_id` stays glued to whoever was the initial
    // bowler regardless of what's actually recorded on subsequent balls.
    // Trusting it caused the slot tile to silently flip back to the
    // initial bowler after every confirmed ball — and the scorer's
    // next tap then got attributed to the wrong player.
    bowler_id = atOverBoundary ? null : last.bowler_id;
    free_hit_pending = engineState?.free_hit_pending ?? false;

    // A dismissed batter shouldn't be on the field. We blank any slot
    // that currently holds someone in engine.dismissed so the scorer
    // has to pick a fresh batter.
    //
    // Exception: in a Cat 1 / Cat 3 special over with
    // cat_special_strike = "stay", the dismissed special batter keeps
    // facing the remaining balls of the over. Detected via the engine
    // flag `special_batter_dismissed` — it stays true until the next
    // `advanceBowler` resets the special-over context, i.e. until the
    // over rolls over.
    const stillSpecialStay = (id: string | null) =>
      !!id &&
      rules.categories.cat_special_strike === "stay" &&
      engineState?.special_over?.special_batter_id === id &&
      engineState?.special_over?.special_batter_dismissed === true;
    const isDismissed = (id: string | null) =>
      !!id && (engineState?.dismissed?.has(id) ?? false);

    if (isDismissed(striker_id) && !stillSpecialStay(striker_id)) {
      striker_id = null;
    }
    if (isDismissed(non_striker_id) && !stillSpecialStay(non_striker_id)) {
      non_striker_id = null;
    }
  } else if (innings) {
    // No balls yet but innings exists. Fall back to whatever was picked
    // at innings-start so the scoreboard slot tiles aren't empty.
    striker_id = innings.initial_striker_id ?? null;
    non_striker_id = innings.initial_non_striker_id ?? null;
    bowler_id = innings.initial_bowler_id ?? null;
  }

  const currentOverBalls = balls.filter((b) => b.over_number === over_number);
  const previousOverBalls = balls.filter((b) => b.over_number === over_number - 1);

  // Special-over detection: any over with a Cat 1 or Cat 3 striker is a
  // special over for that category. Mirrors the engine's
  // computeSpecialOverContext derivation so the badge tracks behaviour.
  let is_special_over: "cat1" | "cat3" | null = null;
  if (rules.categories.enabled && striker_id) {
    const striker = (xi[innings?.batting_team_id ?? ""] ?? []).find(
      (p) => p.id === striker_id,
    );
    if (striker?.category === 1) {
      is_special_over = "cat1";
    } else if (striker?.category === 3) {
      is_special_over = "cat3";
    }
  }

  // Phase derivation
  const phase: MatchPhase = derivePhase({ match, allInnings });

  return {
    match,
    tournament: { id: tournament.id, slug: tournament.slug, name: tournament.name },
    rules,
    teamA,
    teamB,
    xi,
    allInnings,
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
      dismissed_ids: engineState
        ? Array.from(engineState.dismissed)
        : (balls
            .filter((b) => b.is_wicket && b.player_out_id)
            .map((b) => b.player_out_id as string)),
    },
    phase,
  };
}

function derivePhase(args: {
  match: MatchRow;
  allInnings: InningsSummary[];
}): MatchPhase {
  const { match, allInnings } = args;
  if (match.status === "scheduled") return "pre_match";

  const i1 = allInnings.find((i) => i.innings_number === 1);
  const i2 = allInnings.find((i) => i.innings_number === 2);
  const so1 = allInnings.find((i) => i.innings_number === 3);
  const so2 = allInnings.find((i) => i.innings_number === 4);

  if (!i1) return "pre_match";
  if (!i1.is_complete) return "innings_1";

  // Innings 1 complete
  if (!i2) return "innings_break";
  if (!i2.is_complete) return "innings_2";

  // Both regular innings complete. Tied?
  const regularTied = i1.total_runs === i2.total_runs;

  if (!regularTied) {
    // Decided after second innings.
    if (match.status === "completed") return "match_complete";
    return "match_complete";
  }

  // Tied. Super over may or may not have started.
  if (!so1) return "tied_pending_super_over";
  if (!so1.is_complete) return "super_over_1";
  if (!so2) return "super_over_break";
  if (!so2.is_complete) return "super_over_2";

  // Both super-over innings complete.
  if (so1.total_runs === so2.total_runs) {
    // Super over also tied.
    return match.status === "completed" ? "match_complete" : "super_over_tied";
  }
  return match.status === "completed" ? "match_complete" : "super_over_decided";
}
