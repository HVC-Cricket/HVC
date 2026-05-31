/*
 * One-off: backfill `matches.player_of_match_id` for every
 * completed S7 match that doesn't have one yet, using the same
 * computeMatchMvp algorithm the match detail page uses for its
 * "Auto-pick" display. Persisting it makes those matches count
 * on the Awards (Most Player-of-the-Match) leaderboard.
 *
 * Skips any match where player_of_match_id is already set —
 * organizer picks are never overwritten.
 *
 * Default dry-run; --execute writes.
 *
 *   PROD_SERVICE_ROLE=... pnpm tsx scripts/backfill-pom-s7.ts
 *   PROD_SERVICE_ROLE=... pnpm tsx scripts/backfill-pom-s7.ts --execute
 */

import { createClient } from "@supabase/supabase-js";

import { computeMatchMvp } from "../src/lib/scoring/mvp";
import type { BallRow } from "../src/lib/supabase/row-types";

const PROD_URL = "https://cxysyglwooqmzcfvtmyl.supabase.co";
const S7_TOURNAMENT_ID = "4826feda-2246-4759-ba53-8d8e1701ba25";

const args = process.argv.slice(2);
const execute = args.includes("--execute");

const svc = process.env.PROD_SERVICE_ROLE;
if (!svc) {
  console.error(
    "Missing PROD_SERVICE_ROLE env. Run with: PROD_SERVICE_ROLE=... pnpm tsx scripts/backfill-pom-s7.ts",
  );
  process.exit(1);
}

const sb = createClient(PROD_URL, svc, { auth: { persistSession: false } });

async function main() {
  console.log(`=== POM backfill · ${execute ? "EXECUTE" : "DRY RUN"} ===\n`);

  const { data: matches, error: mErr } = await sb
    .from("matches")
    .select("id, match_number, stage, winner_id, player_of_match_id")
    .eq("tournament_id", S7_TOURNAMENT_ID)
    .eq("status", "completed")
    .order("match_number", { ascending: true });
  if (mErr || !matches) throw new Error(`matches read failed: ${mErr?.message}`);

  const missing = matches.filter((m) => !m.player_of_match_id);
  console.log(
    `Completed matches: ${matches.length} | with POM already: ${matches.length - missing.length} | needing backfill: ${missing.length}`,
  );
  if (missing.length === 0) {
    console.log("Nothing to do.");
    return;
  }
  console.log("");

  // Resolve player names once for the plan output.
  const allPlayerIds = new Set<string>();

  type Plan = {
    matchId: string;
    matchNumber: number;
    pickPlayerId: string | null;
    reason: string;
  };
  const plan: Plan[] = [];

  for (const m of missing) {
    // Pull every innings of the match, then balls scoped to those
    // innings ids, then the XI. Same shape match-awards.tsx uses.
    const { data: innings } = await sb
      .from("innings")
      .select("id")
      .eq("match_id", m.id);
    const inningsIds = (innings ?? []).map((i) => i.id);
    if (inningsIds.length === 0) {
      plan.push({
        matchId: m.id,
        matchNumber: m.match_number,
        pickPlayerId: null,
        reason: "no innings rows",
      });
      continue;
    }
    const [ballsRes, xiRes] = await Promise.all([
      sb
        .from("balls")
        .select("*")
        .in("innings_id", inningsIds)
        .eq("is_voided", false),
      sb
        .from("match_players")
        .select("player_id, team_id")
        .eq("match_id", m.id),
    ]);
    const balls = (ballsRes.data ?? []) as BallRow[];
    const xi = xiRes.data ?? [];

    const performances = computeMatchMvp(balls, xi, m.winner_id);
    const ranked = performances
      .filter((p) => p.total > 0)
      .sort((a, b) => b.total - a.total);
    const top = ranked[0];
    if (!top) {
      plan.push({
        matchId: m.id,
        matchNumber: m.match_number,
        pickPlayerId: null,
        reason: "no eligible performer (zero total scores)",
      });
      continue;
    }
    allPlayerIds.add(top.player_id);
    plan.push({
      matchId: m.id,
      matchNumber: m.match_number,
      pickPlayerId: top.player_id,
      reason: `score=${top.total.toFixed(1)} · ${top.reasonLine}`,
    });
  }

  const { data: players } = await sb
    .from("players")
    .select("id, display_name, category")
    .in("id", Array.from(allPlayerIds));
  const nameById = new Map(
    (players ?? []).map((p) => [p.id, `${p.display_name} (C${p.category})`]),
  );

  console.log("Plan:");
  for (const p of plan) {
    const who = p.pickPlayerId
      ? nameById.get(p.pickPlayerId) ?? p.pickPlayerId.slice(0, 8)
      : "—";
    console.log(`  #${String(p.matchNumber).padStart(2)} → ${who.padEnd(36)} ${p.reason}`);
  }

  if (!execute) {
    console.log("\n(dry run — re-run with --execute to write)");
    return;
  }

  console.log("\n=== Writing assignments ===");
  let written = 0;
  for (const p of plan) {
    if (!p.pickPlayerId) continue;
    const { error } = await sb
      .from("matches")
      .update({ player_of_match_id: p.pickPlayerId })
      .eq("id", p.matchId)
      .is("player_of_match_id", null);
    if (error) {
      console.error(`  ! #${p.matchNumber}: ${error.message}`);
    } else {
      written += 1;
    }
  }
  console.log(`\n✓ wrote ${written} POM assignments`);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
