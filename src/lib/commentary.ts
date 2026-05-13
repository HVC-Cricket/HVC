/**
 * Auto-generated ball-by-ball commentary. Each recorded ball maps to
 * a single line via deterministic templates — no randomness so the
 * output is stable across re-renders (the AutoRefresh tick would
 * otherwise produce different text every 2.5s).
 *
 * Pure function over a ball stream + lookup maps. The match page
 * fetches data, calls `buildCommentaryLines`, and renders the result.
 */

import type { BallRow } from "@/lib/supabase/row-types";

export type CommentaryLine = {
  /** Stable React key + DB row id. */
  key: string;
  /** "X.Y" over notation, cricket convention (`over_number - 1`). */
  over: string;
  /** The narrative text. */
  text: string;
  /** Style hints — wickets and boundaries get colour highlights. */
  isWicket: boolean;
  isBoundary: boolean;
  isFreeHit: boolean;
  /** Caller fills this in; the generator doesn't know which innings. */
  inningsNumber: number;
};

export function buildCommentaryLines(args: {
  balls: BallRow[];
  playerNames: Map<string, string>;
}): CommentaryLine[] {
  const lines: CommentaryLine[] = [];
  for (const b of args.balls) {
    lines.push({
      key: b.id,
      // Cricket convention: completed-overs . balls-into-next.
      over: `${b.over_number - 1}.${b.ball_in_over}`,
      text: formatBall(b, args.playerNames),
      isWicket: b.is_wicket,
      isBoundary: !b.is_wicket && (b.runs_off_bat === 4 || b.runs_off_bat === 6),
      isFreeHit: !!b.is_free_hit,
      inningsNumber: 0,
    });
  }
  return lines;
}

function nameOf(map: Map<string, string>, id: string | null): string {
  if (!id) return "?";
  return map.get(id) ?? "?";
}

function formatBall(b: BallRow, names: Map<string, string>): string {
  const striker = nameOf(names, b.batter_id);
  const bowler = nameOf(names, b.bowler_id);
  const fielder = b.fielder_id ? nameOf(names, b.fielder_id) : null;
  const playerOut = b.player_out_id ? nameOf(names, b.player_out_id) : striker;

  const prefix = b.is_free_hit ? "FREE HIT! " : "";

  if (b.is_wicket) {
    return `${prefix}WICKET! ${formatDismissal(playerOut, bowler, fielder, b.wicket_type ?? null)}`;
  }

  // Extras — wide / no-ball / bye
  if (b.extra_type === "wide") {
    // `b.extras` already includes the 1-run penalty; total runs from
    // this delivery = b.extras (since runs_off_bat is 0 on wides).
    if (b.extras === 1) return `${prefix}Wide signalled by ${bowler}.`;
    return `${prefix}Wide — ${b.extras} runs. The batters scamper an additional ${b.extras - 1}.`;
  }
  if (b.extra_type === "no_ball") {
    // 1 penalty + runs_off_bat to the batter.
    if (b.runs_off_bat === 0) {
      return `${prefix}No-ball! ${bowler} oversteps. 1 extra.`;
    }
    if (b.runs_off_bat === 4) {
      return `${prefix}No-ball, FOUR! ${striker} cashes in for 4 + 1 extra.`;
    }
    if (b.runs_off_bat === 6) {
      return `${prefix}No-ball, SIX! ${striker} sends it sailing — 6 + 1 extra.`;
    }
    return `${prefix}No-ball — ${striker} ${runVerb(b.runs_off_bat)}. ${b.runs_off_bat + b.extras} runs total.`;
  }
  if (b.extra_type === "bye") {
    if (b.extras === 1) return `${prefix}Bye. The batters steal a single.`;
    return `${prefix}Byes — ${b.extras} runs. Sharp running.`;
  }

  // Legal ball, off the bat.
  if (b.runs_off_bat === 0) {
    return `${prefix}Dot ball. ${striker} defends.`;
  }
  if (b.runs_off_bat === 4) {
    return `${prefix}FOUR! ${striker} finds the boundary off ${bowler}.`;
  }
  if (b.runs_off_bat === 6) {
    return `${prefix}SIX! ${striker} clears the rope off ${bowler}.`;
  }
  return `${prefix}${striker} ${runVerb(b.runs_off_bat)}.`;
}

function runVerb(n: number): string {
  switch (n) {
    case 1:
      return "takes a single";
    case 2:
      return "pushes through for two";
    case 3:
      return "runs three";
    case 4:
      return "drives for four";
    case 6:
      return "clears the rope";
    default:
      return `scores ${n}`;
  }
}

function formatDismissal(
  out: string,
  bowler: string,
  fielder: string | null,
  type: string | null,
): string {
  switch (type) {
    case "bowled":
      return `${out} bowled by ${bowler}.`;
    case "caught":
      return `${out} caught by ${fielder ?? "?"} off ${bowler}.`;
    case "caught_and_bowled":
      return `${out} caught & bowled by ${bowler}.`;
    case "stumped":
      return `${out} stumped by ${fielder ?? "?"} off ${bowler}.`;
    case "run_out":
      return fielder
        ? `${out} run out by ${fielder}.`
        : `${out} run out.`;
    case "hit_wicket":
      return `${out} hit wicket off ${bowler}.`;
    case "lbw":
      return `${out} LBW off ${bowler}.`;
    case "retired":
      return `${out} retires hurt.`;
    case "obstructing":
      return `${out} given out — obstructing the field.`;
    case "timed_out":
      return `${out} timed out.`;
    default:
      return `${out} out.`;
  }
}
