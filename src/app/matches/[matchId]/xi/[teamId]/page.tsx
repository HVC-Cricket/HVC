import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireTournamentAdmin } from "@/lib/auth";
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
        .select("id, display_name")
        .in("id", playerIds)
    : { data: [] as { id: string; display_name: string }[] };
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));

  // Current XI (if any).
  const { data: existing } = await supabase
    .from("match_players")
    .select("player_id, batting_order, is_captain, is_keeper, is_substitute")
    .eq("match_id", match.id)
    .eq("team_id", team.id);

  const existingByPlayer = new Map(
    (existing ?? []).map((m) => [m.player_id, m]),
  );

  const rosterRows = (roster ?? []).map((r) => {
    const p = playerById.get(r.player_id);
    const ex = existingByPlayer.get(r.player_id);
    return {
      player_id: r.player_id,
      display_name: p?.display_name ?? "(unknown)",
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
                    {match.players_per_side - rosterRows.length} more on
                    the team page before you can field a full XI.{" "}
                    <Link
                      href={`/tournaments/${tournament.slug}/teams/${team.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      Manage squad →
                    </Link>
                  </CardDescription>
                </CardHeader>
              </Card>
            )}
            <Card>
              <CardContent className="p-4">
                <PickXIForm
                  matchId={match.id}
                  teamId={team.id}
                  playersPerSide={match.players_per_side}
                  rows={rosterRows}
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
