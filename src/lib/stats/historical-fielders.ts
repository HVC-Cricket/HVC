/**
 * Parse fielder credits out of CricHeroes-imported dismissal strings
 * (`historical_match_batting.how_to_out`). The cricheroes commentary
 * feed doesn't expose per-ball fielder IDs, but the text-format
 * dismissal does include the fielder's name. We pull it back out so
 * historical seasons (S1–S6) can contribute to the FIELD
 * leaderboards on both /stats and the per-tournament Stats tab.
 *
 * Sample formats observed on prod:
 *
 *   c Pavan Kashyap b Mahesh         → catch credit: Pavan Kashyap
 *   c †Aprameya Guruprasad b X       → catch credit: Aprameya Guruprasad
 *                                       (the † just marks a keeper)
 *   c&b Pavan Kashyap                → catch credit: Pavan Kashyap
 *                                       (the bowler caught it)
 *   run out Tej                      → run-out credit: Tej
 *   run out Sandeep / Pavan Kashyap  → run-out credit: both names
 *   run out Badri (5a)               → run-out credit: Badri
 *                                       (trailing parens are
 *                                       cricheroes' fielder codes)
 *   st Bharath b Sudharshan          → stumping credit: Bharath
 *   b Prasanna                       → no fielder credit
 *   lbw Prasanna                     → no fielder credit
 *   retired hurt / not out / ""      → no fielder credit
 *
 * Name matching strategy — TWO PASSES:
 *
 *   1. **Per-match roster** (primary). For each dismissal, look up
 *      the parsed name inside the SAME match's rosters — the
 *      cricheroes-original `player_name` columns on
 *      historical_match_batting + historical_match_bowling. Both
 *      tables preserve cricheroes' canonical naming at import time
 *      AND point at the player's current UUID (which is the merged
 *      survivor when dupes were dedupe'd in our app). This handles
 *      every case where the player got renamed in our app or
 *      multiple cricheroes IDs were merged into one UUID — the
 *      cricheroes name still resolves through historical_match_*.
 *
 *   2. **Global fallback** (secondary). If the per-match lookup
 *      finds nothing — typically because the fielder didn't bat OR
 *      bowl in this match (only fielded) — fall back to a
 *      case-insensitive exact match against the whole players
 *      table's display_name. Captures the few edge cases the
 *      per-match path misses.
 *
 * Ambiguous names (multiple rows in the same match normalise to
 * the same key, OR multiple global players do) silently skip
 * rather than risk a wrong credit. "sub" / "subs" / "substitute"
 * fielders skip too — cricheroes doesn't credit them to a real
 * player.
 */

export type ParsedFielderCredit = {
  match_id: string;
  innings_number: number;
  player_id: string;
  kind: "catch" | "run_out" | "stumped";
};

type DismissalRow = {
  match_id: string;
  innings_number: number;
  how_to_out: string | null;
};

type RosterRow = {
  match_id: string;
  player_id: string | null;
  player_name: string;
};

const CATCH_RE = /^c\s+†?\s*(.+?)\s+b\s+/i;
const C_AND_B_RE = /^c&b\s+(.+)$/i;
const STUMPED_RE = /^st\s+†?\s*(.+?)\s+b\s+/i;
const RUN_OUT_RE = /^run\s*-?\s*out(?:\s+(.+?))?\s*(?:\(.*\))?$/i;

/**
 * Lower-case, trim, collapse whitespace, strip cricheroes annotations:
 *   - the keeper-marker dagger `†`
 *   - leading "(sub)" / "sub " prefix (substitute fielders)
 *   - trailing parenthetical suffixes like "(wk)", "(5a)" that
 *     appear in cricheroes' roster names but NOT in the dismissal
 *     text (so "Yashu  (wk)" in the roster and "Yashu" in the
 *     dismissal both normalise to "yashu" → match).
 *
 * Both the lookup keys AND the parsed dismissal name go through
 * this — no asymmetry.
 */
function normalize(name: string): string {
  return name
    .replace(/†/g, "")
    .replace(/^\(?sub\)?\s+/i, "")
    // Strip ANY trailing parenthetical group (and the whitespace
    // before it). Catches "(wk)", "(5a)", "(c)", "(VC)", etc.
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Per-match lookup of `normalised cricheroes name -> player UUID`.
 * Built from both teams' historical_match_batting + bowling rosters
 * (so a fielder who only bowled in the innings still resolves, and
 * a fielder who batted in the other innings still resolves). When
 * two rows in the same match normalise to the same key, the entry
 * is `"ambiguous"` and downstream resolution skips it.
 */
export type MatchRosters = Map<string, Map<string, string | "ambiguous">>;

export function buildMatchRosters(
  battingRows: RosterRow[],
  bowlingRows: RosterRow[],
): MatchRosters {
  const out: MatchRosters = new Map();
  const set = (
    matchId: string,
    name: string | null | undefined,
    pid: string | null | undefined,
  ) => {
    if (!name || !pid) return;
    const key = normalize(name);
    if (!key) return;
    let m = out.get(matchId);
    if (!m) {
      m = new Map();
      out.set(matchId, m);
    }
    const existing = m.get(key);
    if (existing === undefined) {
      m.set(key, pid);
    } else if (existing !== pid) {
      // Two different player_ids share this name within the match —
      // marks the key ambiguous so we don't guess wrong.
      m.set(key, "ambiguous");
    }
    // Same pid twice (bat + bowl roster overlap) is fine; keep the value.
  };
  for (const r of battingRows) set(r.match_id, r.player_name, r.player_id);
  for (const r of bowlingRows) set(r.match_id, r.player_name, r.player_id);
  return out;
}

/**
 * Global lookup used as the fallback when per-match resolution
 * misses. Two index types:
 *
 *   - `byFullName`: exact normalised display_name → UUID. Same as
 *     the per-match map; if a player's full name appears in the
 *     dismissal text, this hits first.
 *   - `byFirstName`: first-token-of-name → UUID, BUT only when
 *     that first token unambiguously points to a single player.
 *     Cricheroes often shortens to first names ("Amith" vs the
 *     player record "Amith P"); when our roster has only one
 *     player whose name starts with that token, we can credit
 *     them. If two players share a first name, the token is
 *     `"ambiguous"` and we skip.
 *
 * Both share the same normalisation as the per-match path so a
 * hit on either side means the same thing.
 */
export type GlobalLookup = {
  byFullName: Map<string, string | "ambiguous">;
  byFirstName: Map<string, string | "ambiguous">;
};

export function buildPlayerNameLookup(
  players: { id: string; display_name: string }[],
): GlobalLookup {
  const byFullName = new Map<string, string | "ambiguous">();
  const byFirstName = new Map<string, string | "ambiguous">();
  for (const p of players) {
    if (!p.display_name) continue;
    const key = normalize(p.display_name);
    if (!key) continue;
    const existing = byFullName.get(key);
    if (existing === undefined) {
      byFullName.set(key, p.id);
    } else if (existing !== p.id) {
      byFullName.set(key, "ambiguous");
    }
    const firstToken = key.split(" ")[0];
    if (firstToken && firstToken !== key) {
      const fe = byFirstName.get(firstToken);
      if (fe === undefined) {
        byFirstName.set(firstToken, p.id);
      } else if (fe !== p.id) {
        byFirstName.set(firstToken, "ambiguous");
      }
    } else if (firstToken === key) {
      // Single-token names (like "Yashu") count both as full name AND
      // first-token; only seed byFirstName if no longer-name player
      // already claimed this token.
      if (!byFirstName.has(firstToken)) {
        byFirstName.set(firstToken, p.id);
      } else if (byFirstName.get(firstToken) !== p.id) {
        byFirstName.set(firstToken, "ambiguous");
      }
    }
  }
  return { byFullName, byFirstName };
}

function resolve(
  name: string,
  matchId: string,
  rosters: MatchRosters,
  globalLookup: GlobalLookup,
): string | null {
  const key = normalize(name);
  if (!key) return null;
  if (key === "sub" || key === "subs" || key === "substitute") return null;

  // Per-match first — handles renames + merges since
  // historical_match_*.player_name preserves cricheroes' original
  // naming and player_id already points at the merged UUID.
  const matchMap = rosters.get(matchId);
  if (matchMap) {
    const v = matchMap.get(key);
    if (v === "ambiguous") return null;
    if (v) return v;
  }

  // Global exact-name fallback — fielder existed globally but
  // didn't appear in this match's batting or bowling roster
  // (typically a sub, or a fielder credited in the commentary that
  // cricheroes never linked to a roster slot).
  const g = globalLookup.byFullName.get(key);
  if (g === "ambiguous") return null;
  if (g) return g;

  // First-name token fallback — cricheroes commentary often
  // shortens to a first name ("Amith" → our record "Amith P").
  // Only credits when exactly one global player matches that
  // first-token; ambiguous tokens skip. Single-token search names
  // hit this branch too (handled symmetrically in
  // buildPlayerNameLookup).
  const ft = globalLookup.byFirstName.get(key);
  if (ft === "ambiguous") return null;
  if (ft) return ft;

  return null;
}

export function parseHistoricalFielders(
  rows: DismissalRow[],
  rosters: MatchRosters,
  globalLookup: GlobalLookup,
): ParsedFielderCredit[] {
  const credits: ParsedFielderCredit[] = [];
  for (const r of rows) {
    const how = (r.how_to_out ?? "").trim();
    if (!how) continue;
    const lc = how.toLowerCase();
    if (lc === "not out" || lc === "retired hurt" || lc === "retired")
      continue;

    // Catch — checked before run-out / stumped because "c Foo b Bar"
    // is the most common shape. CATCH_RE doesn't match "c&b X"
    // because `c\s+` requires whitespace, not an ampersand.
    let m = CATCH_RE.exec(how);
    if (m) {
      const pid = resolve(m[1], r.match_id, rosters, globalLookup);
      if (pid) {
        credits.push({
          match_id: r.match_id,
          innings_number: r.innings_number,
          player_id: pid,
          kind: "catch",
        });
      }
      continue;
    }

    // Caught and bowled — the bowler gets the catch credit.
    m = C_AND_B_RE.exec(how);
    if (m) {
      const pid = resolve(m[1], r.match_id, rosters, globalLookup);
      if (pid) {
        credits.push({
          match_id: r.match_id,
          innings_number: r.innings_number,
          player_id: pid,
          kind: "catch",
        });
      }
      continue;
    }

    // Stumped — only the keeper gets the credit.
    m = STUMPED_RE.exec(how);
    if (m) {
      const pid = resolve(m[1], r.match_id, rosters, globalLookup);
      if (pid) {
        credits.push({
          match_id: r.match_id,
          innings_number: r.innings_number,
          player_id: pid,
          kind: "stumped",
        });
      }
      continue;
    }

    // Run out — may have multiple fielders joined by "/". Credit
    // each separately so e.g. "Sandeep / Pavan Kashyap" gives both a
    // run-out credit (cricket convention).
    m = RUN_OUT_RE.exec(how);
    if (m && m[1]) {
      const names = m[1].split(/\s*\/\s*/);
      for (const name of names) {
        const pid = resolve(name, r.match_id, rosters, globalLookup);
        if (pid) {
          credits.push({
            match_id: r.match_id,
            innings_number: r.innings_number,
            player_id: pid,
            kind: "run_out",
          });
        }
      }
      continue;
    }

    // Bowled / lbw / hit-wicket / obstructing / others — no fielder.
  }
  return credits;
}
