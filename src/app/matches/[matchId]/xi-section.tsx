import Link from "next/link";

import { AddSquadMemberPopover } from "@/components/add-squad-member-popover";
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

export type EligibleAdd = {
  tournamentSlug: string;
  // Map of (teamId) → eligible player list with locked_reason set
  // when the player is already on another team in this tournament.
  playersByTeam: Record<
    string,
    { id: string; display_name: string; locked_reason: string | null }[]
  >;
};

export async function XISection({
  matchId,
  tournamentId,
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
  // Pre-compute "Add player" data for both teams when the viewer can
  // manage the team. Spectators don't need this, so we skip the
  // fetches entirely for them.
  const addCtx = canManage
    ? await loadAddPlayerContext(tournamentId, [teamA.id, teamB.id])
    : null;

  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-2">
        <TeamXICard
          matchId={matchId}
          team={teamA}
          playersPerSide={playersPerSide}
          canManage={canManage}
          showButton={false}
          addCtx={addCtx}
        />
        <TeamXICard
          matchId={matchId}
          team={teamB}
          playersPerSide={playersPerSide}
          canManage={canManage}
          showButton={false}
          addCtx={addCtx}
        />
      </div>
      {/* Single combined CTA — the per-team Pick XI buttons were a
          source of confusion (scorers would set one team and start a
          match with the other still empty). Funnel everyone through
          the tabs flow which makes both teams' progress obvious. */}
      {canManage && (
        <div className="flex justify-end">
          <Link href={`/matches/${matchId}/xi`} prefetch>
            <Button size="sm">Pick playing XIs</Button>
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * Resolve the data needed by the inline "Add player" popover for
 * each team: tournament slug (for the action's `tournamentSlug`
 * field) + per-team eligible-player list with `locked_reason` set
 * for anyone already in another team of this tournament.
 *
 * Single call to `team_players` joined to `teams` filtered by
 * `tournament_id` — cheap; the row count is bounded by the
 * tournament's total roster.
 */
async function loadAddPlayerContext(
  tournamentId: string,
  teamIds: string[],
): Promise<EligibleAdd | null> {
  const supabase = await createClient();
  const [tournamentRes, playersRes, rostersRes] = await Promise.all([
    supabase
      .from("tournaments")
      .select("slug")
      .eq("id", tournamentId)
      .maybeSingle(),
    supabase
      .from("players")
      .select("id, display_name")
      .order("display_name", { ascending: true }),
    supabase
      .from("team_players")
      .select("player_id, team_id, teams!inner(name, tournament_id)")
      .eq("teams.tournament_id", tournamentId),
  ]);
  if (!tournamentRes.data) return null;

  // Per-team membership: rosterByTeam[teamId] = Set of playerIds.
  // Also rosterByOtherTeams[teamId] = Map<playerId, otherTeamName>.
  const rosterByTeam = new Map<string, Set<string>>();
  const otherTeamByPlayer = new Map<string, string>();
  for (const r of rostersRes.data ?? []) {
    let bucket = rosterByTeam.get(r.team_id);
    if (!bucket) {
      bucket = new Set();
      rosterByTeam.set(r.team_id, bucket);
    }
    bucket.add(r.player_id);
    const teamObj = Array.isArray(r.teams) ? r.teams[0] : r.teams;
    if (teamObj) {
      // First-write-wins is fine: if a (impossible-in-practice)
      // player is on multiple teams, we only need one reason string.
      if (!otherTeamByPlayer.has(r.player_id)) {
        otherTeamByPlayer.set(r.player_id, teamObj.name);
      }
    }
  }

  const playersByTeam: EligibleAdd["playersByTeam"] = {};
  for (const teamId of teamIds) {
    const ownRoster = rosterByTeam.get(teamId) ?? new Set();
    playersByTeam[teamId] = (playersRes.data ?? [])
      .filter((p) => !ownRoster.has(p.id))
      .map((p) => {
        const otherTeam = otherTeamByPlayer.get(p.id);
        // If they're on "another" team that's not this one, lock.
        const lockedReason =
          otherTeam && !ownRoster.has(p.id)
            ? `Already in ${otherTeam}`
            : null;
        return {
          id: p.id,
          display_name: p.display_name,
          locked_reason: lockedReason,
        };
      });
  }

  return { tournamentSlug: tournamentRes.data.slug, playersByTeam };
}

async function TeamXICard({
  matchId,
  team,
  playersPerSide,
  canManage,
  showButton = true,
  addCtx,
}: {
  matchId: string;
  team: Team;
  playersPerSide: number;
  canManage: boolean;
  /** When XISection renders both teams together it owns the single
   *  combined CTA below and asks each card to hide its own per-team
   *  Pick XI / Edit XI button. Lone callers (none currently, but a
   *  future single-team summary card could) leave the default true. */
  showButton?: boolean;
  /** When the viewer can manage and we want the inline "Add player"
   *  shortcut to render in the card header. */
  addCtx?: EligibleAdd | null;
}) {
  const supabase = await createClient();
  // Pull both match_players (per-match XI selection) AND team_players
  // (the team's squad) so the card lists every squad member, not just
  // the ones already picked into the XI. Without the squad join,
  // adding a player to the squad via the inline "Add player" popover
  // would silently fail to appear on the match page — because the
  // new row lives in `team_players` only until Pick XI runs.
  const [xiRes, squadRes] = await Promise.all([
    supabase
      .from("match_players")
      .select(
        "id, player_id, batting_order, is_captain, is_keeper, is_substitute",
      )
      .eq("match_id", matchId)
      .eq("team_id", team.id)
      .order("batting_order", { ascending: true, nullsFirst: false }),
    supabase
      .from("team_players")
      .select("player_id, created_at")
      .eq("team_id", team.id)
      .order("created_at", { ascending: true }),
  ]);
  const squadRows = squadRes.data ?? [];
  const squadSize = squadRows.length;
  const matchPlayerByPlayer = new Map(
    (xiRes.data ?? []).map((m) => [m.player_id, m]),
  );

  // Union of squad + match_players. Most matches will have squad ⊇
  // match_players, but if a player was removed from the squad after
  // being added to the XI (rare) we still want to show their match
  // row so the chip / breakdown stays honest.
  type Row = {
    key: string;
    player_id: string;
    batting_order: number | null;
    is_captain: boolean;
    is_keeper: boolean;
    is_substitute: boolean;
    /** True when the player has a match_players row. False means
     *  they're on the squad but haven't been picked into the XI yet
     *  — they default to "sub" in the playing-count math. */
    in_match: boolean;
  };
  const rows: Row[] = squadRows.map((tp) => {
    const mp = matchPlayerByPlayer.get(tp.player_id);
    return {
      key: mp?.id ?? `squad-${tp.player_id}`,
      player_id: tp.player_id,
      batting_order: mp?.batting_order ?? null,
      is_captain: mp?.is_captain ?? false,
      is_keeper: mp?.is_keeper ?? false,
      is_substitute: mp?.is_substitute ?? true,
      in_match: !!mp,
    };
  });
  for (const mp of xiRes.data ?? []) {
    if (rows.some((r) => r.player_id === mp.player_id)) continue;
    rows.push({
      key: mp.id,
      player_id: mp.player_id,
      batting_order: mp.batting_order,
      is_captain: !!mp.is_captain,
      is_keeper: !!mp.is_keeper,
      is_substitute: !!mp.is_substitute,
      in_match: true,
    });
  }
  // Display order: XI (sorted by batting_order, nulls last) → in-match
  // subs → not-yet-picked squad members. Keeps the chip-aligned "this
  // is the playing XI" group at the top.
  rows.sort((a, b) => {
    const rank = (r: Row) => (r.in_match ? (r.is_substitute ? 1 : 0) : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (rank(a) === 0) {
      return (a.batting_order ?? 99) - (b.batting_order ?? 99);
    }
    return 0;
  });

  const playerIds = rows.map((r) => r.player_id);
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

  const playing = rows.filter((r) => r.in_match && !r.is_substitute);

  const isEmpty = rows.length === 0;
  const isComplete = playing.length === playersPerSide;
  // Squad-vs-side mismatch: the team can't field a full XI because
  // the squad is below players_per_side. Show a different copy here
  // and on Pick XI so the user is told to add squad members first
  // (and where) instead of staring at "6 more to pick" while only 5
  // players are available.
  const squadShortBy = Math.max(0, playersPerSide - squadSize);
  // Only reserve the batting-order column when at least one player in
  // the XI has an order assigned. On Pick XI the column carries 1..N;
  // on the spectator Squads tab the column is usually all-null and
  // would otherwise render a row of empty dashes that just indent the
  // names to no benefit.
  const showOrderColumn = rows.some((r) => r.batting_order != null);

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
          {squadShortBy > 0
            ? `Team squad has ${squadSize} of ${playersPerSide} — add ${squadShortBy} more to the team to field a full XI.`
            : isEmpty
              ? "No XI selected yet."
              : isComplete
                ? "Playing XI is set."
                : `${playersPerSide - playing.length} more to pick.`}
        </CardDescription>
        {canManage && addCtx && (
          <div className="pt-2">
            <AddSquadMemberPopover
              tournamentSlug={addCtx.tournamentSlug}
              teamId={team.id}
              players={addCtx.playersByTeam[team.id] ?? []}
              align="start"
            />
          </div>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {!isEmpty && (
          <ul className="divide-y divide-foreground/10">
            {rows.map((r) => {
              const p = byId.get(r.player_id);
              const name = p?.display_name ?? "(unknown)";
              return (
                <li
                  key={r.key}
                  className="flex items-center justify-between gap-3 px-6 py-2 text-sm"
                >
                  <span className="flex items-center gap-3">
                    {showOrderColumn && (
                      <span className="inline-flex w-6 justify-end font-mono text-muted-foreground tabular-nums">
                        {r.batting_order ?? ""}
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
                    {r.is_captain && (
                      <span className="rounded bg-foreground/10 px-1 text-xs">
                        C
                      </span>
                    )}
                    {r.is_keeper && (
                      <span className="rounded bg-foreground/10 px-1 text-xs">
                        WK
                      </span>
                    )}
                    {!r.in_match && (
                      <span className="rounded bg-foreground/10 px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                        not picked
                      </span>
                    )}
                    {r.in_match && r.is_substitute && (
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
        {canManage && showButton && (
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
