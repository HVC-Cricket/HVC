import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Maximum rank to surface as a badge — anyone outside the top 10 in
 * a given metric doesn't get a badge for it (otherwise everyone has
 * a "#87 runs" label and the signal vanishes). With HVC's roster of
 * ~50 active players + ~100 historical, top 10 is roughly the top
 * 10% — meaningful "you made the list" filter.
 */
const RANK_CEILING = 10;

export type CareerRankBadge = {
  metric:
    | "runs"
    | "wickets"
    | "fours"
    | "sixes"
    | "matches"
    | "pom";
  label: string;
  rank: number;
};

type PageRow = {
  player_id: string;
  runs: number | null;
  fours: number | null;
  sixes: number | null;
  wickets: number | null;
};

const PAGE_SIZE = 1000;

async function paginate<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data } = await query(from, from + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

/**
 * Returns the badges the given player has earned — one per metric
 * where they rank in the top 10 across all HVC players (historical
 * S1–S6 + S7+ live tournaments combined). Sorted by rank ascending
 * (best rank first) so the UI can show them in priority order.
 *
 * Implementation: pulls aggregated stats from v_player_tournament_stats
 * (which already UNIONs balls + historical_match_batting/bowling per
 * the 2026-05-16 extension), groups by player, then ranks each
 * metric. Two extra queries cover match-played count (from
 * match_players) and POM count (from matches.player_of_match_id) —
 * neither lives in the per-tournament view.
 *
 * Ties: dense rank. If players A and B are tied at #1, B isn't
 * pushed to #2 — both get badge "#1". The next distinct value gets
 * #2 (or #3 if there were three tied at #1).
 */
export async function loadCareerRankBadges(
  playerId: string,
): Promise<CareerRankBadge[]> {
  const supabase = await createClient();

  const [statRows, mpRows, pomRows] = await Promise.all([
    // v_player_tournament_stats: one row per (tournament, player).
    // ~600 rows on prod, fits in a single page.
    supabase
      .from("v_player_tournament_stats" as never)
      .select("player_id, runs, fours, sixes, wickets")
      .then((r) => (r.data ?? []) as unknown as PageRow[]),
    // match_players: 1800+ rows on prod, needs pagination.
    paginate<{ match_id: string; player_id: string }>((from, to) =>
      supabase
        .from("match_players")
        .select("match_id, player_id")
        .range(from, to),
    ),
    // matches: 131 rows on prod with player_of_match_id, single page.
    supabase
      .from("matches")
      .select("player_of_match_id")
      .not("player_of_match_id", "is", null)
      .then(
        (r) =>
          (r.data ?? []) as Array<{ player_of_match_id: string | null }>,
      ),
  ]);

  // Aggregate per player from the per-tournament view.
  const totals = new Map<
    string,
    { runs: number; fours: number; sixes: number; wickets: number }
  >();
  for (const r of statRows) {
    const t = totals.get(r.player_id) ?? {
      runs: 0,
      fours: 0,
      sixes: 0,
      wickets: 0,
    };
    t.runs += r.runs ?? 0;
    t.fours += r.fours ?? 0;
    t.sixes += r.sixes ?? 0;
    t.wickets += r.wickets ?? 0;
    totals.set(r.player_id, t);
  }

  // Matches per player (distinct match_id).
  const matchesByPlayer = new Map<string, Set<string>>();
  for (const r of mpRows) {
    let s = matchesByPlayer.get(r.player_id);
    if (!s) {
      s = new Set();
      matchesByPlayer.set(r.player_id, s);
    }
    s.add(r.match_id);
  }
  // POM count per player.
  const pomByPlayer = new Map<string, number>();
  for (const r of pomRows) {
    if (!r.player_of_match_id) continue;
    pomByPlayer.set(
      r.player_of_match_id,
      (pomByPlayer.get(r.player_of_match_id) ?? 0) + 1,
    );
  }

  // Ensure every player from any source is in the rank pool.
  const allPlayerIds = new Set<string>([
    ...totals.keys(),
    ...matchesByPlayer.keys(),
    ...pomByPlayer.keys(),
  ]);

  /** Dense rank of `value` within the descending-sorted distinct
   *  values of the metric. Returns null when the value is 0 (no
   *  badge for "0 wickets"). */
  const rankOf = (
    metricValueByPlayer: Map<string, number>,
    target: number,
  ): number | null => {
    if (target <= 0) return null;
    // Sort distinct values descending; current player's rank is
    // 1 + count of distinct values higher than theirs.
    const distinct = new Set<number>();
    for (const v of metricValueByPlayer.values()) {
      if (v > 0) distinct.add(v);
    }
    const sorted = [...distinct].sort((a, b) => b - a);
    const idx = sorted.indexOf(target);
    return idx >= 0 ? idx + 1 : null;
  };

  const runsByPlayer = new Map<string, number>();
  const foursByPlayer = new Map<string, number>();
  const sixesByPlayer = new Map<string, number>();
  const wicketsByPlayer = new Map<string, number>();
  for (const pid of allPlayerIds) {
    const t = totals.get(pid);
    runsByPlayer.set(pid, t?.runs ?? 0);
    foursByPlayer.set(pid, t?.fours ?? 0);
    sixesByPlayer.set(pid, t?.sixes ?? 0);
    wicketsByPlayer.set(pid, t?.wickets ?? 0);
  }
  const matchesValueByPlayer = new Map<string, number>();
  for (const pid of allPlayerIds) {
    matchesValueByPlayer.set(pid, matchesByPlayer.get(pid)?.size ?? 0);
  }

  const me = totals.get(playerId) ?? {
    runs: 0,
    fours: 0,
    sixes: 0,
    wickets: 0,
  };
  const myMatches = matchesByPlayer.get(playerId)?.size ?? 0;
  const myPom = pomByPlayer.get(playerId) ?? 0;

  const badges: CareerRankBadge[] = [];
  const tryAdd = (
    metric: CareerRankBadge["metric"],
    label: string,
    rank: number | null,
  ) => {
    if (rank == null || rank > RANK_CEILING) return;
    badges.push({ metric, label, rank });
  };
  tryAdd("runs", "Runs", rankOf(runsByPlayer, me.runs));
  tryAdd("wickets", "Wickets", rankOf(wicketsByPlayer, me.wickets));
  tryAdd("sixes", "Sixes", rankOf(sixesByPlayer, me.sixes));
  tryAdd("fours", "Fours", rankOf(foursByPlayer, me.fours));
  tryAdd("matches", "Matches", rankOf(matchesValueByPlayer, myMatches));
  tryAdd("pom", "POM", rankOf(pomByPlayer, myPom));

  badges.sort((a, b) => a.rank - b.rank);
  return badges;
}
