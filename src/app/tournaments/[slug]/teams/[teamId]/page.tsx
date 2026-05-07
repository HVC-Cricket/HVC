import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionContext, isTournamentOrganizer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { AddRosterForm } from "./add-roster-form";
import { RemoveRosterButton } from "./remove-roster-button";
import { RosterRoleSelect } from "./roster-role-select";

export const dynamic = "force-dynamic";

export default async function TeamDetailPage(props: {
  params: Promise<{ slug: string; teamId: string }>;
}) {
  const { slug, teamId } = await props.params;
  const supabase = await createClient();
  const ctx = await getSessionContext();

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();
  if (!tournament) notFound();

  const canManage = ctx
    ? await isTournamentOrganizer(tournament.id, ctx)
    : false;

  const { data: team } = await supabase
    .from("teams")
    .select("id, name, short_name")
    .eq("id", teamId)
    .eq("tournament_id", tournament.id)
    .single();
  if (!team) notFound();

  const { data: roster } = await supabase
    .from("team_players")
    .select("id, role, player_id, created_at")
    .eq("team_id", team.id)
    .order("created_at", { ascending: true });

  const playerIds = (roster ?? []).map((r) => r.player_id);
  const { data: rosterPlayers } = playerIds.length
    ? await supabase.from("players").select("id, display_name").in("id", playerIds)
    : { data: [] as { id: string; display_name: string }[] };

  const playersById = new Map((rosterPlayers ?? []).map((p) => [p.id, p]));

  const { data: allPlayers } = await supabase
    .from("players")
    .select("id, display_name")
    .order("display_name", { ascending: true });

  const onRosterIds = new Set(playerIds);
  const availablePlayers = (allPlayers ?? []).filter((p) => !onRosterIds.has(p.id));

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              <Link href={`/tournaments/${tournament.slug}`} className="hover:underline">
                {tournament.name}
              </Link>
            </p>
            <h1 className="text-2xl font-semibold">{team.name}</h1>
            <p className="text-sm text-muted-foreground">{team.short_name}</p>
          </div>
          {canManage && (
            <Link
              href={`/tournaments/${tournament.slug}/teams/${team.id}/edit`}
            >
              <Button variant="ghost" size="sm">
                Edit
              </Button>
            </Link>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Roster</CardTitle>
            <CardDescription>
              {roster?.length ?? 0} player{(roster?.length ?? 0) === 1 ? "" : "s"} on this team
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {roster && roster.length > 0 ? (
              <ul className="divide-y divide-foreground/10">
                {roster.map((r) => {
                  const player = playersById.get(r.player_id);
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                      <span className="flex items-center gap-3">
                        <span className="font-medium">{player?.display_name ?? "(unknown)"}</span>
                        {!canManage && (
                          <span className="text-xs text-muted-foreground capitalize">
                            {r.role.replace(/_/g, " ")}
                          </span>
                        )}
                      </span>
                      {canManage && (
                        <span className="flex items-center gap-2">
                          <RosterRoleSelect
                            tournamentSlug={tournament.slug}
                            teamId={team.id}
                            rosterId={r.id}
                            initialRole={r.role as
                              | "captain"
                              | "vice_captain"
                              | "wicket_keeper"
                              | "player"}
                          />
                          <RemoveRosterButton
                            tournamentSlug={tournament.slug}
                            teamId={team.id}
                            rosterId={r.id}
                          />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-4 py-6 text-sm text-muted-foreground">No players yet.</p>
            )}
          </CardContent>
        </Card>

        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add player</CardTitle>
              <CardDescription>
                Pick from existing players, or{" "}
                <Link
                  href={`/players/new?teamId=${team.id}&tournamentSlug=${tournament.slug}`}
                  className="underline underline-offset-4"
                >
                  create a new one
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent>
              {availablePlayers.length === 0 ? (
                <div className="flex flex-col items-start gap-3 text-sm text-muted-foreground">
                  <span>Every existing player is already on this team.</span>
                  <Link
                    href={`/players/new?teamId=${team.id}&tournamentSlug=${tournament.slug}`}
                  >
                    <Button size="sm">Create a new player</Button>
                  </Link>
                </div>
              ) : (
                <AddRosterForm
                  tournamentSlug={tournament.slug}
                  teamId={team.id}
                  players={availablePlayers}
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
