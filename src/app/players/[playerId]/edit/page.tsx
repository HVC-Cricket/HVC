import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { requireOrganizerOrSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { EditPlayerForm } from "./edit-player-form";

export default async function EditPlayerPage(props: {
  params: Promise<{ playerId: string }>;
}) {
  const ctx = await requireOrganizerOrSuperAdmin();
  const { playerId } = await props.params;

  const supabase = await createClient();
  const { data: player } = await supabase
    .from("players")
    .select(
      "id, display_name, category, phone, batting_style, bowling_style, linked_user_id, photo_url",
    )
    .eq("id", playerId)
    .single();
  if (!player) notFound();

  let linkedEmail: string | null = null;
  if (player.linked_user_id) {
    const { data } = await supabase.rpc("lookup_email_by_user_id", {
      p_user_id: player.linked_user_id,
    });
    linkedEmail = data ?? null;
  }

  const { data: linkableUsers } = await supabase.rpc("list_users_for_linking");

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-5">
        <Link
          href={`/players/${player.id}`}
          prefetch
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          <span className="capitalize">{player.display_name}</span>
        </Link>

        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Edit player</h1>
          <p className="text-sm text-muted-foreground">
            Update profile, role, photo, or unlink the auth account.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <EditPlayerForm
              player={{
                id: player.id,
                display_name: player.display_name,
                category: player.category,
                phone: player.phone,
                batting_style: player.batting_style,
                bowling_style: player.bowling_style,
                linked_email: linkedEmail,
                photo_url: player.photo_url,
              }}
              canDelete={ctx.profile?.is_super_admin === true}
              linkableUsers={linkableUsers ?? []}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
