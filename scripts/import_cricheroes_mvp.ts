#!/usr/bin/env tsx
/**
 * Targeted importer for CricHeroes' published MVP leaderboard.
 *
 * Reads ONLY data/cricheroes/csv/tournament_mvp.csv and inserts into
 * historical_tournament_mvp. Does NOT touch tournaments/teams/players/
 * matches — looks up existing UUIDs by slug + name so it can run safely
 * against prod without `--reset`-ing the rest of the historical data
 * (which would wipe player.linked_user_id and other downstream state).
 *
 *   pnpm tsx scripts/import_cricheroes_mvp.ts            # idempotent insert
 *   pnpm tsx scripts/import_cricheroes_mvp.ts --reset    # clear table first
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * Prod requires ALLOW_PROD_IMPORT=1 to bypass the safety check.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types";

const PROD_PROJECT_REF = "cxysyglwooqmzcfvtmyl";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CSV_DIR = resolve(ROOT, "data", "cricheroes", "csv");
const RESET = process.argv.includes("--reset");

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

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1)
    .filter((r) => r.length === headers.length && r.some((v) => v !== ""))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

function readCsv(name: string): Record<string, string>[] {
  const path = resolve(CSV_DIR, name);
  if (!existsSync(path)) {
    console.error(`! missing CSV: ${path}`);
    process.exit(1);
  }
  return parseCsv(readFileSync(path, "utf8"));
}

const intOrNull = (v: string | undefined): number | null => {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const teamKey = (tid: string, teamId: string) => `${tid}:${teamId}`;

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
      `Override with ALLOW_PROD_IMPORT=1 if you really mean it.\n`,
    );
    process.exit(1);
  }
  if (url.includes(PROD_PROJECT_REF)) {
    console.warn(`\n  !! PROD-IMPORT OVERRIDE ACTIVE — writing to ${PROD_PROJECT_REF} !!\n`);
  }

  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false },
  });

  console.log(`Project URL     : ${url}`);
  console.log(`Reset first     : ${RESET ? "yes" : "no"}\n`);

  if (RESET) {
    console.log("Clearing historical_tournament_mvp...");
    const { error } = await supabase
      .from("historical_tournament_mvp")
      .delete()
      .not("id", "is", null);
    if (error) { console.error(`  ! ${error.message}`); process.exit(1); }
    console.log("  cleared\n");
  }

  // Read source CSVs (we still need tournaments.csv + teams.csv + players.csv
  // to translate cricheroes IDs back to our UUIDs; the MVP CSV alone only
  // has cricheroes IDs).
  const tournamentsCsv = readCsv("tournaments.csv");
  const teamsCsv = readCsv("teams.csv");
  const playersCsv = readCsv("players.csv");
  const mvpCsv = readCsv("tournament_mvp.csv");
  console.log(`Source rows     : ${tournamentsCsv.length} tournaments, ${teamsCsv.length} teams, ${playersCsv.length} players, ${mvpCsv.length} mvp\n`);

  // --- 1. tournamentIds: cricheroes_tournament_id -> our uuid (via slug) ---
  const slugs = tournamentsCsv.map((t) => t.slug);
  const { data: dbTournaments, error: tErr } = await supabase
    .from("tournaments")
    .select("id, slug")
    .in("slug", slugs);
  if (tErr || !dbTournaments) { console.error(tErr); process.exit(1); }
  const idBySlug = new Map(dbTournaments.map((t) => [t.slug, t.id]));
  const tournamentIds = new Map<string, string>();
  for (const t of tournamentsCsv) {
    const uuid = idBySlug.get(t.slug);
    if (uuid) tournamentIds.set(t.cricheroes_tournament_id, uuid);
  }
  console.log(`Resolved        : ${tournamentIds.size}/${tournamentsCsv.length} tournaments`);

  // --- 2. teamIds: (cricheroes_tournament_id, cricheroes_team_id) -> uuid ---
  const tournamentUuids = [...tournamentIds.values()];
  const { data: dbTeams, error: teErr } = await supabase
    .from("teams")
    .select("id, tournament_id, name")
    .in("tournament_id", tournamentUuids);
  if (teErr || !dbTeams) { console.error(teErr); process.exit(1); }
  // name lookup key = `<tournament_uuid>::<normalized name>`
  const norm = (s: string) => s.trim().toLowerCase();
  const teamUuidByKey = new Map<string, string>();
  for (const t of dbTeams) {
    teamUuidByKey.set(`${t.tournament_id}::${norm(t.name)}`, t.id);
  }
  const teamIds = new Map<string, string>();
  for (const r of teamsCsv) {
    const tournamentUuid = tournamentIds.get(r.cricheroes_tournament_id);
    if (!tournamentUuid) continue;
    const uuid = teamUuidByKey.get(`${tournamentUuid}::${norm(r.name)}`);
    if (uuid) teamIds.set(teamKey(r.cricheroes_tournament_id, r.cricheroes_team_id), uuid);
  }
  console.log(`Resolved        : ${teamIds.size}/${teamsCsv.length} teams`);

  // --- 3. playerIds: cricheroes_player_id -> uuid (via display_name) ---
  // Matches the full importer's dedupe rule: case-insensitive display_name.
  const playerNames = [...new Set(playersCsv.map((p) => p.display_name))];
  const { data: dbPlayers, error: pErr } = await supabase
    .from("players")
    .select("id, display_name");
  if (pErr || !dbPlayers) { console.error(pErr); process.exit(1); }
  const playerIdByName = new Map<string, string>();
  for (const p of dbPlayers) {
    playerIdByName.set(norm(p.display_name), p.id);
  }
  const playerIds = new Map<string, string>();
  let playerMissing = 0;
  for (const p of playersCsv) {
    const uuid = playerIdByName.get(norm(p.display_name));
    if (uuid) playerIds.set(p.cricheroes_player_id, uuid);
    else playerMissing++;
  }
  console.log(`Resolved        : ${playerIds.size}/${playerNames.length} players  (${playerMissing} missing — likely renamed or merged)\n`);

  // --- 4. insert MVP rows ---
  let inserted = 0, skipped = 0;
  for (const r of mvpCsv) {
    const tournamentUuid = tournamentIds.get(r.cricheroes_tournament_id);
    const teamUuid = tournamentUuid
      ? teamIds.get(teamKey(r.cricheroes_tournament_id, r.cricheroes_team_id)) ?? null
      : null;
    const playerUuid = playerIds.get(r.cricheroes_player_id) ?? null;
    if (!tournamentUuid) { skipped++; continue; }
    const { error } = await supabase
      .from("historical_tournament_mvp")
      .insert({
        tournament_id: tournamentUuid,
        player_id: playerUuid,
        player_name: r.name,
        team_id: teamUuid,
        rank: intOrNull(r.rank) ?? 0,
        matches: intOrNull(r.matches) ?? 0,
        batting_points: r.batting ? Number(r.batting) : 0,
        bowling_points: r.bowling ? Number(r.bowling) : 0,
        fielding_points: r.fielding ? Number(r.fielding) : 0,
        total_points: r.total ? Number(r.total) : 0,
      });
    if (error) {
      if (error.message.includes("duplicate")) { skipped++; continue; }
      console.error(`  ! tournament ${r.cricheroes_tournament_id}, player ${r.cricheroes_player_id} (${r.name}): ${error.message}`);
      process.exit(1);
    }
    inserted++;
  }
  console.log(`Inserted        : ${inserted}`);
  console.log(`Skipped         : ${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
