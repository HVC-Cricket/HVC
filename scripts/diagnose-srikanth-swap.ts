#!/usr/bin/env tsx
/**
 * Read-only inspection for the Srikanth Krishnamurthy / Srikanth T K
 * swap. Prints both players' rows from `players`, every team they've
 * ever been on (`team_players`), every match XI they've appeared in
 * (`match_players`), aggregated balls (S7 live data) where they've
 * been credited, and any historical_match_batting/bowling rows
 * (S1–S6) attributed to them.
 *
 * The goal is to figure out, before mutating anything, whether the
 * proposed swap is S7-only or all-time — by looking at whether the
 * historical attribution makes sense.
 *
 *   pnpm tsx scripts/diagnose-srikanth-swap.ts --env=.env.prod
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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const projectRef = url.replace(/^https?:\/\//, "").split(".")[0];
console.log(`Project: ${projectRef}  (read-only)\n`);

const supabase = createClient<Database>(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function inspect(name: string) {
  const { data: matchedPlayers } = await supabase
    .from("players")
    .select(
      "id, display_name, category, photo_url, phone, linked_user_id, batting_style, bowling_style, created_at",
    )
    .ilike("display_name", `%${name}%`);
  if (!matchedPlayers || matchedPlayers.length === 0) {
    console.log(`No player matching '${name}'.\n`);
    return [];
  }
  return matchedPlayers;
}

async function main() {
  console.log("===== PLAYERS MATCHING 'srikanth' =====\n");
  const players = await inspect("srikanth");
  for (const p of players) {
    console.log(
      `  ${p.display_name}  (id=${p.id})\n` +
        `    cat=${p.category ?? "—"}  phone=${p.phone ?? "—"}  linked_user_id=${p.linked_user_id ?? "—"}\n` +
        `    photo_url=${p.photo_url ? "yes" : "no"}  bat=${p.batting_style ?? "—"} bowl=${p.bowling_style ?? "—"}\n` +
        `    created=${p.created_at}\n`,
    );
  }

  for (const p of players) {
    console.log(`\n----- ${p.display_name} (${p.id}) -----`);

    // Team memberships (team_players → teams → tournaments)
    const { data: tp } = await supabase
      .from("team_players")
      .select(
        "id, role, team:team_id(id, name, short_name, tournament:tournament_id(name, slug))",
      )
      .eq("player_id", p.id);
    console.log("\nteam_players (all-season squads):");
    for (const row of tp ?? []) {
      const t = row.team as unknown as {
        id: string;
        name: string;
        short_name: string;
        tournament: { name: string; slug: string };
      } | null;
      if (!t) continue;
      console.log(
        `  ${t.tournament.slug.padEnd(20)} ${t.short_name.padEnd(6)} ${t.name}  (role=${row.role})`,
      );
    }

    // Match appearances
    const { data: mp } = await supabase
      .from("match_players")
      .select(
        "match_id, team_id, is_substitute, batting_order, match:match_id(match_number, status, tournament:tournament_id(slug)), team:team_id(short_name, name)",
      )
      .eq("player_id", p.id);
    console.log(`\nmatch_players: ${(mp ?? []).length} rows`);
    const byTour = new Map<string, number>();
    for (const row of mp ?? []) {
      const t = row.match as unknown as { tournament: { slug: string } } | null;
      const slug = t?.tournament.slug ?? "?";
      byTour.set(slug, (byTour.get(slug) ?? 0) + 1);
    }
    for (const [slug, count] of byTour) {
      console.log(`  ${slug}: ${count} match XIs`);
    }

    // Balls in S7 (live data)
    const { data: s7tour } = await supabase
      .from("tournaments")
      .select("id")
      .eq("slug", "hvc-season-7")
      .single();

    if (s7tour) {
      const { data: s7innings } = await supabase
        .from("innings")
        .select("id, match:match_id!inner(tournament_id)")
        .eq("match.tournament_id", s7tour.id);
      const inningsIds = (s7innings ?? []).map((i) => i.id);
      if (inningsIds.length > 0) {
        // Paginate the balls fetch.
        const PAGE = 1000;
        let from = 0;
        let totalBat = 0;
        let totalRunsOffBat = 0;
        let totalBowl = 0;
        let totalWkts = 0;
        let totalRunsConceded = 0;
        let totalField = 0;
        for (;;) {
          const { data: balls } = await supabase
            .from("balls")
            .select(
              "batter_id, non_striker_id, bowler_id, fielder_id, runs_off_bat, extras, extra_type, is_wicket, wicket_type",
            )
            .in("innings_id", inningsIds)
            .eq("is_voided", false)
            .range(from, from + PAGE - 1);
          if (!balls || balls.length === 0) break;
          for (const b of balls) {
            if (b.batter_id === p.id) {
              if (b.extra_type !== "wide") {
                totalRunsOffBat += b.runs_off_bat;
                if (b.extra_type !== "no_ball") totalBat += 1;
              }
            }
            if (b.bowler_id === p.id) {
              if (b.extra_type !== "wide" && b.extra_type !== "no_ball") totalBowl += 1;
              if (b.is_wicket && b.wicket_type !== "run_out") totalWkts += 1;
              totalRunsConceded += b.runs_off_bat;
              if (b.extra_type === "wide" || b.extra_type === "no_ball")
                totalRunsConceded += b.extras;
            }
            if (b.is_wicket && b.fielder_id === p.id) totalField += 1;
          }
          if (balls.length < PAGE) break;
          from += PAGE;
        }
        console.log(`\nS7 ball-level stats (paginated):`);
        console.log(
          `  Batting: ${totalRunsOffBat} runs off ${totalBat} balls faced`,
        );
        console.log(
          `  Bowling: ${totalWkts}/${totalRunsConceded} (${Math.floor(totalBowl / 6)}.${totalBowl % 6} ov)`,
        );
        console.log(`  Fielding credits: ${totalField}`);
      }
    }

    // Historical (S1-S6) — historical_match_batting / bowling
    const { data: hbBat } = await supabase
      .from("historical_match_batting")
      .select("match_id, runs, balls_faced, match:match_id(tournament:tournament_id(slug))")
      .eq("player_id", p.id);
    const { data: hbBowl } = await supabase
      .from("historical_match_bowling")
      .select("match_id, wickets, runs, overs, match:match_id(tournament:tournament_id(slug))")
      .eq("player_id", p.id);
    console.log(`\nHistorical (S1–S6) stats:`);
    const histBat = new Map<string, { runs: number; balls: number; innings: number }>();
    for (const r of hbBat ?? []) {
      const m = r.match as unknown as { tournament: { slug: string } } | null;
      const slug = m?.tournament.slug ?? "?";
      const cur = histBat.get(slug) ?? { runs: 0, balls: 0, innings: 0 };
      cur.runs += r.runs;
      cur.balls += r.balls_faced;
      cur.innings += 1;
      histBat.set(slug, cur);
    }
    const histBowl = new Map<string, { wickets: number; runs: number; innings: number }>();
    for (const r of hbBowl ?? []) {
      const m = r.match as unknown as { tournament: { slug: string } } | null;
      const slug = m?.tournament.slug ?? "?";
      const cur = histBowl.get(slug) ?? { wickets: 0, runs: 0, innings: 0 };
      cur.wickets += r.wickets;
      cur.runs += r.runs;
      cur.innings += 1;
      histBowl.set(slug, cur);
    }
    const slugs = new Set([...histBat.keys(), ...histBowl.keys()]);
    if (slugs.size === 0) {
      console.log("  (none)");
    } else {
      for (const slug of [...slugs].sort()) {
        const b = histBat.get(slug);
        const bw = histBowl.get(slug);
        console.log(
          `  ${slug.padEnd(20)} ` +
            `bat=${b ? `${b.runs} runs (${b.balls} balls, ${b.innings} inns)` : "—"}  ` +
            `bowl=${bw ? `${bw.wickets}/${bw.runs} (${bw.innings} inns)` : "—"}`,
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
