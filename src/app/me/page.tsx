import Link from "next/link";
import { redirect } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function MePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  const { data: linkedPlayer } = await supabase
    .from("players")
    .select("id, display_name")
    .eq("linked_user_id", user.id)
    .maybeSingle();

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Auth round-trip + RLS read working if you can see this.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="User ID" value={user.id} mono />
          <Row label="Email" value={user.email ?? "—"} />
          <Row
            label="Display name"
            value={profile?.display_name ?? "(not loaded)"}
          />
          <Row
            label="Super admin"
            value={profile?.is_super_admin ? "yes" : "no"}
          />
          {profile?.created_at && (
            <Row
              label="Joined"
              value={new Date(profile.created_at).toLocaleString()}
            />
          )}
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Player record</span>
            {linkedPlayer ? (
              <Link
                href={`/players/${linkedPlayer.id}`}
                className="hover:underline"
              >
                {linkedPlayer.display_name}
              </Link>
            ) : (
              <span className="text-muted-foreground">none</span>
            )}
          </div>
          {error && (
            <p className="text-destructive">profiles read error: {error.message}</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs" : ""}>{value}</span>
    </div>
  );
}
