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
