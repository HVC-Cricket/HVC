import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { requireOrganizer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { NewMatchForm } from "./new-match-form";

export default async function NewMatchPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const supabase = await createClient();
  const { data: tournament } = await supabase
    .from("tournaments")
    .select(
      "id, slug, name, default_overs_per_innings, default_players_per_side, venue",
    )
    .eq("slug", slug)
    .single();
  if (!tournament) notFound();

  // Authorize + fetch teams in parallel — independent once tournament.id is known.
  const [, teamsRes] = await Promise.all([
    requireOrganizer(tournament.id),
    supabase
      .from("teams")
      .select("id, name, short_name")
      .eq("tournament_id", tournament.id)
      .order("name", { ascending: true }),
  ]);
  const teams = teamsRes.data;

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <Link
          href={`/tournaments/${tournament.slug}`}
          prefetch
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          <span className="capitalize">{tournament.name}</span>
        </Link>

        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">New match</h1>
          <p className="text-sm text-muted-foreground">
            Schedule a match in{" "}
            <span className="capitalize">{tournament.name}</span>. Match number
            is assigned automatically.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <NewMatchForm
              tournamentSlug={tournament.slug}
              teams={teams ?? []}
              defaults={{
                overs_per_innings: tournament.default_overs_per_innings,
                players_per_side: tournament.default_players_per_side,
                venue: tournament.venue ?? "",
              }}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
