/*
 * One-off: auto-assign a scorer to each S7 match such that
 *   (a) the scorer's affiliated team is NOT playing in that match, and
 *   (b) matches are distributed as equally as possible across the
 *       tournament's scorer pool.
 *
 * The greedy algorithm walks matches in match_number order and
 * picks the eligible scorer with the lowest current assignment
 * count, breaking ties by display_name for determinism. This is
 * fair within the constraint and easy to reason about; it's not
 * a globally optimal min-makespan assignment but for ~7 scorers
 * × 21 matches the spread is close enough that the optimal-vs-
 * greedy gap is at most 1 match per scorer.
 *
 * Reads scorer affiliations from:
 *   tournament_admins.user_id      (role='scorer')
 *   → players (linked_user_id == that user_id)
 *   → team_players (player_id ↔ team_id, scoped to the S7 teams)
 *
 * Run with:
 *   DEV_SERVICE_ROLE=... pnpm tsx scripts/assign-scorers-s7.ts --dry-run --env=prod
 *   DEV_SERVICE_ROLE=... pnpm tsx scripts/assign-scorers-s7.ts --execute --env=prod
 *
 * Defaults to dry-run; --execute is required to write.
 */

import { createClient } from "@supabase/supabase-js";

const PROD_URL = "https://cxysyglwooqmzcfvtmyl.supabase.co";
const DEV_URL = "https://clqdimzthzcpurtwhtej.supabase.co";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const envArg = args.find((a) => a.startsWith("--env="));
const env = envArg ? envArg.split("=")[1] : "prod";
const slugArg = args.find((a) => a.startsWith("--slug="));
const tournamentSlug = slugArg
  ? slugArg.split("=")[1]
  : env === "prod"
    ? "hvc-season-7"
    : "hvc-season-7-test";

const url = env === "prod" ? PROD_URL : DEV_URL;
const svc =
  env === "prod"
    ? process.env.PROD_SERVICE_ROLE
    : process.env.DEV_SERVICE_ROLE;
if (!svc) {
  console.error(
    `Missing ${env === "prod" ? "PROD_SERVICE_ROLE" : "DEV_SERVICE_ROLE"} env. Run with: ${env === "prod" ? "PROD_SERVICE_ROLE" : "DEV_SERVICE_ROLE"}=... pnpm tsx scripts/assign-scorers-s7.ts`,
  );
  process.exit(1);
}

const sb = createClient(url, svc, { auth: { persistSession: false } });

async function main() {
  console.log(
    `=== env=${env} · slug=${tournamentSlug} · ${execute ? "EXECUTE" : "DRY RUN"} ===\n`,
  );

  // 1) Tournament + scorers
  const { data: tournament, error: tErr } = await sb
    .from("tournaments")
    .select("id, name")
    .eq("slug", tournamentSlug)
    .single();
  if (tErr || !tournament)
    throw new Error(`Tournament "${tournamentSlug}" not found`);

  // Include organizers in the eligible pool too — they can score
  // any match where their own team isn't playing, which lightens
  // the load on dedicated scorers. The team-conflict filter below
  // still applies, so an organizer who's also a player won't end
  // up assigned to their own team's match.
  const { data: scorerAdmins, error: aErr } = await sb
    .from("tournament_admins")
    .select("user_id, role")
    .eq("tournament_id", tournament.id)
    .in("role", ["scorer", "organizer"]);
  if (aErr) throw new Error(`Failed to read scorers: ${aErr.message}`);
  if (!scorerAdmins || scorerAdmins.length === 0)
    throw new Error("No scorers / organizers configured on this tournament");

  // Dedupe — a user could appear under both organizer + scorer rows
  // for the same tournament; we only want them in the pool once.
  const scorerUserIds = Array.from(
    new Set(scorerAdmins.map((s) => s.user_id)),
  );
  const { data: profiles, error: pErr } = await sb
    .from("profiles")
    .select("id, display_name")
    .in("id", scorerUserIds);
  if (pErr) throw new Error(`Failed to read profiles: ${pErr.message}`);
  const nameByUserId = new Map(
    (profiles ?? []).map((p) => [p.id, p.display_name]),
  );

  // 2) Map each scorer's user_id to the team(s) they play on in this
  // tournament. A scorer who isn't a player in this tournament has no
  // team affiliation and is eligible for ANY match.
  const { data: players } = await sb
    .from("players")
    .select("id, linked_user_id")
    .in("linked_user_id", scorerUserIds);
  const playerIdByUserId = new Map(
    (players ?? []).map((p) => [p.linked_user_id!, p.id]),
  );

  const { data: teams } = await sb
    .from("teams")
    .select("id, name, short_name")
    .eq("tournament_id", tournament.id);
  const teamIds = (teams ?? []).map((t) => t.id);

  const { data: teamPlayers } = await sb
    .from("team_players")
    .select("player_id, team_id")
    .in("team_id", teamIds);
  const teamByPlayerId = new Map(
    (teamPlayers ?? []).map((r) => [r.player_id, r.team_id]),
  );

  type Scorer = {
    userId: string;
    name: string;
    teamId: string | null; // null = not a player in this tournament
  };
  const scorers: Scorer[] = scorerUserIds.map((uid) => {
    const playerId = playerIdByUserId.get(uid);
    return {
      userId: uid,
      name: nameByUserId.get(uid) ?? "(unknown)",
      teamId: playerId ? teamByPlayerId.get(playerId) ?? null : null,
    };
  });

  console.log(`Scorers (${scorers.length}):`);
  for (const s of scorers) {
    const teamLabel = s.teamId
      ? (teams ?? []).find((t) => t.id === s.teamId)?.short_name ?? "?"
      : "—";
    console.log(`  ${s.name.padEnd(28)} team=${teamLabel}`);
  }
  console.log("");

  // 3) Matches in order
  const { data: matches, error: mErr } = await sb
    .from("matches")
    .select("id, match_number, team_a_id, team_b_id, scorer, status")
    .eq("tournament_id", tournament.id)
    .order("match_number", { ascending: true });
  if (mErr || !matches)
    throw new Error(`Failed to read matches: ${mErr?.message}`);
  console.log(`Matches: ${matches.length}\n`);

  // 4) Greedy assignment
  const count = new Map<string, number>(scorers.map((s) => [s.userId, 0]));
  type Plan = {
    matchId: string;
    matchNumber: number;
    chosenName: string | null;
    chosenUserId: string | null;
    reason?: string;
  };
  const plan: Plan[] = [];

  for (const m of matches) {
    // Skip matches already in progress / done — don't trample real
    // history. Still log them for visibility.
    if (m.status !== "scheduled") {
      plan.push({
        matchId: m.id,
        matchNumber: m.match_number,
        chosenName: m.scorer,
        chosenUserId: null,
        reason: `status=${m.status} — left unchanged`,
      });
      continue;
    }

    const eligible = scorers.filter(
      (s) => s.teamId !== m.team_a_id && s.teamId !== m.team_b_id,
    );
    if (eligible.length === 0) {
      plan.push({
        matchId: m.id,
        matchNumber: m.match_number,
        chosenName: null,
        chosenUserId: null,
        reason: "no eligible scorer (every scorer is on a playing team)",
      });
      continue;
    }

    // Pick lowest-count, tie-broken by name (deterministic).
    eligible.sort((a, b) => {
      const ca = count.get(a.userId) ?? 0;
      const cb = count.get(b.userId) ?? 0;
      if (ca !== cb) return ca - cb;
      return a.name.localeCompare(b.name);
    });
    const picked = eligible[0];
    count.set(picked.userId, (count.get(picked.userId) ?? 0) + 1);
    plan.push({
      matchId: m.id,
      matchNumber: m.match_number,
      chosenName: picked.name,
      chosenUserId: picked.userId,
    });
  }

  console.log("Plan:");
  for (const p of plan) {
    const tag = p.reason ? `   (${p.reason})` : "";
    console.log(
      `  #${String(p.matchNumber).padStart(2)} → ${(p.chosenName ?? "—").padEnd(28)}${tag}`,
    );
  }

  console.log("\nLoad per scorer:");
  const loadEntries = Array.from(count.entries()).map(([uid, c]) => ({
    name: nameByUserId.get(uid) ?? uid.slice(0, 8),
    count: c,
  }));
  loadEntries.sort((a, b) => b.count - a.count);
  for (const e of loadEntries) {
    console.log(`  ${e.name.padEnd(28)} ${e.count}`);
  }

  if (!execute) {
    console.log("\n(dry run — re-run with --execute to write)");
    return;
  }

  console.log("\n=== Writing assignments ===");
  let written = 0;
  for (const p of plan) {
    if (!p.chosenName || p.reason) continue;
    const { error } = await sb
      .from("matches")
      .update({ scorer: p.chosenName })
      .eq("id", p.matchId);
    if (error) {
      console.error(`  ! match #${p.matchNumber}: ${error.message}`);
    } else {
      written += 1;
    }
  }
  console.log(`✓ wrote ${written} scorer assignments`);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
