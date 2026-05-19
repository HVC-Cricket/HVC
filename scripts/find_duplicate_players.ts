#!/usr/bin/env tsx
/**
 * Read-only duplicate-player finder for prod.
 *
 * Pulls every row from `players` against the project named by
 * NEXT_PUBLIC_SUPABASE_URL (no writes; service-role bypasses RLS but
 * is only used for SELECT here). Groups by normalized display name
 * and prints any group with > 1 row, each annotated with the player's
 * career stats and link status.
 *
 *   pnpm tsx scripts/find_duplicate_players.ts          # uses .env.prod
 *   pnpm tsx scripts/find_duplicate_players.ts --env=.env.local
 *
 * Output is meant for a human to review and decide which rows are
 * truly the same person vs two people sharing a name.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ───────────────────────────────────────────────────────────────────
// env loader (no dotenv dependency)
// ───────────────────────────────────────────────────────────────────
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

const envArg = process.argv.find((a) => a.startsWith("--env="));
const envFile = envArg ? envArg.split("=")[1] : ".env.prod";
loadEnv(envFile);

// Optional --name=substring filter: when set, prints stats for every
// player whose normalized name contains the substring (case-insensitive).
// Useful for inspecting a candidate group the auto-dedupe missed.
const nameFilter =
  process.argv.find((a) => a.startsWith("--name="))?.split("=")[1] ?? null;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const projectRef = url.replace(/^https?:\/\//, "").split(".")[0];
console.log(`Querying project ${projectRef} (read-only)\n`);

const supabase = createClient<Database>(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ───────────────────────────────────────────────────────────────────
// Fetch
// ───────────────────────────────────────────────────────────────────
type PlayerRow = {
  id: string;
  display_name: string;
  category: number | null;
  photo_url: string | null;
  linked_user_id: string | null;
  created_at: string;
};

async function main() {
  const { data: players, error: playersErr } = await supabase
    .from("players")
    .select("id, display_name, category, photo_url, linked_user_id, created_at")
    .order("display_name", { ascending: true });
  if (playersErr || !players) {
    console.error("players query failed:", playersErr);
    process.exit(1);
  }
  console.log(`Loaded ${players.length} players`);

  // match_players: count distinct matches each player appeared in (in_match only)
  // Supabase JS defaults to a 1000-row hard cap; paginate via .range().
  async function fetchAll<T>(
    table: string,
    columns: string,
    eq?: { col: string; val: unknown },
  ): Promise<T[]> {
    const out: T[] = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      let q = supabase
        .from(table)
        .select(columns)
        .range(from, from + pageSize - 1);
      if (eq) q = q.eq(eq.col, eq.val as never);
      const { data, error } = await q;
      if (error) {
        console.error(`${table} query failed:`, error);
        process.exit(1);
      }
      if (!data || data.length === 0) break;
      out.push(...(data as T[]));
      if (data.length < pageSize) break;
    }
    return out;
  }

  const matchRows = await fetchAll<{
    player_id: string;
    match_id: string;
    is_substitute: boolean;
  }>("match_players", "player_id, match_id, is_substitute", {
    col: "is_substitute",
    val: false,
  });
  const matchesByPlayer = new Map<string, Set<string>>();
  for (const r of matchRows) {
    if (!r.player_id) continue;
    let set = matchesByPlayer.get(r.player_id);
    if (!set) {
      set = new Set();
      matchesByPlayer.set(r.player_id, set);
    }
    set.add(r.match_id);
  }

  const balls = await fetchAll<{
    batter_id: string | null;
    bowler_id: string | null;
    runs_off_bat: number;
    extra_type: string | null;
    is_wicket: boolean;
    wicket_type: string | null;
    counts_for_innings_total: boolean;
  }>(
    "balls",
    "batter_id, bowler_id, runs_off_bat, extra_type, is_wicket, wicket_type, counts_for_innings_total",
    { col: "is_voided", val: false },
  );

  // Historical aggregates for pre-ball-by-ball seasons.
  const histBat = await fetchAll<{
    player_id: string | null;
    runs: number | null;
    balls_faced: number | null;
  }>("historical_match_batting", "player_id, runs, balls_faced");
  const histBowl = await fetchAll<{
    player_id: string | null;
    wickets: number | null;
    runs: number | null;
  }>("historical_match_bowling", "player_id, wickets, runs");

  type Stats = {
    matches: number;
    runs: number;
    ballsFaced: number;
    wickets: number;
    runsConceded: number;
  };
  const statsByPlayer = new Map<string, Stats>();
  const get = (id: string): Stats => {
    let s = statsByPlayer.get(id);
    if (!s) {
      s = { matches: 0, runs: 0, ballsFaced: 0, wickets: 0, runsConceded: 0 };
      statsByPlayer.set(id, s);
    }
    return s;
  };
  for (const b of balls) {
    if (b.batter_id) {
      const s = get(b.batter_id);
      s.runs += b.runs_off_bat ?? 0;
      if (b.extra_type !== "wide") s.ballsFaced += 1;
    }
    if (b.bowler_id) {
      const s = get(b.bowler_id);
      // Run-outs aren't bowler-credited.
      if (
        b.is_wicket &&
        b.wicket_type !== "run_out" &&
        b.counts_for_innings_total
      ) {
        s.wickets += 1;
      }
      if (
        b.extra_type !== "bye" &&
        b.extra_type !== "leg_bye" &&
        b.extra_type !== "penalty"
      ) {
        // standard bowler-charged runs: bat + wides + no-balls
        s.runsConceded +=
          (b.runs_off_bat ?? 0) +
          (b.extra_type === "wide" || b.extra_type === "no_ball" ? 1 : 0);
      }
    }
  }
  for (const h of histBat) {
    if (!h.player_id) continue;
    const s = get(h.player_id);
    s.runs += h.runs ?? 0;
    s.ballsFaced += h.balls_faced ?? 0;
  }
  for (const h of histBowl) {
    if (!h.player_id) continue;
    const s = get(h.player_id);
    s.wickets += h.wickets ?? 0;
    s.runsConceded += h.runs ?? 0;
  }
  for (const [pid, m] of matchesByPlayer) {
    get(pid).matches = m.size;
  }

  // ─────────────────────────────────────────────────────────────────
  // Group by normalized name
  // ─────────────────────────────────────────────────────────────────
  function normalize(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[^\p{L}\p{N} ]/gu, "")
      .trim();
  }

  // First pass: exact normalized matches.
  const exactGroups = new Map<string, PlayerRow[]>();
  for (const p of players as PlayerRow[]) {
    const key = normalize(p.display_name);
    if (!key) continue;
    let list = exactGroups.get(key);
    if (!list) {
      list = [];
      exactGroups.set(key, list);
    }
    list.push(p);
  }

  // Second pass: rows where one's normalized name is a substring of
  // another's (handles "Sandeep" vs "Sandeep K"). Capture as a soft
  // category — surface separately so the user can judge.
  const substringGroups = new Map<string, PlayerRow[]>();
  const keysSorted = [...exactGroups.keys()].sort((a, b) => a.length - b.length);
  for (let i = 0; i < keysSorted.length; i++) {
    const shorter = keysSorted[i];
    if (shorter.length < 3) continue;
    for (let j = i + 1; j < keysSorted.length; j++) {
      const longer = keysSorted[j];
      if (longer === shorter) continue;
      // Whole-word containment: "sandeep" in "sandeep k" but NOT in "sandeepkumar".
      const isPrefixOrWord =
        longer === shorter ||
        longer.startsWith(shorter + " ") ||
        longer.endsWith(" " + shorter) ||
        longer.includes(" " + shorter + " ");
      if (isPrefixOrWord) {
        const groupKey = shorter; // group around the shorter form
        let list = substringGroups.get(groupKey);
        if (!list) {
          list = [...(exactGroups.get(shorter) ?? [])];
          substringGroups.set(groupKey, list);
        }
        for (const row of exactGroups.get(longer) ?? []) {
          if (!list.some((r) => r.id === row.id)) list.push(row);
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // Print
  // ─────────────────────────────────────────────────────────────────
  function fmt(p: PlayerRow): string {
    const s =
      statsByPlayer.get(p.id) ??
      { matches: 0, runs: 0, ballsFaced: 0, wickets: 0, runsConceded: 0 };
    const cat = p.category != null ? `Cat${p.category}` : "—";
    const linked = p.linked_user_id ? "LINKED" : "not linked";
    const photo = p.photo_url ? "📷" : "  ";
    return [
      `  ${photo} ${p.display_name.padEnd(28)}`,
      `id=${p.id.slice(0, 8)}`,
      cat.padEnd(5),
      linked.padEnd(11),
      `M=${s.matches.toString().padStart(3)}`,
      `R=${s.runs.toString().padStart(4)}(${s.ballsFaced.toString().padStart(3)})`,
      `W=${s.wickets.toString().padStart(2)}/${s.runsConceded.toString().padStart(3)}`,
      `created=${p.created_at.slice(0, 10)}`,
    ].join("  ");
  }

  // --name=<substr> mode: print stats for every player whose normalized
  // name contains the substring. Skips the dupe grouping entirely.
  if (nameFilter) {
    const needle = normalize(nameFilter);
    const hits = (players as PlayerRow[])
      .filter((p) => normalize(p.display_name).includes(needle))
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
    console.log(
      `\n${hits.length} player(s) matching "${nameFilter}":\n`,
    );
    for (const p of hits) console.log(fmt(p));
    console.log(`\nDone.`);
    return;
  }

  // Exact dupes first
  const exactDupes = [...exactGroups.entries()].filter(
    ([, list]) => list.length > 1,
  );
  exactDupes.sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(`EXACT NAME MATCHES (case/whitespace-insensitive): ${exactDupes.length} groups`);
  console.log(`══════════════════════════════════════════════════════════`);
  for (const [key, list] of exactDupes) {
    console.log(`\n● "${key}" — ${list.length} rows`);
    list.sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const p of list) console.log(fmt(p));
  }

  // Substring groups — only show groups where the SHORTER name's list
  // by itself doesn't already account for everything (i.e., new info).
  const substringExtras = [...substringGroups.entries()].filter(([key, list]) => {
    const exactCount = exactGroups.get(key)?.length ?? 0;
    return list.length > exactCount;
  });
  substringExtras.sort((a, b) => a[0].localeCompare(b[0]));
  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(`SUBSTRING / PREFIX MATCHES: ${substringExtras.length} groups`);
  console.log(`(one name is a whole-word prefix/suffix of another — judge case-by-case)`);
  console.log(`══════════════════════════════════════════════════════════`);
  for (const [key, list] of substringExtras) {
    console.log(`\n● anchor "${key}" — ${list.length} rows`);
    list.sort((a, b) => a.display_name.localeCompare(b.display_name));
    for (const p of list) console.log(fmt(p));
  }

  console.log(`\nDone. Read-only — nothing written.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
