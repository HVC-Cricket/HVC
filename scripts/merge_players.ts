#!/usr/bin/env tsx
/**
 * Merge one player's data into another and delete the loser row.
 *
 * Use case: a player exists twice in the registry (different display
 * names, no auth link to dedupe through). After review, an admin picks
 * which row to keep — this script re-points every FK that referenced
 * the loser, verifies no stragglers, then deletes the loser.
 *
 *   pnpm tsx scripts/merge_players.ts \
 *     --merge=<from-uuid-or-prefix>:<to-uuid-or-prefix> \
 *     --merge=...
 *
 *   # add --execute to actually mutate. Without it, the script
 *   # only prints the plan and the collisions it would hit.
 *
 * Default env: .env.prod (override with --env=.env.local).
 *
 * Safety:
 *   - Default is dry-run; requires explicit --execute to write.
 *   - Detects (match_id, player_id) collisions in match_players — if
 *     both candidates appear in the same match the merge is a category
 *     error, so the pair is skipped with a warning.
 *   - team_players (team_id, player_id) collisions are resolved by
 *     deleting the loser row (the keeper stays).
 *   - Runs the seven FK updates sequentially. NOT a single
 *     transaction — Supabase JS doesn't expose Postgres tx. If the
 *     script fails midway the data is still consistent (every UPDATE
 *     leaves orphan-free state); just re-run with --execute and the
 *     remaining steps will resume.
 *   - Verifies zero remaining FK references before issuing DELETE.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function loadEnv(file: string): void {
  const path = resolve(ROOT, file);
  if (!existsSync(path)) {
    console.error(`Env file not found: ${path}`);
    process.exit(1);
  }
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

const args = process.argv.slice(2);
const envFile =
  args.find((a) => a.startsWith("--env="))?.split("=")[1] ?? ".env.prod";
const execute = args.includes("--execute");
const mergePairs = args
  .filter((a) => a.startsWith("--merge="))
  .map((a) => a.slice("--merge=".length).split(":"))
  .map(([from, to]) => ({ fromKey: from, toKey: to }));

if (mergePairs.length === 0) {
  console.error(
    "Usage: pnpm tsx scripts/merge_players.ts --merge=<from>:<to> [--execute]",
  );
  process.exit(1);
}

loadEnv(envFile);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const projectRef = url.replace(/^https?:\/\//, "").split(".")[0];
console.log(
  `Project ${projectRef} · mode: ${execute ? "EXECUTE" : "dry-run"}\n`,
);

const supabase = createClient<Database>(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Postgres UUID columns can't take LIKE, so resolve prefixes by
// pulling the full list once and matching client-side.
let allPlayersCache: Array<{ id: string; display_name: string }> | null = null;
async function allPlayers() {
  if (allPlayersCache) return allPlayersCache;
  const { data, error } = await supabase
    .from("players")
    .select("id, display_name");
  if (error || !data) {
    console.error("players list failed:", error);
    process.exit(1);
  }
  allPlayersCache = data;
  return data;
}

async function resolvePlayer(keyish: string): Promise<{
  id: string;
  display_name: string;
}> {
  const looksUuid = keyish.length === 36 && keyish.includes("-");
  if (looksUuid) {
    const { data, error } = await supabase
      .from("players")
      .select("id, display_name")
      .eq("id", keyish)
      .maybeSingle();
    if (error || !data) {
      console.error(`Could not resolve player "${keyish}":`, error);
      process.exit(1);
    }
    return data;
  }
  const players = await allPlayers();
  const matches = players.filter((p) => p.id.startsWith(keyish));
  if (matches.length === 0) {
    console.error(`No player matched prefix "${keyish}"`);
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`Ambiguous prefix "${keyish}" — ${matches.length} matches`);
    for (const m of matches) console.error(`  ${m.id} ${m.display_name}`);
    process.exit(1);
  }
  return matches[0];
}

// Tables to re-point. The list is exhaustive: every FK column that
// references players.id, as of 2026-05-19.
const FK_COLUMNS: Array<{ table: string; column: string; deleteOnConflict?: { onColumns: string[] } }> = [
  // restrict on delete — must update first
  { table: "team_players", column: "player_id", deleteOnConflict: { onColumns: ["team_id"] } },
  // no on-delete clause, default NO ACTION — must update
  { table: "match_players", column: "player_id" /* collisions handled separately as "abort" */ },
  { table: "matches", column: "player_of_match_id" },
  // set null on delete — but we want to repoint
  { table: "innings", column: "initial_striker_id" },
  { table: "innings", column: "initial_non_striker_id" },
  { table: "innings", column: "initial_bowler_id" },
  // balls — no on-delete (NO ACTION) on the not-null ones
  { table: "balls", column: "batter_id" },
  { table: "balls", column: "non_striker_id" },
  { table: "balls", column: "bowler_id" },
  { table: "balls", column: "player_out_id" },
  { table: "balls", column: "fielder_id" },
  // historical aggregates
  { table: "historical_match_batting", column: "player_id" },
  { table: "historical_match_bowling", column: "player_id" },
  { table: "historical_match_fall_of_wickets", column: "dismiss_player_id" },
  { table: "historical_tournament_mvp", column: "player_id" },
];

async function rowsReferencing(
  table: string,
  column: string,
  playerId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, playerId);
  if (error) {
    console.error(`count failed on ${table}.${column}:`, error);
    return -1;
  }
  return count ?? 0;
}

async function mergeOne(fromKey: string, toKey: string): Promise<void> {
  const from = await resolvePlayer(fromKey);
  const to = await resolvePlayer(toKey);
  if (from.id === to.id) {
    console.warn(`Skipping ${fromKey}:${toKey} — same player`);
    return;
  }

  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(`Merge: "${from.display_name}" (${from.id})`);
  console.log(`   →   "${to.display_name}" (${to.id})`);
  console.log(`══════════════════════════════════════════════════════════`);

  // Pre-flight: detect match_players collisions (same match has both).
  // These mean the two players are actually distinct — surface and bail.
  const { data: fromMatches } = await supabase
    .from("match_players")
    .select("match_id")
    .eq("player_id", from.id);
  const { data: toMatches } = await supabase
    .from("match_players")
    .select("match_id")
    .eq("player_id", to.id);
  const toSet = new Set((toMatches ?? []).map((r) => r.match_id));
  const matchCollisions = (fromMatches ?? [])
    .map((r) => r.match_id)
    .filter((m) => toSet.has(m));
  if (matchCollisions.length > 0) {
    console.error(
      `  ✖ ABORT: both players are in ${matchCollisions.length} match(es). They are not duplicates.`,
    );
    for (const m of matchCollisions) console.error(`     match_id=${m}`);
    return;
  }
  console.log(`  ✓ no match_players collisions`);

  // For each FK column, count rows that reference the loser.
  console.log(`\n  Plan:`);
  for (const fk of FK_COLUMNS) {
    const n = await rowsReferencing(fk.table, fk.column, from.id);
    if (n > 0) console.log(`    ${fk.table}.${fk.column}: ${n} row(s) to update`);
  }

  if (!execute) {
    console.log(`\n  (dry-run — pass --execute to write)`);
    return;
  }

  // Execute. team_players is special: unique (team_id, player_id) means
  // if loser and keeper share any team, the keeper's row stays and the
  // loser's row is deleted (instead of UPDATE which would violate the
  // constraint). Then UPDATE everything else.
  for (const fk of FK_COLUMNS) {
    if (fk.deleteOnConflict) {
      // Find conflicting rows: loser rows whose (deleteOnConflict.onColumns) match a keeper row.
      // For team_players: same team_id.
      const onCol = fk.deleteOnConflict.onColumns[0];
      const { data: keeperRows } = await supabase
        .from(fk.table)
        .select(onCol)
        .eq(fk.column, to.id);
      const keeperKeys = new Set(
        (keeperRows ?? []).map((r) => (r as Record<string, string>)[onCol]),
      );
      const { data: loserRows } = await supabase
        .from(fk.table)
        .select(`id, ${onCol}`)
        .eq(fk.column, from.id);
      const conflictIds: string[] = [];
      for (const row of (loserRows ?? []) as Array<Record<string, string>>) {
        if (keeperKeys.has(row[onCol])) conflictIds.push(row.id);
      }
      if (conflictIds.length > 0) {
        const { error } = await supabase
          .from(fk.table)
          .delete()
          .in("id", conflictIds);
        if (error) {
          console.error(`    ✖ ${fk.table} delete-on-conflict failed:`, error);
          return;
        }
        console.log(
          `    ${fk.table}: deleted ${conflictIds.length} conflicting loser row(s)`,
        );
      }
    }
    const { error, count } = await supabase
      .from(fk.table)
      .update({ [fk.column]: to.id }, { count: "exact" })
      .eq(fk.column, from.id);
    if (error) {
      console.error(`    ✖ ${fk.table}.${fk.column} update failed:`, error);
      return;
    }
    if ((count ?? 0) > 0) {
      console.log(`    ${fk.table}.${fk.column}: ${count} updated`);
    }
  }

  // Verify nothing still references the loser.
  let stragglers = 0;
  for (const fk of FK_COLUMNS) {
    const n = await rowsReferencing(fk.table, fk.column, from.id);
    if (n > 0) {
      console.error(`    ✖ ${fk.table}.${fk.column} still has ${n} row(s)`);
      stragglers += n;
    }
  }
  if (stragglers > 0) {
    console.error(`  ✖ ${stragglers} stragglers — not deleting loser`);
    return;
  }
  console.log(`  ✓ no stragglers — safe to delete loser`);

  const { error: delErr } = await supabase
    .from("players")
    .delete()
    .eq("id", from.id);
  if (delErr) {
    console.error(`  ✖ delete failed:`, delErr);
    return;
  }
  console.log(`  ✓ deleted player ${from.id} ("${from.display_name}")`);
}

async function main() {
  for (const { fromKey, toKey } of mergePairs) {
    await mergeOne(fromKey, toKey);
  }
  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
