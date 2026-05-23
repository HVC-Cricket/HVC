#!/usr/bin/env tsx
/**
 * Read-only inspection for S7 Match #1 (CC vs WK). Confirms:
 * - the match's current overs_per_innings (should be 6 — to be lifted to 7)
 * - both innings' current totals + over-6 last ball + the active
 *   batters about to face the 7th over
 * - resolves "Srikanth" (CC) and "Srisha" (WK) to player_ids so the
 *   subsequent insert script has the right targets.
 *
 *   pnpm tsx scripts/diagnose-s7-match1.ts --env=.env.prod
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

const envArg = process.argv.slice(2).find((a) => a.startsWith("--env="));
loadEnv(envArg?.split("=")[1] ?? ".env.prod");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient<Database>(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TOURNAMENT_SLUG = "hvc-season-7";

async function main() {
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("id, name")
    .eq("slug", TOURNAMENT_SLUG)
    .single();
  if (!tournament) throw new Error("Tournament not found");

  const { data: match } = await supabase
    .from("matches")
    .select(
      "id, match_number, status, team_a_id, team_b_id, winner_id, win_margin, result_type, overs_per_innings, players_per_side",
    )
    .eq("tournament_id", tournament.id)
    .eq("match_number", 1)
    .single();
  if (!match) throw new Error("Match #1 not found");

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, short_name")
    .in("id", [match.team_a_id, match.team_b_id]);
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]));

  console.log(`Match #1: ${teamById.get(match.team_a_id)?.short_name} vs ${teamById.get(match.team_b_id)?.short_name}`);
  console.log(`  id=${match.id}`);
  console.log(`  status=${match.status}  overs_per_innings=${match.overs_per_innings}  players_per_side=${match.players_per_side}`);
  console.log(`  winner=${match.winner_id ? teamById.get(match.winner_id)?.short_name : "—"}  win_margin=${match.win_margin ?? "—"}  result_type=${match.result_type ?? "—"}\n`);

  const { data: innings } = await supabase
    .from("innings")
    .select(
      "id, innings_number, batting_team_id, bowling_team_id, total_runs, total_wickets, total_legal_balls, extras_wides, extras_no_balls, extras_byes, target, is_complete, ended_at, initial_striker_id, initial_non_striker_id",
    )
    .eq("match_id", match.id)
    .order("innings_number", { ascending: true });

  for (const inn of innings ?? []) {
    const bat = teamById.get(inn.batting_team_id);
    const bowl = teamById.get(inn.bowling_team_id);
    console.log(
      `Innings ${inn.innings_number}: ${bat?.short_name} bat vs ${bowl?.short_name} bowl`,
    );
    console.log(
      `  total: ${inn.total_runs}/${inn.total_wickets} (${Math.floor(inn.total_legal_balls / 6)}.${inn.total_legal_balls % 6}, ${inn.total_legal_balls} legal balls)`,
    );
    console.log(
      `  extras: wd=${inn.extras_wides} nb=${inn.extras_no_balls} b=${inn.extras_byes}`,
    );
    console.log(`  target=${inn.target ?? "—"}  is_complete=${inn.is_complete}  ended_at=${inn.ended_at ?? "—"}`);

    // Last few balls of over 6 — to figure out who'd be on strike for over 7.
    const { data: lastBalls } = await supabase
      .from("balls")
      .select(
        "id, over_number, ball_in_over, batter_id, non_striker_id, bowler_id, runs_off_bat, extras, extra_type, is_wicket, wicket_type, player_out_id, scored_at",
      )
      .eq("innings_id", inn.id)
      .eq("is_voided", false)
      .order("scored_at", { ascending: false })
      .limit(8);
    const orderedLast = [...(lastBalls ?? [])].reverse();
    console.log(`  Last 8 balls of innings:`);
    const playerIds = new Set<string>();
    for (const b of orderedLast) {
      playerIds.add(b.batter_id);
      playerIds.add(b.non_striker_id);
      playerIds.add(b.bowler_id);
      if (b.player_out_id) playerIds.add(b.player_out_id);
    }
    const { data: pls } = await supabase
      .from("players")
      .select("id, display_name")
      .in("id", [...playerIds]);
    const nameById = new Map((pls ?? []).map((p) => [p.id, p.display_name]));

    for (const b of orderedLast) {
      const tag =
        b.extra_type === "wide"
          ? "WD"
          : b.extra_type === "no_ball"
            ? "NB"
            : b.extra_type === "bye"
              ? "B"
              : "·";
      const wkt = b.is_wicket
        ? ` W(${b.wicket_type}, out=${nameById.get(b.player_out_id ?? "") ?? "?"})`
        : "";
      console.log(
        `    over ${b.over_number}.${b.ball_in_over} ${tag}  ` +
          `bowl=${nameById.get(b.bowler_id)?.slice(0, 16) ?? "?"}  ` +
          `str=${nameById.get(b.batter_id)?.slice(0, 16) ?? "?"}  ` +
          `ns=${nameById.get(b.non_striker_id)?.slice(0, 16) ?? "?"}  ` +
          `${b.runs_off_bat}+${b.extras}r${wkt}`,
      );
    }

    // Derive who'd be on strike at the start of over 7.
    const lastBall = orderedLast[orderedLast.length - 1];
    if (lastBall) {
      const isBye = lastBall.extra_type === "bye";
      const isWide = lastBall.extra_type === "wide";
      const isNB = lastBall.extra_type === "no_ball";
      let rotationRuns = lastBall.runs_off_bat;
      if (isBye) rotationRuns += lastBall.extras;
      else if (isWide || isNB) rotationRuns += Math.max(0, lastBall.extras - 1);
      const swappedOnRuns = rotationRuns % 2 === 1;
      // For start of over 7: end-of-over swap happens after the last
      // legal ball, so the post-rotation pair gets swapped one more time.
      const isLegal = !isWide && !isNB;
      const postLastStriker = swappedOnRuns ? lastBall.non_striker_id : lastBall.batter_id;
      const postLastNonStriker = swappedOnRuns ? lastBall.batter_id : lastBall.non_striker_id;
      const over7Striker = isLegal ? postLastNonStriker : postLastStriker;
      const over7NonStriker = isLegal ? postLastStriker : postLastNonStriker;
      console.log(
        `  → over 7 striker should be: ${nameById.get(over7Striker) ?? "?"}` +
          `  (non-striker: ${nameById.get(over7NonStriker) ?? "?"})`,
      );
    }

    console.log();
  }

  // Resolve "Srikanth" (CC) and "Srisha" (WK) — these will bowl over 7.
  const ccId =
    teamById.get(match.team_a_id)?.short_name === "CC" ? match.team_a_id : match.team_b_id;
  const wkId =
    teamById.get(match.team_a_id)?.short_name === "WK" ? match.team_a_id : match.team_b_id;
  console.log("===== Player resolution =====");
  for (const [name, teamId, label] of [
    ["srikanth", ccId, "CC"],
    ["srisha", wkId, "WK"],
  ] as const) {
    const { data: tpRows } = await supabase
      .from("team_players")
      .select("player:player_id(id, display_name, category, bowling_style)")
      .eq("team_id", teamId);
    const matches = (tpRows ?? [])
      .map(
        (r) =>
          r.player as unknown as {
            id: string;
            display_name: string;
            category: number | null;
            bowling_style: string | null;
          } | null,
      )
      .filter((p): p is { id: string; display_name: string; category: number | null; bowling_style: string | null } => !!p && p.display_name.toLowerCase().includes(name));
    console.log(`  ${name} on ${label}:`);
    for (const p of matches) {
      console.log(
        `    ${p.display_name} (id=${p.id}, cat=${p.category ?? "—"}, bowl=${p.bowling_style ?? "—"})`,
      );
    }
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
