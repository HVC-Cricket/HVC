/**
 * Shared match-status vocabulary — labels + Tailwind class sets for
 * the status pill. Imported by both the match detail header and the
 * tournament-page match list so the pill renders identically in both
 * places. If you change a colour here, both surfaces update.
 */

export type MatchStatus =
  | "scheduled"
  | "live"
  | "innings_break"
  | "completed"
  | "abandoned";

export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  scheduled: "Scheduled",
  live: "Live",
  innings_break: "Innings break",
  completed: "Completed",
  abandoned: "Abandoned",
};

export const MATCH_STATUS_CLASSES: Record<MatchStatus, string> = {
  scheduled: "border-foreground/15 bg-muted text-muted-foreground",
  live: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  innings_break:
    "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  completed:
    "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  abandoned: "border-destructive/30 bg-destructive/10 text-destructive",
};

export type MatchStage =
  | "group"
  | "qualifier"
  | "qualifier_1"
  | "eliminator"
  | "qualifier_2"
  | "quarter"
  | "semi"
  | "final"
  | "exhibition";

export const MATCH_STAGE_LABEL: Record<MatchStage, string> = {
  group: "Group",
  qualifier: "Qualifier",
  qualifier_1: "Qualifier 1",
  eliminator: "Eliminator",
  qualifier_2: "Qualifier 2",
  quarter: "Quarter-final",
  semi: "Semi-final",
  final: "Final",
  exhibition: "Exhibition",
};

/**
 * Stages relevant for a given tournament format. Drives the dropdown
 * in the new/edit match forms so the IPL-style format gets
 * "Qualifier 1 / Eliminator / Qualifier 2 / Final" instead of the
 * generic "Qualifier / Quarter-final / Semi-final".
 *
 * `exhibition` is always available — a friendly / one-off match can
 * happen in any format.
 */
export function stagesForFormat(
  format:
    | "league"
    | "knockout"
    | "group_then_knockout"
    | "round_robin_playoff_final",
): MatchStage[] {
  switch (format) {
    case "league":
      return ["group", "exhibition"];
    case "knockout":
      return ["qualifier", "quarter", "semi", "final", "exhibition"];
    case "group_then_knockout":
      return [
        "group",
        "qualifier",
        "quarter",
        "semi",
        "final",
        "exhibition",
      ];
    case "round_robin_playoff_final":
      return [
        "group",
        "qualifier_1",
        "eliminator",
        "qualifier_2",
        "final",
        "exhibition",
      ];
  }
}
