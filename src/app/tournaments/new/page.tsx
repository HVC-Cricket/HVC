import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireSuperAdmin } from "@/lib/auth";

import { NewTournamentForm } from "./new-tournament-form";

export default async function NewTournamentPage() {
  await requireSuperAdmin();

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>New tournament</CardTitle>
            <CardDescription>
              Container for matches, teams, and rules. Slug is auto-generated
              from the name.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NewTournamentForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
