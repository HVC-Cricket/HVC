/*
 * One-off: copy HVC Season 7 tournament + teams + team_players +
 * matches from prod to dev so the scoring flow can be rehearsed
 * before the May 23 kickoff.
 *
 * Strategy:
 *   - Fresh UUIDs for the tournament + the 7 teams.
 *   - For every player on the S7 squads: reuse an existing dev row
 *     when a normalized display_name match exists, else INSERT a new
 *     player. linked_user_id is always nulled — prod's auth users
 *     don't exist on dev.
 *   - team_players + matches are rewritten with the new dev IDs.
 *   - Tournament `created_by` is set to the dev super-admin
 *     (Pavan Gautham). The dev row is renamed to "HVC - SEASON 7
 *     (Dev Test)" + slug "hvc-season-7-test" so it can't be
 *     confused with the prod row.
 *
 * Run with:
 *   pnpm tsx scripts/copy-s7-prod-to-dev.ts
 *
 * Idempotency: aborts cleanly if a tournament with the dev slug
 * already exists. Re-running after a partial failure: delete the
 * dev tournament row manually first (cascades to teams + matches).
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const PROD_URL = "https://cxysyglwooqmzcfvtmyl.supabase.co";
const PROD_SVC = process.env.PROD_SERVICE_ROLE!;
const DEV_URL = "https://clqdimzthzcpurtwhtej.supabase.co";
const DEV_SVC = process.env.DEV_SERVICE_ROLE!;

const PROD_S7_ID = "4826feda-2246-4759-ba53-8d8e1701ba25";
const DEV_TOURNAMENT_NAME = "HVC - SEASON 7 (Dev Test)";
const DEV_TOURNAMENT_SLUG = "hvc-season-7-test";
const DEV_CREATED_BY = "26029739-693a-4602-b2f9-336bb0581424"; // Pavan Gautham super-admin

if (!PROD_SVC || !DEV_SVC) {
  console.error(
    "Missing env. Run with: PROD_SERVICE_ROLE=... DEV_SERVICE_ROLE=... pnpm tsx scripts/copy-s7-prod-to-dev.ts",
  );
  process.exit(1);
}

const prod = createClient(PROD_URL, PROD_SVC, {
  auth: { persistSession: false },
});
const dev = createClient(DEV_URL, DEV_SVC, { auth: { persistSession: false } });

const norm = (s: string) => s.trim().toLowerCase();

async function main() {
  console.log("=== STAGE 1: Pull from prod ===");
  const { data: tournament, error: tErr } = await prod
    .from("tournaments")
    .select("*")
    .eq("id", PROD_S7_ID)
    .single();
  if (tErr || !tournament) throw new Error(`Failed to read S7: ${tErr?.message}`);
  console.log(`  tournament: ${tournament.name}`);

  const { data: teams, error: teamsErr } = await prod
    .from("teams")
    .select("id, name, short_name, logo_url")
    .eq("tournament_id", PROD_S7_ID);
  if (teamsErr || !teams) throw new Error(`Failed to read teams: ${teamsErr?.message}`);
  console.log(`  teams: ${teams.length}`);

  const prodTeamIds = teams.map((t) => t.id);
  const { data: teamPlayers, error: tpErr } = await prod
    .from("team_players")
    .select("team_id, player_id, role")
    .in("team_id", prodTeamIds);
  if (tpErr || !teamPlayers) throw new Error(`Failed to read team_players: ${tpErr?.message}`);
  console.log(`  team_players: ${teamPlayers.length}`);

  const prodPlayerIds = Array.from(new Set(teamPlayers.map((r) => r.player_id)));
  const { data: prodPlayers, error: pErr } = await prod
    .from("players")
    .select("id, display_name, category, photo_url")
    .in("id", prodPlayerIds);
  if (pErr || !prodPlayers) throw new Error(`Failed to read players: ${pErr?.message}`);
  console.log(`  unique players: ${prodPlayers.length}`);

  const { data: matches, error: mErr } = await prod
    .from("matches")
    .select(
      "match_number, stage, status, team_a_id, team_b_id, scheduled_at, venue, overs_per_innings, players_per_side, toss_winner_id, toss_decision, format_overrides, rules_override",
    )
    .eq("tournament_id", PROD_S7_ID)
    .order("match_number", { ascending: true });
  if (mErr || !matches) throw new Error(`Failed to read matches: ${mErr?.message}`);
  console.log(`  matches: ${matches.length}`);

  console.log("\n=== STAGE 2: Check dev for collisions ===");
  const { data: existing } = await dev
    .from("tournaments")
    .select("id")
    .eq("slug", DEV_TOURNAMENT_SLUG)
    .maybeSingle();
  if (existing) {
    console.error(
      `  ✗ Dev already has a tournament with slug "${DEV_TOURNAMENT_SLUG}" (${existing.id}). Delete it first or pick a different slug.`,
    );
    process.exit(1);
  }
  console.log("  ✓ slug free");

  const { data: devPlayers, error: dpErr } = await dev
    .from("players")
    .select("id, display_name");
  if (dpErr || !devPlayers) throw new Error(`Failed to read dev players: ${dpErr?.message}`);
  const devByName = new Map(devPlayers.map((p) => [norm(p.display_name), p.id]));

  console.log("\n=== STAGE 3: Map players (prod → dev) ===");
  const playerIdMap = new Map<string, string>();
  const playersToInsert: Array<{
    id: string;
    display_name: string;
    category: number | null;
    photo_url: string | null;
  }> = [];
  for (const p of prodPlayers) {
    const hit = devByName.get(norm(p.display_name));
    if (hit) {
      playerIdMap.set(p.id, hit);
    } else {
      const newId = randomUUID();
      playerIdMap.set(p.id, newId);
      playersToInsert.push({
        id: newId,
        display_name: p.display_name,
        category: p.category,
        photo_url: p.photo_url,
      });
    }
  }
  console.log(
    `  reused: ${prodPlayers.length - playersToInsert.length} | new: ${playersToInsert.length}`,
  );

  if (playersToInsert.length > 0) {
    const { error } = await dev.from("players").insert(playersToInsert);
    if (error) throw new Error(`Insert players failed: ${error.message}`);
    console.log(`  ✓ inserted ${playersToInsert.length} new players`);
  }

  console.log("\n=== STAGE 4: Mint dev tournament + team IDs ===");
  const devTournamentId = randomUUID();
  const teamIdMap = new Map<string, string>();
  for (const t of teams) teamIdMap.set(t.id, randomUUID());

  const devTournament = {
    id: devTournamentId,
    name: DEV_TOURNAMENT_NAME,
    slug: DEV_TOURNAMENT_SLUG,
    description: tournament.description,
    format: tournament.format,
    default_overs_per_innings: tournament.default_overs_per_innings,
    default_players_per_side: tournament.default_players_per_side,
    start_date: tournament.start_date,
    end_date: tournament.end_date,
    venue: tournament.venue,
    rules: tournament.rules,
    logo_url: tournament.logo_url,
    banner_url: tournament.banner_url,
    status: tournament.status,
    created_by: DEV_CREATED_BY,
  };

  const { error: ti } = await dev.from("tournaments").insert(devTournament);
  if (ti) throw new Error(`Insert tournament failed: ${ti.message}`);
  console.log(`  ✓ tournament: ${devTournamentId}`);

  const devTeams = teams.map((t) => ({
    id: teamIdMap.get(t.id)!,
    tournament_id: devTournamentId,
    name: t.name,
    short_name: t.short_name,
    logo_url: t.logo_url,
  }));
  const { error: tIns } = await dev.from("teams").insert(devTeams);
  if (tIns) throw new Error(`Insert teams failed: ${tIns.message}`);
  console.log(`  ✓ teams: ${devTeams.length}`);

  console.log("\n=== STAGE 5: team_players + matches ===");
  const devTeamPlayers = teamPlayers.map((r) => ({
    team_id: teamIdMap.get(r.team_id)!,
    player_id: playerIdMap.get(r.player_id)!,
    role: r.role,
  }));
  const { error: tpIns } = await dev.from("team_players").insert(devTeamPlayers);
  if (tpIns) throw new Error(`Insert team_players failed: ${tpIns.message}`);
  console.log(`  ✓ team_players: ${devTeamPlayers.length}`);

  const devMatches = matches.map((m) => ({
    tournament_id: devTournamentId,
    match_number: m.match_number,
    stage: m.stage,
    status: m.status,
    team_a_id: teamIdMap.get(m.team_a_id)!,
    team_b_id: teamIdMap.get(m.team_b_id)!,
    scheduled_at: m.scheduled_at,
    venue: m.venue,
    overs_per_innings: m.overs_per_innings,
    players_per_side: m.players_per_side,
    toss_winner_id: m.toss_winner_id ? teamIdMap.get(m.toss_winner_id) : null,
    toss_decision: m.toss_decision,
    format_overrides: m.format_overrides,
    rules_override: m.rules_override,
  }));
  const { error: mIns } = await dev.from("matches").insert(devMatches);
  if (mIns) throw new Error(`Insert matches failed: ${mIns.message}`);
  console.log(`  ✓ matches: ${devMatches.length}`);

  console.log("\n=== DONE ===");
  console.log(`Dev: /tournaments/${DEV_TOURNAMENT_SLUG}`);
  console.log(`Tournament id: ${devTournamentId}`);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
