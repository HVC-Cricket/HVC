import { computeBatterStats, computeBowlerStats } from "./stats";
import type { BallRow } from "@/lib/supabase/row-types";

/**
 * Most-Valuable-Player scoring for HVC box cricket.
 *
 * Transparent, flat point system tuned for HVC's 7-over format where
 * the ground is small, run-rates run 18+ as a baseline, individual
 * strike rates of 200+ are par, and bowlers don't get cheap "low econ"
 * options the way they do in regular cricket. Same formula drives the
 * per-match Player-of-the-Match award and the tournament-wide MVP
 * leaderboard — keeping them on one ruleset means the tournament MVP
 * is literally "the sum of POTM scores so far."
 *
 * BATTING
 *   +1 per run
 *   +2 per four, +5 per six
 *   +6 if runs ≥ 25                      (steady contribution tier)
 *   +20 if runs ≥ 50
 *   +40 if runs ≥ 75                     (top-quality knock in 7 overs)
 *   Strike-rate bonus (only with ≥6 balls faced):
 *     SR ≥ 300: +12                       (elite)
 *     SR ≥ 250: +8                        (very good)
 *     SR ≥ 200: +4                        (good — par for box cricket)
 *     SR ≥ 150: +2                        (acceptable)
 *   +5 if not out with ≥ 15 runs         (finished the innings)
 *   −3 duck penalty (out for 0, ≥1 ball)
 *
 * BOWLING
 *   +20 per wicket
 *   Multi-wicket haul (highest tier only):
 *     2 wkts: +5
 *     3 wkts: +15
 *     4+ wkts: +30
 *   +12 per maiden over                  (rare in box cricket — keep)
 *   +1 per dot ball
 *   Economy bonus (only with ≥6 legal balls bowled), box-cricket scale:
 *     econ < 10: +12                      (elite)
 *     econ < 12: +8                       (very good)
 *     econ < 14: +5                       (good)
 *     econ < 16: +2                       (decent)
 *   No econ penalty — at this format any econ is plausible given a
 *   small ground; better to reward the good ones than punish the rest.
 *
 * FIELDING
 *   +8 per catch (caught_and_bowled credits the bowler)
 *   +8 per run-out (fielder credited)
 *   +12 per stumping
 *   +5 bonus for 3+ catches in the match
 *
 * TEAM
 *   +10 if on the winning side
 */

export type MvpBreakdown = {
  player_id: string;
  team_id: string;
  battingPts: number;
  bowlingPts: number;
  fieldingPts: number;
  teamPts: number;
  total: number;
  /** Short summary like "42(10) · 2/14 (1.0) · 1c" for the row tooltip. */
  reasonLine: string;
  // Raw stats from this match — surfaced through the aggregator so the
  // tournament MVP row can show the actual cricbuzz-style breakdown
  // (runs/balls, wkts/runs, catches) alongside the points contribution.
  // Without these, spectators tend to misread "Bat: 144" as "144 runs".
  runs: number;
  balls_faced: number;
  fours: number;
  sixes: number;
  wickets: number;
  runs_conceded: number;
  legal_balls: number;
  catches: number;
  run_outs: number;
  stumpings: number;
};

/**
 * Per-match MVP — compute breakdown for every player in the XI.
 *
 * Tournament MVP = sum of `computeMatchMvp` across all matches the
 * player appeared in.
 */
export function computeMatchMvp(
  balls: BallRow[],
  xi: { player_id: string; team_id: string }[],
  winnerId: string | null,
): MvpBreakdown[] {
  return xi.map(({ player_id, team_id }) => {
    const { runs, balls_faced, fours, sixes } = computeBatterStats(
      balls,
      player_id,
    );
    let got_out = false;
    for (const b of balls) {
      if (b.is_wicket && b.player_out_id === player_id) {
        got_out = true;
        break;
      }
    }

    const { legal_balls, runs_conceded, wickets, dots, maidens } =
      computeBowlerStats(balls, player_id);

    let catches = 0;
    let run_outs = 0;
    let stumpings = 0;
    for (const b of balls) {
      if (!b.is_wicket) continue;
      if (b.wicket_type === "caught" && b.fielder_id === player_id)
        catches += 1;
      else if (
        b.wicket_type === "caught_and_bowled" &&
        b.bowler_id === player_id
      )
        catches += 1;
      else if (b.wicket_type === "run_out" && b.fielder_id === player_id)
        run_outs += 1;
      else if (b.wicket_type === "stumped" && b.fielder_id === player_id)
        stumpings += 1;
    }

    // --- Batting points ---
    let battingPts = runs + fours * 2 + sixes * 5;
    if (runs >= 75) battingPts += 40;
    else if (runs >= 50) battingPts += 20;
    else if (runs >= 25) battingPts += 6;
    if (balls_faced >= 6) {
      const sr = (runs / balls_faced) * 100;
      // Box-cricket scale: 200 SR is par; bonuses scale up from there.
      if (sr >= 300) battingPts += 12;
      else if (sr >= 250) battingPts += 8;
      else if (sr >= 200) battingPts += 4;
      else if (sr >= 150) battingPts += 2;
    }
    if (!got_out && runs >= 15) battingPts += 5;
    if (got_out && runs === 0 && balls_faced >= 1) battingPts -= 3;

    // --- Bowling points ---
    const econ =
      legal_balls > 0 ? (runs_conceded / legal_balls) * 6 : Infinity;
    let bowlingPts = wickets * 20 + maidens * 12 + dots;
    if (wickets >= 4) bowlingPts += 30;
    else if (wickets >= 3) bowlingPts += 15;
    else if (wickets >= 2) bowlingPts += 5;
    if (legal_balls >= 6) {
      // Box-cricket scale: 12 is "good", not "bad". No leakage penalty.
      if (econ < 10) bowlingPts += 12;
      else if (econ < 12) bowlingPts += 8;
      else if (econ < 14) bowlingPts += 5;
      else if (econ < 16) bowlingPts += 2;
    }

    // --- Fielding points ---
    let fieldingPts = catches * 8 + run_outs * 8 + stumpings * 12;
    if (catches >= 3) fieldingPts += 5;

    // --- Team bonus ---
    const teamPts = team_id === winnerId ? 10 : 0;

    const total = battingPts + bowlingPts + fieldingPts + teamPts;

    // One-liner that summarises what the player did this match.
    const bits: string[] = [];
    if (balls_faced > 0) bits.push(`${runs}(${balls_faced})`);
    if (wickets > 0 || legal_balls > 0) {
      const overs = `${Math.floor(legal_balls / 6)}.${legal_balls % 6}`;
      bits.push(`${wickets}/${runs_conceded} (${overs})`);
    }
    const fieldBits: string[] = [];
    if (catches) fieldBits.push(`${catches}c`);
    if (run_outs) fieldBits.push(`${run_outs}ro`);
    if (stumpings) fieldBits.push(`${stumpings}st`);
    if (fieldBits.length > 0) bits.push(fieldBits.join(" "));

    return {
      player_id,
      team_id,
      battingPts,
      bowlingPts,
      fieldingPts,
      teamPts,
      total,
      reasonLine: bits.join(" · "),
      runs,
      balls_faced,
      fours,
      sixes,
      wickets,
      runs_conceded,
      legal_balls,
      catches,
      run_outs,
      stumpings,
    };
  });
}
