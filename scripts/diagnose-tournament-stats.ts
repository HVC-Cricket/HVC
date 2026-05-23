#!/usr/bin/env tsx
/**
 * Read-only diagnostic for tournament Stats / MVP "missing match"
 * issues. Lists every match in a tournament with status + innings +
 * ball counts, flags any that the stats/MVP filter
 * (status in [live, innings_break, completed]) silently excludes, and
 * — when --player=<substring> is given — per-match presence in
 * match_players, balls-as-batter, balls-as-bowler, and total runs +
 * wickets per match for that player.
 *
 *   pnpm tsx scripts/diagnose-tournament-stats.ts <slug>
 *   pnpm tsx scripts/diagnose-tournament-stats.ts <slug> --player=pranav
 *   pnpm tsx scripts/diagnose-tournament-stats.ts <slug> --env=.env.prod
 *
 * No writes. Service-role key is used only because the script is
 * convenient to run from the CLI; every query is a SELECT.
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
  const text = readFileSync(path, "utf8");
  for (const raw of text.split("\n")) {
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

// argv[0] = node, argv[1] = script path. Real args start at argv[2].
const userArgs = process.argv.slice(2);
const slugArg = userArgs.find((a) => !a.startsWith("-"));
const envArg = process.argv.find((a) => a.startsWith("--env="));
const envFile = envArg ? envArg.split("=")[1] : ".env.prod";
const playerArg = process.argv.find((a) => a.startsWith("--player="));
const playerFilter = playerArg?.split("=")[1]?.toLowerCase() ?? null;

if (!slugArg) {
  console.error("Usage: pnpm tsx scripts/diagnose-tournament-stats.ts <slug> [--player=name] [--env=.env.prod]");
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
console.log(`Project: ${projectRef}  (read-only)`);
console.log(`Env file: ${envFile}`);
console.log(`Tournament: ${slugArg}`);
if (playerFilter) console.log(`Player filter: ${playerFilter}`);
console.log();

const supabase = createClient<Database>(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const STATS_FILTER = new Set(["live", "innings_break", "completed"]);

async function main() {
  const { data: tournament, error: tErr } = await supabase
    .from("tournaments")
    .select("id, name, slug")
    .eq("slug", slugArg!)
    .single();
  if (tErr || !tournament) {
    console.error("Tournament not found:", tErr?.message);
    process.exit(1);
  }
  console.log(`Tournament id: ${tournament.id} — ${tournament.name}\n`);

  const { data: matches } = await supabase
    .from("matches")
    .select(
      "id, match_number, stage, status, team_a_id, team_b_id, winner_id, started_at, ended_at, current_innings_id",
    )
    .eq("tournament_id", tournament.id)
    .order("match_number", { ascending: true });
  if (!matches || matches.length === 0) {
    console.log("No matches.");
    return;
  }

  const matchIds = matches.map((m) => m.id);

  const { data: teams } = await supabase
    .from("teams")
    .select("id, short_name")
    .eq("tournament_id", tournament.id);
  const teamShort = new Map((teams ?? []).map((t) => [t.id, t.short_name]));

  // Innings per match.
  const { data: innings } = await supabase
    .from("innings")
    .select("id, match_id, innings_number, total_runs, total_wickets, total_legal_balls, is_complete, ended_at")
    .in("match_id", matchIds);
  const inningsByMatch = new Map<string, NonNullable<typeof innings>>();
  for (const i of innings ?? []) {
    const arr = inningsByMatch.get(i.match_id) ?? [];
    arr.push(i);
    inningsByMatch.set(i.match_id, arr);
  }

  // Ball counts per innings (live, non-voided only). Paginated so the
  // PostgREST max-rows cap (1000) doesn't truncate — bumping into
  // that ceiling was the bug this diagnostic was written to find in
  // the first place.
  const inningsIds = (innings ?? []).map((i) => i.id);
  const ballsByInnings = new Map<string, number>();
  if (inningsIds.length > 0) {
    let from = 0;
    const PAGE = 1000;
    for (;;) {
      const { data: ballRows } = await supabase
        .from("balls")
        .select("innings_id")
        .in("innings_id", inningsIds)
        .eq("is_voided", false)
        .range(from, from + PAGE - 1);
      if (!ballRows || ballRows.length === 0) break;
      for (const b of ballRows) {
        ballsByInnings.set(
          b.innings_id,
          (ballsByInnings.get(b.innings_id) ?? 0) + 1,
        );
      }
      if (ballRows.length < PAGE) break;
      from += PAGE;
    }
  }

  // --- Match table ---
  const statusCounts: Record<string, number> = {};
  console.log("===== MATCHES =====");
  console.log(
    "  #  status         stage         teams              innings  balls    started?  ended?",
  );
  for (const m of matches) {
    statusCounts[m.status] = (statusCounts[m.status] ?? 0) + 1;
    const inns = inningsByMatch.get(m.id) ?? [];
    const ballsCount = inns.reduce(
      (sum, i) => sum + (ballsByInnings.get(i.id) ?? 0),
      0,
    );
    const a = teamShort.get(m.team_a_id) ?? "?";
    const b = teamShort.get(m.team_b_id) ?? "?";
    const inStats = STATS_FILTER.has(m.status);
    const flag = inStats ? "  ✓" : "  ✗ EXCLUDED";
    console.log(
      `  ${String(m.match_number).padStart(2)}  ${m.status.padEnd(14)} ${m.stage.padEnd(13)} ${a}-${b}`.padEnd(60) +
        `  ${String(inns.length).padStart(3)}     ${String(ballsCount).padStart(4)}    ` +
        `${m.started_at ? "yes" : "no "}       ${m.ended_at ? "yes" : "no "} ${flag}`,
    );
  }
  console.log();
  console.log("Status totals:");
  for (const [k, v] of Object.entries(statusCounts).sort()) {
    const incl = STATS_FILTER.has(k) ? "(in stats)" : "(EXCLUDED from stats/MVP)";
    console.log(`  ${k.padEnd(14)} ${v}  ${incl}`);
  }
  console.log();

  // --- Anomalies ---
  console.log("===== ANOMALIES =====");
  let anomalyCount = 0;
  for (const m of matches) {
    const inns = inningsByMatch.get(m.id) ?? [];
    const ballsCount = inns.reduce(
      (sum, i) => sum + (ballsByInnings.get(i.id) ?? 0),
      0,
    );

    // Match has balls but status is excluded from stats/MVP — those
    // balls won't surface anywhere.
    if (!STATS_FILTER.has(m.status) && ballsCount > 0) {
      console.log(
        `  Match #${m.match_number} (${m.status}): has ${ballsCount} balls but status is excluded from stats/MVP.`,
      );
      anomalyCount += 1;
    }

    // Match has status in stats filter but zero balls — likely not
    // started; only worth flagging if scheduled_at has passed or
    // started_at is set.
    if (STATS_FILTER.has(m.status) && ballsCount === 0 && m.started_at) {
      console.log(
        `  Match #${m.match_number} (${m.status}): started but no balls recorded.`,
      );
      anomalyCount += 1;
    }

    // Status is 'live' but match has been ended.
    if (m.status === "live" && m.ended_at) {
      console.log(
        `  Match #${m.match_number}: status=live but ended_at is set — should be 'completed'.`,
      );
      anomalyCount += 1;
    }
  }
  if (anomalyCount === 0) console.log("  (none)");
  console.log();

  // --- Player drill-down ---
  if (playerFilter) {
    console.log(`===== PLAYER DRILL-DOWN: '${playerFilter}' =====`);

    const { data: matchedPlayers } = await supabase
      .from("players")
      .select("id, display_name, category")
      .ilike("display_name", `%${playerFilter}%`);
    if (!matchedPlayers || matchedPlayers.length === 0) {
      console.log("  No matching players found.");
      return;
    }

    for (const player of matchedPlayers) {
      console.log(
        `\n  ${player.display_name} (id=${player.id}, cat=${player.category ?? "—"})`,
      );

      // match_players appearances in this tournament's matches.
      const { data: mpRows } = await supabase
        .from("match_players")
        .select("match_id, is_substitute, team_id")
        .eq("player_id", player.id)
        .in("match_id", matchIds);
      const inXI = new Set(
        (mpRows ?? [])
          .filter((r) => !r.is_substitute)
          .map((r) => r.match_id),
      );
      const asSub = new Set(
        (mpRows ?? [])
          .filter((r) => r.is_substitute)
          .map((r) => r.match_id),
      );

      // Ball appearances per match.
      // batter
      const { data: batBalls } = await supabase
        .from("balls")
        .select("innings_id, runs_off_bat, extras, extra_type")
        .eq("batter_id", player.id)
        .eq("is_voided", false)
        .in("innings_id", inningsIds);
      const batByMatch = new Map<string, { balls: number; runs: number }>();
      const inningsToMatch = new Map(
        (innings ?? []).map((i) => [i.id, i.match_id]),
      );
      for (const b of batBalls ?? []) {
        const mid = inningsToMatch.get(b.innings_id);
        if (!mid) continue;
        const e = batByMatch.get(mid) ?? { balls: 0, runs: 0 };
        if (b.extra_type !== "wide") {
          e.runs += b.runs_off_bat;
          if (b.extra_type !== "no_ball") e.balls += 1;
        }
        batByMatch.set(mid, e);
      }

      const { data: bowlBalls } = await supabase
        .from("balls")
        .select(
          "innings_id, is_wicket, wicket_type, runs_off_bat, extras, extra_type",
        )
        .eq("bowler_id", player.id)
        .eq("is_voided", false)
        .in("innings_id", inningsIds);
      const bowlByMatch = new Map<
        string,
        { balls: number; runs: number; wkts: number }
      >();
      for (const b of bowlBalls ?? []) {
        const mid = inningsToMatch.get(b.innings_id);
        if (!mid) continue;
        const e = bowlByMatch.get(mid) ?? { balls: 0, runs: 0, wkts: 0 };
        if (b.extra_type !== "wide" && b.extra_type !== "no_ball")
          e.balls += 1;
        e.runs += b.runs_off_bat;
        if (b.extra_type === "wide" || b.extra_type === "no_ball")
          e.runs += b.extras;
        if (b.is_wicket && b.wicket_type !== "run_out") e.wkts += 1;
        bowlByMatch.set(mid, e);
      }

      console.log(
        `    In XI for ${inXI.size} matches, sub for ${asSub.size}.`,
      );
      console.log(
        "    #  status         in XI?  sub?  batted   bowled       runs  wkts  in stats?",
      );

      let totalRunsInStats = 0;
      let totalWktsInStats = 0;
      let totalMatchesInStats = 0;
      let totalRunsAll = 0;
      let totalWktsAll = 0;

      for (const m of matches) {
        const inXIHere = inXI.has(m.id);
        const subHere = asSub.has(m.id);
        const bat = batByMatch.get(m.id);
        const bowl = bowlByMatch.get(m.id);
        if (!inXIHere && !subHere && !bat && !bowl) continue;

        const inStats = STATS_FILTER.has(m.status);
        const batStr = bat ? `${bat.runs}(${bat.balls})` : "—";
        const bowlStr = bowl
          ? `${bowl.wkts}/${bowl.runs} (${Math.floor(bowl.balls / 6)}.${bowl.balls % 6})`
          : "—";

        totalRunsAll += bat?.runs ?? 0;
        totalWktsAll += bowl?.wkts ?? 0;
        if (inStats) {
          totalRunsInStats += bat?.runs ?? 0;
          totalWktsInStats += bowl?.wkts ?? 0;
          if (inXIHere || subHere || bat || bowl) totalMatchesInStats += 1;
        }

        console.log(
          `    ${String(m.match_number).padStart(2)}  ${m.status.padEnd(14)} ${inXIHere ? "yes" : "no "}     ${subHere ? "yes" : "no "}   ${batStr.padEnd(8)} ${bowlStr.padEnd(12)} ${String(bat?.runs ?? 0).padStart(4)}  ${String(bowl?.wkts ?? 0).padStart(4)}  ${inStats ? "yes" : "NO ←"}`,
        );
      }
      console.log(
        `    ────────  in stats:  ${totalMatchesInStats} matches, ${totalRunsInStats} runs, ${totalWktsInStats} wkts`,
      );
      console.log(
        `    ────────  raw total: ${totalRunsAll} runs, ${totalWktsAll} wkts (incl. excluded matches)`,
      );
      const missing =
        totalRunsAll - totalRunsInStats + (totalWktsAll - totalWktsInStats);
      if (missing > 0) {
        console.log(
          `    ⚠  ${totalRunsAll - totalRunsInStats} runs and ${totalWktsAll - totalWktsInStats} wkts are NOT counted in the live Stats/MVP page.`,
        );
      }
    }
  }
}

main()
  .catch((e) => {
    console.error("fatal:", e);
    process.exit(1);
  })
  .then(() => process.exit(0));
