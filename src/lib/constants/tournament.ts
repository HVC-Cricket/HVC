/**
 * Shared tournament-status + format vocabulary. Used by both the
 * tournament listing page and the tournament detail header so the
 * status pill and format chip render identically.
 */

import { stagesForFormat, type MatchStage, type MatchStatus } from "./match";

export type TournamentStatus =
  | "draft"
  | "upcoming"
  | "active"
  | "completed"
  | "archived";

export type TournamentFormat =
  | "league"
  | "knockout"
  | "group_then_knockout"
  | "round_robin_playoff_final";

export const STATUS_LABEL: Record<TournamentStatus, string> = {
  active: "Live",
  draft: "Draft",
  upcoming: "Upcoming",
  completed: "Completed",
  archived: "Archived",
};

export const STATUS_CLASSES: Record<TournamentStatus, string> = {
  active:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  draft:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  upcoming:
    "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  completed:
    "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  archived: "border-foreground/15 bg-muted text-muted-foreground",
};

export const FORMAT_LABEL: Record<TournamentFormat, string> = {
  league: "League",
  knockout: "Knockout",
  group_then_knockout: "Group → Knockout",
  round_robin_playoff_final: "Round Robin → Playoff → Final",
};

/**
 * Compute the *effective* tournament status from the match list, so the
 * badge stays honest as scoring progresses. The stored
 * `tournaments.status` is treated as a fallback — admins set it on
 * create (default `draft`) but rarely remember to flip it later.
 *
 * Rules (in order):
 *   - `archived` is preserved — admins use it to hide old tournaments,
 *     so we never override it.
 *   - Any live / innings_break match → `active`.
 *   - All matches terminal (completed/abandoned):
 *       - For formats that include a Final stage (knockout,
 *         group_then_knockout, round_robin_playoff_final): only
 *         `completed` if a final-stage match exists AND is terminal.
 *         Otherwise the tournament is between phases (e.g. group is
 *         done, playoffs haven't been scheduled yet) → keep `active`
 *         so admins see the badge still pulsing while they set up the
 *         next round.
 *       - Other formats → `completed`.
 *   - Any completed/abandoned alongside scheduled ones → `active`.
 *   - Otherwise (no matches yet, or only scheduled & nothing played)
 *     → fall back to the stored value (typically `draft`).
 */
export function deriveTournamentStatus(
  stored: TournamentStatus,
  matches: Array<{ stage: MatchStage; status: MatchStatus }>,
  format: TournamentFormat,
): TournamentStatus {
  if (stored === "archived") return "archived";
  if (matches.length === 0) return stored;
  if (matches.some((m) => m.status === "live" || m.status === "innings_break"))
    return "active";
  const terminal = (s: MatchStatus) => s === "completed" || s === "abandoned";
  const hasFinal = stagesForFormat(format).includes("final");
  if (matches.every((m) => terminal(m.status))) {
    if (hasFinal) {
      const finalDone = matches.some(
        (m) => m.stage === "final" && terminal(m.status),
      );
      if (!finalDone) return "active";
    }
    return "completed";
  }
  if (matches.some((m) => terminal(m.status))) return "active";
  return stored;
}
