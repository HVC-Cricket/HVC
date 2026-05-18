import Link from "next/link";
import { notFound } from "next/navigation";

import { AddSquadMemberPopover } from "@/components/add-squad-member-popover";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireTournamentAdmin } from "@/lib/auth";
import { matchHasRecordedBalls } from "@/lib/match-balls";
import { createClient } from "@/lib/supabase/server";

import { PickXIForm } from "./pick-xi-form";

export default async function PickXIPage(props: {
  params: Promise<{ matchId: string; teamId: string }>;
}) {
  const { matchId, teamId } = await props.params;
  const supabase = await createClient();

  const { data: match } = await supabase
    .from("matches")
    .select("id, tournament_id, players_per_side, team_a_id, team_b_id")
    .eq("id", matchId)
    .single();
  if (!match) notFound();
  if (teamId !== match.team_a_id && teamId !== match.team_b_id) notFound();

  await requireTournamentAdmin(match.tournament_id);

  // Tournament slug — needed so we can deep-link to the team squad
  // page when the user has to add more players. Fetched in parallel
  // with the team row below.
  const [teamRes, tournamentRes] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, short_name")
      .eq("id", teamId)
      .single(),
    supabase
      .from("tournaments")
      .select("slug")
      .eq("id", match.tournament_id)
      .single(),
  ]);
  const team = teamRes.data;
  const tournament = tournamentRes.data;
  if (!team || !tournament) notFound();

  // Roster of the team (with player display names).
  const { data: roster } = await supabase
    .from("team_players")
    .select("id, player_id, role, created_at")
    .eq("team_id", team.id)
    .order("created_at", { ascending: true });
  const playerIds = (roster ?? []).map((r) => r.player_id);
  const { data: players } = playerIds.length
    ? await supabase
        .from("players")
        .select("id, display_name, category")
        .in("id", playerIds)
    : {
        data: [] as {
          id: string;
          display_name: string;
          category: number | null;
        }[],
      };
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));

  // Current XI (if any) + the cross-tournament roster snapshot so we
  // can render the inline "Add player" popover with already-taken
  // players visibly disabled rather than letting the user pick and
  // hit a server error.
  const [{ data: existing }, allPlayersRes, tournamentRostersRes] =
    await Promise.all([
      supabase
        .from("match_players")
        .select("player_id, batting_order, is_captain, is_keeper, is_substitute")
        .eq("match_id", match.id)
        .eq("team_id", team.id),
      supabase
        .from("players")
        .select("id, display_name")
        .order("display_name", { ascending: true }),
      supabase
        .from("team_players")
        .select("player_id, team_id, teams!inner(name, tournament_id)")
        .eq("teams.tournament_id", match.tournament_id),
    ]);

  // Build the "Add player" candidate list: every player NOT already on
  // this team, with `locked_reason` set to "Already in <team>" for
  // anyone on a different team in this tournament. Same shape the
  // shared popover expects.
  const ownRoster = new Set(
    (tournamentRostersRes.data ?? [])
      .filter((r) => r.team_id === team.id)
      .map((r) => r.player_id),
  );
  const otherTeamByPlayer = new Map<string, string>();
  for (const r of tournamentRostersRes.data ?? []) {
    if (r.team_id === team.id) continue;
    const teamObj = Array.isArray(r.teams) ? r.teams[0] : r.teams;
    if (!teamObj) continue;
    if (!otherTeamByPlayer.has(r.player_id)) {
      otherTeamByPlayer.set(r.player_id, teamObj.name);
    }
  }
  const eligiblePlayers = (allPlayersRes.data ?? [])
    .filter((p) => !ownRoster.has(p.id))
    .map((p) => ({
      id: p.id,
      display_name: p.display_name,
      locked_reason: otherTeamByPlayer.has(p.id)
        ? `Already in ${otherTeamByPlayer.get(p.id)}`
        : null,
    }));

  const existingByPlayer = new Map(
    (existing ?? []).map((m) => [m.player_id, m]),
  );

  const xiLocked = await matchHasRecordedBalls(supabase, match.id);

  const rosterRows = (roster ?? []).map((r) => {
    const p = playerById.get(r.player_id);
    const ex = existingByPlayer.get(r.player_id);
    return {
      player_id: r.player_id,
      display_name: p?.display_name ?? "(unknown)",
      category: (p?.category as 1 | 2 | 3 | null) ?? null,
      roster_role: r.role,
      included: !!ex,
      batting_order: ex?.batting_order ?? null,
      is_captain: !!ex?.is_captain,
      is_keeper: !!ex?.is_keeper,
      is_substitute: !!ex?.is_substitute,
    };
  });

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link
              href={`/matches/${match.id}`}
              className="hover:underline"
            >
              ← Match
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">{team.name} — Pick XI</h1>
          <p className="text-sm text-muted-foreground">
            Tick {match.players_per_side} players for this match. Anyone left
            ticked beyond {match.players_per_side}{" "}
            should be marked as substitute. Captain + wicket-keeper
            aren&apos;t set here — captain comes from the team squad,
            and the keeper is picked per-delivery on the scoreboard.
          </p>
        </div>

        {xiLocked && (
          <Card className="border-foreground/15 bg-muted/30">
            <CardHeader>
              <CardTitle className="text-base">XI locked</CardTitle>
              <CardDescription>
                Scoring has started for this match — the playing XI
                can&apos;t change while balls are on the books.
                If you really need to edit it, undo every ball back to
                the start of the match first (the undo button on the
                scoreboard re-opens this form once the innings clears).
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {rosterRows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No squad</CardTitle>
              <CardDescription>
                Add players to the team squad first.{" "}
                <Link
                  href={`/tournaments/${tournament.slug}/teams/${team.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  Manage squad →
                </Link>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AddSquadMemberPopover
                tournamentSlug={tournament.slug}
                teamId={team.id}
                players={eligiblePlayers}
                align="start"
              />
            </CardContent>
          </Card>
        ) : (
          <>
            {rosterRows.length < match.players_per_side && (
              <Card className="border-amber-500/30 bg-amber-500/5 dark:border-amber-400/20 dark:bg-amber-400/5">
                <CardHeader>
                  <CardTitle className="text-base">
                    Squad too small for a full XI
                  </CardTitle>
                  <CardDescription>
                    {team.name} has {rosterRows.length} player
                    {rosterRows.length === 1 ? "" : "s"} in the squad but
                    this match is {match.players_per_side}-a-side. Add{" "}
                    {match.players_per_side - rosterRows.length} more —
                    either inline below, or via the team page (with
                    role / captaincy controls).{" "}
                    <Link
                      href={`/tournaments/${tournament.slug}/teams/${team.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      Manage squad →
                    </Link>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <AddSquadMemberPopover
                    tournamentSlug={tournament.slug}
                    teamId={team.id}
                    players={eligiblePlayers}
                    align="start"
                  />
                </CardContent>
              </Card>
            )}
            <Card>
              <CardContent className="p-4">
                <PickXIForm
                  matchId={match.id}
                  teamId={team.id}
                  playersPerSide={match.players_per_side}
                  rows={rosterRows}
                  locked={xiLocked}
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
