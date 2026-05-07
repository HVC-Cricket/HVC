"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireTournamentAdmin } from "@/lib/auth";
import {
  type EnginePlayer,
  applyBall,
  getRuleSet,
  startInnings,
} from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";

import type { ActionResult } from "@/app/tournaments/actions";

const startMatchSchema = z.object({
  matchId: z.string().uuid(),
  striker_id: z.string().uuid(),
  non_striker_id: z.string().uuid(),
  bowler_id: z.string().uuid(),
});

/**
 * Transitions a scheduled match into 'live' by creating innings 1.
 * Requires: toss decided, both XIs picked.
 *
 * Toss winner + decision determines which side bats first. The chosen
 * striker / non-striker must be on the batting side's XI; bowler must be on
 * the fielding side's XI.
 */
export async function startMatch(
  input: z.infer<typeof startMatchSchema>,
): Promise<ActionResult<{ inningsId: string }>> {
  const parsed = startMatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data: match } = await supabase
    .from("matches")
    .select("*")
    .eq("id", parsed.data.matchId)
    .single();
  if (!match) return { ok: false, error: "Match not found" };
  await requireTournamentAdmin(match.tournament_id);

  if (match.status !== "scheduled") {
    return { ok: false, error: `Match is already ${match.status}` };
  }
  if (!match.toss_winner_id || !match.toss_decision) {
    return { ok: false, error: "Toss must be set before the match starts" };
  }

  // Determine batting / bowling teams from toss.
  const tossTeam = match.toss_winner_id;
  const otherTeam =
    tossTeam === match.team_a_id ? match.team_b_id : match.team_a_id;
  const battingTeamId =
    match.toss_decision === "bat" ? tossTeam : otherTeam;
  const bowlingTeamId =
    battingTeamId === match.team_a_id ? match.team_b_id : match.team_a_id;

  // Sanity-check XIs.
  const { data: xiRows } = await supabase
    .from("match_players")
    .select("player_id, team_id")
    .eq("match_id", match.id);
  const battingXi = (xiRows ?? []).filter((r) => r.team_id === battingTeamId);
  const bowlingXi = (xiRows ?? []).filter((r) => r.team_id === bowlingTeamId);
  if (battingXi.length === 0 || bowlingXi.length === 0) {
    return { ok: false, error: "Both XIs must be picked before starting" };
  }
  const inBatting = (id: string) => battingXi.some((r) => r.player_id === id);
  const inBowling = (id: string) => bowlingXi.some((r) => r.player_id === id);
  if (
    !inBatting(parsed.data.striker_id) ||
    !inBatting(parsed.data.non_striker_id) ||
    parsed.data.striker_id === parsed.data.non_striker_id
  ) {
    return { ok: false, error: "Striker and non-striker must be two different batting-XI players" };
  }
  if (!inBowling(parsed.data.bowler_id)) {
    return { ok: false, error: "Bowler must be in the bowling-XI" };
  }

  // Insert innings 1.
  const { data: innings, error: insErr } = await supabase
    .from("innings")
    .insert({
      match_id: match.id,
      innings_number: 1,
      batting_team_id: battingTeamId,
      bowling_team_id: bowlingTeamId,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insErr || !innings) {
    return { ok: false, error: insErr?.message ?? "Failed to create innings" };
  }

  // Flip match to live + remember current innings.
  const { error: updErr } = await supabase
    .from("matches")
    .update({
      status: "live",
      current_innings_id: innings.id,
      started_at: match.started_at ?? new Date().toISOString(),
    })
    .eq("id", match.id);
  if (updErr) {
    return { ok: false, error: updErr.message };
  }

  revalidatePath(`/matches/${match.id}`);
  revalidatePath(`/matches/${match.id}/score`);
  return { ok: true, data: { inningsId: innings.id } };
}

const recordBallSchema = z.object({
  matchId: z.string().uuid(),
  inningsId: z.string().uuid(),
  // Per-ball context — scorer-controlled
  striker_id: z.string().uuid(),
  non_striker_id: z.string().uuid(),
  bowler_id: z.string().uuid(),
  // Outcome
  runs_off_bat: z.coerce.number().int().min(0).max(6),
  extras: z.coerce.number().int().min(0).max(7).default(0),
  extra_type: z.enum(["wide", "no_ball", "bye"]).nullable().optional(),
  is_wicket: z.boolean().default(false),
  wicket_type: z
    .enum([
      "bowled",
      "caught",
      "caught_and_bowled",
      "run_out",
      "stumped",
      "hit_wicket",
      "retired",
      "obstructing",
      "timed_out",
    ])
    .nullable()
    .optional(),
  player_out_id: z.string().uuid().nullable().optional(),
  fielder_id: z.string().uuid().nullable().optional(),
});

export async function recordBall(
  input: z.infer<typeof recordBallSchema>,
): Promise<ActionResult> {
  const parsed = recordBallSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: innings } = await supabase
    .from("innings")
    .select("id, match_id, batting_team_id, bowling_team_id, is_complete")
    .eq("id", parsed.data.inningsId)
    .single();
  if (!innings) return { ok: false, error: "Innings not found" };
  if (innings.is_complete) return { ok: false, error: "Innings already complete" };

  const { data: match } = await supabase
    .from("matches")
    .select("id, tournament_id, players_per_side")
    .eq("id", parsed.data.matchId)
    .single();
  if (!match) return { ok: false, error: "Match not found" };
  await requireTournamentAdmin(match.tournament_id);

  // Load rules for engine validation.
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("rules")
    .eq("id", match.tournament_id)
    .single();
  const rules = getRuleSet(tournament?.rules);

  // Load existing balls to compute current state.
  const { data: prevBalls } = await supabase
    .from("balls")
    .select(
      "over_number, ball_in_over, legal_ball_seq, batter_id, non_striker_id, bowler_id, runs_off_bat, extras, extra_type, is_wicket, wicket_type, player_out_id, scored_at",
    )
    .eq("innings_id", parsed.data.inningsId)
    .eq("is_voided", false)
    .order("scored_at", { ascending: true });

  // Load player metadata for the engine context.
  const { data: matchPlayers } = await supabase
    .from("match_players")
    .select("player_id, team_id")
    .eq("match_id", match.id);
  const teamByPlayer = new Map(
    (matchPlayers ?? []).map((r) => [r.player_id, r.team_id] as const),
  );
  const { data: playerRows } = await supabase
    .from("players")
    .select("id, display_name, category")
    .in("id", Array.from(teamByPlayer.keys()));
  const playerById = new Map(
    (playerRows ?? []).map((p) => [p.id, p]),
  );
  const toEnginePlayer = (id: string): EnginePlayer => {
    const p = playerById.get(id);
    return {
      id,
      display_name: p?.display_name ?? "?",
      category: (p?.category as 1 | 2 | 3 | null) ?? null,
      team_id: teamByPlayer.get(id) ?? "",
    };
  };

  // Replay through the engine to derive current state, then apply the
  // proposed ball to validate.
  let state = startInnings({
    innings_number: 1,
    batting_team_id: innings.batting_team_id,
    bowling_team_id: innings.bowling_team_id,
    striker: toEnginePlayer(
      prevBalls?.[0]?.batter_id ?? parsed.data.striker_id,
    ),
    non_striker: toEnginePlayer(
      prevBalls?.[0]?.non_striker_id ?? parsed.data.non_striker_id,
    ),
    bowler: toEnginePlayer(
      prevBalls?.[0]?.bowler_id ?? parsed.data.bowler_id,
    ),
    rules,
  });

  for (const b of prevBalls ?? []) {
    const r = applyBall(
      state,
      {
        runs_off_bat: b.runs_off_bat,
        extras: b.extras,
        extra_type: b.extra_type as
          | "wide"
          | "no_ball"
          | "bye"
          | null,
        is_wicket: b.is_wicket,
        wicket_type: b.wicket_type as Parameters<
          typeof applyBall
        >[1]["wicket_type"],
        player_out_id: b.player_out_id,
      },
      rules,
    );
    if (!r.ok) {
      return {
        ok: false,
        error: `Replay failed at over ${b.over_number}.${b.ball_in_over}: ${r.error.message}`,
      };
    }
    state = r.state;
  }

  // Apply the new ball through the engine for validation.
  const validation = applyBall(
    state,
    {
      runs_off_bat: parsed.data.runs_off_bat,
      extras: parsed.data.extras,
      extra_type: parsed.data.extra_type ?? null,
      is_wicket: parsed.data.is_wicket,
      wicket_type: parsed.data.wicket_type ?? null,
      player_out_id: parsed.data.player_out_id ?? null,
    },
    rules,
  );
  if (!validation.ok) {
    return { ok: false, error: validation.error.message };
  }

  // Compute the over/ball/legal-seq for the new row.
  const ballsPerOver = 6;
  const last = (prevBalls ?? [])[prevBalls?.length ? prevBalls.length - 1 : -1];
  let over_number = 1;
  let ball_in_over = 0;
  let legal_ball_seq: number | null = null;
  if (last) {
    over_number = last.over_number;
    ball_in_over = last.ball_in_over;
    if (last.legal_ball_seq != null && last.ball_in_over === ballsPerOver) {
      over_number += 1;
      ball_in_over = 0;
    }
  }
  const isLegal =
    !parsed.data.extra_type || parsed.data.extra_type === "bye";
  if (isLegal) {
    ball_in_over += 1;
    const totalLegalBefore =
      (prevBalls ?? []).filter(
        (b) =>
          b.extra_type !== "wide" && b.extra_type !== "no_ball",
      ).length;
    legal_ball_seq = totalLegalBefore + 1;
  }

  const isFreeHit = state.free_hit_pending && isLegal;

  const { error: insErr } = await supabase.from("balls").insert({
    innings_id: parsed.data.inningsId,
    over_number,
    ball_in_over,
    legal_ball_seq,
    batter_id: parsed.data.striker_id,
    non_striker_id: parsed.data.non_striker_id,
    bowler_id: parsed.data.bowler_id,
    runs_off_bat: parsed.data.runs_off_bat,
    extras: parsed.data.extras,
    extra_type: parsed.data.extra_type ?? null,
    is_wicket: parsed.data.is_wicket,
    wicket_type: parsed.data.wicket_type ?? null,
    player_out_id: parsed.data.player_out_id ?? null,
    fielder_id: parsed.data.fielder_id ?? null,
    is_free_hit: isFreeHit,
    scored_by: user.id,
  });
  if (insErr) return { ok: false, error: insErr.message };

  // The trigger on `balls` will recompute innings totals.
  // Mark innings complete if engine says so.
  let inningsComplete = validation.state.is_complete;

  // Chase: if this is innings 2 and there's a target, the innings ends
  // the moment total_runs >= target. We re-read totals because the trigger
  // updates them after our insert.
  if (!inningsComplete) {
    const { data: latest } = await supabase
      .from("innings")
      .select("total_runs, target")
      .eq("id", innings.id)
      .single();
    if (latest?.target != null && latest.total_runs >= latest.target) {
      inningsComplete = true;
    }
  }

  if (inningsComplete) {
    await supabase
      .from("innings")
      .update({ is_complete: true, ended_at: new Date().toISOString() })
      .eq("id", innings.id);

    // If this was the second innings, finalize the match.
    const { data: i } = await supabase
      .from("innings")
      .select("innings_number")
      .eq("id", innings.id)
      .single();
    if (i?.innings_number === 2) {
      await finalizeMatchInternal(supabase, parsed.data.matchId);
    }
  }

  revalidatePath(`/matches/${parsed.data.matchId}/score`);
  return { ok: true, data: undefined };
}

const startSecondInningsSchema = z.object({
  matchId: z.string().uuid(),
  striker_id: z.string().uuid(),
  non_striker_id: z.string().uuid(),
  bowler_id: z.string().uuid(),
});

export async function startSecondInnings(
  input: z.infer<typeof startSecondInningsSchema>,
): Promise<ActionResult<{ inningsId: string }>> {
  const parsed = startSecondInningsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data: match } = await supabase
    .from("matches")
    .select("id, tournament_id, team_a_id, team_b_id, status")
    .eq("id", parsed.data.matchId)
    .single();
  if (!match) return { ok: false, error: "Match not found" };
  await requireTournamentAdmin(match.tournament_id);

  // Innings 1 must be complete; innings 2 must not exist.
  const { data: innings1 } = await supabase
    .from("innings")
    .select("id, batting_team_id, bowling_team_id, total_runs, is_complete")
    .eq("match_id", match.id)
    .eq("innings_number", 1)
    .maybeSingle();
  if (!innings1) return { ok: false, error: "Innings 1 not started" };
  if (!innings1.is_complete) {
    return { ok: false, error: "Innings 1 must be complete first" };
  }

  const { data: existingI2 } = await supabase
    .from("innings")
    .select("id")
    .eq("match_id", match.id)
    .eq("innings_number", 2)
    .maybeSingle();
  if (existingI2) {
    return { ok: false, error: "Innings 2 already exists" };
  }

  // Sides flip. Target = innings1 + 1.
  const battingTeamId = innings1.bowling_team_id;
  const bowlingTeamId = innings1.batting_team_id;
  const target = innings1.total_runs + 1;

  // Validate XI membership.
  const { data: xiRows } = await supabase
    .from("match_players")
    .select("player_id, team_id")
    .eq("match_id", match.id);
  const inBatting = (id: string) =>
    !!xiRows?.find((r) => r.team_id === battingTeamId && r.player_id === id);
  const inBowling = (id: string) =>
    !!xiRows?.find((r) => r.team_id === bowlingTeamId && r.player_id === id);
  if (
    !inBatting(parsed.data.striker_id) ||
    !inBatting(parsed.data.non_striker_id) ||
    parsed.data.striker_id === parsed.data.non_striker_id
  ) {
    return { ok: false, error: "Striker and non-striker must be two different batting-XI players" };
  }
  if (!inBowling(parsed.data.bowler_id)) {
    return { ok: false, error: "Bowler must be in the bowling-XI" };
  }

  const { data: innings, error: insErr } = await supabase
    .from("innings")
    .insert({
      match_id: match.id,
      innings_number: 2,
      batting_team_id: battingTeamId,
      bowling_team_id: bowlingTeamId,
      target,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insErr || !innings) {
    return { ok: false, error: insErr?.message ?? "Failed to create innings 2" };
  }

  await supabase
    .from("matches")
    .update({ current_innings_id: innings.id, status: "live" })
    .eq("id", match.id);

  revalidatePath(`/matches/${match.id}/score`);
  return { ok: true, data: { inningsId: innings.id } };
}

const finalizeSchema = z.object({ matchId: z.string().uuid() });

export async function finalizeMatch(
  input: z.infer<typeof finalizeSchema>,
): Promise<ActionResult> {
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data: match } = await supabase
    .from("matches")
    .select("tournament_id")
    .eq("id", parsed.data.matchId)
    .single();
  if (!match) return { ok: false, error: "Match not found" };
  await requireTournamentAdmin(match.tournament_id);

  const result = await finalizeMatchInternal(supabase, parsed.data.matchId);
  if (!result.ok) return result;
  revalidatePath(`/matches/${parsed.data.matchId}/score`);
  revalidatePath(`/matches/${parsed.data.matchId}`);
  return { ok: true, data: undefined };
}

/**
 * Inspect both innings totals and decide the winner / win margin.
 * Sets matches.status='completed', winner_id, win_margin, result_type.
 * Tie → result_type='tie' with no winner; super-over flow handles the
 * follow-up (deferred).
 */
async function finalizeMatchInternal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: string,
): Promise<ActionResult> {
  const { data: innings } = await supabase
    .from("innings")
    .select(
      "innings_number, batting_team_id, bowling_team_id, total_runs, total_wickets, target",
    )
    .eq("match_id", matchId)
    .order("innings_number", { ascending: true });
  const i1 = innings?.find((i) => i.innings_number === 1);
  const i2 = innings?.find((i) => i.innings_number === 2);
  if (!i1 || !i2) {
    return { ok: false, error: "Both innings must exist to finalize" };
  }

  let winnerId: string | null = null;
  let winMargin: string | null = null;
  let resultType: "normal" | "tie" | "super_over" | "no_result" | "abandoned" =
    "normal";

  if (i2.total_runs >= (i2.target ?? i1.total_runs + 1)) {
    // Chasing side won by wickets remaining
    winnerId = i2.batting_team_id;
    const { data: matchRow } = await supabase
      .from("matches")
      .select("players_per_side")
      .eq("id", matchId)
      .single();
    const xi = matchRow?.players_per_side ?? 11;
    const wicketsLeft = xi - 1 - i2.total_wickets;
    winMargin = `won by ${wicketsLeft} wicket${wicketsLeft === 1 ? "" : "s"}`;
  } else if (i2.total_runs < i1.total_runs) {
    // Defending side won by runs
    winnerId = i1.batting_team_id;
    const margin = i1.total_runs - i2.total_runs;
    winMargin = `won by ${margin} run${margin === 1 ? "" : "s"}`;
  } else {
    // Tie
    resultType = "tie";
    winMargin = "tied";
  }

  const { error } = await supabase
    .from("matches")
    .update({
      status: "completed",
      ended_at: new Date().toISOString(),
      result_type: resultType,
      winner_id: winnerId,
      win_margin: winMargin,
    })
    .eq("id", matchId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

const voidLastSchema = z.object({
  matchId: z.string().uuid(),
  inningsId: z.string().uuid(),
});

export async function voidLastBall(
  input: z.infer<typeof voidLastSchema>,
): Promise<ActionResult> {
  const parsed = voidLastSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const { data: match } = await supabase
    .from("matches")
    .select("tournament_id")
    .eq("id", parsed.data.matchId)
    .single();
  if (!match) return { ok: false, error: "Match not found" };
  await requireTournamentAdmin(match.tournament_id);

  const { data: lastBall } = await supabase
    .from("balls")
    .select("id")
    .eq("innings_id", parsed.data.inningsId)
    .eq("is_voided", false)
    .order("scored_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastBall) return { ok: false, error: "No ball to undo" };

  const { error } = await supabase
    .from("balls")
    .update({
      is_voided: true,
      voided_by: user.id,
      voided_at: new Date().toISOString(),
    })
    .eq("id", lastBall.id);
  if (error) return { ok: false, error: error.message };

  // If the innings was marked complete, un-mark it.
  await supabase
    .from("innings")
    .update({ is_complete: false, ended_at: null })
    .eq("id", parsed.data.inningsId);

  revalidatePath(`/matches/${parsed.data.matchId}/score`);
  return { ok: true, data: undefined };
}
