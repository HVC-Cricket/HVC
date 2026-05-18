import { ChevronLeft } from "lucide-react";
import Link from "next/link";
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

  // Both RPCs depend only on data already in hand — parallelise.
  const [linkedEmailRes, linkableUsersRes] = await Promise.all([
    player.linked_user_id
      ? supabase.rpc("lookup_email_by_user_id", {
          p_user_id: player.linked_user_id,
        })
      : Promise.resolve({ data: null }),
    supabase.rpc("list_users_for_linking"),
  ]);
  const linkedEmail = (linkedEmailRes.data as string | null) ?? null;
  const linkableUsers = linkableUsersRes.data;

  // Surface a warning when the player is on the playing XI of any
  // in-progress match. Changing their `category` mid-match would
  // shift which Cat-N overs are still satisfiable; changing their
  // name / photo is harmless. Read-only check — doesn't block the
  // save, just informs.
  const { data: liveMatchPlayers } = await supabase
    .from("match_players")
    .select(
      "match_id, matches!inner(id, status, match_number, team_a_id, team_b_id, tournaments(name, slug))",
    )
    .eq("player_id", player.id)
    .eq("is_substitute", false)
    .in("matches.status", ["live", "innings_break"]);
  type LiveRow = {
    match_id: string;
    matches: {
      id: string;
      status: string;
      match_number: number | null;
      team_a_id: string;
      team_b_id: string;
      tournaments: { name: string; slug: string } | null;
    } | null;
  };
  const liveMatches = (
    (liveMatchPlayers ?? []) as unknown as LiveRow[]
  )
    .map((r) => r.matches)
    .filter((m): m is NonNullable<typeof m> => m != null);

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

        {liveMatches.length > 0 && (
          <Card className="border-amber-500/30 bg-amber-500/5 dark:border-amber-400/20 dark:bg-amber-400/5">
            <CardHeader>
              <CardTitle className="text-base">
                Player is in a live match
              </CardTitle>
              <CardDescription className="space-y-1">
                <span className="block">
                  Changing <strong>category</strong> mid-match may break
                  Cat-N over rules already scheduled. Name, photo, phone,
                  and batting / bowling style are safe to edit.
                </span>
                <span className="block">
                  Currently on the XI of:
                </span>
                <ul className="list-disc space-y-0.5 pl-5">
                  {liveMatches.map((m) => (
                    <li key={m.id}>
                      <Link
                        href={`/matches/${m.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {m.tournaments?.name ?? "(unknown tournament)"} ·
                        Match {m.match_number ?? "?"}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardDescription>
            </CardHeader>
          </Card>
        )}

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
