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
import { getInitials } from "@/lib/utils";

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

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Players
            </h1>
            <p className="text-sm text-muted-foreground">
              {players?.length
                ? `${players.length} player${players.length === 1 ? "" : "s"} in the global registry.`
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

        {players && players.length === 0 && (
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
        )}

        {players && players.length > 0 && (
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <ul className="divide-y divide-foreground/10">
                {players.map((p) => {
                  const photo = resolvePlayerPhoto({
                    photo_url: p.photo_url,
                    linked_avatar_url: p.linked_user_id
                      ? (avatarByUserId.get(p.linked_user_id) ?? null)
                      : null,
                  });
                  const styleParts = [p.batting_style, p.bowling_style]
                    .filter(Boolean)
                    .map((s) => s!.replace(/_/g, " "));
                  const styleText = styleParts.join(" · ");
                  // If the signed-in user lands on their own linked
                  // player here, route them to /me — that's "their"
                  // profile page, same view they'd get from the nav.
                  const href =
                    ctx?.user.id != null && ctx.user.id === p.linked_user_id
                      ? "/me"
                      : `/players/${p.id}`;
                  return (
                    <li key={p.id}>
                      <Link
                        href={href}
                        prefetch
                        className="group flex items-center gap-3 px-4 py-3 transition hover:bg-muted/30"
                      >
                        {photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={photo}
                            alt=""
                            className="size-11 shrink-0 rounded-full border border-foreground/10 object-cover"
                          />
                        ) : (
                          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                            {getInitials(p.display_name)}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium capitalize">
                              {p.display_name}
                            </span>
                            {p.category ? (
                              <span className="shrink-0 rounded-full border border-foreground/15 bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                                C{p.category}
                              </span>
                            ) : (
                              <span className="shrink-0 rounded-full border border-destructive/30 bg-destructive/10 px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-destructive">
                                no cat
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[11px] capitalize text-muted-foreground">
                            {styleText || "—"}
                          </div>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground transition group-hover:text-foreground">
                          →
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
