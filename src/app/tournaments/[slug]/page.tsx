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

export const dynamic = "force-dynamic";

export default async function TournamentDetailPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const supabase = await createClient();
  const ctx = await getSessionContext();

  const { data: tournament, error } = await supabase
    .from("tournaments")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error || !tournament) notFound();

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, short_name")
    .eq("tournament_id", tournament.id)
    .order("created_at", { ascending: true });

  const { data: matches } = await supabase
    .from("matches")
    .select(
      "id, match_number, stage, status, scheduled_at, team_a_id, team_b_id",
    )
    .eq("tournament_id", tournament.id)
    .order("match_number", { ascending: true });

  const teamLookup = new Map((teams ?? []).map((t) => [t.id, t]));

  const canManage = ctx
    ? await isTournamentOrganizer(tournament.id, ctx)
    : false;

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{tournament.name}</h1>
            <p className="text-sm text-muted-foreground capitalize">
              {tournament.format.replace(/_/g, " ")} · {tournament.status}
            </p>
            {tournament.description && (
              <p className="pt-2 text-sm">{tournament.description}</p>
            )}
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              <Link href={`/tournaments/${tournament.slug}/admins`}>
                <Button variant="ghost" size="sm">
                  Admins
                </Button>
              </Link>
              <Link href={`/tournaments/${tournament.slug}/edit`}>
                <Button variant="ghost" size="sm">
                  Edit
                </Button>
              </Link>
            </div>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <Row label="Default overs / innings" value={String(tournament.default_overs_per_innings)} />
            <Row label="Default players / side" value={String(tournament.default_players_per_side)} />
            <Row label="Venue" value={tournament.venue ?? "—"} />
            <Row
              label="Dates"
              value={
                tournament.start_date || tournament.end_date
                  ? `${tournament.start_date ? new Date(tournament.start_date).toLocaleDateString() : "TBD"} — ${tournament.end_date ? new Date(tournament.end_date).toLocaleDateString() : "TBD"}`
                  : "—"
              }
            />
          </CardContent>
        </Card>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Matches</h2>
            {canManage && (
              <Link href={`/tournaments/${tournament.slug}/matches/new`}>
                <Button size="sm">New match</Button>
              </Link>
            )}
          </div>
          {!matches || matches.length === 0 ? (
            <Card>
              <CardHeader>
                <CardDescription>
                  No matches scheduled yet
                  {canManage ? ". Add the first one with the button above." : "."}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <ul className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
              {matches.map((m) => {
                const a = teamLookup.get(m.team_a_id);
                const b = teamLookup.get(m.team_b_id);
                return (
                  <li key={m.id}>
                    <Link
                      href={`/matches/${m.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/40"
                    >
                      <span className="flex items-center gap-3">
                        <span className="inline-flex w-8 justify-end font-mono text-muted-foreground">
                          #{m.match_number}
                        </span>
                        <span className="font-medium">
                          {a?.short_name ?? "?"} vs {b?.short_name ?? "?"}
                        </span>
                        <span className="text-xs text-muted-foreground capitalize">
                          {m.stage.replace(/_/g, " ")}
                        </span>
                      </span>
                      <span className="flex items-center gap-3 text-xs text-muted-foreground">
                        {m.scheduled_at && (
                          <span>
                            {new Date(m.scheduled_at).toLocaleString()}
                          </span>
                        )}
                        <span className="capitalize">
                          {m.status.replace(/_/g, " ")}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Teams</h2>
            {canManage && (
              <Link href={`/tournaments/${tournament.slug}/teams/new`}>
                <Button size="sm">Add team</Button>
              </Link>
            )}
          </div>
          {!teams || teams.length === 0 ? (
            <Card>
              <CardHeader>
                <CardDescription>
                  No teams yet
                  {canManage ? ". Add the first one with the button above." : "."}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {teams.map((team) => (
                <Link
                  key={team.id}
                  href={`/tournaments/${tournament.slug}/teams/${team.id}`}
                >
                  <Card className="h-full transition hover:bg-muted/40">
                    <CardHeader>
                      <CardTitle>{team.name}</CardTitle>
                      <CardDescription>{team.short_name}</CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
