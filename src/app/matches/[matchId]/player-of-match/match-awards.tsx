import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { computeBatterStats, computeBowlerStats } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import type { BallRow } from "@/lib/supabase/row-types";

import { PlayerOfMatchForm } from "./player-of-match-form";

/**
 * Renders the "Player of the match" banner on a completed match.
 *
 * Two paths:
 *   - If `matches.player_of_match_id` is set → admin override is shown.
 *   - Otherwise the highest-scoring player from the auto-computed
 *     ranking is shown with an "auto-pick" badge.
 *
 * Tournament admins additionally see a form to accept the suggestion,
 * pick anyone else from either XI, or revert to auto.
 */
export async function MatchAwards({
  matchId,
  canManage,
}: {
  matchId: string;
  canManage: boolean;
}) {
  const supabase = await createClient();

  const { data: match } = await supabase
    .from("matches")
    .select(
      "id, status, player_of_match_id, team_a_id, team_b_id, winner_id",
    )
    .eq("id", matchId)
    .single();
  if (!match || match.status !== "completed") return null;

  const { data: teams } = await supabase
    .from("teams")
    .select("id, short_name")
    .in("id", [match.team_a_id, match.team_b_id]);
  const teamShortById = new Map((teams ?? []).map((t) => [t.id, t.short_name]));

  const { data: xi } = await supabase
    .from("match_players")
    .select("player_id, team_id")
    .eq("match_id", matchId);
  const xiIds = (xi ?? []).map((r) => r.player_id);

  const { data: players } = xiIds.length
    ? await supabase
        .from("players")
        .select("id, display_name, category, photo_url")
        .in("id", xiIds)
    : {
        data: [] as {
          id: string;
          display_name: string;
          category: number | null;
          photo_url: string | null;
        }[],
      };
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));
  const teamByPlayerId = new Map((xi ?? []).map((r) => [r.player_id, r.team_id]));

  // Compute the auto-ranking from balls.
  const { data: balls } = await supabase
    .from("balls")
    .select("*")
    .in(
      "innings_id",
      (
        await supabase
          .from("innings")
          .select("id")
          .eq("match_id", matchId)
      ).data?.map((r) => r.id) ?? [],
    )
    .eq("is_voided", false);

  const performances = computePerformances(
    (balls ?? []) as BallRow[],
    xi ?? [],
    match.winner_id,
  );
  const ranked = [...performances]
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
  const suggestions = ranked.slice(0, 3).map((p) => ({
    id: p.player_id,
    display_name: playerById.get(p.player_id)?.display_name ?? "?",
    team_short: teamShortById.get(p.team_id) ?? "?",
    category: playerById.get(p.player_id)?.category ?? null,
    reason: p.reasonLine,
    score: p.score,
  }));

  // Determine who to display: admin override OR top auto-pick.
  const adminPicked = match.player_of_match_id
    ? playerById.get(match.player_of_match_id)
    : null;
  const autoPickId = ranked[0]?.player_id ?? null;
  const autoPicked =
    !adminPicked && autoPickId ? playerById.get(autoPickId) : null;
  const chosen = adminPicked ?? autoPicked;
  const isAuto = !adminPicked && !!autoPicked;

  // The full dropdown lists everyone — sorted alphabetically.
  const allOptions = (players ?? [])
    .map((p) => {
      const teamId = teamByPlayerId.get(p.id);
      return {
        id: p.id,
        display_name: p.display_name,
        category: p.category,
        team_short: teamId ? (teamShortById.get(teamId) ?? "?") : "?",
      };
    })
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  // Anonymous viewer + nothing to show → render nothing.
  if (!canManage && !chosen) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-baseline gap-2 text-base">
          <span>Player of the match</span>
          {isAuto && (
            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-normal uppercase tracking-wide text-blue-700">
              Auto-pick
            </span>
          )}
        </CardTitle>
        {chosen && (
          <CardDescription>
            From{" "}
            {teamByPlayerId.get(chosen.id) === match.winner_id
              ? "the winning side"
              : "the losing side"}
            .
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {chosen && (
          <div className="flex items-center gap-3">
            {chosen.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={chosen.photo_url}
                alt={chosen.display_name}
                width={48}
                height={48}
                className="size-12 rounded-full object-cover"
              />
            ) : (
              <div className="flex size-12 items-center justify-center rounded-full bg-muted text-sm font-medium">
                {chosen.display_name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div>
              <div className="font-medium">{chosen.display_name}</div>
              <div className="text-xs text-muted-foreground">
                {teamShortById.get(teamByPlayerId.get(chosen.id) ?? "") ?? "?"}
                {chosen.category ? ` · C${chosen.category}` : ""}
                {ranked.find((r) => r.player_id === chosen.id)?.reasonLine && (
                  <>
                    {" · "}
                    {ranked.find((r) => r.player_id === chosen.id)!.reasonLine}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        {canManage && (
          <PlayerOfMatchForm
            matchId={matchId}
            current={match.player_of_match_id}
            suggestions={suggestions}
            options={allOptions}
          />
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Auto Player-of-the-match scoring
//
// Transparent point system, tuned for HVC's 7-over box-cricket format
// where wickets are scarce, par scores are low, and matches end fast.
// Rules are flat (no multipliers), so the totals are easy to verify by
// hand if anyone questions a pick.
//
// BATTING
//   +1 per run
//   +2 per four, +5 per six               (small ground but a six is
//                                          still rare and decisive)
//   +6 if runs ≥ 25                       (steady contribution tier)
//   +20 if runs ≥ 50
//   +40 if runs ≥ 75                      (top-quality knock in 7 overs)
//   Strike-rate bonus (only with ≥6 balls faced):
//     SR ≥ 200: +12
//     SR ≥ 150: +8
//     SR ≥ 120: +4
//   +5 if not out with ≥ 15 runs          (finished the innings)
//   −3 duck penalty (out for 0, ≥1 ball)
//
// BOWLING
//   +20 per wicket
//   Multi-wicket haul (highest tier only):
//     2 wkts: +5
//     3 wkts: +15
//     4+ wkts: +30
//   +12 per maiden over
//   +1 per dot ball
//   Economy bonus (only with ≥6 legal balls bowled):
//     econ < 4: +12
//     econ < 5: +8
//     econ < 6: +5
//     econ < 7: +2
//   −5 leakage penalty if econ > 12 with ≥6 legal balls
//
// FIELDING
//   +8 per catch (caught_and_bowled credits the bowler)
//   +8 per run-out (fielder credited)
//   +12 per stumping
//   +5 bonus for 3+ catches in the match
//
// TEAM
//   +10 if on the winning side
//
// Calibration spot-checks:
//   * 50(30) on the winning side ≈ a 3-for haul on the losing side
//     (both land in the high 90s) — a winning all-rounder beats either.
//   * A 4-wicket haul (~120+) outranks most batting performances —
//     correct for this format where wickets are precious.
//   * A 5(15) cameo gets ~13 points — below any meaningful contribution.
// ---------------------------------------------------------------------------

type Performance = {
  player_id: string;
  team_id: string;
  score: number;
  reasonLine: string;
};

function computePerformances(
  balls: BallRow[],
  xi: { player_id: string; team_id: string }[],
  winnerId: string | null,
): Performance[] {
  return xi.map(({ player_id, team_id }) => {
    // Batting — shared batter compute + a separate scan for "did this
    // player get out at all" (the POTM duck penalty needs it).
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

    // Bowling — shared bowler compute. POTM scoring doesn't use the
    // wides / no-balls count, but everything else is identical.
    const {
      legal_balls,
      runs_conceded,
      wickets,
      dots,
      maidens,
    } = computeBowlerStats(balls, player_id);

    // Fielding (incl. c&b → bowler gets the catch credit)
    let catches = 0;
    let run_outs = 0;
    let stumpings = 0;
    for (const b of balls) {
      if (!b.is_wicket) continue;
      if (b.wicket_type === "caught" && b.fielder_id === player_id) catches += 1;
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
      if (sr >= 200) battingPts += 12;
      else if (sr >= 150) battingPts += 8;
      else if (sr >= 120) battingPts += 4;
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
      if (econ < 4) bowlingPts += 12;
      else if (econ < 5) bowlingPts += 8;
      else if (econ < 6) bowlingPts += 5;
      else if (econ < 7) bowlingPts += 2;
      if (econ > 12) bowlingPts -= 5;
    }

    // --- Fielding points ---
    let fieldingPts = catches * 8 + run_outs * 8 + stumpings * 12;
    if (catches >= 3) fieldingPts += 5;

    // --- Team bonus ---
    const teamBonus = team_id === winnerId ? 10 : 0;

    const score = battingPts + bowlingPts + fieldingPts + teamBonus;

    // Build a one-line summary that fits next to the player's name.
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
      score,
      reasonLine: bits.join(" · "),
    };
  });
}
