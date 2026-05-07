import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionContext, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { EditPlayerForm } from "./edit-player-form";

export default async function EditPlayerPage(props: {
  params: Promise<{ playerId: string }>;
}) {
  await requireUser();
  const ctx = await getSessionContext();
  const { playerId } = await props.params;

  const supabase = await createClient();
  const { data: player } = await supabase
    .from("players")
    .select("id, display_name, phone, batting_style, bowling_style")
    .eq("id", playerId)
    .single();
  if (!player) notFound();

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
                phone: player.phone,
                batting_style: player.batting_style,
                bowling_style: player.bowling_style,
              }}
              canDelete={ctx?.profile?.is_super_admin === true}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
