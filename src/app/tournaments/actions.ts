"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireSuperAdmin, requireUser } from "@/lib/auth";
import { slugify } from "@/lib/slug";
import { createClient } from "@/lib/supabase/server";

const tournamentFormatValues = ["league", "knockout", "group_then_knockout"] as const;
const tournamentStatusValues = ["draft", "active", "completed", "archived"] as const;

const baseTournamentFields = {
  name: z.string().min(2, "Name must be at least 2 characters"),
  format: z.enum(tournamentFormatValues),
  default_overs_per_innings: z.coerce.number().int().positive().max(50),
  default_players_per_side: z.coerce.number().int().min(2).max(15),
  start_date: z.string().optional().or(z.literal("")),
  end_date: z.string().optional().or(z.literal("")),
  venue: z.string().optional().or(z.literal("")),
  description: z.string().optional().or(z.literal("")),
};

const createTournamentSchema = z.object(baseTournamentFields);
const updateTournamentSchema = z.object({
  ...baseTournamentFields,
  id: z.string().uuid(),
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, digits, hyphens"),
  status: z.enum(tournamentStatusValues),
});

export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;
export type UpdateTournamentInput = z.infer<typeof updateTournamentSchema>;

export type ActionResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function createTournament(
  input: CreateTournamentInput,
): Promise<ActionResult<{ slug: string }>> {
  await requireSuperAdmin();

  const parsed = createTournamentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in" };

  const baseSlug = slugify(data.name) || "tournament";
  // Try base slug, then base-2, base-3, etc., until insert succeeds.
  for (let attempt = 0; attempt < 10; attempt++) {
    const slug = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;

    const { error } = await supabase.from("tournaments").insert({
      name: data.name,
      slug,
      format: data.format,
      default_overs_per_innings: data.default_overs_per_innings,
      default_players_per_side: data.default_players_per_side,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      venue: data.venue || null,
      description: data.description || null,
      created_by: user.id,
    });

    if (!error) {
      revalidatePath("/tournaments");
      redirect(`/tournaments/${slug}`);
    }

    // 23505 = unique_violation. Retry with a suffix.
    if (error.code !== "23505") {
      return { ok: false, error: error.message };
    }
  }
  return { ok: false, error: "Could not generate a unique slug after 10 attempts" };
}

export async function updateTournament(
  input: UpdateTournamentInput,
): Promise<ActionResult<{ slug: string }>> {
  await requireSuperAdmin();

  const parsed = updateTournamentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("tournaments")
    .update({
      name: data.name,
      slug: data.slug,
      format: data.format,
      default_overs_per_innings: data.default_overs_per_innings,
      default_players_per_side: data.default_players_per_side,
      start_date: data.start_date || null,
      end_date: data.end_date || null,
      venue: data.venue || null,
      description: data.description || null,
      status: data.status,
    })
    .eq("id", data.id);

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: `Slug "${data.slug}" is already taken` };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/tournaments");
  revalidatePath(`/tournaments/${data.slug}`);
  redirect(`/tournaments/${data.slug}`);
}

const deleteTournamentSchema = z.object({ tournamentId: z.string().uuid() });

export async function deleteTournament(
  input: z.infer<typeof deleteTournamentSchema>,
): Promise<ActionResult> {
  await requireSuperAdmin();
  const parsed = deleteTournamentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tournaments")
    .delete()
    .eq("id", parsed.data.tournamentId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/tournaments");
  redirect("/tournaments");
}

const updateStatusSchema = z.object({
  tournamentId: z.string().uuid(),
  status: z.enum(tournamentStatusValues),
});

export async function updateTournamentStatus(
  input: z.infer<typeof updateStatusSchema>,
): Promise<ActionResult> {
  await requireUser();
  const parsed = updateStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("tournaments")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.tournamentId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/tournaments");
  return { ok: true, data: undefined };
}
