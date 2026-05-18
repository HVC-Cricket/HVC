// Pure types for the scoring engine. No I/O, no React.
// Ball + state shapes match what we eventually persist to Postgres,
// but the engine itself is decoupled from Supabase.

export type ExtraType = "wide" | "no_ball" | "bye";

export type WicketType =
  | "bowled"
  | "caught"
  | "caught_and_bowled"
  | "run_out"
  | "stumped"
  | "hit_wicket"
  | "retired"
  | "obstructing"
  | "timed_out";

export type PlayerCategory = 1 | 2 | 3;

/**
 * Per-tournament rule set. Drives validation in `applyBall` and which
 * dismissals are legal under different ball contexts (free hit, no-ball, etc.).
 * Encoded as plain JSON so it can live in `tournaments.rules` JSONB.
 */
export type RuleSet = {
  overs_per_innings: number;
  players_per_side: number;
  max_overs_per_bowler: number;
  /**
   * Last-man standing: when true, the innings continues until the
   * LAST batsman is dismissed (wickets cap = `players_per_side`,
   * not `players_per_side - 1`). While only the last batsman remains
   * at the crease, strike rotation is disabled and the non-striker
   * slot stays frozen (the previously-dismissed batter stays in it
   * as a "dummy" non-striker — slot is locked in the UI).
   * Box-cricket convention; HVC: true. Standard cricket: false.
   * Does not apply inside super overs.
   */
  last_man_standing: boolean;

  /**
   * Default cricket-style strike rotation: odd runs swap ends, end of over
   * swaps ends. HVC overrides during Cat 1/3 special overs.
   */
  strike_rotation: "standard";

  extras: {
    /** byes counted as innings extras */
    byes: boolean;
    /** leg-byes counted (HVC: false) */
    leg_byes: boolean;
    /** ball is dead the moment an overthrow hits the batsman (HVC: true) */
    overthrow_dead_on_batsman: boolean;
  };

  no_ball: {
    /** if true, every no-ball causes the next legal delivery to be a free hit */
    causes_free_hit: boolean;
  };

  free_hit: {
    /** dismissal types that DO count as out on a free-hit ball */
    out_dismissals: WicketType[];
  };

  /** which wicket types are even allowed in the engine (HVC: no LBW) */
  allowed_wicket_types: WicketType[];

  /** HVC category bowling/batting rules */
  categories: {
    enabled: boolean;
    /**
     * Overs where the Cat 1 specialist bats + bowls. Each entry is a
     * 1-based over number within the innings. Empty array means no
     * over is Cat 1 (tournament has no Cat 1 players, or Cat 1 rule
     * is disabled for this match). Replaces the legacy scalar
     * `cat1_over` so a single tournament can have Cat 1 in any over,
     * multiple overs, or none at all.
     */
    cat1_overs: number[];
    /**
     * Overs where the Cat 3 specialist bats + bowls. Same semantics
     * as `cat1_overs`.
     */
    cat3_overs: number[];
    /**
     * In Cat 1/3 special overs:
     *  - "first_only": only the first dismissal of the special batter counts
     *  - "all": every dismissal counts (negative scoring)
     */
    cat_special_dismissals: "first_only" | "all";
    /**
     * Strike rotation override during the special over for the special batter:
     *  - "stay": special batter stays on strike regardless of runs
     *  - "standard": rotate normally
     */
    cat_special_strike: "stay" | "standard";
    /**
     * If non-striker is run-out during the special over, do they get
     * permanently barred from batting later in the match?
     */
    cat_special_non_striker_lock: boolean;
  };

  super_over: {
    enabled: boolean;
    overs: number;
    max_wickets: number;
    /** number of batters teams nominate before the super over */
    nominate_batters: number;
    /** team that batted second in main match bats first in super over */
    second_team_bats_first: boolean;
  };
};

/**
 * Player metadata as the engine sees it. Pulled from `players` + `match_players`
 * before innings start. Engine is read-only on this; mutations go to state.
 */
export type EnginePlayer = {
  id: string;
  display_name: string;
  category: PlayerCategory | null;
  team_id: string;
};

/**
 * Snapshot of innings state. Engine produces a new state per ball via `applyBall`.
 * Persisted balls in Postgres can be replayed through the engine to derive any
 * historical state.
 */
export type InningsState = {
  innings_number: number;
  batting_team_id: string;
  bowling_team_id: string;

  total_runs: number;
  total_wickets: number;
  legal_balls: number;
  extras_wides: number;
  extras_no_balls: number;
  extras_byes: number;

  current_over_number: number;
  ball_in_over: number;

  striker_id: string;
  non_striker_id: string;
  bowler_id: string;

  free_hit_pending: boolean;

  /** legal balls bowled by each bowler this innings — used for max-overs cap */
  bowler_legal_balls: Record<string, number>;
  /** wickets each bowler has taken (for stats) */
  bowler_wickets: Record<string, number>;

  /** player_ids barred from batting (e.g. non-striker run-out in special over) */
  barred_batters: Set<string>;
  /** player_ids already dismissed (so we don't double-count) */
  dismissed: Set<string>;

  /**
   * If we're in a category-special over (HVC over 1 or 2), tracks:
   *  - which over type (cat1 / cat3)
   *  - the special batter's id
   *  - whether the special batter has been dismissed this over (for first_only rule)
   */
  special_over: {
    type: "cat1" | "cat3";
    special_batter_id: string;
    special_batter_dismissed: boolean;
  } | null;

  /** is this innings part of a super over? gates wicket cap + super-over messaging */
  is_super_over: boolean;
  is_complete: boolean;
};

/**
 * Input from the scorer for a single delivery. Mirrors the `balls` table.
 * The engine validates and computes the resulting state delta.
 */
export type BallInput = {
  runs_off_bat: number;
  extras: number;
  extra_type: ExtraType | null;
  is_wicket: boolean;
  wicket_type?: WicketType | null;
  /**
   * If the dismissed player isn't the striker (e.g. run-out of non-striker),
   * pass the explicit player_id. Defaults to striker.
   */
  player_out_id?: string | null;
  fielder_id?: string | null;
  /** scorer's tournament-supplied flag — ignored by HVC ruleset */
  is_powerplay?: boolean;
  /** whether overthrow ricocheted onto the batsman (caps the ball at that point) */
  overthrow_hit_batsman?: boolean;
  commentary?: string;
};

export type EngineError = {
  code:
    | "invalid_bowler"
    | "invalid_wicket_type"
    | "invalid_free_hit_dismissal"
    | "invalid_extra_type"
    | "barred_batter"
    | "innings_complete"
    | "negative_runs"
    | "bowler_at_max"
    | "rule_violation";
  message: string;
};

export type ApplyBallResult =
  | { ok: true; state: InningsState }
  | { ok: false; error: EngineError };
