/*
 * One-off: schedule Qualifier 1 + Eliminator real match rows for
 * HVC S7 once the league phase is complete. Reads standings from
 * `v_points_table` + the same NRR formula `computeStandings()` uses
 * (Pts desc, NRR desc, deterministic tiebreak by team_id).
 *
 * Pairings:
 *   Qualifier 1: standings[0] vs standings[1] (1st vs 2nd)
 *   Eliminator:  standings[2] vs standings[3] (3rd vs 4th)
 *
 * Status=scheduled, no scheduled_at, no umpires / scorer — the
 * organizer fills those via the existing edit-match form.
 * Qualifier 2 + Final are NOT created here (they depend on the
 * outcomes of these two and will be scheduled later).
 *
 * Aborts if either match already exists for this tournament so a
 * second run is a no-op.
 *
 * Run with:
 *   PROD_SERVICE_ROLE=... pnpm tsx scripts/schedule-playoffs-s7.ts --env=prod
 *   PROD_SERVICE_ROLE=... pnpm tsx scripts/schedule-playoffs-s7.ts --env=prod --execute
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
    `Missing ${env === "prod" ? "PROD_SERVICE_ROLE" : "DEV_SERVICE_ROLE"} env. Run with: ${env === "prod" ? "PROD_SERVICE_ROLE" : "DEV_SERVICE_ROLE"}=... pnpm tsx scripts/schedule-playoffs-s7.ts`,
  );
  process.exit(1);
}

const sb = createClient(url, svc, { auth: { persistSession: false } });

async function main() {
  console.log(
    `=== env=${env} · slug=${tournamentSlug} · ${execute ? "EXECUTE" : "DRY RUN"} ===\n`,
  );

  const { data: tournament, error: tErr } = await sb
    .from("tournaments")
    .select("id, name, format, default_overs_per_innings, default_players_per_side")
    .eq("slug", tournamentSlug)
    .single();
  if (tErr || !tournament)
    throw new Error(`Tournament "${tournamentSlug}" not found`);
  if (tournament.format !== "round_robin_playoff_final") {
    throw new Error(
      `Tournament format is ${tournament.format}; this script only schedules round-robin-playoff brackets`,
    );
  }

  // Verify league complete.
  const { data: matches, error: mErr } = await sb
    .from("matches")
    .select("id, match_number, stage, status, team_a_id, team_b_id")
    .eq("tournament_id", tournament.id)
    .order("match_number", { ascending: true });
  if (mErr || !matches)
    throw new Error(`Failed to read matches: ${mErr?.message}`);
  const group = matches.filter((m) => m.stage === "group");
  const allGroupDone =
    group.length > 0 && group.every((m) => m.status === "completed");
  if (!allGroupDone) {
    throw new Error(
      `League phase not complete: ${group.filter((m) => m.status !== "completed").length} group matches still ${"pending"}`,
    );
  }
  const existingPlayoffs = matches.filter((m) =>
    ["qualifier_1", "eliminator", "qualifier_2", "final"].includes(m.stage),
  );
  if (existingPlayoffs.length > 0) {
    console.log("Already scheduled — nothing to do:");
    for (const m of existingPlayoffs) {
      console.log(`  #${m.match_number} ${m.stage} ${m.status}`);
    }
    return;
  }

  // Pull standings via v_points_table + compute NRR for tiebreak —
  // mirrors src/lib/standings.ts. Kept inline so this script doesn't
  // pull the Next.js server-only `createClient` indirectly.
  const { data: points } = await sb
    .from("v_points_table")
    .select("team_id, played, won, lost, tied, no_results, points")
    .eq("tournament_id", tournament.id);
  const { data: matchMeta } = await sb
    .from("matches")
    .select("id, status, result_type, players_per_side, overs_per_innings")
    .eq("tournament_id", tournament.id)
    .eq("stage", "group")
    .eq("status", "completed");
  const decidedMatches = (matchMeta ?? []).filter(
    (m) => m.result_type !== "no_result" && m.result_type !== "abandoned",
  );
  const matchById = new Map(decidedMatches.map((m) => [m.id, m]));
  const decidedIds = new Set(decidedMatches.map((m) => m.id));
  const { data: innings } = await sb
    .from("innings")
    .select(
      "match_id, innings_number, batting_team_id, bowling_team_id, total_runs, total_wickets, total_legal_balls, matches!innings_match_id_fkey!inner(tournament_id, status, stage)",
    )
    .eq("matches.tournament_id", tournament.id)
    .eq("matches.status", "completed")
    .eq("matches.stage", "group")
    .lte("innings_number", 2);
  const inn = (innings ?? []).filter((i) => decidedIds.has(i.match_id));

  type Acc = {
    scored: number;
    faced: number;
    conceded: number;
    bowled: number;
  };
  const acc = new Map<string, Acc>();
  const bump = (id: string) => {
    let a = acc.get(id);
    if (!a) {
      a = { scored: 0, faced: 0, conceded: 0, bowled: 0 };
      acc.set(id, a);
    }
    return a;
  };
  for (const i of inn) {
    const m = matchById.get(i.match_id);
    if (!m) continue;
    const maxW = m.players_per_side - 1;
    const full = m.overs_per_innings * 6;
    const allOut = i.total_wickets >= maxW;
    const balls = allOut ? full : i.total_legal_balls;
    const bat = bump(i.batting_team_id);
    bat.scored += i.total_runs;
    bat.faced += balls;
    const bowl = bump(i.bowling_team_id);
    bowl.conceded += i.total_runs;
    bowl.bowled += balls;
  }
  const nrr = new Map<string, number>();
  for (const [tid, a] of acc) {
    const rs = a.faced > 0 ? (a.scored * 6) / a.faced : 0;
    const rc = a.bowled > 0 ? (a.conceded * 6) / a.bowled : 0;
    nrr.set(tid, rs - rc);
  }

  const standings = (points ?? [])
    .map((p) => ({ ...p, nrr: nrr.get(p.team_id) ?? 0 }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.nrr !== a.nrr) return b.nrr - a.nrr;
      return a.team_id.localeCompare(b.team_id);
    });

  if (standings.length < 4) {
    throw new Error(
      `Need at least 4 teams in standings; got ${standings.length}`,
    );
  }
  const top4 = standings.slice(0, 4);

  // Pretty print for confirmation.
  const { data: teams } = await sb
    .from("teams")
    .select("id, name, short_name")
    .in(
      "id",
      top4.map((s) => s.team_id),
    );
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]));
  console.log("Top 4 seeds:");
  for (let i = 0; i < 4; i++) {
    const s = top4[i];
    const t = teamById.get(s.team_id);
    console.log(
      `  ${i + 1}. ${t?.short_name?.padEnd(4) ?? "?"} ${(t?.name ?? "?").padEnd(28)} pts=${s.points} nrr=${s.nrr >= 0 ? "+" : ""}${s.nrr.toFixed(3)}`,
    );
  }
  console.log("");

  const lastNumber = matches.reduce(
    (max, m) => (m.match_number > max ? m.match_number : max),
    0,
  );
  const rows = [
    {
      tournament_id: tournament.id,
      match_number: lastNumber + 1,
      stage: "qualifier_1",
      team_a_id: top4[0].team_id,
      team_b_id: top4[1].team_id,
      status: "scheduled",
      overs_per_innings: tournament.default_overs_per_innings,
      players_per_side: tournament.default_players_per_side,
    },
    {
      tournament_id: tournament.id,
      match_number: lastNumber + 2,
      stage: "eliminator",
      team_a_id: top4[2].team_id,
      team_b_id: top4[3].team_id,
      status: "scheduled",
      overs_per_innings: tournament.default_overs_per_innings,
      players_per_side: tournament.default_players_per_side,
    },
  ];

  console.log("Plan:");
  for (const r of rows) {
    const a = teamById.get(r.team_a_id);
    const b = teamById.get(r.team_b_id);
    console.log(
      `  #${r.match_number} ${r.stage.padEnd(12)} ${(a?.short_name ?? "?").padEnd(4)} vs ${(b?.short_name ?? "?").padEnd(4)}`,
    );
  }

  if (!execute) {
    console.log("\n(dry run — re-run with --execute to write)");
    return;
  }

  const { data: inserted, error: insErr } = await sb
    .from("matches")
    .insert(rows)
    .select("id, match_number, stage");
  if (insErr) {
    throw new Error(`Insert failed: ${insErr.message}`);
  }
  console.log(`\n✓ Inserted ${inserted?.length ?? 0} playoff matches.`);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
