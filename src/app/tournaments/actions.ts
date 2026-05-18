"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOrganizer, requireSuperAdmin, requireUser } from "@/lib/auth";
import { getRuleSet, HVC_RULES } from "@/lib/scoring";
import { slugify } from "@/lib/slug";
import { createClient } from "@/lib/supabase/server";

import type { Json } from "@/lib/supabase/database.types";

const tournamentFormatValues = [
  "league",
  "knockout",
  "group_then_knockout",
  "round_robin_playoff_final",
] as const;
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
  logo_url: z.string().url().nullable().optional(),
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
  // Per-over category arrays — patched into the JSONB `rules`
  // column. Optional so legacy callers / tests that don't manage
  // categories pass through unchanged.
  cat1_overs: z.array(z.number().int().positive()).optional(),
  cat3_overs: z.array(z.number().int().positive()).optional(),
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
      // Default new tournaments to the HVC ruleset. Stored as JSONB so we can
      // tweak per-tournament without migrations. Engine reads via getRuleSet().
      rules: HVC_RULES as unknown as Json,
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
  const parsed = updateTournamentSchema.safeParse(input);
  if (!parsed.success) {
    await requireUser();
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  await requireOrganizer(parsed.data.id);
  const data = parsed.data;

  const supabase = await createClient();

  // Merge the new cat1/cat3 arrays into the existing rules JSONB
  // (when provided). Loading the row first lets us preserve every
  // unrelated field (super_over, extras, etc.) the form doesn't
  // touch — a partial `jsonb_set` would work too but the
  // round-trip is fine for what's a once-per-tournament write.
  let rulesUpdate: Json | undefined;
  if (data.cat1_overs !== undefined || data.cat3_overs !== undefined) {
    const { data: existing } = await supabase
      .from("tournaments")
      .select("rules")
      .eq("id", data.id)
      .single();
    const currentRules = getRuleSet(existing?.rules);
    const nextRules = {
      ...currentRules,
      categories: {
        ...currentRules.categories,
        cat1_overs: data.cat1_overs ?? currentRules.categories.cat1_overs,
        cat3_overs: data.cat3_overs ?? currentRules.categories.cat3_overs,
      },
    };
    rulesUpdate = nextRules as unknown as Json;
  }

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
      logo_url: data.logo_url ?? null,
      ...(rulesUpdate !== undefined ? { rules: rulesUpdate } : {}),
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

