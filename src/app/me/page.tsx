import { Trophy, UserRound } from "lucide-react";
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
      .select("id, display_name, category, batting_style, bowling_style")
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

  // Career snapshot for the linked player — read from the
  // historical-aware v_player_tournament_stats view (sums across both
  // balls-derived and cricheroes-imported matches) + match_players for
  // the distinct match count.
  type PlayerCareer = {
    matches: number;
    runs: number;
    balls_faced: number;
    fours: number;
    sixes: number;
    wickets: number;
    runs_conceded: number;
    legal_balls_bowled: number;
  };
  let career: PlayerCareer | null = null;
  if (linkedPlayer) {
    type StatRow = {
      runs: number | null;
      balls_faced: number | null;
      fours: number | null;
      sixes: number | null;
      wickets: number | null;
      runs_conceded: number | null;
      legal_balls_bowled: number | null;
    };
    const [statsRes, mpRes] = await Promise.all([
      supabase
        .from("v_player_tournament_stats" as never)
        .select(
          "runs, balls_faced, fours, sixes, wickets, runs_conceded, legal_balls_bowled",
        )
        .eq("player_id", linkedPlayer.id),
      supabase
        .from("match_players")
        .select("match_id")
        .eq("player_id", linkedPlayer.id),
    ]);
    const rows = (statsRes.data as unknown as StatRow[] | null) ?? [];
    const matchSet = new Set<string>();
    for (const r of mpRes.data ?? []) matchSet.add(r.match_id);
    career = rows.reduce<PlayerCareer>(
      (acc, r) => ({
        matches: acc.matches,
        runs: acc.runs + (r.runs ?? 0),
        balls_faced: acc.balls_faced + (r.balls_faced ?? 0),
        fours: acc.fours + (r.fours ?? 0),
        sixes: acc.sixes + (r.sixes ?? 0),
        wickets: acc.wickets + (r.wickets ?? 0),
        runs_conceded: acc.runs_conceded + (r.runs_conceded ?? 0),
        legal_balls_bowled:
          acc.legal_balls_bowled + (r.legal_balls_bowled ?? 0),
      }),
      {
        matches: matchSet.size,
        runs: 0,
        balls_faced: 0,
        fours: 0,
        sixes: 0,
        wickets: 0,
        runs_conceded: 0,
        legal_balls_bowled: 0,
      },
    );
  }

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
          <CardContent className="space-y-4">
            {linkedPlayer && career ? (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold capitalize">
                      {linkedPlayer.display_name}
                    </span>
                    {linkedPlayer.category && (
                      <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-mono">
                        C{linkedPlayer.category}
                      </span>
                    )}
                  </div>
                  {(linkedPlayer.batting_style ||
                    linkedPlayer.bowling_style) && (
                    <span className="text-[11px] text-muted-foreground">
                      {[linkedPlayer.batting_style, linkedPlayer.bowling_style]
                        .filter(Boolean)
                        .map((s) => s!.replace(/_/g, " "))
                        .join(" · ")}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <MeStat label="Matches" value={career.matches} />
                  <MeStat label="Runs" value={career.runs} />
                  <MeStat label="4s" value={career.fours} />
                  <MeStat label="6s" value={career.sixes} />
                  <MeStat
                    label="SR"
                    value={
                      career.balls_faced > 0
                        ? ((career.runs / career.balls_faced) * 100).toFixed(1)
                        : "—"
                    }
                  />
                  <MeStat label="Wickets" value={career.wickets} />
                  <MeStat
                    label="Overs bowled"
                    value={`${Math.floor(career.legal_balls_bowled / 6)}.${career.legal_balls_bowled % 6}`}
                  />
                  <MeStat
                    label="Econ"
                    value={
                      career.legal_balls_bowled > 0
                        ? (
                            (career.runs_conceded /
                              career.legal_balls_bowled) *
                            6
                          ).toFixed(2)
                        : "—"
                    }
                  />
                </div>
                <div className="flex justify-end">
                  <Link
                    href={`/players/${linkedPlayer.id}`}
                    prefetch
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Per-tournament breakdown →
                  </Link>
                </div>
              </>
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

        <div className="flex justify-end border-t border-foreground/10 pt-4">
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
      </div>
    </main>
  );
}

function MeStat({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-md border border-foreground/10 bg-background p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-base font-semibold tabular-nums">
        {value}
      </div>
    </div>
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
