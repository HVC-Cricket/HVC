import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchLinkedAvatars } from "@/lib/players/fetch-linked-avatars";
import { resolvePlayerPhoto } from "@/lib/players/photo";
import { createClient } from "@/lib/supabase/server";
import { getInitials } from "@/lib/utils";

type Team = { id: string; name: string; short_name: string };

export async function XISection({
  matchId,
  tournamentId: _tournamentId,
  playersPerSide,
  teamA,
  teamB,
  canManage,
}: {
  matchId: string;
  tournamentId: string;
  playersPerSide: number;
  teamA: Team;
  teamB: Team;
  canManage: boolean;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TeamXICard
        matchId={matchId}
        team={teamA}
        playersPerSide={playersPerSide}
        canManage={canManage}
      />
      <TeamXICard
        matchId={matchId}
        team={teamB}
        playersPerSide={playersPerSide}
        canManage={canManage}
      />
    </div>
  );
}

async function TeamXICard({
  matchId,
  team,
  playersPerSide,
  canManage,
}: {
  matchId: string;
  team: Team;
  playersPerSide: number;
  canManage: boolean;
}) {
  const supabase = await createClient();
  const { data: xi } = await supabase
    .from("match_players")
    .select("id, player_id, batting_order, is_captain, is_keeper, is_substitute")
    .eq("match_id", matchId)
    .eq("team_id", team.id)
    .order("batting_order", { ascending: true, nullsFirst: false });

  const playerIds = (xi ?? []).map((m) => m.player_id);
  type PlayerRow = {
    id: string;
    display_name: string;
    photo_url: string | null;
    linked_user_id: string | null;
  };
  const { data: players } = playerIds.length
    ? await supabase
        .from("players")
        .select("id, display_name, photo_url, linked_user_id")
        .in("id", playerIds)
    : { data: [] as PlayerRow[] };
  // Linked-account avatar fallback — a player who linked their auth
  // account but never uploaded a separate photo still shows their face.
  const avatarByUserId = await fetchLinkedAvatars(supabase, players ?? []);
  const byId = new Map(
    ((players ?? []) as PlayerRow[]).map((p) => [
      p.id,
      {
        ...p,
        resolved_photo: resolvePlayerPhoto({
          photo_url: p.photo_url,
          linked_avatar_url: p.linked_user_id
            ? (avatarByUserId.get(p.linked_user_id) ?? null)
            : null,
        }),
      },
    ]),
  );

  const playing = (xi ?? []).filter((m) => !m.is_substitute);

  const isEmpty = (xi?.length ?? 0) === 0;
  const isComplete = playing.length === playersPerSide;
  // Only reserve the batting-order column when at least one player in
  // the XI has an order assigned. On Pick XI the column carries 1..N;
  // on the spectator Squads tab the column is usually all-null and
  // would otherwise render a row of empty dashes that just indent the
  // names to no benefit.
  const showOrderColumn = (xi ?? []).some((m) => m.batting_order != null);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-baseline justify-between gap-2">
          <CardTitle className="text-base capitalize">{team.name}</CardTitle>
          <span
            className={
              "font-mono text-xs tabular-nums " +
              (isComplete
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-muted-foreground")
            }
          >
            {playing.length} / {playersPerSide}
          </span>
        </div>
        <CardDescription>
          {isEmpty
            ? "No XI selected yet."
            : isComplete
              ? "Playing XI is set."
              : `${playersPerSide - playing.length} more to pick.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {!isEmpty && (
          <ul className="divide-y divide-foreground/10">
            {(xi ?? []).map((m) => {
              const p = byId.get(m.player_id);
              const name = p?.display_name ?? "(unknown)";
              return (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 px-6 py-2 text-sm"
                >
                  <span className="flex items-center gap-3">
                    {showOrderColumn && (
                      <span className="inline-flex w-6 justify-end font-mono text-muted-foreground tabular-nums">
                        {m.batting_order ?? ""}
                      </span>
                    )}
                    {p?.resolved_photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.resolved_photo}
                        alt={name}
                        className="size-8 shrink-0 rounded-full border border-foreground/10 object-cover"
                      />
                    ) : (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-foreground/10 bg-primary/10 text-[10px] font-semibold text-primary">
                        {getInitials(name)}
                      </span>
                    )}
                    <span className="font-medium capitalize">{name}</span>
                    {m.is_captain && (
                      <span className="rounded bg-foreground/10 px-1 text-xs">
                        C
                      </span>
                    )}
                    {m.is_keeper && (
                      <span className="rounded bg-foreground/10 px-1 text-xs">
                        WK
                      </span>
                    )}
                    {m.is_substitute && (
                      <span className="text-xs text-muted-foreground">
                        sub
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {canManage && (
          <div
            className={
              (isEmpty ? "" : "border-t border-foreground/10 ") +
              "px-6 py-3 text-right"
            }
          >
            <Link href={`/matches/${matchId}/xi/${team.id}`}>
              <Button variant={isEmpty ? "default" : "ghost"} size="sm">
                {isEmpty ? "Pick XI" : "Edit XI"}
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
