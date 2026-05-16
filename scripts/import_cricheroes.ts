#!/usr/bin/env tsx
/**
 * CricHeroes CSV → Supabase importer.
 *
 * Reads schema-shaped CSVs from data/cricheroes/csv/ (produced by
 * scripts/scrape_cricheroes.py) and inserts them via the service-role
 * client (RLS-bypass).
 *
 *   pnpm tsx scripts/import_cricheroes.ts            # insert; bails if data exists
 *   pnpm tsx scripts/import_cricheroes.ts --reset    # clear target tables first
 *
 * Env (loaded from .env.local or process.env):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Safety: refuses to run if NEXT_PUBLIC_SUPABASE_URL points at the prod
 * project. Service-role bypasses RLS — a misfire would flatten prod.
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

// ---------------------------------------------------------------------
// env loader — .env.local without dotenv
// ---------------------------------------------------------------------
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
// CSV parser — handles "..." quoted fields with embedded commas
// ---------------------------------------------------------------------
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { cur.push(field); field = ""; }
      else if (ch === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (ch === "\r") { /* skip */ }
      else field += ch;
    }
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  while (rows.length && rows[rows.length - 1].every(c => !c)) rows.pop();
  if (!rows.length) return [];
  const [header, ...body] = rows;
  return body.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

function readCsv(name: string): Record<string, string>[] {
  return parseCsv(readFileSync(resolve(CSV_DIR, name), "utf8"));
}

const intOrNull = (s: string): number | null => {
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const strOrNull = (s: string): string | null => (s === "" ? null : s);
const bool = (s: string): boolean => s === "1" || s.toLowerCase() === "true";

// ---------------------------------------------------------------------
// main
// ---------------------------------------------------------------------
async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env / .env.local");
    process.exit(1);
  }
  if (url.includes(PROD_PROJECT_REF) && process.env.ALLOW_PROD_IMPORT !== "1") {
    console.error(
      `\nREFUSING TO RUN: NEXT_PUBLIC_SUPABASE_URL points at the prod project (${PROD_PROJECT_REF}).\n` +
      `Switch .env.local to the dev project, OR set ALLOW_PROD_IMPORT=1 to acknowledge.\n` +
      `(The prod-load override is intended for the one-time historical seed after the\n` +
      ` prod wipe — see HANDOFF §15.)\n`,
    );
    process.exit(1);
  }
  if (url.includes(PROD_PROJECT_REF)) {
    console.warn(`\n  !! PROD-IMPORT OVERRIDE ACTIVE — writing to ${PROD_PROJECT_REF} !!\n`);
  }

  console.log(`Importer target : ${url}`);
  console.log(`Reset first     : ${RESET ? "yes" : "no"}`);
  console.log(`CSV directory   : ${CSV_DIR}\n`);

  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (RESET) {
    console.log("Clearing target tables (reverse-FK order)...");
    // No truncate via JS client — use .delete() with an always-true filter.
    // Order: child tables first.
    const tables = [
      "match_audit_events",
      "historical_match_fall_of_wickets",
      "historical_match_bowling",
      "historical_match_batting",
      "balls",
      "innings",
      "match_players",
      "team_players",
      "matches",
      "players",
      "teams",
      "tournaments",
    ] as const;
    for (const t of tables) {
      const { error } = await supabase.from(t).delete().not("id", "is", null);
      if (error) {
        console.error(`  ! ${t}: ${error.message}`);
        process.exit(1);
      }
      console.log(`  cleared ${t}`);
    }
    console.log();
  }

  // cricheroes_id (string) -> uuid (string)
  const tournamentIds = new Map<string, string>();
  // teams are keyed by COMPOSITE "<cricheroes_tournament_id>:<cricheroes_team_id>"
  // because cricheroes reuses team IDs across tournaments (e.g. Hoysala Hunters
  // has the same team_id in all seasons it appeared in). Our schema gives each
  // tournament-team pair its own UUID, so this map preserves the disambiguation.
  const teamIds = new Map<string, string>();
  const teamKey = (tournamentId: string, teamId: string): string => `${tournamentId}:${teamId}`;
  const playerIds = new Map<string, string>();
  const matchIds = new Map<string, string>();
  // match_id -> cricheroes_tournament_id, so match_players + innings can resolve
  // teams via the composite key without re-parsing matches.csv.
  const matchToTournament = new Map<string, string>();

  // ----- 1. tournaments -----
  const tournaments = readCsv("tournaments.csv");
  console.log(`[1/10] tournaments  (${tournaments.length} rows)`);
  for (const t of tournaments) {
    const { data, error } = await supabase
      .from("tournaments")
      .insert({
        name: t.name,
        slug: t.slug,
        description: strOrNull(t.description),
        format: t.format as "league" | "knockout" | "group_then_knockout" | "round_robin_playoff_final",
        default_overs_per_innings: intOrNull(t.default_overs_per_innings) ?? 6,
        default_players_per_side: intOrNull(t.default_players_per_side) ?? 6,
        start_date: strOrNull(t.start_date),
        end_date: strOrNull(t.end_date),
        venue: strOrNull(t.venue),
        logo_url: strOrNull(t.logo_url),
        status: t.status as "draft" | "active" | "completed" | "archived",
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error(`  ! ${t.name}: ${error?.message}`);
      process.exit(1);
    }
    tournamentIds.set(t.cricheroes_tournament_id, data.id);
  }
  console.log(`      inserted: ${tournamentIds.size}\n`);

  // ----- 2. teams -----
  const teams = readCsv("teams.csv");
  console.log(`[2/10] teams        (${teams.length} rows)`);
  for (const tm of teams) {
    const tournamentId = tournamentIds.get(tm.cricheroes_tournament_id);
    if (!tournamentId) { console.warn(`  ! orphan team ${tm.name}`); continue; }
    // teams.csv stores just the cricheroes filename; prefix the canonical
    // media host so the column holds a directly-usable URL.
    let logoUrl: string | null = strOrNull(tm.logo_url);
    if (logoUrl && !logoUrl.startsWith("http")) {
      logoUrl = `https://media.cricheroes.in/team_logo/${logoUrl}`;
    }
    const { data, error } = await supabase
      .from("teams")
      .insert({
        tournament_id: tournamentId,
        name: tm.name,
        short_name: tm.short_name,
        logo_url: logoUrl,
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error(`  ! ${tm.name}: ${error?.message}`);
      process.exit(1);
    }
    teamIds.set(teamKey(tm.cricheroes_tournament_id, tm.cricheroes_team_id), data.id);
  }
  console.log(`      inserted: ${teamIds.size}\n`);

  // ----- 3. players (dedup by display_name, case-insensitive) -----
  const players = readCsv("players.csv");
  console.log(`[3/10] players      (${players.length} rows)`);
  let playerNew = 0;
  let playerLinked = 0;
  for (const p of players) {
    const { data: existing, error: lookupErr } = await supabase
      .from("players")
      .select("id")
      .ilike("display_name", p.display_name)
      .limit(1);
    if (lookupErr) {
      console.error(`  ! lookup ${p.display_name}: ${lookupErr.message}`);
      process.exit(1);
    }
    if (existing && existing.length) {
      playerIds.set(p.cricheroes_player_id, existing[0].id);
      playerLinked++;
      continue;
    }
    const category = intOrNull(p.category);
    const { data, error } = await supabase
      .from("players")
      .insert({
        display_name: p.display_name,
        batting_style: strOrNull(p.batting_style),
        bowling_style: strOrNull(p.bowling_style),
        category: category === 1 || category === 2 || category === 3 ? category : null,
        phone: strOrNull(p.phone),
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error(`  ! ${p.display_name}: ${error?.message}`);
      process.exit(1);
    }
    playerIds.set(p.cricheroes_player_id, data.id);
    playerNew++;
  }
  console.log(`      inserted: ${playerNew}, linked-to-existing: ${playerLinked}\n`);

  // ----- 4. matches -----
  // Inserted BEFORE match_players + innings so we can look up the
  // tournament_id for any match — needed because cricheroes_team_id is reused
  // across tournaments and team UUIDs must be resolved per (tournament, team).
  const matches = readCsv("matches.csv");
  console.log(`[4/10] matches      (${matches.length} rows)`);
  for (const m of matches) {
    const tournamentId = tournamentIds.get(m.cricheroes_tournament_id);
    const teamAId = teamIds.get(teamKey(m.cricheroes_tournament_id, m.cricheroes_team_a_id));
    const teamBId = teamIds.get(teamKey(m.cricheroes_tournament_id, m.cricheroes_team_b_id));
    if (!tournamentId || !teamAId || !teamBId) {
      console.warn(`  ! orphan match ${m.cricheroes_match_id}`);
      continue;
    }
    const tossDecision = strOrNull(m.toss_decision);
    const tossWinner = m.cricheroes_toss_winner_id
      ? teamIds.get(teamKey(m.cricheroes_tournament_id, m.cricheroes_toss_winner_id)) ?? null
      : null;
    const winner = m.cricheroes_winner_id
      ? teamIds.get(teamKey(m.cricheroes_tournament_id, m.cricheroes_winner_id)) ?? null
      : null;
    const { data, error } = await supabase
      .from("matches")
      .insert({
        tournament_id: tournamentId,
        match_number: intOrNull(m.match_number) ?? 0,
        team_a_id: teamAId,
        team_b_id: teamBId,
        scheduled_at: strOrNull(m.scheduled_at),
        started_at: strOrNull(m.started_at),
        ended_at: strOrNull(m.ended_at),
        venue: strOrNull(m.venue),
        overs_per_innings: intOrNull(m.overs_per_innings) ?? 6,
        players_per_side: intOrNull(m.players_per_side) ?? 6,
        toss_winner_id: tossWinner,
        toss_decision: tossDecision === "bat" || tossDecision === "bowl" ? tossDecision : null,
        stage: m.stage as "group" | "qualifier" | "qualifier_1" | "eliminator" | "qualifier_2" | "quarter" | "semi" | "final" | "exhibition",
        status: m.status as "scheduled" | "live" | "innings_break" | "completed" | "abandoned",
        result_type: strOrNull(m.result_type) as "normal" | "tie" | "super_over" | "no_result" | "abandoned" | null,
        winner_id: winner,
        win_margin: strOrNull(m.win_margin),
        player_of_match_id: playerIds.get(m.cricheroes_pom_player_id) ?? null,
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error(`  ! match ${m.cricheroes_match_id}: ${error?.message}`);
      process.exit(1);
    }
    matchIds.set(m.cricheroes_match_id, data.id);
    matchToTournament.set(m.cricheroes_match_id, m.cricheroes_tournament_id);
  }
  console.log(`      inserted: ${matchIds.size}\n`);

  // ----- 5. match_players -----
  const matchPlayers = readCsv("match_players.csv");
  console.log(`[5/10] match_players (${matchPlayers.length} rows)`);
  let mpCount = 0;
  let mpSkip = 0;
  for (const mp of matchPlayers) {
    const matchId = matchIds.get(mp.cricheroes_match_id);
    const tournamentRef = matchToTournament.get(mp.cricheroes_match_id);
    const teamId = tournamentRef ? teamIds.get(teamKey(tournamentRef, mp.cricheroes_team_id)) : undefined;
    const playerId = playerIds.get(mp.cricheroes_player_id);
    if (!matchId || !teamId || !playerId) { mpSkip++; continue; }
    const battingOrder = intOrNull(mp.batting_order);
    const { error } = await supabase
      .from("match_players")
      .insert({
        match_id: matchId,
        team_id: teamId,
        player_id: playerId,
        batting_order: battingOrder,
        is_captain: bool(mp.is_captain),
        is_keeper: bool(mp.is_keeper),
        is_substitute: bool(mp.is_substitute),
      });
    if (error) {
      if (error.message.includes("duplicate")) { mpSkip++; continue; }
      console.error(`  ! match_player: ${error.message}`);
      process.exit(1);
    }
    mpCount++;
  }
  console.log(`      inserted: ${mpCount}, skipped (dup/orphan): ${mpSkip}\n`);

  // ----- 6. innings -----
  const innings = readCsv("innings.csv");
  console.log(`[6/10] innings      (${innings.length} rows)`);
  let inCount = 0;
  for (const ing of innings) {
    const matchId = matchIds.get(ing.cricheroes_match_id);
    const tournamentRef = matchToTournament.get(ing.cricheroes_match_id);
    const battingTeamId = tournamentRef ? teamIds.get(teamKey(tournamentRef, ing.cricheroes_batting_team_id)) : undefined;
    const bowlingTeamId = tournamentRef ? teamIds.get(teamKey(tournamentRef, ing.cricheroes_bowling_team_id)) : undefined;
    if (!matchId || !battingTeamId || !bowlingTeamId) {
      console.warn(`  ! orphan innings (match ${ing.cricheroes_match_id})`);
      continue;
    }
    const { error } = await supabase
      .from("innings")
      .insert({
        match_id: matchId,
        innings_number: intOrNull(ing.innings_number) ?? 0,
        batting_team_id: battingTeamId,
        bowling_team_id: bowlingTeamId,
        total_runs: intOrNull(ing.total_runs) ?? 0,
        total_wickets: intOrNull(ing.total_wickets) ?? 0,
        total_legal_balls: intOrNull(ing.total_legal_balls) ?? 0,
        extras_wides: intOrNull(ing.extras_wides) ?? 0,
        extras_no_balls: intOrNull(ing.extras_no_balls) ?? 0,
        extras_byes: intOrNull(ing.extras_byes) ?? 0,
        extras_leg_byes: intOrNull(ing.extras_leg_byes) ?? 0,
        extras_penalty: intOrNull(ing.extras_penalty) ?? 0,
        target: intOrNull(ing.target),
        is_complete: true,
        started_at: strOrNull(ing.started_at),
        ended_at: strOrNull(ing.ended_at),
      });
    if (error) {
      console.error(`  ! innings (match ${ing.cricheroes_match_id}, #${ing.innings_number}): ${error.message}`);
      continue;
    }
    inCount++;
  }
  console.log(`      inserted: ${inCount}\n`);

  // ----- 7. team_players (derived from match_players via SQL) -----
  // The CSV team_players.csv is unreliable because cricheroes reuses team_id
  // across tournaments and the scraper deduped (team_id, player_id). The
  // truthful source is match_players: a player belongs to a team in a
  // tournament IFF they appeared in a match for that team in that tournament.
  console.log(`[7/10] team_players (derived from match_players)`);
  // Read all match_players we just inserted and dedupe per (team, player).
  // Role precedence: captain > wicket_keeper > player.
  const { data: mpRows, error: mpRowsErr } = await supabase
    .from("match_players")
    .select("team_id, player_id, is_captain, is_keeper");
  if (mpRowsErr) {
    console.error(`  ! reading match_players back: ${mpRowsErr.message}`);
    process.exit(1);
  }
  // Aggregate per (team, player): role = captain > wicket_keeper > player
  const roleByPair = new Map<string, "captain" | "wicket_keeper" | "player">();
  for (const r of mpRows ?? []) {
    const k = `${r.team_id}:${r.player_id}`;
    const cur = roleByPair.get(k);
    let role: "captain" | "wicket_keeper" | "player" = "player";
    if (r.is_captain) role = "captain";
    else if (r.is_keeper) role = "wicket_keeper";
    // upgrade only
    if (!cur || (role === "captain") || (role === "wicket_keeper" && cur === "player")) {
      roleByPair.set(k, role);
    }
  }
  let tpCount = 0;
  for (const [pair, role] of roleByPair) {
    const [teamId, playerId] = pair.split(":");
    const { error } = await supabase
      .from("team_players")
      .insert({ team_id: teamId, player_id: playerId, role });
    if (error) {
      if (error.message.includes("duplicate")) continue;
      console.error(`  ! team_player (${pair}): ${error.message}`);
      process.exit(1);
    }
    tpCount++;
  }
  console.log(`      inserted: ${tpCount}\n`);

  // ----- 8. historical_match_batting -----
  // Per-batter per-innings aggregates for matches with no ball-by-ball
  // (which is all the cricheroes-imported ones, since cricheroes doesn't
  // expose complete ball data for these matches).
  const histBatting = readCsv("historical_batting.csv");
  console.log(`[8/10] historical_match_batting  (${histBatting.length} rows)`);
  let hbCount = 0, hbSkip = 0;
  for (const r of histBatting) {
    const matchId = matchIds.get(r.cricheroes_match_id);
    const tournamentRef = matchToTournament.get(r.cricheroes_match_id);
    const battingTeamId = tournamentRef
      ? teamIds.get(teamKey(tournamentRef, r.cricheroes_team_id))
      : undefined;
    const playerId = playerIds.get(r.cricheroes_player_id) ?? null;
    if (!matchId || !battingTeamId) { hbSkip++; continue; }
    const { error } = await supabase
      .from("historical_match_batting")
      .insert({
        match_id: matchId,
        innings_number: intOrNull(r.innings_number) ?? 0,
        batting_team_id: battingTeamId,
        player_id: playerId,
        player_name: r.name,
        batting_order: intOrNull(r.batting_order),
        is_captain: bool(r.is_captain),
        runs: intOrNull(r.runs) ?? 0,
        balls_faced: intOrNull(r.balls) ?? 0,
        minutes: intOrNull(r.minutes),
        fours: intOrNull(r.fours) ?? 0,
        sixes: intOrNull(r.sixes) ?? 0,
        strike_rate: r.strike_rate ? Number(r.strike_rate) : null,
        batting_hand: strOrNull(r.batting_hand),
        how_to_out: strOrNull(r.how_to_out),
        is_out: bool(r.is_out),
      });
    if (error) {
      if (error.message.includes("duplicate")) { hbSkip++; continue; }
      console.error(`  ! historical_batting (match ${r.cricheroes_match_id}, inn ${r.innings_number}): ${error.message}`);
      process.exit(1);
    }
    hbCount++;
  }
  console.log(`       inserted: ${hbCount}, skipped: ${hbSkip}\n`);

  // ----- 9. historical_match_bowling -----
  // CSV has cricheroes_team_id = the BOWLING team (the team the bowlers
  // belong to), not the batting team — already correct.
  const histBowling = readCsv("historical_bowling.csv");
  console.log(`[9/10] historical_match_bowling  (${histBowling.length} rows)`);
  let hwCount = 0, hwSkip = 0;
  for (const r of histBowling) {
    const matchId = matchIds.get(r.cricheroes_match_id);
    const tournamentRef = matchToTournament.get(r.cricheroes_match_id);
    const bowlingTeamId = tournamentRef
      ? teamIds.get(teamKey(tournamentRef, r.cricheroes_team_id))
      : undefined;
    const playerId = playerIds.get(r.cricheroes_player_id) ?? null;
    if (!matchId || !bowlingTeamId) { hwSkip++; continue; }
    const { error } = await supabase
      .from("historical_match_bowling")
      .insert({
        match_id: matchId,
        innings_number: intOrNull(r.innings_number) ?? 0,
        bowling_team_id: bowlingTeamId,
        player_id: playerId,
        player_name: r.name,
        bowling_order: intOrNull(r.bowling_order),
        overs: r.overs ? Number(r.overs) : 0,
        maidens: intOrNull(r.maidens) ?? 0,
        runs: intOrNull(r.runs) ?? 0,
        wickets: intOrNull(r.wickets) ?? 0,
        dots: intOrNull(r.dots) ?? 0,
        fours_conceded: intOrNull(r.fours_conceded) ?? 0,
        sixes_conceded: intOrNull(r.sixes_conceded) ?? 0,
        wides: intOrNull(r.wides) ?? 0,
        noballs: intOrNull(r.noballs) ?? 0,
        economy_rate: r.economy_rate ? Number(r.economy_rate) : null,
      });
    if (error) {
      if (error.message.includes("duplicate")) { hwSkip++; continue; }
      console.error(`  ! historical_bowling (match ${r.cricheroes_match_id}, inn ${r.innings_number}): ${error.message}`);
      process.exit(1);
    }
    hwCount++;
  }
  console.log(`       inserted: ${hwCount}, skipped: ${hwSkip}\n`);

  // ----- 10. historical_match_fall_of_wickets -----
  const histFow = readCsv("fall_of_wickets.csv");
  console.log(`[10/10] historical_match_fall_of_wickets  (${histFow.length} rows)`);
  let hfCount = 0, hfSkip = 0;
  for (const r of histFow) {
    const matchId = matchIds.get(r.cricheroes_match_id);
    const tournamentRef = matchToTournament.get(r.cricheroes_match_id);
    const battingTeamId = tournamentRef
      ? teamIds.get(teamKey(tournamentRef, r.cricheroes_batting_team_id))
      : undefined;
    const dismissPlayerId = r.cricheroes_dismiss_player_id
      ? playerIds.get(r.cricheroes_dismiss_player_id) ?? null
      : null;
    if (!matchId || !battingTeamId) { hfSkip++; continue; }
    const { error } = await supabase
      .from("historical_match_fall_of_wickets")
      .insert({
        match_id: matchId,
        innings_number: intOrNull(r.innings_number) ?? 0,
        batting_team_id: battingTeamId,
        wicket_no: intOrNull(r.wicket_no) ?? 0,
        run_at_fall: intOrNull(r.run_at_fall) ?? 0,
        over_at_fall: r.over_at_fall ? Number(r.over_at_fall) : null,
        dismiss_player_id: dismissPlayerId,
        dismiss_player_name: strOrNull(r.dismiss_player_name),
      });
    if (error) {
      if (error.message.includes("duplicate")) { hfSkip++; continue; }
      console.error(`  ! historical_fow (match ${r.cricheroes_match_id}, inn ${r.innings_number}, wkt ${r.wicket_no}): ${error.message}`);
      process.exit(1);
    }
    hfCount++;
  }
  console.log(`        inserted: ${hfCount}, skipped: ${hfSkip}\n`);

  console.log("DONE");
  console.log(`  tournaments:                       ${tournamentIds.size}`);
  console.log(`  teams:                             ${teamIds.size}`);
  console.log(`  players:                           ${playerIds.size}  (${playerNew} new, ${playerLinked} linked-to-existing)`);
  console.log(`  team_players:                      ${tpCount}`);
  console.log(`  matches:                           ${matchIds.size}`);
  console.log(`  match_players:                     ${mpCount}`);
  console.log(`  innings:                           ${inCount}`);
  console.log(`  historical_match_batting:          ${hbCount}`);
  console.log(`  historical_match_bowling:          ${hwCount}`);
  console.log(`  historical_match_fall_of_wickets:  ${hfCount}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
