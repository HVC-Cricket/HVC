/*
 * One-off: reset HVC S7 Qualifier 2 (match #24) to a clean
 * scheduled state after rain stopped play. The match was
 * postponed to June 7 7:00 PM IST and the rules say it's a full
 * rematch (not a continuation), so the recorded innings + balls
 * from the rain-interrupted attempt have to be wiped.
 *
 * What this does:
 *   1. UPDATE match: clear current_innings_id, status='scheduled',
 *      clear toss, clear started_at / ended_at, clear winner /
 *      result_type / player_of_match_id, clear scoring-lock
 *      fields, set scheduled_at to the new June 7 slot.
 *      Teams + XI (match_players) are preserved — same teams
 *      playing the rematch.
 *   2. DELETE every `balls` row from the innings of this match.
 *   3. DELETE the innings row itself.
 *
 * What this does NOT touch:
 *   - match_players (the playing XI)  — preserved
 *   - match_audit_events              — preserved as audit trail
 *   - teams / players / tournament    — unrelated
 *   - any other matches               — explicit match_id filter
 *
 * Default dry-run; --execute writes.
 *
 * Run with:
 *   PROD_SERVICE_ROLE=... pnpm tsx scripts/reset-q2-rainout.ts
 *   PROD_SERVICE_ROLE=... pnpm tsx scripts/reset-q2-rainout.ts --execute
 */

import { createClient } from "@supabase/supabase-js";

const PROD_URL = "https://cxysyglwooqmzcfvtmyl.supabase.co";
const Q2_MATCH_ID = "3e01d50b-7f3a-4302-a816-3f44f7a47343";
// 2026-06-07 19:00 IST = 13:30 UTC
const NEW_SCHEDULED_AT_UTC = "2026-06-07T13:30:00+00:00";

const args = process.argv.slice(2);
const execute = args.includes("--execute");

const svc = process.env.PROD_SERVICE_ROLE;
if (!svc) {
  console.error(
    "Missing PROD_SERVICE_ROLE env. Run with: PROD_SERVICE_ROLE=... pnpm tsx scripts/reset-q2-rainout.ts",
  );
  process.exit(1);
}

const sb = createClient(PROD_URL, svc, { auth: { persistSession: false } });

async function main() {
  console.log(
    `=== Q2 rainout reset · ${execute ? "EXECUTE" : "DRY RUN"} ===\n`,
  );

  // 1) Read current state for confirmation.
  const { data: match, error: mErr } = await sb
    .from("matches")
    .select(
      "id, match_number, stage, status, team_a_id, team_b_id, scheduled_at, started_at, toss_winner_id, toss_decision, current_innings_id, primary_scorer_id",
    )
    .eq("id", Q2_MATCH_ID)
    .single();
  if (mErr || !match) throw new Error(`Match not found: ${mErr?.message}`);
  if (match.stage !== "qualifier_2") {
    throw new Error(
      `Refusing to act: match #${match.match_number} stage is ${match.stage}, expected qualifier_2`,
    );
  }
  console.log("Current match state:");
  console.log(
    `  #${match.match_number} ${match.stage} ${match.status}`,
  );
  console.log(`  scheduled_at: ${match.scheduled_at}`);
  console.log(`  started_at:   ${match.started_at ?? "—"}`);
  console.log(
    `  toss:         ${match.toss_winner_id ? `winner=${match.toss_winner_id.slice(0, 8)} decision=${match.toss_decision}` : "—"}`,
  );
  console.log(`  current_innings_id: ${match.current_innings_id ?? "—"}`);

  const { data: innings, error: iErr } = await sb
    .from("innings")
    .select("id, innings_number, total_runs, total_wickets, total_legal_balls")
    .eq("match_id", Q2_MATCH_ID);
  if (iErr) throw new Error(`Innings read failed: ${iErr.message}`);
  console.log(`\nInnings rows to delete: ${innings?.length ?? 0}`);
  for (const i of innings ?? []) {
    console.log(
      `  innings #${i.innings_number}: ${i.total_runs}/${i.total_wickets} in ${i.total_legal_balls} balls (id=${i.id.slice(0, 8)})`,
    );
  }

  const inningsIds = (innings ?? []).map((i) => i.id);
  let ballCount = 0;
  if (inningsIds.length > 0) {
    const { count, error: bErr } = await sb
      .from("balls")
      .select("id", { count: "exact", head: true })
      .in("innings_id", inningsIds);
    if (bErr) throw new Error(`Balls count failed: ${bErr.message}`);
    ballCount = count ?? 0;
  }
  console.log(`Balls rows to delete: ${ballCount}`);

  console.log(`\nWill UPDATE match:`);
  console.log(`  status            'live' → 'scheduled'`);
  console.log(`  scheduled_at      → ${NEW_SCHEDULED_AT_UTC} (June 7 7:00 PM IST)`);
  console.log(`  toss_winner_id    → null`);
  console.log(`  toss_decision     → null`);
  console.log(`  started_at        → null`);
  console.log(`  ended_at          → null`);
  console.log(`  winner_id         → null`);
  console.log(`  result_type       → null`);
  console.log(`  player_of_match_id → null`);
  console.log(`  current_innings_id → null`);
  console.log(`  primary_scorer_id → null (and heartbeat / pending-request fields)`);
  console.log(`\nPreserved:`);
  console.log(`  teams (KW vs HH), match_players (XI), match_audit_events`);

  if (!execute) {
    console.log("\n(dry run — re-run with --execute to write)");
    return;
  }

  // Order matters: clear current_innings_id FK first, then delete
  // balls, then innings. Otherwise the innings DELETE could fail on
  // an outstanding FK reference from matches.current_innings_id.

  console.log("\n=== Writing changes ===");

  // (a) Clear current_innings_id + reset match
  const { error: updErr } = await sb
    .from("matches")
    .update({
      status: "scheduled",
      scheduled_at: NEW_SCHEDULED_AT_UTC,
      toss_winner_id: null,
      toss_decision: null,
      started_at: null,
      ended_at: null,
      winner_id: null,
      win_margin: null,
      result_type: null,
      player_of_match_id: null,
      current_innings_id: null,
      primary_scorer_id: null,
      primary_scorer_heartbeat_at: null,
      pending_scorer_request_id: null,
      pending_scorer_request_at: null,
    })
    .eq("id", Q2_MATCH_ID);
  if (updErr) throw new Error(`Match UPDATE failed: ${updErr.message}`);
  console.log("  ✓ match reset");

  // (b) Delete balls
  if (inningsIds.length > 0) {
    const { error: delBErr } = await sb
      .from("balls")
      .delete()
      .in("innings_id", inningsIds);
    if (delBErr) throw new Error(`Balls DELETE failed: ${delBErr.message}`);
    console.log(`  ✓ deleted ${ballCount} balls`);
  }

  // (c) Delete innings
  if (inningsIds.length > 0) {
    const { error: delIErr } = await sb
      .from("innings")
      .delete()
      .in("id", inningsIds);
    if (delIErr) throw new Error(`Innings DELETE failed: ${delIErr.message}`);
    console.log(`  ✓ deleted ${innings?.length ?? 0} innings`);
  }

  console.log("\n✓ Reset complete. Match #24 is scheduled for June 7 7:00 PM IST.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
