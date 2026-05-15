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
import { requireOrganizer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getInitials } from "@/lib/utils";

import { AddAdminForm } from "./add-admin-form";
import { RemoveAdminButton } from "./remove-admin-button";

export const dynamic = "force-dynamic";

export default async function AdminsPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const supabase = await createClient();

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("id, name, slug")
    .eq("slug", slug)
    .single();
  if (!tournament) notFound();

  const ctx = await requireOrganizer(tournament.id);
  const isSuper = ctx.profile?.is_super_admin === true;

  // Admins list + profile dropdown source are independent — parallelise.
  const [adminsRes, allProfilesRes] = await Promise.all([
    supabase
      .from("tournament_admins")
      .select("id, user_id, role, created_at")
      .eq("tournament_id", tournament.id)
      .order("created_at", { ascending: true }),
    // Fetch ALL signed-up users so the add-admin form can present a
    // searchable picker instead of asking for an exact email.
    supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .order("display_name", { ascending: true }),
  ]);
  const admins = adminsRes.data;
  const allProfiles = allProfilesRes.data;
  const profileById = new Map(
    (allProfiles ?? []).map((p) => [p.id, p]),
  );
  const existingAdminUserIds = new Set(
    (admins ?? []).map((a) => a.user_id),
  );
  const addableUsers = (allProfiles ?? []).filter(
    (p) => !existingAdminUserIds.has(p.id),
  );

  const organizers = (admins ?? []).filter((a) => a.role === "organizer");
  const scorers = (admins ?? []).filter((a) => a.role === "scorer");

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <Link
          href={`/tournaments/${tournament.slug}`}
          prefetch
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          <span className="capitalize">{tournament.name}</span>
        </Link>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Admins</h1>
          <p className="text-sm text-muted-foreground">
            Organizers can edit teams, players, and matches. Scorers can enter
            ball-by-ball data for matches they&apos;re assigned to.
          </p>
        </div>

        <AdminList
          title="Organizers"
          description="Full tournament admin (super admin counts implicitly)."
          admins={organizers}
          profileById={profileById}
          tournamentSlug={tournament.slug}
          canRemove={isSuper}
        />

        <AdminList
          title="Scorers"
          description="Can enter ball-by-ball data."
          admins={scorers}
          profileById={profileById}
          tournamentSlug={tournament.slug}
          canRemove={true}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add admin</CardTitle>
            <CardDescription>
              {isSuper
                ? "Pick a signed-up user and assign them a role."
                : "Pick a signed-up user to add as a scorer. Only super admins can add organizers."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AddAdminForm
              tournamentSlug={tournament.slug}
              allowOrganizer={isSuper}
              users={addableUsers}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function AdminList({
  title,
  description,
  admins,
  profileById,
  tournamentSlug,
  canRemove,
}: {
  title: string;
  description: string;
  admins: { id: string; user_id: string; role: string; created_at: string }[];
  profileById: Map<
    string,
    { id: string; display_name: string; avatar_url: string | null }
  >;
  tournamentSlug: string;
  canRemove: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {admins.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="divide-y divide-foreground/10">
            {admins.map((a) => {
              const profile = profileById.get(a.user_id);
              const name = profile?.display_name ?? "(unknown user)";
              const initials = getInitials(name);
              return (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 px-6 py-3 text-sm"
                >
                  <span className="flex items-center gap-3">
                    {profile?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={profile.avatar_url}
                        alt=""
                        className="size-8 rounded-full border border-foreground/10 object-cover"
                      />
                    ) : (
                      <span className="flex size-8 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
                        {initials}
                      </span>
                    )}
                    <span className="font-medium capitalize">{name}</span>
                  </span>
                  {canRemove && (
                    <RemoveAdminButton
                      tournamentSlug={tournamentSlug}
                      adminId={a.id}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
