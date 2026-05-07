"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  isTournamentOrganizer,
  requireSuperAdmin,
  requireUser,
} from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import type { ActionResult } from "@/app/tournaments/actions";

const addAdminSchema = z.object({
  tournamentSlug: z.string().min(1),
  email: z.string().email("Enter a valid email"),
  role: z.enum(["organizer", "scorer"]),
});

export async function addAdmin(
  input: z.infer<typeof addAdminSchema>,
): Promise<ActionResult> {
  const parsed = addAdminSchema.safeParse(input);
  if (!parsed.success) {
    await requireUser();
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("id")
    .eq("slug", parsed.data.tournamentSlug)
    .single();
  if (!tournament) {
    await requireUser();
    return { ok: false, error: "Tournament not found" };
  }

  // Permission gate: only super-admin can add organizers; organizers (or super-admin) can add scorers.
  const ctx = await requireUser();
  const callerIsSuper = ctx.profile?.is_super_admin === true;
  if (parsed.data.role === "organizer" && !callerIsSuper) {
    return { ok: false, error: "Only super admins can add organizers" };
  }
  if (
    parsed.data.role === "scorer" &&
    !(await isTournamentOrganizer(tournament.id, ctx))
  ) {
    return { ok: false, error: "Only organizers or super admins can add scorers" };
  }

  // Resolve email → user_id via the SECURITY DEFINER helper.
  const { data: targetUserId, error: lookupErr } = await supabase.rpc(
    "lookup_user_id_by_email",
    { p_email: parsed.data.email },
  );
  if (lookupErr) {
    return { ok: false, error: lookupErr.message };
  }
  if (!targetUserId) {
    return {
      ok: false,
      error: `No user with email ${parsed.data.email}. They need to sign up first.`,
    };
  }

  const { error } = await supabase.from("tournament_admins").insert({
    tournament_id: tournament.id,
    user_id: targetUserId,
    role: parsed.data.role,
    added_by: ctx.user.id,
  });

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "That user is already an admin of this tournament",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath(`/tournaments/${parsed.data.tournamentSlug}/admins`);
  return { ok: true, data: undefined };
}

const removeAdminSchema = z.object({
  tournamentSlug: z.string().min(1),
  adminId: z.string().uuid(),
});

export async function removeAdmin(
  input: z.infer<typeof removeAdminSchema>,
): Promise<ActionResult> {
  const parsed = removeAdminSchema.safeParse(input);
  if (!parsed.success) {
    await requireUser();
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("id")
    .eq("slug", parsed.data.tournamentSlug)
    .single();
  if (!tournament) {
    await requireUser();
    return { ok: false, error: "Tournament not found" };
  }

  const { data: admin } = await supabase
    .from("tournament_admins")
    .select("role")
    .eq("id", parsed.data.adminId)
    .eq("tournament_id", tournament.id)
    .single();
  if (!admin) {
    await requireUser();
    return { ok: false, error: "Admin not found" };
  }

  // Permission: super-admin removes anyone; organizers can only remove scorers.
  const ctx = await requireUser();
  if (admin.role === "organizer" && !ctx.profile?.is_super_admin) {
    await requireSuperAdmin(); // redirect
  }
  if (
    admin.role === "scorer" &&
    !(await isTournamentOrganizer(tournament.id, ctx))
  ) {
    return { ok: false, error: "Only organizers or super admins can remove scorers" };
  }

  const { error } = await supabase
    .from("tournament_admins")
    .delete()
    .eq("id", parsed.data.adminId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/tournaments/${parsed.data.tournamentSlug}/admins`);
  return { ok: true, data: undefined };
}
