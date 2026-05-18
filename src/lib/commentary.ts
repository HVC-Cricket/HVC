/**
 * Auto-generated ball-by-ball commentary. Each recorded ball maps to
 * a single line via deterministic templates — no randomness so the
 * output is stable across re-renders (the AutoRefresh tick would
 * otherwise produce different text every 2.5s).
 *
 * Pure function over a ball stream + lookup maps. The match page
 * fetches data, calls `buildCommentaryLines`, and renders the result.
 *
 * Beyond the per-ball line, the builder also emits short narration
 * lines between balls when the batter pairing changes (innings start,
 * wicket replacements, manual swaps, mid-innings batter substitutions).
 * These keep the feed self-explanatory without needing the scorer to
 * type anything.
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
  /** True for synthetic lines (innings start, replacements, swaps).
   *  Lets the renderer give them a softer style than ball lines. */
  isNarration: boolean;
  /** Caller fills this in; the generator doesn't know which innings. */
  inningsNumber: number;
};

export function buildCommentaryLines(args: {
  balls: BallRow[];
  playerNames: Map<string, string>;
  /** Optional player-category map. Lets the swap detector skip
   *  Cat 1 / Cat 3 special-batter odd-run rotations (stay rule). */
  playerCats?: Map<string, 1 | 2 | 3 | null>;
}): CommentaryLine[] {
  const { balls, playerNames, playerCats } = args;
  const lines: CommentaryLine[] = [];
  if (balls.length === 0) return lines;

  // Innings start — name the opening pair before the first ball.
  const first = balls[0];
  lines.push({
    key: `start-${first.id}`,
    over: `${first.over_number - 1}.0`,
    text: `Innings underway. ${nameOf(playerNames, first.batter_id)} on strike, ${nameOf(playerNames, first.non_striker_id)} at the non-striker end. ${nameOf(playerNames, first.bowler_id)} to bowl the first over.`,
    isWicket: false,
    isBoundary: false,
    isFreeHit: false,
    isNarration: true,
    inningsNumber: 0,
  });

  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];

    // Narrate the transition from the previous ball to this one.
    if (i > 0) {
      const prev = balls[i - 1];
      emitTransitionLines(prev, b, playerNames, playerCats, lines);
    }

    // Per-ball line.
    lines.push({
      key: b.id,
      over: `${b.over_number - 1}.${b.ball_in_over}`,
      text: formatBall(b, playerNames),
      isWicket: b.is_wicket,
      isBoundary: !b.is_wicket && (b.runs_off_bat === 4 || b.runs_off_bat === 6),
      isFreeHit: !!b.is_free_hit,
      isNarration: false,
      inningsNumber: 0,
    });
  }
  return lines;
}

function emitTransitionLines(
  prev: BallRow,
  cur: BallRow,
  names: Map<string, string>,
  cats: Map<string, 1 | 2 | 3 | null> | undefined,
  lines: CommentaryLine[],
): void {
  const prevPair = [prev.batter_id, prev.non_striker_id];
  const curPair = [cur.batter_id, cur.non_striker_id];
  const prevSet = new Set(prevPair);
  const curSet = new Set(curPair);
  const added = curPair.filter((id) => !prevSet.has(id));
  const removed = prevPair.filter((id) => !curSet.has(id));

  const overTag = `${cur.over_number - 1}.${Math.max(0, cur.ball_in_over - 1)}`;

  if (added.length > 0) {
    // New batter(s) entered between balls. Distinguish wicket
    // replacement (engine cleared a slot on the previous ball) from
    // a non-wicket substitution (scorer swapped a batter in mid-
    // innings via the slot picker — happens for corrections, or
    // mid-over special-batter dismissals that the engine handles
    // outside the wicket flow).
    if (prev.is_wicket && prev.player_out_id && added.length === 1) {
      lines.push({
        key: `rep-${cur.id}`,
        over: overTag,
        text: `${nameOf(names, added[0])} comes in to replace dismissed ${nameOf(names, prev.player_out_id)}.`,
        isWicket: false,
        isBoundary: false,
        isFreeHit: false,
        isNarration: true,
        inningsNumber: 0,
      });
    } else {
      // Pair up each new player with the player they replaced (by
      // slot position) so the text reads sensibly.
      for (let i = 0; i < added.length; i++) {
        const came = added[i];
        const went = removed[i] ?? null;
        lines.push({
          key: `chg-${cur.id}-${came}`,
          over: overTag,
          text: went
            ? `${nameOf(names, came)} replaces ${nameOf(names, went)} at the crease.`
            : `${nameOf(names, came)} comes to the crease.`,
          isWicket: false,
          isBoundary: false,
          isFreeHit: false,
          isNarration: true,
          inningsNumber: 0,
        });
      }
    }
    return;
  }

  // Same pair across both balls — check for an unexpected end-swap.
  // Skip if the previous ball was a wicket (the slot bookkeeping there
  // is already covered by the replacement branch above).
  if (prev.is_wicket) return;

  if (prev.batter_id === cur.batter_id) return; // no swap at all

  // Compute the expected post-rotation pair from `prev` and compare
  // against `cur`. If they don't match, a manual swap happened
  // between balls (`⇄ Swap` button on the scoreboard).
  const expected = expectedRotation(prev, cats?.get(prev.batter_id) ?? null);
  if (
    expected.batter === cur.batter_id &&
    expected.non_striker === cur.non_striker_id
  ) {
    return; // natural rotation, no narration needed
  }

  lines.push({
    key: `swap-${cur.id}`,
    over: overTag,
    text: `Ends switched. ${nameOf(names, cur.batter_id)} now on strike, ${nameOf(names, cur.non_striker_id)} at the non-striker end.`,
    isWicket: false,
    isBoundary: false,
    isFreeHit: false,
    isNarration: true,
    inningsNumber: 0,
  });
}

/** Mirrors the engine's strike-rotation rules for a non-wicket ball.
 *  Returns the expected striker / non-striker for the NEXT ball
 *  assuming no manual swap and no batter substitution. */
function expectedRotation(
  prev: BallRow,
  prevStrikerCat: 1 | 2 | 3 | null,
): { batter: string; non_striker: string } {
  let batter = prev.batter_id;
  let non_striker = prev.non_striker_id;

  // Rotation runs. Wide / no-ball penalty doesn't rotate; running on
  // top of an extra does. Byes are credited to extras but the batters
  // physically ran for them, so they rotate.
  let rotationRuns = prev.runs_off_bat;
  if (prev.extra_type === "bye") {
    rotationRuns += prev.extras;
  } else if (prev.extra_type === "wide" || prev.extra_type === "no_ball") {
    rotationRuns += Math.max(0, prev.extras - 1);
  }
  const isOdd = rotationRuns % 2 === 1;

  // Cat 1 / Cat 3 striker → stay-rule suppresses odd-run swap.
  const isSpecialStay = prevStrikerCat === 1 || prevStrikerCat === 3;
  if (isOdd && !isSpecialStay) {
    [batter, non_striker] = [non_striker, batter];
  }

  // End-of-over swap fires on the 6th LEGAL ball of the over (wides /
  // no-balls don't tick `ball_in_over`).
  const isLegalBall = !prev.extra_type || prev.extra_type === "bye";
  if (isLegalBall && prev.ball_in_over === 6) {
    [batter, non_striker] = [non_striker, batter];
  }

  return { batter, non_striker };
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
