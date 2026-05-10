import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TournamentsPage() {
  const supabase = await createClient();
  const ctx = await getSessionContext();

  const { data: tournaments, error } = await supabase
    .from("tournaments")
    .select(
      "id, name, slug, format, status, venue, start_date, end_date, logo_url",
    )
    .order("created_at", { ascending: false });

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Tournaments</h1>
            <p className="text-sm text-muted-foreground">
              All tournaments organized in HVC Scoring.
            </p>
          </div>
          {ctx?.profile?.is_super_admin && (
            <Link href="/tournaments/new">
              <Button>New tournament</Button>
            </Link>
          )}
        </div>

        {error && (
          <p className="text-destructive text-sm">
            Failed to load tournaments: {error.message}
          </p>
        )}

        {tournaments && tournaments.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>No tournaments yet</CardTitle>
              <CardDescription>
                {ctx?.profile?.is_super_admin
                  ? "Create the first one with the button above."
                  : "Check back once an admin sets one up."}
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {tournaments && tournaments.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tournaments.map((t) => (
              <Link key={t.id} href={`/tournaments/${t.slug}`}>
                <Card className="h-full transition hover:bg-muted/40">
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      {t.logo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={t.logo_url}
                          alt=""
                          className="h-10 w-10 rounded-md border border-foreground/10 object-cover"
                        />
                      ) : null}
                      <div className="space-y-1">
                        <CardTitle>{t.name}</CardTitle>
                        <CardDescription className="capitalize">
                          {t.format.replace(/_/g, " ")} · {t.status}
                        </CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground space-y-1">
                    {t.venue && <div>{t.venue}</div>}
                    {(t.start_date || t.end_date) && (
                      <div>
                        {t.start_date ? new Date(t.start_date).toLocaleDateString() : "TBD"}
                        {" — "}
                        {t.end_date ? new Date(t.end_date).toLocaleDateString() : "TBD"}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
