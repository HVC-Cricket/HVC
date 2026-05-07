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

export default async function PlayersPage() {
  const supabase = await createClient();
  const ctx = await getSessionContext();

  const { data: players, error } = await supabase
    .from("players")
    .select("id, display_name, batting_style, bowling_style")
    .order("display_name", { ascending: true });

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Players</h1>
            <p className="text-sm text-muted-foreground">
              Global registry. The same player can be on rosters across
              tournaments — career stats follow them.
            </p>
          </div>
          {ctx?.user && (
            <Link href="/players/new">
              <Button>New player</Button>
            </Link>
          )}
        </div>

        {error && (
          <p className="text-destructive text-sm">
            Failed to load players: {error.message}
          </p>
        )}

        {players && players.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>No players yet</CardTitle>
              <CardDescription>
                {ctx?.user
                  ? "Add the first one with the button above."
                  : "Sign in to add players."}
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {players && players.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-foreground/10">
                {players.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-3 p-4 text-sm"
                  >
                    <span className="font-medium">{p.display_name}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-muted-foreground">
                        {[p.batting_style, p.bowling_style]
                          .filter(Boolean)
                          .map((s) => s!.replace(/_/g, " "))
                          .join(" · ") || "—"}
                      </span>
                      {ctx?.user && (
                        <Link
                          href={`/players/${p.id}/edit`}
                          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                        >
                          Edit
                        </Link>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
