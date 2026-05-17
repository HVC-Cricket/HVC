#!/usr/bin/env tsx
/**
 * Auto-complete pending group-stage matches with realistic ball-by-ball
 * data so testers can skip ahead to the playoff bracket without
 * scoring every match by hand.
 *
 *   pnpm exec tsx scripts/auto-complete-matches.ts <slug> [count] [--seed=N]
 *   pnpm exec tsx scripts/auto-complete-matches.ts pranavs-tournament 4
 *
 * For each picked match the script:
 *   1. Picks toss (random team, random decision).
 *   2. Inserts match_players (7 non-substitute per side) using the team
 *      roster, if not already set.
 *   3. Inserts innings 1 + ball-by-ball legal deliveries (no
 *      wides/no-balls/byes — keeps the generator simple; CRR / SR
 *      / averages still look natural).
 *   4. Inserts innings 2 with target = innings 1 total + 1, generates
 *      balls until target reached, overs exhausted, or all out.
 *   5. Stamps match: status='completed', winner_id, win_margin,
 *      result_type, started_at, ended_at, toss_*.
 *
 * `recompute_innings` trigger fires per ball insert and keeps innings
 * totals in sync — no manual aggregation here.
 *
 * Does NOT fire `maybeAutoSchedulePlayoffs` — that's a server action
 * triggered by `finalizeMatch`. After all 15 group matches are
 * terminal, the next finalize via the UI will create the playoff
 * bracket. Safe to run before / after some matches are scored
 * manually.
 *
 * Picks matches with status='scheduled' (skips 'live' and 'completed'),
 * highest match_number first. Targets dev only.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type { Database } from "../src/lib/supabase/database.types";

const PROD_PROJECT_REF = "cxysyglwooqmzcfvtmyl";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function loadEnvLocal(): void {
  const envPath = resolve(ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvLocal();

// ---------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------
const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("-")) ?? "pranavs-tournament";
const countArg = args
  .filter((a) => !a.startsWith("-"))
  .slice(1)
  .find(Boolean);
const count = Math.max(1, parseInt(countArg ?? "4", 10));
const seedArg = args.find((a) => a.startsWith("--seed="));
const seed = parseInt(seedArg?.split("=", 2)[1] ?? "20260517", 10);

// ---------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------
function mulberry32(s: number): () => number {
  return function () {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function weightedPick<T>(rng: () => number, options: [T, number][]): T {
  const total = options.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [val, w] of options) {
    if (r < w) return val;
    r -= w;
  }
  return options[options.length - 1][0];
}

// ---------------------------------------------------------------------
// Ball outcome distribution
// ---------------------------------------------------------------------
type BallOutcome = {
  runs_off_bat: number;
  is_wicket: boolean;
  wicket_type: string | null;
  rotate: boolean; // strike rotation
};

function rollOutcome(rng: () => number, opts: {
  needRuns?: number;
  ballsLeft?: number;
  wicketsInHand?: number;
}): BallOutcome {
  // Death-overs / chase pressure → more boundaries + risk
  const rr = opts.needRuns && opts.ballsLeft
    ? (opts.needRuns / opts.ballsLeft) * 6
    : 8; // par run-rate in box cricket

  // Wicket-only roll: ~7% baseline, more under pressure.
  const wicketChance = rr > 12 ? 0.11 : rr > 10 ? 0.08 : 0.06;
  if (rng() < wicketChance && (opts.wicketsInHand ?? 7) > 1) {
    return {
      runs_off_bat: 0,
      is_wicket: true,
      // 60% caught, 25% bowled, 10% run_out, 5% lbw
      wicket_type: weightedPick(rng, [
        ["caught", 60],
        ["bowled", 25],
        ["run_out", 10],
        ["lbw", 5],
      ]),
      rotate: false,
    };
  }

  // Runs roll. Base distribution skewed for box cricket (small ground,
  // ~17 RR). Tilt toward boundaries when chasing under pressure.
  const boundaryWeight = rr > 12 ? 28 : rr > 10 ? 22 : 16;
  const sixWeight = rr > 12 ? 14 : rr > 10 ? 10 : 6;
  const runs = weightedPick<number>(rng, [
    [0, 22],
    [1, 30],
    [2, 14],
    [3, 4],
    [4, boundaryWeight],
    [6, sixWeight],
  ]);

  return {
    runs_off_bat: runs,
    is_wicket: false,
    wicket_type: null,
    rotate: runs % 2 === 1,
  };
}

// ---------------------------------------------------------------------
// Innings generator
// ---------------------------------------------------------------------
type BallRow = Database["public"]["Tables"]["balls"]["Insert"];

function generateInnings(opts: {
  inningsId: string;
  battingXI: string[]; // ordered, 7 players
  bowlingXI: string[];
  target: number | null;
  oversCap: number;
  scoredBy: string;
  rng: () => number;
  startedAt: Date;
}): { balls: BallRow[]; allOut: boolean; chased: boolean } {
  const balls: BallRow[] = [];
  let striker = opts.battingXI[0];
  let nonStriker = opts.battingXI[1];
  let nextBatter = 2;
  let runs = 0;
  let wickets = 0;
  let legalBallSeq = 0;
  let chased = false;
  let allOut = false;

  // Bowler tracking — max 2 overs per bowler, no consecutive overs.
  const bowlerOvers = new Map<string, number>();
  let prevBowler: string | null = null;

  let ts = opts.startedAt.getTime();

  for (let over = 1; over <= opts.oversCap; over++) {
    // Pick bowler.
    const eligible = opts.bowlingXI.filter(
      (b) => b !== prevBowler && (bowlerOvers.get(b) ?? 0) < 2,
    );
    const bowler = eligible.length > 0
      ? pickRandom(opts.rng, eligible)
      : pickRandom(opts.rng, opts.bowlingXI.filter((b) => b !== prevBowler) ?? opts.bowlingXI);
    bowlerOvers.set(bowler, (bowlerOvers.get(bowler) ?? 0) + 1);
    prevBowler = bowler;

    for (let ballInOver = 1; ballInOver <= 6; ballInOver++) {
      const ballsLeft = (opts.oversCap - over) * 6 + (6 - ballInOver + 1);
      const outcome = rollOutcome(opts.rng, {
        needRuns: opts.target ? opts.target - runs : undefined,
        ballsLeft,
        wicketsInHand: opts.bowlingXI.length - wickets,
      });

      legalBallSeq += 1;
      ts += 30_000; // 30s per ball — gives a realistic scored_at timeline

      balls.push({
        innings_id: opts.inningsId,
        over_number: over,
        ball_in_over: ballInOver,
        legal_ball_seq: legalBallSeq,
        batter_id: striker,
        non_striker_id: nonStriker,
        bowler_id: bowler,
        runs_off_bat: outcome.runs_off_bat,
        extras: 0,
        extra_type: null,
        is_wicket: outcome.is_wicket,
        wicket_type: outcome.wicket_type,
        player_out_id: outcome.is_wicket ? striker : null,
        // Fielder needed for caught / run_out / stumped (matches the
        // server-side guard in recordBallSchema).
        fielder_id: outcome.is_wicket
          ? outcome.wicket_type === "caught" ||
            outcome.wicket_type === "run_out" ||
            outcome.wicket_type === "stumped"
            ? pickRandom(opts.rng, opts.bowlingXI.filter((p) => p !== bowler))
            : null
          : null,
        scored_by: opts.scoredBy,
        scored_at: new Date(ts).toISOString(),
        counts_for_innings_total: true,
      });

      runs += outcome.runs_off_bat;
      if (outcome.is_wicket) {
        wickets += 1;
        // Replace striker with next batter; if we run out of batters,
        // innings ends.
        if (nextBatter >= opts.battingXI.length) {
          allOut = true;
          return { balls, allOut, chased };
        }
        striker = opts.battingXI[nextBatter++];
      }
      if (outcome.rotate) {
        [striker, nonStriker] = [nonStriker, striker];
      }

      // Chased? End the innings mid-over.
      if (opts.target != null && runs >= opts.target) {
        chased = true;
        return { balls, allOut, chased };
      }

      // All-out cap (one batter must remain — 6 of 7 dismissed in HVC
      // would trigger last-man, but to keep this simple we just stop
      // at players_per_side - 1).
      if (wickets >= opts.bowlingXI.length - 1) {
        allOut = true;
        return { balls, allOut, chased };
      }
    }

    // End of over → swap strike.
    [striker, nonStriker] = [nonStriker, striker];
  }

  return { balls, allOut, chased };
}

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  if (url.includes(PROD_PROJECT_REF) && process.env.ALLOW_PROD_IMPORT !== "1") {
    console.error(
      `\nREFUSING TO RUN: NEXT_PUBLIC_SUPABASE_URL points at prod (${PROD_PROJECT_REF}).\n` +
      `This script writes fake ball-by-ball data; never appropriate on prod.\n`,
    );
    process.exit(1);
  }

  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false },
  });

  console.log(`Tournament : ${slug}`);
  console.log(`Count      : ${count}`);
  console.log(`Seed       : ${seed}\n`);

  // Tournament + matches
  const { data: tournament, error: tErr } = await supabase
    .from("tournaments")
    .select("id, name")
    .eq("slug", slug)
    .single();
  if (tErr || !tournament) {
    console.error(`Tournament '${slug}' not found.`);
    process.exit(1);
  }

  const { data: pending, error: mErr } = await supabase
    .from("matches")
    .select(
      "id, match_number, team_a_id, team_b_id, overs_per_innings, players_per_side, toss_winner_id, toss_decision, scheduled_at",
    )
    .eq("tournament_id", tournament.id)
    .eq("stage", "group")
    .eq("status", "scheduled")
    .order("match_number", { ascending: false })
    .limit(count);
  if (mErr || !pending || pending.length === 0) {
    console.error("No scheduled group matches to auto-complete.");
    process.exit(1);
  }

  // Process in match_number ascending order so the timeline looks
  // natural (latest in calendar order finishes last).
  const targets = [...pending].reverse();
  console.log(`Will auto-complete matches: ${targets.map((m) => `#${m.match_number}`).join(", ")}\n`);

  // Scored_by — any super-admin will do.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("is_super_admin", true)
    .limit(1)
    .single();
  if (!profile) {
    console.error("No super-admin profile found to use as scored_by.");
    process.exit(1);
  }
  const scoredBy = profile.id;

  let rngSeed = seed;
  for (const m of targets) {
    rngSeed += 1;
    const rng = mulberry32(rngSeed);
    await completeMatch(supabase, m, rng, scoredBy);
  }

  console.log("\nDone.");
}

// ---------------------------------------------------------------------
// Per-match completion
// ---------------------------------------------------------------------
async function completeMatch(
  supabase: ReturnType<typeof createClient<Database>>,
  match: {
    id: string;
    match_number: number;
    team_a_id: string;
    team_b_id: string;
    overs_per_innings: number;
    players_per_side: number;
    toss_winner_id: string | null;
    toss_decision: string | null;
    scheduled_at: string | null;
  },
  rng: () => number,
  scoredBy: string,
) {
  console.log(`Match #${match.match_number}...`);

  // 1. XIs — pull from team_players if match_players empty.
  const teamIds = [match.team_a_id, match.team_b_id];
  const { data: existingXI } = await supabase
    .from("match_players")
    .select("team_id, player_id, is_substitute")
    .eq("match_id", match.id);

  const xiByTeam: Record<string, string[]> = {};
  for (const t of teamIds) {
    const inMatch = (existingXI ?? [])
      .filter((r) => r.team_id === t && !r.is_substitute)
      .map((r) => r.player_id);
    if (inMatch.length >= match.players_per_side) {
      xiByTeam[t] = inMatch.slice(0, match.players_per_side);
      continue;
    }
    // Need to pick. Take 7 from team_players.
    const { data: roster } = await supabase
      .from("team_players")
      .select("player_id")
      .eq("team_id", t)
      .limit(50);
    const pickFrom = (roster ?? []).map((r) => r.player_id);
    const picked = pickFrom.slice(0, match.players_per_side);
    xiByTeam[t] = picked;

    // Insert match_players rows (skip if already exists per team_id+player_id).
    const rows = picked.map((player_id, idx) => ({
      match_id: match.id,
      team_id: t,
      player_id,
      batting_order: idx + 1,
      is_captain: false,
      is_keeper: false,
      is_substitute: false,
    }));
    if (rows.length > 0) {
      // Use upsert to be idempotent.
      const { error } = await supabase
        .from("match_players")
        .upsert(rows, { onConflict: "match_id,player_id" });
      if (error) {
        console.error(`  ! match_players insert failed: ${error.message}`);
        return;
      }
    }
  }

  // 2. Toss. If already set, respect it; else pick randomly.
  let tossWinnerId = match.toss_winner_id;
  let tossDecision = match.toss_decision as "bat" | "bowl" | null;
  if (!tossWinnerId || !tossDecision) {
    tossWinnerId = rng() < 0.5 ? match.team_a_id : match.team_b_id;
    tossDecision = rng() < 0.55 ? "bat" : "bowl"; // slight bat-first bias
  }

  // Batting first = toss winner who chose bat, OR the other team if toss winner chose bowl.
  const battingFirstTeam =
    tossDecision === "bat"
      ? tossWinnerId
      : tossWinnerId === match.team_a_id
        ? match.team_b_id
        : match.team_a_id;
  const bowlingFirstTeam =
    battingFirstTeam === match.team_a_id ? match.team_b_id : match.team_a_id;

  // 3. Build timestamps for this match. Anchor on scheduled_at if set,
  // else now.
  const baseTime = match.scheduled_at ? new Date(match.scheduled_at) : new Date();
  const startedAt = new Date(baseTime.getTime());
  // First innings starts immediately, second 5 minutes after first ends.

  // 4. Insert innings 1.
  const { data: inn1, error: i1Err } = await supabase
    .from("innings")
    .insert({
      match_id: match.id,
      innings_number: 1,
      batting_team_id: battingFirstTeam,
      bowling_team_id: bowlingFirstTeam,
      started_at: startedAt.toISOString(),
      target: null,
    })
    .select("id")
    .single();
  if (i1Err || !inn1) {
    console.error(`  ! innings 1 insert failed: ${i1Err?.message}`);
    return;
  }

  // 5. Generate innings 1 balls.
  const inn1Result = generateInnings({
    inningsId: inn1.id,
    battingXI: shuffle(xiByTeam[battingFirstTeam], rng),
    bowlingXI: xiByTeam[bowlingFirstTeam],
    target: null,
    oversCap: match.overs_per_innings,
    scoredBy,
    rng,
    startedAt,
  });
  const { error: b1Err } = await supabase.from("balls").insert(inn1Result.balls);
  if (b1Err) {
    console.error(`  ! innings 1 balls insert failed: ${b1Err.message}`);
    return;
  }

  // 6. Mark innings 1 complete + read its totals (recompute trigger
  // already updated them).
  const inn1EndedAt = new Date(
    startedAt.getTime() + inn1Result.balls.length * 30_000 + 60_000,
  );
  await supabase
    .from("innings")
    .update({ is_complete: true, ended_at: inn1EndedAt.toISOString() })
    .eq("id", inn1.id);
  const { data: inn1Final } = await supabase
    .from("innings")
    .select("total_runs, total_legal_balls")
    .eq("id", inn1.id)
    .single();
  const target = (inn1Final?.total_runs ?? 0) + 1;
  console.log(
    `  Innings 1: ${inn1Final?.total_runs ?? 0}/${inn1Result.balls.filter((b) => b.is_wicket).length} (${inn1Final?.total_legal_balls ?? 0} balls) — target ${target}`,
  );

  // 7. Insert innings 2.
  const inn2StartedAt = new Date(inn1EndedAt.getTime() + 5 * 60_000);
  const { data: inn2, error: i2Err } = await supabase
    .from("innings")
    .insert({
      match_id: match.id,
      innings_number: 2,
      batting_team_id: bowlingFirstTeam,
      bowling_team_id: battingFirstTeam,
      started_at: inn2StartedAt.toISOString(),
      target,
    })
    .select("id")
    .single();
  if (i2Err || !inn2) {
    console.error(`  ! innings 2 insert failed: ${i2Err?.message}`);
    return;
  }

  const inn2Result = generateInnings({
    inningsId: inn2.id,
    battingXI: shuffle(xiByTeam[bowlingFirstTeam], rng),
    bowlingXI: xiByTeam[battingFirstTeam],
    target,
    oversCap: match.overs_per_innings,
    scoredBy,
    rng,
    startedAt: inn2StartedAt,
  });
  const { error: b2Err } = await supabase.from("balls").insert(inn2Result.balls);
  if (b2Err) {
    console.error(`  ! innings 2 balls insert failed: ${b2Err.message}`);
    return;
  }

  const inn2EndedAt = new Date(
    inn2StartedAt.getTime() + inn2Result.balls.length * 30_000 + 60_000,
  );
  await supabase
    .from("innings")
    .update({ is_complete: true, ended_at: inn2EndedAt.toISOString() })
    .eq("id", inn2.id);
  const { data: inn2Final } = await supabase
    .from("innings")
    .select("total_runs, total_legal_balls")
    .eq("id", inn2.id)
    .single();
  console.log(
    `  Innings 2: ${inn2Final?.total_runs ?? 0}/${inn2Result.balls.filter((b) => b.is_wicket).length} (${inn2Final?.total_legal_balls ?? 0} balls)`,
  );

  // 8. Result.
  const inn1Runs = inn1Final?.total_runs ?? 0;
  const inn2Runs = inn2Final?.total_runs ?? 0;
  const inn2Wkts = inn2Result.balls.filter((b) => b.is_wicket).length;
  const playersPerSide = match.players_per_side;
  let winnerId: string | null = null;
  let winMargin: string | null = null;
  let resultType: "normal" | "tie" = "normal";

  if (inn2Runs > inn1Runs) {
    // Chase succeeded.
    winnerId = bowlingFirstTeam;
    const wktsRemaining = playersPerSide - 1 - inn2Wkts;
    winMargin = `${wktsRemaining} wicket${wktsRemaining === 1 ? "" : "s"}`;
  } else if (inn2Runs < inn1Runs) {
    winnerId = battingFirstTeam;
    const runsMargin = inn1Runs - inn2Runs;
    winMargin = `${runsMargin} run${runsMargin === 1 ? "" : "s"}`;
  } else {
    resultType = "tie";
  }

  const { error: matchErr } = await supabase
    .from("matches")
    .update({
      status: "completed",
      result_type: resultType,
      winner_id: winnerId,
      win_margin: winMargin,
      toss_winner_id: tossWinnerId,
      toss_decision: tossDecision,
      started_at: startedAt.toISOString(),
      ended_at: inn2EndedAt.toISOString(),
      current_innings_id: null,
    })
    .eq("id", match.id);
  if (matchErr) {
    console.error(`  ! match update failed: ${matchErr.message}`);
    return;
  }

  const summary = winnerId
    ? `winner ${winnerId === match.team_a_id ? "team A" : "team B"} by ${winMargin}`
    : "tied";
  console.log(`  → ${summary}\n`);
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
