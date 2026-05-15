import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionContext, isOrganizerOrSuperAdmin } from "@/lib/auth";
import { fetchLinkedAvatars } from "@/lib/players/fetch-linked-avatars";
import { resolvePlayerPhoto } from "@/lib/players/photo";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  const supabase = await createClient();
  const ctx = await getSessionContext();
  const canManagePlayers = ctx ? await isOrganizerOrSuperAdmin(ctx) : false;

  const { data: players, error } = await supabase
    .from("players")
    .select(
      "id, display_name, category, batting_style, bowling_style, photo_url, linked_user_id",
    )
    .order("display_name", { ascending: true });

  // Batch-fetch linked auth-user avatars so players who only linked
  // their account (no player photo uploaded) still show a face.
  const avatarByUserId = await fetchLinkedAvatars(supabase, players ?? []);

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
          {canManagePlayers && (
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
                {canManagePlayers
                  ? "Add the first one with the button above."
                  : "Only organizers and super admins can add players."}
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {players && players.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <ul className="divide-y divide-foreground/10">
                {players.map((p) => {
                  const photo = resolvePlayerPhoto({
                    photo_url: p.photo_url,
                    linked_avatar_url: p.linked_user_id
                      ? (avatarByUserId.get(p.linked_user_id) ?? null)
                      : null,
                  });
                  return (
                  <li key={p.id}>
                    <Link
                      href={`/players/${p.id}`}
                      className="flex items-center justify-between gap-3 p-4 text-sm hover:bg-muted/40"
                    >
                      <span className="flex items-center gap-3">
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={photo}
                            alt=""
                            className="h-8 w-8 rounded-full border border-foreground/10 object-cover"
                          />
                        ) : (
                          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">
                            —
                          </span>
                        )}
                        {p.category ? (
                          <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-xs font-mono">
                            C{p.category}
                          </span>
                        ) : (
                          <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-xs text-destructive">
                            no category
                          </span>
                        )}
                        <span className="font-medium">{p.display_name}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="text-muted-foreground">
                          {[p.batting_style, p.bowling_style]
                            .filter(Boolean)
                            .map((s) => s!.replace(/_/g, " "))
                            .join(" · ") || "—"}
                        </span>
                      </span>
                    </Link>
                  </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
