import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import type { Database } from "@/lib/supabase/database.types";

import { PlayerOfMatchForm } from "./player-of-match-form";

type BallRow = Database["public"]["Tables"]["balls"]["Row"];

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
// Simple, transparent point system:
//   batting:  +1 per run, +2 per 4, +4 per 6, +10 if runs ≥ 30, +20 if ≥ 50
//   bowling:  +18 per wicket, +10 per maiden, +1 per dot, +5 if econ < 6
//   fielding: +8 per catch (incl. c&b), +6 per run-out, +10 per stumping
//   team:     +6 if on the winning side
//
// Tuned for HVC's 7-over format where wickets are precious and matches
// are short — a 3-wicket haul (54) trades roughly evenly with a 50.
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
  const wicketBowler = new Set([
    "bowled",
    "caught",
    "caught_and_bowled",
    "lbw",
    "stumped",
    "hit_wicket",
  ]);

  return xi.map(({ player_id, team_id }) => {
    // Batting
    let runs = 0;
    let balls_faced = 0;
    let fours = 0;
    let sixes = 0;
    for (const b of balls) {
      if (b.batter_id !== player_id) continue;
      runs += b.runs_off_bat;
      if (b.extra_type !== "wide") balls_faced += 1;
      if (b.runs_off_bat === 4) fours += 1;
      if (b.runs_off_bat === 6) sixes += 1;
    }

    // Bowling
    let wickets = 0;
    let legal_balls = 0;
    let runs_conceded = 0;
    let dots = 0;
    const overBalls = new Map<number, BallRow[]>();
    for (const b of balls) {
      if (b.bowler_id !== player_id) continue;
      const isLegal = b.extra_type !== "wide" && b.extra_type !== "no_ball";
      if (isLegal) legal_balls += 1;
      runs_conceded += b.runs_off_bat;
      if (b.extra_type === "wide" || b.extra_type === "no_ball")
        runs_conceded += b.extras;
      if (b.is_wicket && b.wicket_type && wicketBowler.has(b.wicket_type))
        wickets += 1;
      if (isLegal && b.runs_off_bat + b.extras === 0) dots += 1;
      if (!overBalls.has(b.over_number)) overBalls.set(b.over_number, []);
      overBalls.get(b.over_number)!.push(b);
    }
    let maidens = 0;
    for (const [, group] of overBalls) {
      const legalInOver = group.filter(
        (b) => b.extra_type !== "wide" && b.extra_type !== "no_ball",
      ).length;
      if (legalInOver !== 6) continue;
      const runsInOver = group.reduce(
        (s, b) => s + b.runs_off_bat + b.extras,
        0,
      );
      if (runsInOver === 0) maidens += 1;
    }

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

    // Composite score
    const battingPts =
      runs +
      fours * 2 +
      sixes * 4 +
      (runs >= 30 ? 10 : 0) +
      (runs >= 50 ? 20 : 0);
    const econ = legal_balls > 0 ? (runs_conceded / legal_balls) * 6 : Infinity;
    const bowlingPts =
      wickets * 18 +
      maidens * 10 +
      dots * 1 +
      (legal_balls >= 6 && econ < 6 ? 5 : 0);
    const fieldingPts = catches * 8 + run_outs * 6 + stumpings * 10;
    const teamBonus = team_id === winnerId ? 6 : 0;
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
