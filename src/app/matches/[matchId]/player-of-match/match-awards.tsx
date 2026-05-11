import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { PlayerOfMatchForm } from "./player-of-match-form";

/**
 * Renders the "Player of the match" banner on a completed match.
 * Tournament admins see a select to pick from either XI; everyone else
 * sees the chosen player (or nothing if none has been picked yet).
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

  // Anonymous viewer with nothing set → render nothing.
  if (!canManage && !match.player_of_match_id) return null;

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
    : { data: [] as { id: string; display_name: string; category: number | null; photo_url: string | null }[] };
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));
  const teamByPlayerId = new Map((xi ?? []).map((r) => [r.player_id, r.team_id]));

  const options = (players ?? [])
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

  const chosen = match.player_of_match_id
    ? playerById.get(match.player_of_match_id)
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Player of the match</CardTitle>
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
      <CardContent className="space-y-3">
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
              </div>
            </div>
          </div>
        )}
        {canManage && (
          <PlayerOfMatchForm
            matchId={matchId}
            current={match.player_of_match_id}
            options={options}
          />
        )}
      </CardContent>
    </Card>
  );
}
