import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { computeMatchMvp } from "@/lib/scoring/mvp";
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
        .select("id, display_name, category, photo_url, linked_user_id")
        .in("id", xiIds)
    : {
        data: [] as {
          id: string;
          display_name: string;
          category: number | null;
          photo_url: string | null;
          linked_user_id: string | null;
        }[],
      };
  // Resolve linked-account avatars so a player who linked their auth
  // account (but never uploaded a player photo) still shows their face
  // on the POTM banner.
  const linkedUserIds = (players ?? [])
    .map((p) => p.linked_user_id)
    .filter((id): id is string => !!id);
  const avatarByUserId = new Map<string, string | null>();
  if (linkedUserIds.length > 0) {
    const { data: linkedProfiles } = await supabase
      .from("profiles")
      .select("id, avatar_url")
      .in("id", linkedUserIds);
    for (const pr of linkedProfiles ?? [])
      avatarByUserId.set(pr.id, pr.avatar_url);
  }
  const playerById = new Map(
    (players ?? []).map((p) => [
      p.id,
      {
        ...p,
        resolved_photo:
          p.photo_url ??
          (p.linked_user_id ? avatarByUserId.get(p.linked_user_id) : null) ??
          null,
      },
    ]),
  );
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

  const performances = computeMatchMvp(
    (balls ?? []) as BallRow[],
    xi ?? [],
    match.winner_id,
  );
  const ranked = [...performances]
    .filter((p) => p.total > 0)
    .sort((a, b) => b.total - a.total);
  const suggestions = ranked.slice(0, 3).map((p) => ({
    id: p.player_id,
    display_name: playerById.get(p.player_id)?.display_name ?? "?",
    team_short: teamShortById.get(p.team_id) ?? "?",
    category: playerById.get(p.player_id)?.category ?? null,
    reason: p.reasonLine,
    score: p.total,
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
            {chosen.resolved_photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={chosen.resolved_photo}
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

