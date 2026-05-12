"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { requireTournamentAdmin } from "@/lib/auth";
import { type MatchPushPayload, notifyMatch } from "@/lib/push";
import {
  type EnginePlayer,
  advanceBowler,
  applyBall,
  getRuleSet,
  setNonStriker,
  setStriker,
  startInnings,
} from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";

import type { ActionResult } from "@/app/tournaments/actions";

/**
 * HVC first-over rule: if the opening striker is Category 1, the opening
 * bowler must also be Category 1. Enforced at innings-1 and innings-2
 * start; super overs (innings 3/4) are exempt.
 */
async function enforceCat1FirstOverRule(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tournamentId: string,
  picks: { striker_id: string; bowler_id: string },
): Promise<ActionResult> {
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("rules")
    .eq("id", tournamentId)
    .single();
  const rules = getRuleSet(tournament?.rules);
  if (!rules.categories.enabled) return { ok: true, data: undefined };

  const { data: catRows } = await supabase
    .from("players")
    .select("id, category")
    .in("id", [picks.striker_id, picks.bowler_id]);
  const catById = new Map((catRows ?? []).map((r) => [r.id, r.category]));
  const strikerCat = catById.get(picks.striker_id);
  const bowlerCat = catById.get(picks.bowler_id);
  if (strikerCat === 1 && bowlerCat !== 1) {
    return {
      ok: false,
      error: "First over: a Category 1 striker must face a Category 1 bowler",
    };
  }
  return { ok: true, data: undefined };
}

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

  const catCheck = await enforceCat1FirstOverRule(supabase, match.tournament_id, {
    striker_id: parsed.data.striker_id,
    bowler_id: parsed.data.bowler_id,
  });
  if (!catCheck.ok) return catCheck;

  // Insert innings 1. Stash the picks on the innings row so the
  // scoreboard knows who's at the crease before any ball is recorded.
  const { data: innings, error: insErr } = await supabase
    .from("innings")
    .insert({
      match_id: match.id,
      innings_number: 1,
      batting_team_id: battingTeamId,
      bowling_team_id: bowlingTeamId,
      started_at: new Date().toISOString(),
      initial_striker_id: parsed.data.striker_id,
      initial_non_striker_id: parsed.data.non_striker_id,
      initial_bowler_id: parsed.data.bowler_id,
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
  // proposed ball to validate. innings_number > 2 means super over →
  // engine applies the 2-wicket / 1-over caps.
  const { data: inningsRow } = await supabase
    .from("innings")
    .select("innings_number")
    .eq("id", parsed.data.inningsId)
    .single();
  const isSuperOver = (inningsRow?.innings_number ?? 1) > 2;

  let state = startInnings({
    innings_number: inningsRow?.innings_number ?? 1,
    batting_team_id: innings.batting_team_id,
    bowling_team_id: innings.bowling_team_id,
    is_super_over: isSuperOver,
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
    // applyBall doesn't read striker / non-striker / bowler from the
    // BallInput — it only rotates them via cricket rules. Sync them
    // from each recorded ball so the engine tracks scorer-driven
    // mid-innings substitutions (replacement after a wicket, etc.).
    if (b.batter_id !== state.striker_id) {
      state = setStriker(state, b.batter_id);
    }
    if (b.non_striker_id !== state.non_striker_id) {
      state = setNonStriker(state, b.non_striker_id);
    }
    if (b.bowler_id !== state.bowler_id) {
      state = advanceBowler(
        state,
        toEnginePlayer(b.bowler_id),
        toEnginePlayer(state.striker_id),
        toEnginePlayer(state.non_striker_id),
        rules,
      );
    }
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

  // Bowling restrictions for the regular innings (super overs have their
  // own caps; skip these for innings 3/4):
  //   - Same bowler can't bowl two overs in a row.
  //   - HVC rule: at most ONE bowler in the innings may bowl 2 overs;
  //     everyone else is capped at 1.
  if ((inningsRow?.innings_number ?? 1) <= 2) {
    const legalBallsByBowler = new Map<string, number>();
    for (const b of prevBalls ?? []) {
      if (b.extra_type === "wide" || b.extra_type === "no_ball") continue;
      legalBallsByBowler.set(
        b.bowler_id,
        (legalBallsByBowler.get(b.bowler_id) ?? 0) + 1,
      );
    }
    const thisBowlerLegalBefore =
      legalBallsByBowler.get(parsed.data.bowler_id) ?? 0;

    if (thisBowlerLegalBefore >= rules.max_overs_per_bowler * 6) {
      return {
        ok: false,
        error: `Bowler has already bowled their ${rules.max_overs_per_bowler} overs`,
      };
    }

    if (thisBowlerLegalBefore >= 6) {
      // About to bowl ball 7+ → this is their 2nd over. Check nobody
      // else is already in (or past) their 2nd.
      const otherDoubleUp = Array.from(legalBallsByBowler.entries()).some(
        ([id, n]) => id !== parsed.data.bowler_id && n > 6,
      );
      if (otherDoubleUp) {
        return {
          ok: false,
          error:
            "Only one bowler per innings can bowl 2 overs and another bowler is already using that slot.",
        };
      }
    }

    const lastBall = (prevBalls ?? [])[(prevBalls?.length ?? 0) - 1];
    const overJustEnded =
      !!lastBall &&
      lastBall.legal_ball_seq != null &&
      lastBall.ball_in_over === 6;

    // Bowler must stay the same within an over — no mid-over swaps.
    // Real cricket allows them only on injury; we don't model that.
    if (
      lastBall &&
      !overJustEnded &&
      lastBall.bowler_id !== parsed.data.bowler_id
    ) {
      return {
        ok: false,
        error:
          "Bowler can't change mid-over. Finish the current over with the same bowler.",
      };
    }

    // Consecutive overs check — at the very first ball of a new over
    // (the previous ball completed one).
    if (overJustEnded && lastBall.bowler_id === parsed.data.bowler_id) {
      return {
        ok: false,
        error: "Same bowler can't bowl consecutive overs",
      };
    }
  }

  // Sync engine slots with the new ball's chosen striker / non-striker /
  // bowler before validation. Same reason as the replay loop above:
  // applyBall only rotates, it doesn't accept new player IDs as input.
  if (parsed.data.striker_id !== state.striker_id) {
    state = setStriker(state, parsed.data.striker_id);
  }
  if (parsed.data.non_striker_id !== state.non_striker_id) {
    state = setNonStriker(state, parsed.data.non_striker_id);
  }
  if (parsed.data.bowler_id !== state.bowler_id) {
    state = advanceBowler(
      state,
      toEnginePlayer(parsed.data.bowler_id),
      toEnginePlayer(state.striker_id),
      toEnginePlayer(state.non_striker_id),
      rules,
    );
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

  let inningsNumberJustEnded: number | null = null;
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
    inningsNumberJustEnded = i?.innings_number ?? null;
    if (i?.innings_number === 2) {
      const { data: i1 } = await supabase
        .from("innings")
        .select("total_runs")
        .eq("match_id", parsed.data.matchId)
        .eq("innings_number", 1)
        .maybeSingle();
      const { data: i2 } = await supabase
        .from("innings")
        .select("total_runs")
        .eq("match_id", parsed.data.matchId)
        .eq("innings_number", 2)
        .maybeSingle();
      // Only finalize if NOT tied. A tie waits for the super over to be
      // started (or for the scorer to declare it a final tie manually).
      if (i1 && i2 && i1.total_runs !== i2.total_runs) {
        await finalizeMatchInternal(supabase, parsed.data.matchId);
      }
    }
    if (i?.innings_number === 4) {
      // Both super-over innings complete → finalize.
      await finalizeMatchInternal(supabase, parsed.data.matchId);
    }
  }

  // ---- Push notifications -------------------------------------------
  // Detect events of interest and dispatch via `after()` so the scorer's
  // ball entry returns straight away — push fan-out runs after the
  // response is sent. Failures here never break ball recording.
  const pushEvents: MatchPushPayload[] = [];

  if (parsed.data.is_wicket) {
    const outName = parsed.data.player_out_id
      ? (playerById.get(parsed.data.player_out_id)?.display_name ?? "Batter")
      : "Batter";
    const wicketLabel = parsed.data.wicket_type
      ? parsed.data.wicket_type.replace(/_/g, " ")
      : "out";
    pushEvents.push({
      title: "Wicket!",
      body: `${outName} — ${wicketLabel}`,
      url: `/matches/${parsed.data.matchId}`,
      tag: `wicket-${parsed.data.matchId}-${(prevBalls?.length ?? 0) + 1}`,
    });
  }

  // Milestones — only the striker accrues runs_off_bat.
  const strikerRunsBefore = (prevBalls ?? [])
    .filter((b) => b.batter_id === parsed.data.striker_id)
    .reduce((sum, b) => sum + (b.runs_off_bat ?? 0), 0);
  const strikerRunsAfter = strikerRunsBefore + parsed.data.runs_off_bat;
  const strikerName =
    playerById.get(parsed.data.striker_id)?.display_name ?? "Striker";
  if (strikerRunsBefore < 50 && strikerRunsAfter >= 50) {
    pushEvents.push({
      title: "Fifty!",
      body: `${strikerName} reaches ${strikerRunsAfter}`,
      url: `/matches/${parsed.data.matchId}`,
      tag: `fifty-${parsed.data.matchId}-${parsed.data.striker_id}`,
    });
  }
  if (strikerRunsBefore < 100 && strikerRunsAfter >= 100) {
    pushEvents.push({
      title: "Century!",
      body: `${strikerName} reaches ${strikerRunsAfter}`,
      url: `/matches/${parsed.data.matchId}`,
      tag: `hundred-${parsed.data.matchId}-${parsed.data.striker_id}`,
    });
  }

  if (inningsNumberJustEnded === 1) {
    const { data: i1 } = await supabase
      .from("innings")
      .select("total_runs, total_wickets")
      .eq("id", innings.id)
      .single();
    if (i1) {
      pushEvents.push({
        title: "Innings break",
        body: `1st innings ${i1.total_runs}/${i1.total_wickets}. Target: ${i1.total_runs + 1}.`,
        url: `/matches/${parsed.data.matchId}`,
        tag: `innings-break-${parsed.data.matchId}`,
      });
    }
  }

  if (inningsNumberJustEnded === 2 || inningsNumberJustEnded === 4) {
    const { data: m } = await supabase
      .from("matches")
      .select("status, winner_id, win_margin, result_type, team_a_id, team_b_id")
      .eq("id", parsed.data.matchId)
      .single();
    if (m?.status === "completed") {
      let body = "Final result available.";
      if (m.winner_id && m.win_margin) {
        const { data: t } = await supabase
          .from("teams")
          .select("name")
          .eq("id", m.winner_id)
          .maybeSingle();
        const winnerName = t?.name ?? "Winner";
        body = `${winnerName} won ${m.win_margin}`;
      } else if (m.result_type === "tie") {
        body = "Match tied";
      }
      pushEvents.push({
        title: "Match complete",
        body,
        url: `/matches/${parsed.data.matchId}`,
        tag: `match-end-${parsed.data.matchId}`,
      });
    }
  }

  if (pushEvents.length > 0) {
    const matchId = parsed.data.matchId;
    after(async () => {
      for (const ev of pushEvents) {
        try {
          await notifyMatch(matchId, ev);
        } catch (err) {
          console.error("[push] dispatch failed", err);
        }
      }
    });
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

  const catCheck = await enforceCat1FirstOverRule(supabase, match.tournament_id, {
    striker_id: parsed.data.striker_id,
    bowler_id: parsed.data.bowler_id,
  });
  if (!catCheck.ok) return catCheck;

  const { data: innings, error: insErr } = await supabase
    .from("innings")
    .insert({
      match_id: match.id,
      innings_number: 2,
      batting_team_id: battingTeamId,
      bowling_team_id: bowlingTeamId,
      target,
      started_at: new Date().toISOString(),
      initial_striker_id: parsed.data.striker_id,
      initial_non_striker_id: parsed.data.non_striker_id,
      initial_bowler_id: parsed.data.bowler_id,
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
  const so1 = innings?.find((i) => i.innings_number === 3);
  const so2 = innings?.find((i) => i.innings_number === 4);
  if (!i1 || !i2) {
    return { ok: false, error: "Both innings must exist to finalize" };
  }

  let winnerId: string | null = null;
  let winMargin: string | null = null;
  let resultType: "normal" | "tie" | "super_over" | "no_result" | "abandoned" =
    "normal";

  // If a super over has been completed, its outcome decides the match.
  if (so1 && so2) {
    resultType = "super_over";
    if (so1.total_runs > so2.total_runs) {
      winnerId = so1.batting_team_id;
      const margin = so1.total_runs - so2.total_runs;
      winMargin = `won the super over by ${margin} run${margin === 1 ? "" : "s"}`;
    } else if (so2.total_runs > so1.total_runs) {
      winnerId = so2.batting_team_id;
      const { data: matchRow } = await supabase
        .from("matches")
        .select("players_per_side")
        .eq("id", matchId)
        .single();
      const xi = matchRow?.players_per_side ?? 11;
      // Super-over wickets cap is the rules' max_wickets; default 2.
      const wicketsLeft = xi - 1 - so2.total_wickets;
      winMargin = `won the super over by ${wicketsLeft} wicket${wicketsLeft === 1 ? "" : "s"}`;
    } else {
      // Super over also tied
      resultType = "tie";
      winMargin = "tied (super over also tied)";
    }
  } else if (i2.total_runs >= (i2.target ?? i1.total_runs + 1)) {
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
    // Tie (no super over yet)
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

// ---------------------------------------------------------------------------
// Super over actions
// ---------------------------------------------------------------------------

const startSuperOverInningsSchema = z.object({
  matchId: z.string().uuid(),
  inningsNumber: z.union([z.literal(3), z.literal(4)]),
  striker_id: z.string().uuid(),
  non_striker_id: z.string().uuid(),
  bowler_id: z.string().uuid(),
});

/**
 * Creates a super-over innings (3 = team that batted 2nd in main match,
 * 4 = team that batted 1st). Validates that:
 *  - regular innings 1 + 2 are both complete and tied
 *  - the requested super-over innings doesn't already exist
 *  - super-over team setup follows HVC: team that batted second in main
 *    match bats first in super over (i.e. innings 3.batting_team =
 *    innings 2.batting_team).
 */
export async function startSuperOverInnings(
  input: z.infer<typeof startSuperOverInningsSchema>,
): Promise<ActionResult<{ inningsId: string }>> {
  const parsed = startSuperOverInningsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data: match } = await supabase
    .from("matches")
    .select("id, tournament_id, team_a_id, team_b_id")
    .eq("id", parsed.data.matchId)
    .single();
  if (!match) return { ok: false, error: "Match not found" };
  await requireTournamentAdmin(match.tournament_id);

  const { data: regular } = await supabase
    .from("innings")
    .select("innings_number, batting_team_id, bowling_team_id, total_runs, is_complete")
    .eq("match_id", match.id)
    .in("innings_number", [1, 2, 3, 4]);
  const i1 = regular?.find((i) => i.innings_number === 1);
  const i2 = regular?.find((i) => i.innings_number === 2);
  const so1 = regular?.find((i) => i.innings_number === 3);
  const so2 = regular?.find((i) => i.innings_number === 4);

  if (!i1?.is_complete || !i2?.is_complete) {
    return { ok: false, error: "Regular innings must both be complete" };
  }
  if (i1.total_runs !== i2.total_runs) {
    return {
      ok: false,
      error: "Match isn't tied — super over only happens after a tied result",
    };
  }

  let battingTeamId: string;
  let bowlingTeamId: string;
  let target: number | null = null;

  if (parsed.data.inningsNumber === 3) {
    if (so1) return { ok: false, error: "Super over innings 3 already exists" };
    // Team that batted SECOND in main match bats FIRST in super over.
    battingTeamId = i2.batting_team_id;
    bowlingTeamId = i2.bowling_team_id;
  } else {
    if (!so1?.is_complete) {
      return { ok: false, error: "Super over innings 3 must be complete first" };
    }
    if (so2) return { ok: false, error: "Super over innings 4 already exists" };
    battingTeamId = so1.bowling_team_id;
    bowlingTeamId = so1.batting_team_id;
    target = so1.total_runs + 1;
  }

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
      innings_number: parsed.data.inningsNumber,
      batting_team_id: battingTeamId,
      bowling_team_id: bowlingTeamId,
      target,
      started_at: new Date().toISOString(),
      initial_striker_id: parsed.data.striker_id,
      initial_non_striker_id: parsed.data.non_striker_id,
      initial_bowler_id: parsed.data.bowler_id,
    })
    .select("id")
    .single();
  if (insErr || !innings) {
    return { ok: false, error: insErr?.message ?? "Failed to create super-over innings" };
  }

  await supabase
    .from("matches")
    .update({ current_innings_id: innings.id, status: "live" })
    .eq("id", match.id);

  revalidatePath(`/matches/${match.id}/score`);
  return { ok: true, data: { inningsId: innings.id } };
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

const voidLastNSchema = z.object({
  matchId: z.string().uuid(),
  inningsId: z.string().uuid(),
  count: z.coerce.number().int().min(1).max(20),
});

/**
 * Void the N most recent non-voided balls in the innings. Used by the
 * "Undo last 3" / "Undo this over" buttons. The count is server-derived
 * for "this over" (caller passes the number of balls in the over) so we
 * don't have to re-calculate state here.
 */
export async function voidLastN(
  input: z.infer<typeof voidLastNSchema>,
): Promise<ActionResult<{ voided: number }>> {
  const parsed = voidLastNSchema.safeParse(input);
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

  const { data: balls } = await supabase
    .from("balls")
    .select("id")
    .eq("innings_id", parsed.data.inningsId)
    .eq("is_voided", false)
    .order("scored_at", { ascending: false })
    .limit(parsed.data.count);
  if (!balls || balls.length === 0) {
    return { ok: false, error: "No balls to undo" };
  }

  const ids = balls.map((b) => b.id);
  const { error } = await supabase
    .from("balls")
    .update({
      is_voided: true,
      voided_by: user.id,
      voided_at: new Date().toISOString(),
    })
    .in("id", ids);
  if (error) return { ok: false, error: error.message };

  // The trigger recomputes innings totals on each row update; un-mark
  // the innings as complete in case the original last ball had ended it.
  await supabase
    .from("innings")
    .update({ is_complete: false, ended_at: null })
    .eq("id", parsed.data.inningsId);

  revalidatePath(`/matches/${parsed.data.matchId}/score`);
  return { ok: true, data: { voided: ids.length } };
}
