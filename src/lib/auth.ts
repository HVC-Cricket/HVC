import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export type SessionContext = {
  user: {
    id: string;
    email: string | null;
  };
  profile: {
    display_name: string;
    is_super_admin: boolean;
  } | null;
};

export async function getSessionContext(): Promise<SessionContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, is_super_admin")
    .eq("id", user.id)
    .single();

  return {
    user: { id: user.id, email: user.email ?? null },
    profile: profile
      ? {
          display_name: profile.display_name,
          is_super_admin: profile.is_super_admin,
        }
      : null,
  };
}

export async function requireUser(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function requireSuperAdmin(): Promise<SessionContext> {
  const ctx = await requireUser();
  if (!ctx.profile?.is_super_admin) redirect("/");
  return ctx;
}

/** Mirror of the SQL `is_tournament_organizer()` helper. */
export async function isTournamentOrganizer(
  tournamentId: string,
  ctx: SessionContext,
): Promise<boolean> {
  if (ctx.profile?.is_super_admin) return true;
  const supabase = await createClient();
  const { data } = await supabase
    .from("tournament_admins")
    .select("role")
    .eq("tournament_id", tournamentId)
    .eq("user_id", ctx.user.id)
    .eq("role", "organizer")
    .maybeSingle();
  return !!data;
}

/** Mirror of the SQL `is_tournament_admin()` helper (organizer OR scorer). */
export async function isTournamentAdmin(
  tournamentId: string,
  ctx: SessionContext,
): Promise<boolean> {
  if (ctx.profile?.is_super_admin) return true;
  const supabase = await createClient();
  const { data } = await supabase
    .from("tournament_admins")
    .select("role")
    .eq("tournament_id", tournamentId)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  return !!data;
}

export async function requireOrganizer(
  tournamentId: string,
): Promise<SessionContext> {
  const ctx = await requireUser();
  if (!(await isTournamentOrganizer(tournamentId, ctx))) redirect("/");
  return ctx;
}

export async function requireTournamentAdmin(
  tournamentId: string,
): Promise<SessionContext> {
  const ctx = await requireUser();
  if (!(await isTournamentAdmin(tournamentId, ctx))) redirect("/");
  return ctx;
}
