"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";

import { requireTournamentAdmin } from "@/lib/auth";
import { formatEnumLabel } from "@/lib/format";
import { logMatchAuditEvent } from "@/lib/match-audit";
import { type MatchPushPayload, notifyMatch } from "@/lib/push";
import {
  advanceBowler,
  applyBall,
  applyMatchScalarRules,
  applyRulesOverride,
  categoryForOver,
  createEnginePlayerFactory,
  getRuleSet,
  replayInnings,
  setNonStriker,
  setStriker,
  type RulesOverride,
} from "@/lib/scoring";
import { computeStandings } from "@/lib/standings";
import { createClient } from "@/lib/supabase/server";

import type { ActionResult } from "@/app/tournaments/actions";

import { enforceScoringLock } from "./lock-actions";
import {
  computeBallPosition,
  validateBowlerRules,
} from "./record-ball-helpers";

/**
 * Server-side check for the first over of innings 1 / innings 2:
 * if the rules declare over 1 to be a Cat N over (N ∈ {1, 3}), both
 * the striker and bowler must be Cat N. When over 1 is Cat 2 ("open"
 * per the tournament + match override), no enforcement.
 *
 * Super overs (innings 3/4) are exempt entirely; categories don't
 * apply there.
 *
 * Renamed from `enforceCat1FirstOverRule` once `categories.cat1_over`
 * became an array — same idea, but now driven off
 * `categoryForOver(rules, 1)` so a tournament can opt out of Cat
 * overs entirely (`cat1_overs: []`, `cat3_overs: []`).
 */
async function enforceFirstOverCategoryRule(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: string,
  tournamentId: string,
  picks: { striker_id: string; bowler_id: string },
): Promise<ActionResult> {
  const [tournamentRes, matchRes] = await Promise.all([
    supabase
      .from("tournaments")
      .select("rules")
      .eq("id", tournamentId)
      .single(),
    supabase
      .from("matches")
      .select("rules_override")
      .eq("id", matchId)
      .maybeSingle(),
  ]);
  const baseRules = getRuleSet(tournamentRes.data?.rules);
  const override =
    (matchRes.data as { rules_override?: RulesOverride } | null)
      ?.rules_override ?? null;
  const rules = applyRulesOverride(baseRules, override);
  if (!rules.categories.enabled) return { ok: true, data: undefined };
  const requiredCat = categoryForOver(rules, 1);
  if (requiredCat === 2) return { ok: true, data: undefined };

  const { data: catRows } = await supabase
    .from("players")
    .select("id, category")
    .in("id", [picks.striker_id, picks.bowler_id]);
  const catById = new Map((catRows ?? []).map((r) => [r.id, r.category]));
  const strikerCat = catById.get(picks.striker_id);
  const bowlerCat = catById.get(picks.bowler_id);
  if (strikerCat !== requiredCat) {
    return {
      ok: false,
      error: `Over 1 is a Category ${requiredCat} over — the opening striker must be Category ${requiredCat}.`,
    };
  }
  if (bowlerCat !== requiredCat) {
    return {
      ok: false,
      error: `Over 1 is a Category ${requiredCat} over — the opening bowler must be Category ${requiredCat}.`,
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

  const catCheck = await enforceFirstOverCategoryRule(
    supabase,
    match.id,
    match.tournament_id,
    {
      striker_id: parsed.data.striker_id,
      bowler_id: parsed.data.bowler_id,
    },
  );
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

  const {
    data: { user: actor },
  } = await supabase.auth.getUser();
  await logMatchAuditEvent({
    matchId: match.id,
    eventType: "match_started",
    actorId: actor?.id ?? null,
    payload: {
      batting_team_id: battingTeamId,
      bowling_team_id: bowlingTeamId,
      striker_id: parsed.data.striker_id,
      non_striker_id: parsed.data.non_striker_id,
      bowler_id: parsed.data.bowler_id,
    },
  });

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
}).refine(
  // Catches, run-outs, and stumpings need a credited fielder so the
  // commentary string + fielding leaderboards don't end up with "?"
  // entries. caught_and_bowled credits the bowler implicitly.
  (d) =>
    !d.is_wicket ||
    !d.wicket_type ||
    !["caught", "run_out", "stumped"].includes(d.wicket_type) ||
    !!d.fielder_id,
  { message: "Fielder is required for caught / run-out / stumped" },
);

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

  // Wave 1: every read that depends only on the input IDs starts at
  // the same time. Previously these were 5 sequential awaits — one
  // network round-trip apiece, each adding 200–500ms on the mobile →
  // Vercel → Supabase path. Collapsing them to a Promise.all turns
  // a ~2.5s wall-clock wait into a single ~500ms hop. The lock RPC
  // is included here because its only dependency is matchId+userId
  // and it doesn't touch any of the other rows being read.
  //
  // innings_number is folded into the innings SELECT so the
  // separate fetch we used to do further down (just to know whether
  // we're in a super over) is no longer needed.
  const [
    { data: innings },
    matchRes,
    { data: prevBalls },
    { data: matchPlayers },
    lock,
  ] = await Promise.all([
    supabase
      .from("innings")
      .select(
        "id, match_id, batting_team_id, bowling_team_id, is_complete, innings_number",
      )
      .eq("id", parsed.data.inningsId)
      .single(),
    // `rules_override` was added in migration 20260518130000_*; the
    // generated database.types.ts hasn't been regenerated, so cast
    // the row shape here. Drop the cast once we re-run gen:types.
    supabase
      .from("matches")
      .select(
        "id, tournament_id, players_per_side, overs_per_innings, rules_override",
      )
      .eq("id", parsed.data.matchId)
      .single() as unknown as Promise<{
      data: {
        id: string;
        tournament_id: string;
        players_per_side: number;
        overs_per_innings: number;
        rules_override: unknown;
      } | null;
    }>,
    supabase
      .from("balls")
      .select(
        "over_number, ball_in_over, legal_ball_seq, batter_id, non_striker_id, bowler_id, runs_off_bat, extras, extra_type, is_wicket, wicket_type, player_out_id, scored_at",
      )
      .eq("innings_id", parsed.data.inningsId)
      .eq("is_voided", false)
      .order("scored_at", { ascending: true }),
    supabase
      .from("match_players")
      .select("player_id, team_id")
      .eq("match_id", parsed.data.matchId),
    // Block writes from a non-primary scorer + bump heartbeat for the
    // primary scorer in the same atomic step.
    enforceScoringLock({
      matchId: parsed.data.matchId,
      userId: user.id,
    }),
  ]);
  const match = matchRes.data;

  if (!innings) return { ok: false, error: "Innings not found" };
  if (innings.is_complete) return { ok: false, error: "Innings already complete" };
  if (!match) return { ok: false, error: "Match not found" };
  if (!lock.ok) return lock;
  const inningsNumber = innings.innings_number ?? 1;
  const isSuperOver = inningsNumber > 2;

  // Wave 2: reads that depend on Wave 1 results. tournament rules
  // need match.tournament_id; players need the player_ids from
  // match_players. requireTournamentAdmin also runs here in parallel
  // since it only needs the tournament_id to check the auth row.
  const teamByPlayer = new Map(
    (matchPlayers ?? []).map((r) => [r.player_id, r.team_id] as const),
  );
  const [{ data: tournament }, { data: playerRows }] = await Promise.all([
    supabase
      .from("tournaments")
      .select("rules")
      .eq("id", match.tournament_id)
      .single(),
    supabase
      .from("players")
      .select("id, display_name, category")
      .in("id", Array.from(teamByPlayer.keys())),
    requireTournamentAdmin(match.tournament_id),
  ]);

  // Effective rules = tournament defaults < per-match categories override
  // < per-match scalar columns (players_per_side, overs_per_innings).
  // The scalar layer is what makes a 6-player match end the innings at
  // 6 wickets under HVC's 7-player tournament rules instead of 7.
  //
  // Bind to `rules` — there is no second variant; every downstream
  // consumer (replay, applyBall, advanceBowler, validateBowlerRules,
  // per-ball cat enforcement, post-completion writes) must see the
  // exact same effective set or behaviour drifts.
  const rules = applyMatchScalarRules(
    applyRulesOverride(
      getRuleSet(tournament?.rules),
      (match.rules_override as RulesOverride) ?? null,
    ),
    {
      players_per_side: match.players_per_side,
      overs_per_innings: match.overs_per_innings,
    },
  );

  const playerById = new Map(
    (playerRows ?? []).map((p) => [p.id, p]),
  );
  const toEnginePlayer = createEnginePlayerFactory(playerById, teamByPlayer);

  const replay = replayInnings({
    innings_number: inningsNumber,
    batting_team_id: innings.batting_team_id,
    bowling_team_id: innings.bowling_team_id,
    is_super_over: isSuperOver,
    seedStriker: toEnginePlayer(
      prevBalls?.[0]?.batter_id ?? parsed.data.striker_id,
    ),
    seedNonStriker: toEnginePlayer(
      prevBalls?.[0]?.non_striker_id ?? parsed.data.non_striker_id,
    ),
    seedBowler: toEnginePlayer(
      prevBalls?.[0]?.bowler_id ?? parsed.data.bowler_id,
    ),
    balls: prevBalls ?? [],
    rules,
    toEnginePlayer,
  });
  if (!replay.ok) {
    const failedBall = (prevBalls ?? [])[replay.failedAtIndex];
    return {
      ok: false,
      error: failedBall
        ? `Replay failed at over ${failedBall.over_number}.${failedBall.ball_in_over}: ${replay.error}`
        : `Replay failed: ${replay.error}`,
    };
  }
  let state = replay.state;

  const bowlerCheck = validateBowlerRules({
    prevBalls: prevBalls ?? [],
    newBowlerId: parsed.data.bowler_id,
    rules,
    inningsNumber,
  });
  if (!bowlerCheck.ok) return bowlerCheck;

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

  // Per-ball cat enforcement (server-side mirror of the client toast
  // in scoreboard.tsx). The scorer-side check is purely advisory; a
  // tampered client could submit a Cat 2 striker + bowler on a Cat 1
  // over and the engine wouldn't notice (it keys off striker.category
  // for special-over mechanics but doesn't gate against the rule
  // arrays). Super overs skip the rule by definition.
  if (!isSuperOver && rules.categories.enabled) {
    const requiredCat = categoryForOver(rules, state.current_over_number);
    if (requiredCat !== 2) {
      const strikerCat = playerById.get(parsed.data.striker_id)?.category;
      const bowlerCat = playerById.get(parsed.data.bowler_id)?.category;
      if (strikerCat !== requiredCat) {
        return {
          ok: false,
          error: `Over ${state.current_over_number} is a Cat ${requiredCat} over — striker must be Category ${requiredCat}.`,
        };
      }
      if (bowlerCat !== requiredCat) {
        return {
          ok: false,
          error: `Over ${state.current_over_number} is a Cat ${requiredCat} over — bowler must be Category ${requiredCat}.`,
        };
      }
    }
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

  const { over_number, ball_in_over, legal_ball_seq, isLegal } =
    computeBallPosition({
      prevBalls: prevBalls ?? [],
      newExtraType: parsed.data.extra_type ?? null,
    });

  const isFreeHit = state.free_hit_pending && isLegal;

  // HVC Cat 1 / Cat 3 special-over rule: the special batter stays at
  // the crease after being dismissed and may be dismissed again later
  // in the over. The bowler is credited each time (their stat line
  // counts balls directly), but the team's innings total only goes up
  // on the FIRST dismissal. Pre-applyBall engine state is the right
  // signal: if `special_batter_dismissed` is already true and this
  // ball dismisses the same player, mark the row so the recompute
  // function excludes it from `innings.total_wickets`.
  const dismissedId = parsed.data.player_out_id ?? parsed.data.striker_id;
  const isRepeatSpecialDismissal =
    parsed.data.is_wicket &&
    state.special_over !== null &&
    state.special_over.special_batter_id === dismissedId &&
    state.special_over.special_batter_dismissed === true;
  const countsForInningsTotal = !isRepeatSpecialDismissal;

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
    counts_for_innings_total: countsForInningsTotal,
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
    // Innings 1 enters a "pending finalize" state: scorer confirms via
    // the InningsFinishPanel before sides flip. We leave `ended_at`
    // null and the phase machine treats `is_complete && !ended_at` as
    // pending. Innings 2 / super-over use `match.status` as their gate
    // (MatchCompletePanel), so we stamp `ended_at` there as before.
    const isInnings1 = inningsNumber === 1;
    // Kept fire-and-forget on purpose: the ball insert already
    // succeeded above, so returning a hard error here would cause the
    // offline queue to drop the task as a validation failure even
    // though the ball IS recorded. The next tap would then try to
    // record another ball on an innings the engine thinks is complete
    // and error out, cascading into a stuck-state. Instead the client
    // optimistic-finishing card has a router.refresh() escape hatch
    // (3s auto + manual button) which is enough to recover from
    // transient UPDATE blips; a persistent failure would be visible
    // in logs and is a separate bug to chase.
    await supabase
      .from("innings")
      .update({
        is_complete: true,
        ended_at: isInnings1 ? null : new Date().toISOString(),
      })
      .eq("id", innings.id);

    // innings_number was already loaded in Wave 1 — no need to round-
    // trip again just to know which innings just finished. Match
    // completion is no longer auto-applied here either; when innings
    // 2 (or super-over innings 4) ends, the match enters a "pending
    // finalize" state and the scorer confirms via MatchCompletePanel,
    // which gives them a chance to undo the last ball before the
    // result is locked in.
    inningsNumberJustEnded = inningsNumber;
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
      ? formatEnumLabel(parsed.data.wicket_type)
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

  // Match-completion push fires from finalizeMatch now, since recordBall
  // no longer auto-completes the match.

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

  const catCheck = await enforceFirstOverCategoryRule(
    supabase,
    match.id,
    match.tournament_id,
    {
      striker_id: parsed.data.striker_id,
      bowler_id: parsed.data.bowler_id,
    },
  );
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

  const {
    data: { user: actor2 },
  } = await supabase.auth.getUser();
  await logMatchAuditEvent({
    matchId: match.id,
    eventType: "innings_2_started",
    actorId: actor2?.id ?? null,
    payload: {
      target,
      striker_id: parsed.data.striker_id,
      non_striker_id: parsed.data.non_striker_id,
      bowler_id: parsed.data.bowler_id,
    },
  });

  revalidatePath(`/matches/${match.id}/score`);
  return { ok: true, data: { inningsId: innings.id } };
}

// ---------------------------------------------------------------------------
// Innings-level finalize — mirrors finalizeMatch but for innings 1.
// ---------------------------------------------------------------------------
//
// When innings 1 auto-completes (all out / overs exhausted), `recordBall`
// flags `is_complete = true` but leaves `ended_at` null. The page enters
// the `innings_1_pending_finish` phase and surfaces the InningsFinishPanel
// with Finish / Undo last ball buttons. This action stamps `ended_at` so
// the next page refresh advances to the innings-break picker.

const finalizeInningsSchema = z.object({
  matchId: z.string().uuid(),
  inningsId: z.string().uuid(),
});

export async function finalizeInnings(
  input: z.infer<typeof finalizeInningsSchema>,
): Promise<ActionResult> {
  const parsed = finalizeInningsSchema.safeParse(input);
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

  const { data: innings } = await supabase
    .from("innings")
    .select("is_complete, ended_at")
    .eq("id", parsed.data.inningsId)
    .single();
  if (!innings) return { ok: false, error: "Innings not found" };
  if (!innings.is_complete) {
    return { ok: false, error: "Innings is not complete yet" };
  }
  if (innings.ended_at) {
    // Idempotent — already finalized.
    return { ok: true, data: undefined };
  }

  const { error } = await supabase
    .from("innings")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", parsed.data.inningsId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/matches/${parsed.data.matchId}/score`);
  revalidatePath(`/matches/${parsed.data.matchId}`);
  return { ok: true, data: undefined };
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

  // Auto-schedule the next playoff stage when each round wraps up
  // (Q1 → Eliminator → Q2 → Final). Best-effort: a failure here is
  // logged but never blocks the scorer from finalizing the result.
  try {
    await maybeAutoSchedulePlayoffs(supabase, match.tournament_id);
  } catch (err) {
    console.error("[auto-schedule playoffs] failed", err);
  }

  // Match-completion push (moved from recordBall now that completion is
  // explicit). Single fan-out on confirm — no fan-out on the optimistic
  // last-ball anymore.
  const { data: m } = await supabase
    .from("matches")
    .select("status, winner_id, win_margin, result_type")
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
    const matchId = parsed.data.matchId;
    after(async () => {
      try {
        await notifyMatch(matchId, {
          title: "Match complete",
          body,
          url: `/matches/${matchId}`,
          tag: `match-end-${matchId}`,
        });
      } catch (err) {
        console.error("[push] dispatch failed", err);
      }
    });
  }

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
  // Super overs chain — 3/4 is the first pair, 5/6 the second, etc.
  // The decisive pair is the highest one with both legs present.
  const superOvers = (innings ?? [])
    .filter((i) => i.innings_number >= 3)
    .sort((a, b) => a.innings_number - b.innings_number);
  let so1: (typeof superOvers)[number] | undefined;
  let so2: (typeof superOvers)[number] | undefined;
  for (let idx = 0; idx + 1 < superOvers.length; idx += 2) {
    so1 = superOvers[idx];
    so2 = superOvers[idx + 1];
  }
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

  const {
    data: { user: actor },
  } = await supabase.auth.getUser();
  await logMatchAuditEvent({
    matchId,
    eventType: "match_completed",
    actorId: actor?.id ?? null,
    payload: {
      result_type: resultType,
      winner_id: winnerId,
      win_margin: winMargin,
    },
  });

  return { ok: true, data: undefined };
}

/**
 * IPL-style playoff chain for round_robin_playoff_final tournaments.
 * Fires whenever a match is finalised; multiple stages can be queued
 * in the same run if their dependencies are simultaneously satisfied:
 *
 *   - All group matches terminal → Qualifier 1 (#1 vs #2 on the points
 *                                  table) AND Eliminator (#3 vs #4)
 *                                  scheduled in parallel — both depend
 *                                  only on standings, no need to wait
 *                                  for Q1 to finish.
 *   - Q1 + Eliminator terminal   → Qualifier 2 (Q1 loser vs Elim winner)
 *   - Qualifier 2 terminal       → Final       (Q1 winner vs Q2 winner)
 *
 * Idempotent — each branch guards on `!stageAny` so existing playoff
 * rows are never duplicated or overwritten. Bails cleanly for any
 * other tournament format.
 */
async function maybeAutoSchedulePlayoffs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tournamentId: string,
): Promise<void> {
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("format, slug")
    .eq("id", tournamentId)
    .single();
  if (tournament?.format !== "round_robin_playoff_final") return;

  const { data: matchRows } = await supabase
    .from("matches")
    .select(
      "id, stage, status, team_a_id, team_b_id, winner_id, match_number, overs_per_innings, players_per_side, venue",
    )
    .eq("tournament_id", tournamentId);
  if (!matchRows || matchRows.length === 0) return;

  const terminal = (s: string | null | undefined) =>
    s === "completed" || s === "abandoned";

  const groupMatches = matchRows.filter((m) => m.stage === "group");
  const q1Any = matchRows.find((m) => m.stage === "qualifier_1");
  const elimAny = matchRows.find((m) => m.stage === "eliminator");
  const q2Any = matchRows.find((m) => m.stage === "qualifier_2");
  const finalAny = matchRows.find((m) => m.stage === "final");

  const q1Done =
    q1Any && terminal(q1Any.status) && q1Any.winner_id ? q1Any : null;
  const elimDone =
    elimAny && terminal(elimAny.status) && elimAny.winner_id ? elimAny : null;
  const q2Done =
    q2Any && terminal(q2Any.status) && q2Any.winner_id ? q2Any : null;

  // Format settings (overs / players / venue) inherit from a group
  // match so the playoff is configured the same way without an admin
  // having to set them by hand. Fall back to any earlier playoff row
  // if there's no group match (defensive — `round_robin_playoff_final`
  // requires a group stage in practice).
  const template = groupMatches[0] ?? q1Any ?? elimAny ?? q2Any;
  if (!template) return;

  let nextNumber =
    matchRows.reduce((mx, m) => Math.max(mx, m.match_number ?? 0), 0) + 1;

  const schedule = async (
    stage: "qualifier_1" | "eliminator" | "qualifier_2" | "final",
    teamAId: string,
    teamBId: string,
  ) => {
    const { error } = await supabase.from("matches").insert({
      tournament_id: tournamentId,
      match_number: nextNumber++,
      stage,
      team_a_id: teamAId,
      team_b_id: teamBId,
      overs_per_innings: template.overs_per_innings,
      players_per_side: template.players_per_side,
      venue: template.venue,
    });
    if (error) {
      console.error(`[auto-schedule ${stage}] insert failed`, error);
      return false;
    }
    return true;
  };

  // Multiple stages can be scheduled in a single run (Q1 + Eliminator
  // both derive from the points table once group ends, so they go up
  // together — no point waiting for Q1 to finish before queuing the
  // Eliminator). Q2 / Final still need their dependencies to be done.
  let scheduled = false;

  const groupAllDone =
    groupMatches.length > 0 && groupMatches.every((m) => terminal(m.status));

  // Standings load only when needed for the points-table-driven slots.
  let standingsCache: Awaited<ReturnType<typeof computeStandings>> | null =
    null;
  const getStandings = async () => {
    if (!standingsCache) {
      standingsCache = await computeStandings(supabase, tournamentId);
    }
    return standingsCache;
  };

  // 1. Qualifier 1 — top 1 vs top 2 on the points table.
  if (!q1Any && groupAllDone) {
    const standings = await getStandings();
    if (standings.length >= 2) {
      const ok = await schedule(
        "qualifier_1",
        standings[0].team_id,
        standings[1].team_id,
      );
      if (ok) scheduled = true;
    }
  }
  // 2. Eliminator — top 3 vs top 4 on the points table. Same trigger
  //    as Q1 (group done); they go up in parallel.
  if (!elimAny && groupAllDone) {
    const standings = await getStandings();
    if (standings.length >= 4) {
      const ok = await schedule(
        "eliminator",
        standings[2].team_id,
        standings[3].team_id,
      );
      if (ok) scheduled = true;
    }
  }
  // 3. Qualifier 2 — Q1 loser vs Eliminator winner. Needs both to be
  //    decided first.
  if (!q2Any && q1Done && elimDone) {
    const q1Loser =
      q1Done.team_a_id === q1Done.winner_id
        ? q1Done.team_b_id
        : q1Done.team_a_id;
    const ok = await schedule(
      "qualifier_2",
      q1Loser,
      elimDone.winner_id as string,
    );
    if (ok) scheduled = true;
  }
  // 4. Final — Q1 winner vs Q2 winner.
  if (!finalAny && q1Done && q2Done) {
    const ok = await schedule(
      "final",
      q1Done.winner_id as string,
      q2Done.winner_id as string,
    );
    if (ok) scheduled = true;
  }

  if (scheduled && tournament.slug) {
    revalidatePath(`/tournaments/${tournament.slug}`);
  }
}

// ---------------------------------------------------------------------------
// Super over actions
// ---------------------------------------------------------------------------

const startSuperOverInningsSchema = z.object({
  matchId: z.string().uuid(),
  inningsNumber: z.coerce.number().int().min(3),
  striker_id: z.string().uuid(),
  non_striker_id: z.string().uuid(),
  bowler_id: z.string().uuid(),
});

/**
 * Creates a super-over innings. Innings 3+4 are the first super over,
 * 5+6 the second, etc. — pairs continue until one is decided.
 *
 * Batting-team rule:
 *  - First leg of a super over (odd innings_number ≥ 3): team that
 *    batted SECOND in the previous leg (or in innings 2 for the first
 *    super over) bats first.
 *  - Second leg (even ≥ 4): the other team chases the first leg's total + 1.
 *
 * Each super over is independent for stats / wickets caps; the engine's
 * `is_super_over` flag (innings_number > 2) drives the 1-over / 2-wicket
 * caps and disables Cat 1/3 special-batter rules.
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

  const { data: allInnings } = await supabase
    .from("innings")
    .select(
      "innings_number, batting_team_id, bowling_team_id, total_runs, is_complete",
    )
    .eq("match_id", match.id)
    .order("innings_number", { ascending: true });
  const i1 = allInnings?.find((i) => i.innings_number === 1);
  const i2 = allInnings?.find((i) => i.innings_number === 2);

  if (!i1?.is_complete || !i2?.is_complete) {
    return { ok: false, error: "Regular innings must both be complete" };
  }
  if (i1.total_runs !== i2.total_runs) {
    return {
      ok: false,
      error: "Match isn't tied — super over only happens after a tied result",
    };
  }

  const targetInnings = parsed.data.inningsNumber;
  if (allInnings?.some((i) => i.innings_number === targetInnings)) {
    return {
      ok: false,
      error: `Innings ${targetInnings} already exists`,
    };
  }
  // First leg of a super over (odd innings_number) requires the previous
  // pair to be tied. Second leg (even) requires its own first leg done.
  if (targetInnings % 2 === 1) {
    // Odd ≥ 3 — first leg. Need the prior pair to be complete + tied.
    if (targetInnings >= 5) {
      const prevFirst = allInnings?.find(
        (i) => i.innings_number === targetInnings - 2,
      );
      const prevSecond = allInnings?.find(
        (i) => i.innings_number === targetInnings - 1,
      );
      if (!prevFirst?.is_complete || !prevSecond?.is_complete) {
        return {
          ok: false,
          error: `Innings ${targetInnings - 2} and ${targetInnings - 1} must both be complete first`,
        };
      }
      if (prevFirst.total_runs !== prevSecond.total_runs) {
        return {
          ok: false,
          error: "Previous super over wasn't tied — no follow-up needed",
        };
      }
    }
  } else {
    // Even — second leg. Need its first leg done.
    const firstLeg = allInnings?.find(
      (i) => i.innings_number === targetInnings - 1,
    );
    if (!firstLeg?.is_complete) {
      return {
        ok: false,
        error: `Innings ${targetInnings - 1} must be complete first`,
      };
    }
  }

  let battingTeamId: string;
  let bowlingTeamId: string;
  let target: number | null = null;

  if (targetInnings % 2 === 1) {
    // First leg of a (new) super over — team that batted SECOND in the
    // most recent prior leg bats first. For innings 3, that's i2.
    // For innings 5+, that's the second leg of the previous super over.
    const reference =
      targetInnings === 3
        ? i2
        : allInnings?.find((i) => i.innings_number === targetInnings - 1);
    if (!reference) {
      return { ok: false, error: "Missing reference innings" };
    }
    battingTeamId = reference.batting_team_id;
    bowlingTeamId = reference.bowling_team_id;
  } else {
    // Second leg — chase the first leg's total + 1, sides flipped.
    const firstLeg = allInnings!.find(
      (i) => i.innings_number === targetInnings - 1,
    )!;
    battingTeamId = firstLeg.bowling_team_id;
    bowlingTeamId = firstLeg.batting_team_id;
    target = firstLeg.total_runs + 1;
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

  const {
    data: { user: actor },
  } = await supabase.auth.getUser();
  await logMatchAuditEvent({
    matchId: match.id,
    eventType: "super_over_started",
    actorId: actor?.id ?? null,
    payload: {
      innings_number: parsed.data.inningsNumber,
      target,
      batting_team_id: battingTeamId,
      striker_id: parsed.data.striker_id,
      non_striker_id: parsed.data.non_striker_id,
      bowler_id: parsed.data.bowler_id,
    },
  });

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

  const lock = await enforceScoringLock({
    matchId: parsed.data.matchId,
    userId: user.id,
  });
  if (!lock.ok) return lock;

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

  const lock = await enforceScoringLock({
    matchId: parsed.data.matchId,
    userId: user.id,
  });
  if (!lock.ok) return lock;

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
