/**
 * Engine-replay helpers shared between the page state loader and the
 * `recordBall` Server Action. Both need to walk through the recorded
 * balls of an innings and project them onto an `InningsState` so they
 * can read out the post-rotation striker / non-striker / bowler /
 * free-hit / dismissed-set. The loop was duplicated until this module.
 */

import {
  type EnginePlayer,
  type ExtraType,
  type InningsState,
  type RuleSet,
  type WicketType,
} from "./types";
import {
  advanceBowler,
  applyBall,
  setNonStriker,
  setStriker,
  startInnings,
} from "./engine";

/**
 * Minimal shape `replayInnings` needs from each ball. Both the full
 * `BallRow` and the slimmer column-pick used inside `recordBall`
 * satisfy it.
 */
export type ReplayBall = {
  batter_id: string;
  non_striker_id: string;
  bowler_id: string;
  runs_off_bat: number;
  extras: number;
  extra_type: string | null;
  is_wicket: boolean;
  wicket_type: string | null;
  player_out_id: string | null;
  /** Optional — actions.ts doesn't select this column. The engine
   *  treats it as informational on caught/run_out/stumped balls. */
  fielder_id?: string | null;
};

/**
 * Builds an `(id) => EnginePlayer` factory from the two lookup maps
 * server components already compute (player metadata + which team
 * each player is on). Curries out the boilerplate so callers can
 * write `replayInnings({ toEnginePlayer, ... })` instead of inlining.
 */
export function createEnginePlayerFactory(
  playerById: Map<
    string,
    { display_name: string; category: 1 | 2 | 3 | null }
  >,
  teamByPlayer: Map<string, string>,
): (id: string) => EnginePlayer {
  return (id) => {
    const p = playerById.get(id);
    return {
      id,
      display_name: p?.display_name ?? "?",
      category: p?.category ?? null,
      team_id: teamByPlayer.get(id) ?? "",
    };
  };
}

export type ReplayResult =
  | { ok: true; state: InningsState }
  | {
      ok: false;
      /** Whatever the engine had at the point of failure. */
      state: InningsState;
      /** Index of the ball that failed. */
      failedAtIndex: number;
      /** Engine error message. */
      error: string;
    };

/**
 * Seed `startInnings` with the opening trio, then replay every
 * recorded ball through the engine in order. Each iteration syncs
 * striker / non-striker / bowler from the ball row before calling
 * `applyBall` — `applyBall` doesn't take those as input, so without
 * the sync the engine's slots would stay glued to the seed.
 */
export function replayInnings(args: {
  innings_number: number;
  batting_team_id: string;
  bowling_team_id: string;
  is_super_over: boolean;
  seedStriker: EnginePlayer;
  seedNonStriker: EnginePlayer;
  seedBowler: EnginePlayer;
  balls: readonly ReplayBall[];
  rules: RuleSet;
  toEnginePlayer: (id: string) => EnginePlayer;
}): ReplayResult {
  let state = startInnings({
    innings_number: args.innings_number,
    batting_team_id: args.batting_team_id,
    bowling_team_id: args.bowling_team_id,
    is_super_over: args.is_super_over,
    striker: args.seedStriker,
    non_striker: args.seedNonStriker,
    bowler: args.seedBowler,
    rules: args.rules,
  });

  for (let i = 0; i < args.balls.length; i++) {
    const b = args.balls[i];

    // Sync the engine's slot identities with what's on the ball row.
    // This is the bit that catches mid-innings substitutions (a new
    // batter coming in after a wicket, a bowler change at end of
    // over) so engine.dismissed / engine.bowler_legal_balls etc. stay
    // accurate.
    if (b.batter_id !== state.striker_id) {
      state = setStriker(state, b.batter_id);
    }
    if (b.non_striker_id !== state.non_striker_id) {
      state = setNonStriker(state, b.non_striker_id);
    }
    if (b.bowler_id !== state.bowler_id) {
      state = advanceBowler(
        state,
        args.toEnginePlayer(b.bowler_id),
        args.toEnginePlayer(state.striker_id),
        args.toEnginePlayer(state.non_striker_id),
        args.rules,
      );
    }

    const r = applyBall(
      state,
      {
        runs_off_bat: b.runs_off_bat,
        extras: b.extras,
        extra_type: b.extra_type as ExtraType | null,
        is_wicket: b.is_wicket,
        wicket_type: b.wicket_type as WicketType | null,
        player_out_id: b.player_out_id,
        fielder_id: b.fielder_id ?? null,
      },
      args.rules,
    );
    if (!r.ok) {
      return {
        ok: false,
        state,
        failedAtIndex: i,
        error: r.error.message,
      };
    }
    state = r.state;
  }
  return { ok: true, state };
}
