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

import { NewTeamForm } from "./new-team-form";

export default async function NewTeamPage(props: {
  params: Promise<{ slug: string }>;
}) {
  await requireUser();
  const { slug } = await props.params;

  const supabase = await createClient();
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("name, slug")
    .eq("slug", slug)
    .single();

  if (!tournament) notFound();

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>New team</CardTitle>
            <CardDescription>
              Adding a team to <strong>{tournament.name}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewTeamForm tournamentSlug={tournament.slug} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
