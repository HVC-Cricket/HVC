import { Award } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchLinkedAvatars } from "@/lib/players/fetch-linked-avatars";
import { computeMatchMvp } from "@/lib/scoring/mvp";
import { createClient } from "@/lib/supabase/server";
import type { BallRow } from "@/lib/supabase/row-types";
import { getInitials } from "@/lib/utils";

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
  const avatarByUserId = await fetchLinkedAvatars(supabase, players ?? []);
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

  const chosenTeamId = chosen ? teamByPlayerId.get(chosen.id) : null;
  const chosenIsWinner = chosenTeamId === match.winner_id;
  const chosenReason = chosen
    ? ranked.find((r) => r.player_id === chosen.id)?.reasonLine ?? null
    : null;

  return (
    <Card className="overflow-hidden border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Award className="size-4 text-amber-600 dark:text-amber-400" />
          <span>Player of the match</span>
          {isAuto && (
            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700 dark:text-blue-300">
              Auto-pick
            </span>
          )}
        </CardTitle>
        {!chosen && (
          <CardDescription>
            Pick the standout performer below.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {chosen && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-background/60 p-3 sm:gap-4 sm:p-4">
            <div className="relative shrink-0">
              {chosen.resolved_photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={chosen.resolved_photo}
                  alt={chosen.display_name}
                  className="size-16 rounded-full border-2 border-amber-500/40 object-cover sm:size-20"
                />
              ) : (
                <div className="flex size-16 items-center justify-center rounded-full border-2 border-amber-500/40 bg-primary/15 text-base font-semibold text-primary sm:size-20">
                  {getInitials(chosen.display_name)}
                </div>
              )}
              <span className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm ring-2 ring-background sm:size-7">
                <Award className="size-3.5 sm:size-4" />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-base font-semibold capitalize sm:text-lg">
                  {chosen.display_name}
                </span>
                <span className="shrink-0 rounded bg-foreground/10 px-1.5 font-mono text-[10px]">
                  {teamShortById.get(chosenTeamId ?? "") ?? "?"}
                </span>
                {chosen.category && (
                  <span className="shrink-0 rounded bg-foreground/10 px-1.5 font-mono text-[10px]">
                    C{chosen.category}
                  </span>
                )}
                <span
                  className={
                    "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide " +
                    (chosenIsWinner
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                      : "bg-muted text-muted-foreground")
                  }
                >
                  {chosenIsWinner ? "Winning side" : "Losing side"}
                </span>
              </div>
              {chosenReason && (
                <div className="mt-1 text-xs text-muted-foreground">
                  {chosenReason}
                </div>
              )}
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

