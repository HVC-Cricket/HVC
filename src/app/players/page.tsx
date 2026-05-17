import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionContext, isOrganizerOrSuperAdmin } from "@/lib/auth";
import { fetchLinkedAvatars } from "@/lib/players/fetch-linked-avatars";
import { resolvePlayerPhoto } from "@/lib/players/photo";
import { createClient } from "@/lib/supabase/server";

import { PlayersSearchList, type PlayerRow } from "./players-search-list";

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
    .order("display_name", { ascending: true })
    // Safety cap. HVC currently has <100 players but this stays
    // bounded if a future tournament imports a large historical roster.
    // Hit at ~10x current size; revisit if we approach.
    .limit(1000);

  // Batch-fetch linked auth-user avatars so players who only linked
  // their account (no player photo uploaded) still show a face.
  const avatarByUserId = await fetchLinkedAvatars(supabase, players ?? []);

  // Pre-resolve everything the client list needs (photo, href, style
  // text) so the search component is purely a render + filter — no
  // session checks, no map lookups, no async work on the client.
  const rows: PlayerRow[] = (players ?? []).map((p) => ({
    id: p.id,
    display_name: p.display_name,
    category: p.category,
    style_text: [p.batting_style, p.bowling_style]
      .filter(Boolean)
      .map((s) => s!.replace(/_/g, " "))
      .join(" · "),
    photo: resolvePlayerPhoto({
      photo_url: p.photo_url,
      linked_avatar_url: p.linked_user_id
        ? (avatarByUserId.get(p.linked_user_id) ?? null)
        : null,
    }),
    // If the signed-in user lands on their own linked player here,
    // route them to /me — that's "their" profile page, same view they'd
    // get from the nav.
    href:
      ctx?.user.id != null && ctx.user.id === p.linked_user_id
        ? "/me"
        : `/players/${p.id}`,
  }));

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Players
            </h1>
            <p className="text-sm text-muted-foreground">
              {rows.length
                ? `${rows.length} player${rows.length === 1 ? "" : "s"} in the global registry.`
                : "Global registry across all tournaments."}
            </p>
          </div>
          {canManagePlayers && (
            <Link href="/players/new" prefetch>
              <Button size="sm">New player</Button>
            </Link>
          )}
        </header>

        {error && (
          <p className="text-sm text-destructive">
            Failed to load players: {error.message}
          </p>
        )}

        {rows.length === 0 ? (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">No players yet</CardTitle>
              <CardDescription>
                {canManagePlayers
                  ? "Add the first one with the button above."
                  : "Only organizers and super admins can add players."}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <PlayersSearchList rows={rows} />
        )}
      </div>
    </main>
  );
}
