import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireOrganizerOrSuperAdmin } from "@/lib/auth";

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

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>New player</CardTitle>
            <CardDescription>
              Players are a global registry across tournaments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewPlayerForm redirectTo={redirectTo} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
