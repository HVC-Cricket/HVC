/**
 * Shared tournament-status + format vocabulary. Used by both the
 * tournament listing page and the tournament detail header so the
 * status pill and format chip render identically.
 */

export type TournamentStatus =
  | "draft"
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
  completed: "Completed",
  archived: "Archived",
};

export const STATUS_CLASSES: Record<TournamentStatus, string> = {
  active:
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  draft:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
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
 * Compute the *effective* tournament status from the match statuses,
 * so the badge stays honest as scoring progresses. The stored
 * `tournaments.status` is treated as a fallback — admins set it on
 * create (default `draft`) but rarely remember to flip it later.
 *
 * Rules (in order):
 *   - `archived` is preserved — admins use it to hide old tournaments,
 *     so we never override it.
 *   - Any live / innings_break match → `active`.
 *   - All matches terminal (completed/abandoned) and at least one
 *     exists → `completed`.
 *   - Any completed/abandoned alongside scheduled ones → `active`.
 *   - Otherwise (no matches yet, or only scheduled & nothing played)
 *     → fall back to the stored value (typically `draft`).
 */
export function deriveTournamentStatus(
  stored: TournamentStatus,
  matchStatuses: Array<
    "scheduled" | "live" | "innings_break" | "completed" | "abandoned"
  >,
): TournamentStatus {
  if (stored === "archived") return "archived";
  if (matchStatuses.length === 0) return stored;
  if (matchStatuses.some((s) => s === "live" || s === "innings_break"))
    return "active";
  const terminal = (s: string) => s === "completed" || s === "abandoned";
  if (matchStatuses.every(terminal)) return "completed";
  if (matchStatuses.some(terminal)) return "active";
  return stored;
}
