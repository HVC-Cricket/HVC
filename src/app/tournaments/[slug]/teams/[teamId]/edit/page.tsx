import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { EditTeamForm } from "./edit-team-form";

export default async function EditTeamPage(props: {
  params: Promise<{ slug: string; teamId: string }>;
}) {
  await requireUser();
  const { slug, teamId } = await props.params;

  const supabase = await createClient();
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("id, slug, name")
    .eq("slug", slug)
    .single();
  if (!tournament) notFound();

  const { data: team } = await supabase
    .from("teams")
    .select("id, name, short_name, color")
    .eq("id", teamId)
    .eq("tournament_id", tournament.id)
    .single();
  if (!team) notFound();

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Edit team</CardTitle>
            <CardDescription>
              Editing <strong>{team.name}</strong> in{" "}
              <strong>{tournament.name}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EditTeamForm
              tournamentSlug={tournament.slug}
              team={{
                id: team.id,
                name: team.name,
                short_name: team.short_name,
                color: team.color,
              }}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
