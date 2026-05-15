import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { requireOrganizerOrSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { NewPlayerForm } from "./new-player-form";

export default async function NewPlayerPage(props: {
  searchParams: Promise<{ teamId?: string; tournamentSlug?: string }>;
}) {
  await requireOrganizerOrSuperAdmin();
  const sp = await props.searchParams;

  const redirectTo =
    sp.tournamentSlug && sp.teamId
      ? `/tournaments/${sp.tournamentSlug}/teams/${sp.teamId}`
      : undefined;

  const supabase = await createClient();
  const { data: linkableUsers } = await supabase.rpc("list_users_for_linking");

  // The back link points either to wherever the create flow was
  // initiated (a team roster page, if those query params are set) or
  // to the players list as a safe default.
  const backHref = redirectTo ?? "/players";
  const backLabel = redirectTo ? "Team" : "Players";

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <Link
          href={backHref}
          prefetch
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          <span>{backLabel}</span>
        </Link>

        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">New player</h1>
          <p className="text-sm text-muted-foreground">
            Add a player to the global registry. They can then be picked
            for any tournament&apos;s team roster.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <NewPlayerForm
              redirectTo={redirectTo}
              linkableUsers={linkableUsers ?? []}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
