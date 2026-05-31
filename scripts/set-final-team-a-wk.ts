/*
 * One-off: WK won Q1 (#22), so set Final.team_a = WK and
 * schedule the Final for 8:00 PM IST on June 7. team_b stays
 * null until Q2 (the rained-out KW-vs-HH rematch on June 7 at
 * 7:00 PM IST) resolves.
 *
 * Default dry-run; --execute writes.
 */

import { createClient } from "@supabase/supabase-js";

const PROD_URL = "https://cxysyglwooqmzcfvtmyl.supabase.co";
const FINAL_MATCH_ID = "(resolved at runtime — match_number=25 in S7)";
const WK_TEAM_ID = "2cd9a17c-28a1-4333-b850-9c3c1f83d7d6";
const S7_TOURNAMENT_ID = "4826feda-2246-4759-ba53-8d8e1701ba25";
// 2026-06-07 20:00 IST = 14:30 UTC
const NEW_SCHEDULED_AT_UTC = "2026-06-07T14:30:00+00:00";

const args = process.argv.slice(2);
const execute = args.includes("--execute");

const svc = process.env.PROD_SERVICE_ROLE;
if (!svc) {
  console.error(
    "Missing PROD_SERVICE_ROLE env. Run with: PROD_SERVICE_ROLE=... pnpm tsx scripts/set-final-team-a-wk.ts",
  );
  process.exit(1);
}

const sb = createClient(PROD_URL, svc, { auth: { persistSession: false } });

async function main() {
  console.log(`=== Set Final.team_a + schedule · ${execute ? "EXECUTE" : "DRY RUN"} ===\n`);
  void FINAL_MATCH_ID;

  // Resolve the Final match row for S7.
  const { data: final, error: fErr } = await sb
    .from("matches")
    .select(
      "id, match_number, stage, status, team_a_id, team_b_id, scheduled_at",
    )
    .eq("tournament_id", S7_TOURNAMENT_ID)
    .eq("stage", "final")
    .single();
  if (fErr || !final) throw new Error(`Final not found: ${fErr?.message}`);
  if (final.status !== "scheduled") {
    throw new Error(
      `Refusing to act — Final status is ${final.status}, expected scheduled`,
    );
  }

  // Sanity-check Q1 winner.
  const { data: q1, error: q1Err } = await sb
    .from("matches")
    .select("winner_id, status")
    .eq("tournament_id", S7_TOURNAMENT_ID)
    .eq("stage", "qualifier_1")
    .single();
  if (q1Err || !q1) throw new Error(`Q1 not found: ${q1Err?.message}`);
  if (q1.status !== "completed" || !q1.winner_id) {
    throw new Error(`Q1 isn't completed yet (status=${q1.status})`);
  }
  if (q1.winner_id !== WK_TEAM_ID) {
    throw new Error(
      `Q1 winner_id=${q1.winner_id} doesn't match expected WK ${WK_TEAM_ID} — refusing to write`,
    );
  }

  console.log("Final (#25) current state:");
  console.log(`  status:       ${final.status}`);
  console.log(`  team_a_id:    ${final.team_a_id ?? "null"}`);
  console.log(`  team_b_id:    ${final.team_b_id ?? "null"}`);
  console.log(`  scheduled_at: ${final.scheduled_at ?? "null"}`);
  console.log("\nWill UPDATE:");
  console.log(`  team_a_id → ${WK_TEAM_ID} (WK, Q1 winner)`);
  console.log(`  scheduled_at → ${NEW_SCHEDULED_AT_UTC} (June 7 8:00 PM IST)`);
  console.log("\nPreserved: team_b_id (null — Q2 winner unresolved)");

  if (!execute) {
    console.log("\n(dry run — re-run with --execute to write)");
    return;
  }

  const { error: updErr } = await sb
    .from("matches")
    .update({
      team_a_id: WK_TEAM_ID,
      scheduled_at: NEW_SCHEDULED_AT_UTC,
    })
    .eq("id", final.id);
  if (updErr) throw new Error(`UPDATE failed: ${updErr.message}`);
  console.log("\n✓ Final.team_a set to WK + scheduled for June 7 8:00 PM IST.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
