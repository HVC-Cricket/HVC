import { Plus, Shield, Trophy, UserRound } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { signOut } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { ProfileCard } from "./profile-card";

export const dynamic = "force-dynamic";

type AdminRole = "organizer" | "scorer";
type AdminEntry = {
  tournament_id: string;
  slug: string;
  name: string;
  role: AdminRole;
};

export default async function MePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Profile + linked player + tournament-admin rows in parallel.
  // Profile column list pruned to only what the page reads — phone /
  // updated_at etc. were being shipped unused.
  const [profileRes, linkedPlayerRes, adminRowsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, avatar_url, is_super_admin, created_at")
      .eq("id", user.id)
      .single(),
    supabase
      .from("players")
      .select("id, display_name")
      .eq("linked_user_id", user.id)
      .maybeSingle(),
    supabase
      .from("tournament_admins")
      .select("tournament_id, role")
      .eq("user_id", user.id),
  ]);
  const profile = profileRes.data;
  const linkedPlayer = linkedPlayerRes.data;
  const adminRows = adminRowsRes.data ?? [];

  // Resolve tournament names/slugs for the admin rows.
  const adminEntries: AdminEntry[] = [];
  if (adminRows.length > 0) {
    const ids = [...new Set(adminRows.map((r) => r.tournament_id))];
    const { data: tournaments } = await supabase
      .from("tournaments")
      .select("id, slug, name")
      .in("id", ids);
    const byId = new Map((tournaments ?? []).map((t) => [t.id, t]));
    for (const r of adminRows) {
      const t = byId.get(r.tournament_id);
      if (!t) continue;
      adminEntries.push({
        tournament_id: r.tournament_id,
        slug: t.slug,
        name: t.name,
        role: r.role as AdminRole,
      });
    }
    // Organizer rows first, then alphabetised within each role.
    adminEntries.sort((a, b) => {
      if (a.role !== b.role) return a.role === "organizer" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  // Role hierarchy for the hero badge.
  const isSuperAdmin = !!profile?.is_super_admin;
  const isOrganizer = adminEntries.some((e) => e.role === "organizer");
  const isScorer = adminEntries.some((e) => e.role === "scorer");
  const isPlayer = !!linkedPlayer;

  const { label: roleLabel, classes: roleClasses } = pickRoleBadge({
    isSuperAdmin,
    isOrganizer,
    isScorer,
    isPlayer,
  });

  const displayName =
    profile?.display_name ?? user.email?.split("@")[0] ?? "Member";

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <ProfileCard
          displayName={displayName}
          email={user.email ?? "—"}
          avatarUrl={profile?.avatar_url ?? null}
          roleLabel={roleLabel}
          roleClasses={roleClasses}
          joinedAt={
            profile?.created_at
              ? new Date(profile.created_at).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              : null
          }
        />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserRound className="size-4 text-muted-foreground" />
              Player profile
            </CardTitle>
          </CardHeader>
          <CardContent>
            {linkedPlayer ? (
              <Link
                href={`/players/${linkedPlayer.id}`}
                prefetch
                className="group flex items-center justify-between gap-3 rounded-md border border-foreground/10 bg-background px-3 py-2.5 transition hover:border-foreground/25 hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium capitalize">
                    {linkedPlayer.display_name}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Linked player record
                  </div>
                </div>
                <span className="text-xs text-muted-foreground transition group-hover:text-foreground">
                  View →
                </span>
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">
                Not linked to a player profile yet. Ask a tournament admin
                if you should be — they can link your account from the
                player edit page.
              </p>
            )}
          </CardContent>
        </Card>

        {adminEntries.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Trophy className="size-4 text-muted-foreground" />
                Tournaments you manage
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {adminEntries.map((e) => (
                <Link
                  key={e.tournament_id}
                  href={`/tournaments/${e.slug}`}
                  prefetch
                  className="group flex items-center justify-between gap-3 rounded-md border border-foreground/10 bg-background px-3 py-2.5 transition hover:border-foreground/25 hover:bg-muted/30"
                >
                  <span className="min-w-0 truncate text-sm font-medium capitalize">
                    {e.name}
                  </span>
                  <span
                    className={
                      "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                      (e.role === "organizer"
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-foreground/15 bg-muted text-muted-foreground")
                    }
                  >
                    {e.role}
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {isSuperAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="size-4 text-primary" />
                Super admin shortcuts
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Link href="/tournaments/new">
                <Button size="sm">
                  <Plus className="mr-1 size-3.5" />
                  New tournament
                </Button>
              </Link>
              <Link href="/tournaments">
                <Button variant="ghost" size="sm">
                  All tournaments
                </Button>
              </Link>
              <Link href="/players">
                <Button variant="ghost" size="sm">
                  Players
                </Button>
              </Link>
              <Link href="/players/new">
                <Button variant="ghost" size="sm">
                  <Plus className="mr-1 size-3.5" />
                  New player
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        <form action={signOut}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}

function pickRoleBadge({
  isSuperAdmin,
  isOrganizer,
  isScorer,
  isPlayer,
}: {
  isSuperAdmin: boolean;
  isOrganizer: boolean;
  isScorer: boolean;
  isPlayer: boolean;
}): { label: string; classes: string } {
  // Hierarchy: super-admin overrides everything; then organizer beats
  // scorer beats player beats plain member.
  if (isSuperAdmin) {
    return {
      label: "Super admin",
      classes: "border-primary/30 bg-primary/10 text-primary",
    };
  }
  if (isOrganizer) {
    return {
      label: "Organizer",
      classes:
        "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    };
  }
  if (isScorer) {
    return {
      label: "Scorer",
      classes:
        "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    };
  }
  if (isPlayer) {
    return {
      label: "Player",
      classes:
        "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    };
  }
  return {
    label: "Member",
    classes: "border-foreground/15 bg-muted text-muted-foreground",
  };
}
