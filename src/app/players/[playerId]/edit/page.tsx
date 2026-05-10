import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>Edit player</CardTitle>
            <CardDescription>
              Editing <strong>{player.display_name}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
