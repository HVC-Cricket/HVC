"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import type { ActionResult } from "@/app/tournaments/actions";

const teamPlayerRoles = ["captain", "vice_captain", "wicket_keeper", "player"] as const;

const createTeamSchema = z.object({
  tournamentSlug: z.string().min(1),
  name: z.string().min(2, "Team name must be at least 2 characters"),
  short_name: z
    .string()
    .min(2, "Short name must be 2–5 characters")
    .max(5, "Short name must be 2–5 characters")
    .toUpperCase(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex like #1f6feb")
    .optional()
    .or(z.literal("")),
});

export async function createTeam(
  input: z.infer<typeof createTeamSchema>,
): Promise<ActionResult<{ teamId: string }>> {
  await requireUser();

  const parsed = createTeamSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data: tournament, error: tErr } = await supabase
    .from("tournaments")
    .select("id, slug")
    .eq("slug", parsed.data.tournamentSlug)
    .single();
  if (tErr || !tournament) {
    return { ok: false, error: "Tournament not found" };
  }

  const { error } = await supabase.from("teams").insert({
    tournament_id: tournament.id,
    name: parsed.data.name,
    short_name: parsed.data.short_name,
    color: parsed.data.color || null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/tournaments/${tournament.slug}`);
  redirect(`/tournaments/${tournament.slug}`);
}

const updateTeamSchema = z.object({
  tournamentSlug: z.string().min(1),
  teamId: z.string().uuid(),
  name: z.string().min(2, "Team name must be at least 2 characters"),
  short_name: z.string().min(2).max(5).toUpperCase(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Color must be a hex like #1f6feb")
    .optional()
    .or(z.literal("")),
});

export async function updateTeam(
  input: z.infer<typeof updateTeamSchema>,
): Promise<ActionResult> {
  await requireUser();
  const parsed = updateTeamSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("teams")
    .update({
      name: parsed.data.name,
      short_name: parsed.data.short_name,
      color: parsed.data.color || null,
    })
    .eq("id", parsed.data.teamId);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Another team in this tournament uses that name or short name" };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath(`/tournaments/${parsed.data.tournamentSlug}`);
  revalidatePath(`/tournaments/${parsed.data.tournamentSlug}/teams/${parsed.data.teamId}`);
  redirect(`/tournaments/${parsed.data.tournamentSlug}/teams/${parsed.data.teamId}`);
}

const deleteTeamSchema = z.object({
  tournamentSlug: z.string().min(1),
  teamId: z.string().uuid(),
});

export async function deleteTeam(
  input: z.infer<typeof deleteTeamSchema>,
): Promise<ActionResult> {
  await requireUser();
  const parsed = deleteTeamSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("teams")
    .delete()
    .eq("id", parsed.data.teamId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/tournaments/${parsed.data.tournamentSlug}`);
  redirect(`/tournaments/${parsed.data.tournamentSlug}`);
}

const addRosterSchema = z.object({
  tournamentSlug: z.string().min(1),
  teamId: z.string().uuid(),
  playerId: z.string().uuid(),
  jersey_number: z.coerce.number().int().min(0).max(999).optional(),
  role: z.enum(teamPlayerRoles),
});

export async function addPlayerToTeam(
  input: z.infer<typeof addRosterSchema>,
): Promise<ActionResult> {
  await requireUser();
  const parsed = addRosterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("team_players").insert({
    team_id: parsed.data.teamId,
    player_id: parsed.data.playerId,
    jersey_number: parsed.data.jersey_number ?? null,
    role: parsed.data.role,
  });

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Player is already on this team" };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath(`/tournaments/${parsed.data.tournamentSlug}/teams/${parsed.data.teamId}`);
  return { ok: true, data: undefined };
}

const removeRosterSchema = z.object({
  tournamentSlug: z.string().min(1),
  teamId: z.string().uuid(),
  rosterId: z.string().uuid(),
});

export async function removePlayerFromTeam(
  input: z.infer<typeof removeRosterSchema>,
): Promise<ActionResult> {
  await requireUser();
  const parsed = removeRosterSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("team_players")
    .delete()
    .eq("id", parsed.data.rosterId)
    .eq("team_id", parsed.data.teamId);

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/tournaments/${parsed.data.tournamentSlug}/teams/${parsed.data.teamId}`);
  return { ok: true, data: undefined };
}
