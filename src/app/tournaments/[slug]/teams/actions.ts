"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOrganizer, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import type { ActionResult } from "@/app/tournaments/actions";

const teamPlayerRoles = ["captain", "vice_captain", "wicket_keeper", "player"] as const;

async function resolveTournamentBySlug(slug: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tournaments")
    .select("id, slug")
    .eq("slug", slug)
    .single();
  if (error || !data) return null;
  return data;
}

const createTeamSchema = z.object({
  tournamentSlug: z.string().min(1),
  name: z.string().min(2, "Team name must be at least 2 characters"),
  short_name: z
    .string()
    .min(2, "Short name must be 2–5 characters")
    .max(5, "Short name must be 2–5 characters")
    .toUpperCase(),
});

export async function createTeam(
  input: z.infer<typeof createTeamSchema>,
): Promise<ActionResult<{ teamId: string }>> {
  const parsed = createTeamSchema.safeParse(input);
  if (!parsed.success) {
    await requireUser();
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const tournament = await resolveTournamentBySlug(parsed.data.tournamentSlug);
  if (!tournament) {
    await requireUser();
    return { ok: false, error: "Tournament not found" };
  }
  await requireOrganizer(tournament.id);

  const supabase = await createClient();
  const { error } = await supabase.from("teams").insert({
    tournament_id: tournament.id,
    name: parsed.data.name,
    short_name: parsed.data.short_name,
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
});

export async function updateTeam(
  input: z.infer<typeof updateTeamSchema>,
): Promise<ActionResult> {
  const parsed = updateTeamSchema.safeParse(input);
  if (!parsed.success) {
    await requireUser();
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const tournament = await resolveTournamentBySlug(parsed.data.tournamentSlug);
  if (!tournament) {
    await requireUser();
    return { ok: false, error: "Tournament not found" };
  }
  await requireOrganizer(tournament.id);

  const supabase = await createClient();
  const { error } = await supabase
    .from("teams")
    .update({
      name: parsed.data.name,
      short_name: parsed.data.short_name,
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
  const parsed = deleteTeamSchema.safeParse(input);
  if (!parsed.success) {
    await requireUser();
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const tournament = await resolveTournamentBySlug(parsed.data.tournamentSlug);
  if (!tournament) {
    await requireUser();
    return { ok: false, error: "Tournament not found" };
  }
  await requireOrganizer(tournament.id);

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
  role: z.enum(teamPlayerRoles),
});

export async function addPlayerToTeam(
  input: z.infer<typeof addRosterSchema>,
): Promise<ActionResult> {
  const parsed = addRosterSchema.safeParse(input);
  if (!parsed.success) {
    await requireUser();
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const tournament = await resolveTournamentBySlug(parsed.data.tournamentSlug);
  if (!tournament) {
    await requireUser();
    return { ok: false, error: "Tournament not found" };
  }
  await requireOrganizer(tournament.id);

  const supabase = await createClient();
  const { error } = await supabase.from("team_players").insert({
    team_id: parsed.data.teamId,
    player_id: parsed.data.playerId,
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
  const parsed = removeRosterSchema.safeParse(input);
  if (!parsed.success) {
    await requireUser();
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const tournament = await resolveTournamentBySlug(parsed.data.tournamentSlug);
  if (!tournament) {
    await requireUser();
    return { ok: false, error: "Tournament not found" };
  }
  await requireOrganizer(tournament.id);

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
