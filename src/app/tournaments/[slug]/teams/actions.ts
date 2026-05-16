"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  canManageTeam,
  isTournamentOrganizer,
  requireOrganizer,
  requireUser,
} from "@/lib/auth";
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
  /** When true, redirect to the new team page after create. When
   *  false / omitted, redirect to the tournament page on its teams
   *  tab. */
  openAfterCreate: z.boolean().optional(),
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
  const { data, error } = await supabase
    .from("teams")
    .insert({
      tournament_id: tournament.id,
      name: parsed.data.name,
      short_name: parsed.data.short_name,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not create team" };
  }

  revalidatePath(`/tournaments/${tournament.slug}`);
  if (parsed.data.openAfterCreate) {
    redirect(`/tournaments/${tournament.slug}/teams/${data.id}`);
  }
  // Default: land back on the tournament page with the Teams tab open.
  redirect(`/tournaments/${tournament.slug}?tab=teams`);
}

const updateTeamSchema = z.object({
  tournamentSlug: z.string().min(1),
  teamId: z.string().uuid(),
  name: z.string().min(2, "Team name must be at least 2 characters"),
  short_name: z.string().min(2).max(5).toUpperCase(),
  logo_url: z.string().url().nullable().optional(),
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
  // Organizer OR team admin of this specific team can edit.
  const ctx = await requireUser();
  if (!(await canManageTeam(parsed.data.teamId, tournament.id, ctx))) {
    return { ok: false, error: "Not authorized to edit this team" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("teams")
    .update({
      name: parsed.data.name,
      short_name: parsed.data.short_name,
      logo_url: parsed.data.logo_url ?? null,
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
  const ctx = await requireUser();
  if (!(await canManageTeam(parsed.data.teamId, tournament.id, ctx))) {
    return { ok: false, error: "Not authorized to manage this team's roster" };
  }

  // Captain / vice-captain role changes are organizer-only. A team
  // admin (not organizer) can't add a player as captain/vc because
  // those roles ARE team-admin access — letting team admins hand
  // that out (or swap captaincy) would let them effectively remove
  // each other.
  const isOrg = await isTournamentOrganizer(tournament.id, ctx);
  if (!isOrg && (parsed.data.role === "captain" || parsed.data.role === "vice_captain")) {
    return {
      ok: false,
      error: "Only the tournament organizer can set captain or vice-captain.",
    };
  }

  const supabase = await createClient();

  // Cross-team-in-tournament guard: a player can be on at most one
  // team per tournament. Enforced here for everyone (the rule the
  // user asked for applies universally, not just to team admins —
  // having the same player on two teams in one tournament makes the
  // match XI picker, points table, and per-player stats ambiguous).
  const { data: conflicts } = await supabase
    .from("team_players")
    .select("teams!inner(id, name, tournament_id)")
    .eq("player_id", parsed.data.playerId)
    .neq("team_id", parsed.data.teamId);
  type RosterConflict = { teams: { tournament_id: string; name: string } };
  const inSameTournament = (
    (conflicts ?? []) as unknown as RosterConflict[]
  ).find((r) => r.teams.tournament_id === tournament.id);
  if (inSameTournament) {
    return {
      ok: false,
      error: `Player is already on another team in this tournament — "${inSameTournament.teams.name}". Remove them from there first.`,
    };
  }

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

const updateRosterRoleSchema = z.object({
  tournamentSlug: z.string().min(1),
  teamId: z.string().uuid(),
  rosterId: z.string().uuid(),
  role: z.enum(teamPlayerRoles),
});

export async function updateRosterRole(
  input: z.infer<typeof updateRosterRoleSchema>,
): Promise<ActionResult> {
  const parsed = updateRosterRoleSchema.safeParse(input);
  if (!parsed.success) {
    await requireUser();
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const tournament = await resolveTournamentBySlug(parsed.data.tournamentSlug);
  if (!tournament) {
    await requireUser();
    return { ok: false, error: "Tournament not found" };
  }
  const ctx = await requireUser();
  if (!(await canManageTeam(parsed.data.teamId, tournament.id, ctx))) {
    return { ok: false, error: "Not authorized to manage this team's roster" };
  }

  const isOrg = await isTournamentOrganizer(tournament.id, ctx);
  const supabase = await createClient();

  // Look up the current role; team admins can't promote into OR demote
  // out of captain / vice-captain — captain / vc IS the team-admin
  // role, so letting them flip that would let team admins remove
  // each other.
  if (!isOrg) {
    const { data: existing } = await supabase
      .from("team_players")
      .select("role")
      .eq("id", parsed.data.rosterId)
      .eq("team_id", parsed.data.teamId)
      .maybeSingle();
    const oldRole = existing?.role;
    const captaincy = (r: string | null | undefined) =>
      r === "captain" || r === "vice_captain";
    if (captaincy(oldRole) || captaincy(parsed.data.role)) {
      return {
        ok: false,
        error: "Only the tournament organizer can change captain or vice-captain.",
      };
    }
  }

  const { error } = await supabase
    .from("team_players")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.rosterId)
    .eq("team_id", parsed.data.teamId);

  if (error) return { ok: false, error: error.message };

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
  const ctx = await requireUser();
  if (!(await canManageTeam(parsed.data.teamId, tournament.id, ctx))) {
    return { ok: false, error: "Not authorized to manage this team's roster" };
  }

  const isOrg = await isTournamentOrganizer(tournament.id, ctx);
  const supabase = await createClient();

  // Removing the captain or vice-captain drops their team-admin
  // access (since captain/vc IS the team-admin role). Team admins
  // can't do that to each other — only the organizer can.
  if (!isOrg) {
    const { data: existing } = await supabase
      .from("team_players")
      .select("role")
      .eq("id", parsed.data.rosterId)
      .eq("team_id", parsed.data.teamId)
      .maybeSingle();
    if (existing?.role === "captain" || existing?.role === "vice_captain") {
      return {
        ok: false,
        error: "Only the tournament organizer can remove the captain or vice-captain.",
      };
    }
  }

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
