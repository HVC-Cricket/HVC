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
  if (validation.state.is_complete) {
    await supabase
      .from("innings")
      .update({ is_complete: true, ended_at: new Date().toISOString() })
      .eq("id", innings.id);
  }

  revalidatePath(`/matches/${parsed.data.matchId}/score`);
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
