import Link from "next/link";
import { notFound } from "next/navigation";

import { PlayerCareerSection } from "@/components/player-career-section";
import { Button } from "@/components/ui/button";
import { getSessionContext, isOrganizerOrSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function PlayerDetailPage(props: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await props.params;
  const supabase = await createClient();
  const ctx = await getSessionContext();
  const canManagePlayers = ctx ? await isOrganizerOrSuperAdmin(ctx) : false;

  const { data: player } = await supabase
    .from("players")
    .select(
      "id, display_name, category, batting_style, bowling_style, phone, linked_user_id, photo_url",
    )
    .eq("id", playerId)
    .single();
  if (!player) notFound();

  let linkedEmail: string | null = null;
  let linkedAvatarUrl: string | null = null;
  if (player.linked_user_id) {
    // Fetch the linked profile's avatar — falls back into the hero
    // photo slot when the player itself has no photo_url set.
    const { data: linkedProfile } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", player.linked_user_id)
      .maybeSingle();
    linkedAvatarUrl = linkedProfile?.avatar_url ?? null;

    if (ctx) {
      const { data } = await supabase.rpc("lookup_email_by_user_id", {
        p_user_id: player.linked_user_id,
      });
      linkedEmail = data ?? null;
    }
  }

  const heroPhoto = player.photo_url ?? linkedAvatarUrl;

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            {heroPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={heroPhoto}
                alt=""
                className="h-16 w-16 rounded-full border border-foreground/10 object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                —
              </div>
            )}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                <Link href="/players" className="hover:underline">
                  ← Players
                </Link>
              </p>
              <h1 className="flex items-center gap-3 text-2xl font-semibold">
                {player.display_name}
                {player.category && (
                  <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-xs font-mono">
                    C{player.category}
                  </span>
                )}
              </h1>
              <p className="text-sm text-muted-foreground">
                {[player.batting_style, player.bowling_style]
                  .filter(Boolean)
                  .map((s) => s!.replace(/_/g, " "))
                  .join(" · ") || "—"}
              </p>
              {linkedEmail && (
                <p className="text-xs text-muted-foreground">
                  Linked to{" "}
                  <span className="font-mono">{linkedEmail}</span>
                </p>
              )}
            </div>
          </div>
          {canManagePlayers && (
            <Link href={`/players/${player.id}/edit`}>
              <Button variant="ghost" size="sm">
                Edit
              </Button>
            </Link>
          )}
        </div>

        <PlayerCareerSection playerId={player.id} />
      </div>
    </main>
  );
}
