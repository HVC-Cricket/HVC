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
  | "group_then_knockout";

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
};
