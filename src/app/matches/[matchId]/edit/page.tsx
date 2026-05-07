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

import { EditMatchForm } from "./edit-match-form";

export default async function EditMatchPage(props: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await props.params;
  const supabase = await createClient();

  const { data: match } = await supabase
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .single();
  if (!match) notFound();

  await requireOrganizer(match.tournament_id);

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("id, slug, name")
    .eq("id", match.tournament_id)
    .single();
  if (!tournament) notFound();

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
            <CardTitle>Edit match</CardTitle>
            <CardDescription>
              {tournament.name} · Match {match.match_number}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EditMatchForm
              match={{
                id: match.id,
                stage: match.stage,
                team_a_id: match.team_a_id,
                team_b_id: match.team_b_id,
                scheduled_at: match.scheduled_at,
                venue: match.venue,
                overs_per_innings: match.overs_per_innings,
                players_per_side: match.players_per_side,
                status: match.status,
              }}
              teams={teams ?? []}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
