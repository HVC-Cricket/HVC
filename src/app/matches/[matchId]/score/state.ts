import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import {
  type EnginePlayer,
  type ExtraType,
  type InningsState,
  type RuleSet,
  type WicketType,
  advanceBowler,
  applyBall,
  getRuleSet,
  startInnings,
} from "@/lib/scoring";

import type { Database } from "@/lib/supabase/database.types";

type BallRow = Database["public"]["Tables"]["balls"]["Row"];
type MatchRow = Database["public"]["Tables"]["matches"]["Row"];

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
  const toEnginePlayer = (id: string): EnginePlayer => {
    const p = playerById.get(id);
    return {
      id,
      display_name: p?.display_name ?? "?",
      category: (p?.category as 1 | 2 | 3 | null) ?? null,
      team_id: teamByPlayer.get(id) ?? "",
    };
  };

  let engineState: InningsState | null = null;
  if (innings) {
    const seedStrikerId =
      innings.initial_striker_id ?? balls[0]?.batter_id ?? null;
    const seedNonStrikerId =
      innings.initial_non_striker_id ?? balls[0]?.non_striker_id ?? null;
    const seedBowlerId =
      innings.initial_bowler_id ?? balls[0]?.bowler_id ?? null;
    if (seedStrikerId && seedNonStrikerId && seedBowlerId) {
      let s = startInnings({
        innings_number: innings.innings_number,
        batting_team_id: innings.batting_team_id,
        bowling_team_id: innings.bowling_team_id,
        is_super_over: innings.innings_number > 2,
        striker: toEnginePlayer(seedStrikerId),
        non_striker: toEnginePlayer(seedNonStrikerId),
        bowler: toEnginePlayer(seedBowlerId),
        rules,
      });
      let replayOk = true;
      for (const b of balls) {
        // applyBall doesn't take a bowler input — when the recorded
        // ball's bowler differs from engine state, sync it via
        // advanceBowler first. Without this, the engine's
        // bowler_legal_balls would all pile up on the initial bowler
        // and spurious "bowler_at_max" rejections kick in mid-replay.
        if (b.bowler_id !== s.bowler_id) {
          s = advanceBowler(
            s,
            toEnginePlayer(b.bowler_id),
            toEnginePlayer(s.striker_id),
            toEnginePlayer(s.non_striker_id),
            rules,
          );
        }
        const r = applyBall(
          s,
          {
            runs_off_bat: b.runs_off_bat,
            extras: b.extras,
            extra_type: b.extra_type as ExtraType | null,
            is_wicket: b.is_wicket,
            wicket_type: b.wicket_type as WicketType | null,
            player_out_id: b.player_out_id,
            fielder_id: b.fielder_id,
          },
          rules,
        );
        if (!r.ok) {
          replayOk = false;
          break;
        }
        s = r.state;
      }
      if (replayOk) engineState = s;
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

    // If the last ball was a wicket, the dismissed batter's slot is
    // empty until the scorer picks the next batter in. After the
    // engine has applied any pre-wicket crossing rotation, the
    // dismissed player still sits in whichever slot they ended up in
    // (engine just adds them to .dismissed; it doesn't blank the slot).
    if (last.is_wicket && last.player_out_id) {
      if (striker_id === last.player_out_id) striker_id = null;
      if (non_striker_id === last.player_out_id) non_striker_id = null;
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
