import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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

  await requireOrganizer(tournament.id);

  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, short_name")
    .eq("tournament_id", tournament.id)
    .order("name", { ascending: true });

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>New match</CardTitle>
            <CardDescription>
              Adding a match to <strong>{tournament.name}</strong>. Match
              number is auto-generated.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
