import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireOrganizer } from "@/lib/auth";
import { getRuleSet } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";

import { EditTournamentForm } from "./edit-tournament-form";

export default async function EditTournamentPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const supabase = await createClient();
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("*")
    .eq("slug", slug)
    .single();
  if (!tournament) notFound();

  await requireOrganizer(tournament.id);

  const rules = getRuleSet(tournament.rules);

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <Link
          href={`/tournaments/${tournament.slug}`}
          prefetch
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          <span className="capitalize">{tournament.name}</span>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Edit tournament</CardTitle>
            <CardDescription>
              Editing <strong className="capitalize">{tournament.name}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EditTournamentForm
              tournament={{
                id: tournament.id,
                name: tournament.name,
                slug: tournament.slug,
                format: tournament.format,
                default_overs_per_innings: tournament.default_overs_per_innings,
                default_players_per_side: tournament.default_players_per_side,
                start_date: tournament.start_date,
                end_date: tournament.end_date,
                venue: tournament.venue,
                description: tournament.description,
                status: tournament.status,
                logo_url: tournament.logo_url,
                cat1_overs: rules.categories.cat1_overs,
                cat3_overs: rules.categories.cat3_overs,
              }}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
