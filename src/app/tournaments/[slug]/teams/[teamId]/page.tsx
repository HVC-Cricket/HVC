import { ChevronLeft } from "lucide-react";
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
import {
  canManageTeam,
  getSessionContext,
  isTournamentOrganizer,
} from "@/lib/auth";
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

  // canManage = organizer OR captain/vc (linked) of this team — can
  // edit metadata + manage roster. canChangeCaptaincy = organizer
  // only — only they can promote/demote captains, since that's what
  // grants team-admin access.
  const [teamRes, canManage, canChangeCaptaincy, allPlayersRes, rosterRes] =
    await Promise.all([
      supabase
        .from("teams")
        .select("id, name, short_name, logo_url")
        .eq("id", teamId)
        .eq("tournament_id", tournament.id)
        .single(),
      ctx
        ? canManageTeam(teamId, tournament.id, ctx)
        : Promise.resolve(false),
      ctx
        ? isTournamentOrganizer(tournament.id, ctx)
        : Promise.resolve(false),
      supabase
        .from("players")
        .select("id, display_name")
        .order("display_name", { ascending: true }),
      supabase
        .from("team_players")
        .select("id, role, player_id, created_at")
        .eq("team_id", teamId)
        .order("created_at", { ascending: true }),
    ]);
  const team = teamRes.data;
  if (!team) notFound();
  const roster = rosterRes.data;
  const allPlayers = allPlayersRes.data;

  // Captain / vice-captain are mandatory at the team level (DB enforces
  // ≤1 of each via partial unique indexes; the UI nudges organizers to
  // fill both). Match XI selection / match start may add harder gates
  // later.
  const hasCaptain = (roster ?? []).some((r) => r.role === "captain");
  const hasViceCaptain = (roster ?? []).some((r) => r.role === "vice_captain");
  const missingRoles: ("captain" | "vice_captain")[] = [];
  if (!hasCaptain) missingRoles.push("captain");
  if (!hasViceCaptain) missingRoles.push("vice_captain");

  // Roster players come from the same `players` table we just fetched
  // wholesale for the picker — no extra query needed.
  const playerIds = (roster ?? []).map((r) => r.player_id);
  const playersById = new Map(
    (allPlayers ?? [])
      .filter((p) => playerIds.includes(p.id))
      .map((p) => [p.id, p]),
  );

  const onRosterIds = new Set(playerIds);
  const availablePlayers = (allPlayers ?? []).filter((p) => !onRosterIds.has(p.id));

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <Link
          href={`/tournaments/${tournament.slug}`}
          prefetch
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          <span className="capitalize">{tournament.name}</span>
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            {team.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={team.logo_url}
                alt=""
                className="h-14 w-14 rounded-md border border-foreground/10 object-cover"
              />
            )}
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold capitalize">
                {team.name}
              </h1>
              <p className="text-sm uppercase tracking-wide text-muted-foreground">
                {team.short_name}
              </p>
            </div>
          </div>
          {canManage && (
            <Link
              href={`/tournaments/${tournament.slug}/teams/${team.id}/edit`}
              prefetch
            >
              <Button variant="ghost" size="sm">
                Edit
              </Button>
            </Link>
          )}
        </div>

        {canManage && missingRoles.length > 0 && (roster?.length ?? 0) > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
            <strong className="font-semibold">Set up the team:</strong>{" "}
            this team needs a{" "}
            {missingRoles.map((r, i) => (
              <span key={r}>
                <strong>{r === "captain" ? "captain" : "vice-captain"}</strong>
                {i < missingRoles.length - 1 ? " and a " : ""}
              </span>
            ))}
            . Set the role from the squad below — and if that player is
            linked to a user account, they automatically become a team
            admin.
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Squad</CardTitle>
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
                            canChangeCaptaincy={canChangeCaptaincy}
                          />
                          <RemoveRosterButton
                            tournamentSlug={tournament.slug}
                            teamId={team.id}
                            rosterId={r.id}
                            disabled={
                              !canChangeCaptaincy &&
                              (r.role === "captain" ||
                                r.role === "vice_captain")
                            }
                            disabledTitle={
                              !canChangeCaptaincy &&
                              (r.role === "captain" ||
                                r.role === "vice_captain")
                                ? "Only the tournament organizer can remove the captain or vice-captain."
                                : undefined
                            }
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
                  canChangeCaptaincy={canChangeCaptaincy}
                />
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
