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
 * Name matching is case-insensitive exact. Ambiguous names (multiple
 * players normalise to the same key) silently skip — better to miss
 * a few credits than to attribute wrong ones. Unmatched names also
 * skip silently. Both cases are acceptable: the FIELD leaderboards
 * are "best-effort historical" rather than "complete".
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

const CATCH_RE = /^c\s+†?\s*(.+?)\s+b\s+/i;
const C_AND_B_RE = /^c&b\s+(.+)$/i;
const STUMPED_RE = /^st\s+†?\s*(.+?)\s+b\s+/i;
const RUN_OUT_RE = /^run\s*-?\s*out(?:\s+(.+?))?\s*(?:\(.*\))?$/i;

/**
 * Lower-case, trim, collapse whitespace, strip the cricheroes
 * keeper-marker dagger. Both the players-table key AND the parsed
 * dismissal name go through this — no asymmetry.
 */
function normalize(name: string): string {
  return name
    .replace(/†/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Build a `normalised name -> player_id` index. When two players
 * normalise to the same key (e.g., two "Sridhar"s), the entry is
 * `"ambiguous"` and downstream resolution skips that name entirely.
 */
export function buildPlayerNameLookup(
  players: { id: string; display_name: string }[],
): Map<string, string | "ambiguous"> {
  const lookup = new Map<string, string | "ambiguous">();
  for (const p of players) {
    if (!p.display_name) continue;
    const key = normalize(p.display_name);
    if (!key) continue;
    if (lookup.has(key)) {
      lookup.set(key, "ambiguous");
    } else {
      lookup.set(key, p.id);
    }
  }
  return lookup;
}

function resolve(
  name: string,
  lookup: Map<string, string | "ambiguous">,
): string | null {
  const key = normalize(name);
  if (!key) return null;
  const v = lookup.get(key);
  if (v === undefined || v === "ambiguous") return null;
  return v;
}

export function parseHistoricalFielders(
  rows: DismissalRow[],
  lookup: Map<string, string | "ambiguous">,
): ParsedFielderCredit[] {
  const credits: ParsedFielderCredit[] = [];
  for (const r of rows) {
    const how = (r.how_to_out ?? "").trim();
    if (!how) continue;
    const lc = how.toLowerCase();
    if (lc === "not out" || lc === "retired hurt") continue;

    // Catch — checked before run-out / stumped because "c Foo b Bar"
    // is the most common shape. CATCH_RE doesn't match "c&b X"
    // because `c\s+` requires whitespace, not an ampersand.
    let m = CATCH_RE.exec(how);
    if (m) {
      const pid = resolve(m[1], lookup);
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
      const pid = resolve(m[1], lookup);
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
      const pid = resolve(m[1], lookup);
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
        const pid = resolve(name, lookup);
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
