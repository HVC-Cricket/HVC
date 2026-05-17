import type {
  ApplyBallResult,
  BallInput,
  EngineError,
  EnginePlayer,
  InningsState,
  RuleSet,
} from "./types";

// ---------------------------------------------------------------------------
// State init
// ---------------------------------------------------------------------------

/**
 * Build the starting state of an innings, given the playing XIs, opening
 * batters / bowler, and the rule set in force.
 *
 * The engine is purely derivable from initial state + the sequence of balls,
 * which is what `balls` in Postgres stores. Re-deriving any historical state
 * is just "fold applyBall over balls".
 */
export function startInnings(args: {
  innings_number: number;
  batting_team_id: string;
  bowling_team_id: string;
  is_super_over?: boolean;
  striker: EnginePlayer;
  non_striker: EnginePlayer;
  bowler: EnginePlayer;
  rules: RuleSet;
}): InningsState {
  const {
    innings_number,
    batting_team_id,
    bowling_team_id,
    is_super_over = false,
    striker,
    non_striker,
    bowler,
    rules,
  } = args;

  const current_over_number = 1;
  const special_over = computeSpecialOverContext(
    current_over_number,
    striker,
    non_striker,
    rules,
    is_super_over,
  );

  return {
    innings_number,
    batting_team_id,
    bowling_team_id,
    total_runs: 0,
    total_wickets: 0,
    legal_balls: 0,
    extras_wides: 0,
    extras_no_balls: 0,
    extras_byes: 0,
    current_over_number,
    ball_in_over: 0,
    striker_id: striker.id,
    non_striker_id: non_striker.id,
    bowler_id: bowler.id,
    free_hit_pending: false,
    bowler_legal_balls: { [bowler.id]: 0 },
    bowler_wickets: { [bowler.id]: 0 },
    barred_batters: new Set<string>(),
    dismissed: new Set<string>(),
    special_over,
    is_super_over,
    is_complete: false,
  };
}

/**
 * Decide whether the current over is a category-special over (Cat 1 or
 * Cat 3) and, if so, who the special batter is.
 *
 * The Category dropdown on the scoreboard gates the striker pick so that
 * a Cat 1 striker only ever appears when the scorer has declared a Cat 1
 * over (likewise Cat 3). We therefore derive the context from the
 * striker's category alone: any over with a Cat 1 striker is a Cat 1
 * special over, any over with a Cat 3 striker is a Cat 3 special over.
 * `over_number` is no longer used and the legacy `cat1_over`/`cat3_over`
 * rule fields are now informational only.
 */
function computeSpecialOverContext(
  _over_number: number,
  striker: EnginePlayer,
  _non_striker: EnginePlayer,
  rules: RuleSet,
  isSuperOver: boolean,
): InningsState["special_over"] {
  if (!rules.categories.enabled) return null;
  // Super overs have no Cat 1 / Cat 3 special-batter rule — any
  // category player can bat or bowl and standard rotation applies.
  if (isSuperOver) return null;

  if (striker.category === 1) {
    return {
      type: "cat1",
      special_batter_id: striker.id,
      special_batter_dismissed: false,
    };
  }
  if (striker.category === 3) {
    return {
      type: "cat3",
      special_batter_id: striker.id,
      special_batter_dismissed: false,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// applyBall
// ---------------------------------------------------------------------------

/**
 * Validate and apply a single ball to an innings state. Returns either the
 * new state or a structured error. Pure function: no I/O, no mutation of input.
 */
export function applyBall(
  state: InningsState,
  ball: BallInput,
  rules: RuleSet,
): ApplyBallResult {
  if (state.is_complete) {
    return err("innings_complete", "Innings already complete");
  }
  if (ball.runs_off_bat < 0 || ball.extras < 0) {
    return err("negative_runs", "Runs cannot be negative");
  }
  if (ball.extra_type) {
    if (ball.extra_type === "bye" && !rules.extras.byes) {
      return err("invalid_extra_type", "Byes are not allowed in this ruleset");
    }
  }
  if (ball.is_wicket) {
    if (
      !ball.wicket_type ||
      !rules.allowed_wicket_types.includes(ball.wicket_type)
    ) {
      return err(
        "invalid_wicket_type",
        `Wicket type "${ball.wicket_type ?? "none"}" not allowed`,
      );
    }
    // Free-hit dismissal restriction
    if (
      state.free_hit_pending &&
      !rules.free_hit.out_dismissals.includes(ball.wicket_type)
    ) {
      return err(
        "invalid_free_hit_dismissal",
        `On a free hit, only ${rules.free_hit.out_dismissals.join(", ")} are out`,
      );
    }
  }

  // Bowler max-overs check (legal balls only — wides/no-balls don't count
  // toward the over total). Allow continuing the current over if already
  // partway through; only refuse to *start* a new over once at the cap.
  const bowlerLegalBefore = state.bowler_legal_balls[state.bowler_id] ?? 0;
  const ballsPerOver = 6;
  const maxLegal = rules.max_overs_per_bowler * ballsPerOver;
  if (bowlerLegalBefore >= maxLegal) {
    return err(
      "bowler_at_max",
      `Bowler is at max ${rules.max_overs_per_bowler} overs`,
    );
  }

  // ---- Now compute the new state ----
  const next: InningsState = cloneState(state);
  const isLegalBall = !ball.extra_type || ball.extra_type === "bye";
  const isWide = ball.extra_type === "wide";
  const isNoBall = ball.extra_type === "no_ball";
  const isBye = ball.extra_type === "bye";

  // Runs accumulation
  next.total_runs += ball.runs_off_bat + ball.extras;
  if (isWide) next.extras_wides += ball.extras;
  if (isNoBall) next.extras_no_balls += ball.extras;
  if (isBye) next.extras_byes += ball.extras;

  // Free-hit lifecycle
  if (isNoBall) {
    if (rules.no_ball.causes_free_hit) next.free_hit_pending = true;
  } else if (isLegalBall) {
    // legal ball consumes the free hit (ball was bowled)
    next.free_hit_pending = false;
  }
  // wides leave the free-hit flag unchanged (next legal ball is still a free hit)

  // Legal-ball + bowler-balls counters
  if (isLegalBall) {
    next.legal_balls += 1;
    next.ball_in_over += 1;
    next.bowler_legal_balls[state.bowler_id] =
      (next.bowler_legal_balls[state.bowler_id] ?? 0) + 1;
  }

  // Wicket processing
  if (ball.is_wicket && ball.wicket_type) {
    const dismissedId = ball.player_out_id ?? state.striker_id;
    const isSpecialOver = state.special_over !== null;
    const isSpecialBatter =
      isSpecialOver &&
      dismissedId === state.special_over!.special_batter_id;

    let wicketCounts = true;

    // Cat 1/3 special-batter rule
    if (isSpecialOver && isSpecialBatter) {
      if (
        rules.categories.cat_special_dismissals === "first_only" &&
        state.special_over!.special_batter_dismissed
      ) {
        // already dismissed once this over → ignore
        wicketCounts = false;
      } else {
        next.special_over = {
          ...state.special_over!,
          special_batter_dismissed: true,
        };
      }
    }

    // Cat 1/3 non-striker run-out lock
    if (
      isSpecialOver &&
      ball.wicket_type === "run_out" &&
      dismissedId === state.non_striker_id &&
      rules.categories.cat_special_non_striker_lock
    ) {
      next.barred_batters.add(dismissedId);
    }

    if (wicketCounts) {
      next.total_wickets += 1;
      next.dismissed.add(dismissedId);
      next.bowler_wickets[state.bowler_id] =
        (next.bowler_wickets[state.bowler_id] ?? 0) + 1;
    }
  }

  // Strike rotation
  // 1) Special batter "stay" overrides standard rotation while they're at the crease
  // 2) Otherwise: rotate when the batsmen actually ran an odd number of times
  // 3) End-of-over swap (always, unless innings ends)
  //
  // What counts as a "run" for rotation:
  //   - Bat runs on a legal ball (1, 3, 5 → swap)
  //   - Bat runs on a no-ball (the penalty isn't a run, but odd bat
  //     runs still rotate — NB+1 / NB+3 swap, NB+0 / NB+2 don't)
  //   - Byes (legal-ball byes, or extras-above-penalty on a no-ball /
  //     wide which are byes / overthrows the batsmen ran for)
  // The 1-run penalty on wides + no-balls itself doesn't trigger
  // rotation; only the additional running does.
  let rotationRuns = ball.runs_off_bat;
  if (isBye) {
    rotationRuns += ball.extras;
  } else if (isWide || isNoBall) {
    rotationRuns += Math.max(0, ball.extras - 1);
  }
  const isOddRun = rotationRuns % 2 === 1;
  let shouldRotateOnRuns = isOddRun;

  if (
    state.special_over &&
    rules.categories.cat_special_strike === "stay" &&
    (state.striker_id === state.special_over.special_batter_id ||
      state.non_striker_id === state.special_over.special_batter_id)
  ) {
    shouldRotateOnRuns = false; // special batter stays on strike
  }

  // Last-man standing: once only one batter remains live, the striker
  // stays on strike regardless of runs and end-of-over doesn't swap
  // ends. `dismissed.size` is the unique-batters-out count (not
  // `total_wickets`, which can lag in special overs).
  const lastManMode =
    rules.last_man_standing &&
    !next.is_super_over &&
    next.dismissed.size >= rules.players_per_side - 1;
  if (lastManMode) {
    shouldRotateOnRuns = false;
  }

  if (shouldRotateOnRuns) {
    [next.striker_id, next.non_striker_id] = [
      next.non_striker_id,
      next.striker_id,
    ];
  }

  // End of over: swap ends and reset ball_in_over. Caller advances the bowler
  // separately via `advanceBowler`, which also recomputes `special_over`
  // for the new over. We clear it here so the in-between state (after
  // ball 6, before advanceBowler) doesn't claim the previous over's
  // special context still holds — otherwise the loader can't tell that
  // a dismissed special batter who swapped into the non-striker slot
  // should now leave the field. In last-man mode the lone batter stays
  // at the striker end across overs too — skip the swap.
  if (next.ball_in_over === ballsPerOver) {
    if (!lastManMode) {
      [next.striker_id, next.non_striker_id] = [
        next.non_striker_id,
        next.striker_id,
      ];
    }
    next.ball_in_over = 0;
    next.current_over_number += 1;
    next.special_over = null;
  }

  // Innings end conditions
  const oversComplete =
    next.current_over_number > rules.overs_per_innings && next.ball_in_over === 0;
  // Last-man-standing: innings ends when ALL N batters are dismissed.
  // Standard cricket: innings ends at N-1 (one batter unavailable).
  const wicketsCap =
    rules.last_man_standing && !next.is_super_over
      ? rules.players_per_side
      : rules.players_per_side - 1;
  const allOut = next.total_wickets >= wicketsCap;
  const superOverWicketsCap = rules.super_over.max_wickets;
  const superOverDone =
    next.is_super_over && next.total_wickets >= superOverWicketsCap;
  const superOverOversDone =
    next.is_super_over &&
    next.current_over_number > rules.super_over.overs &&
    next.ball_in_over === 0;

  if (oversComplete || allOut || superOverDone || superOverOversDone) {
    next.is_complete = true;
  }

  return { ok: true, state: next };
}

// ---------------------------------------------------------------------------
// State transitions outside applyBall
// ---------------------------------------------------------------------------

/** Set the next bowler at the start of an over. Recomputes special-over context. */
export function advanceBowler(
  state: InningsState,
  bowler: EnginePlayer,
  striker: EnginePlayer,
  non_striker: EnginePlayer,
  rules: RuleSet,
): InningsState {
  const next = cloneState(state);
  next.bowler_id = bowler.id;
  if (next.bowler_legal_balls[bowler.id] === undefined) {
    next.bowler_legal_balls[bowler.id] = 0;
    next.bowler_wickets[bowler.id] = 0;
  }
  next.special_over = computeSpecialOverContext(
    next.current_over_number,
    striker,
    non_striker,
    rules,
    next.is_super_over,
  );
  return next;
}

/**
 * Replace the striker (after a wicket, for instance — except when a Cat 1/3
 * special batter stays at the crease per `cat_special_strike`).
 */
export function setStriker(
  state: InningsState,
  newStrikerId: string,
): InningsState {
  const next = cloneState(state);
  next.striker_id = newStrikerId;
  return next;
}

export function setNonStriker(
  state: InningsState,
  newNonStrikerId: string,
): InningsState {
  const next = cloneState(state);
  next.non_striker_id = newNonStrikerId;
  return next;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneState(s: InningsState): InningsState {
  return {
    ...s,
    bowler_legal_balls: { ...s.bowler_legal_balls },
    bowler_wickets: { ...s.bowler_wickets },
    barred_batters: new Set(s.barred_batters),
    dismissed: new Set(s.dismissed),
    special_over: s.special_over ? { ...s.special_over } : null,
  };
}

function err(code: EngineError["code"], message: string): ApplyBallResult {
  return { ok: false, error: { code, message } };
}
