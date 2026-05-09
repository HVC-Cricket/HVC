"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOrganizerOrSuperAdmin, requireSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import type { ActionResult } from "@/app/tournaments/actions";

const battingStyles = ["right_hand", "left_hand"] as const;
const bowlingStyles = [
  "right_arm_fast",
  "right_arm_medium",
  "right_arm_off_spin",
  "right_arm_leg_spin",
  "left_arm_fast",
  "left_arm_medium",
  "left_arm_orthodox",
  "left_arm_chinaman",
] as const;

const emailField = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .refine(
    (v) => !v || z.string().email().safeParse(v).success,
    { message: "Enter a valid email" },
  );

const createPlayerSchema = z.object({
  display_name: z.string().min(2, "Name must be at least 2 characters"),
  category: z.coerce.number().int().min(1).max(3),
  phone: z.string().optional().or(z.literal("")),
  batting_style: z.enum(["", ...battingStyles]).optional(),
  bowling_style: z.enum(["", ...bowlingStyles]).optional(),
  linked_email: emailField,
  redirectTo: z.string().optional(),
});

async function resolveLinkedUserId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  email: string | undefined | null,
): Promise<{ ok: true; userId: string | null } | { ok: false; error: string }> {
  const trimmed = email?.trim();
  if (!trimmed) return { ok: true, userId: null };

  const { data, error } = await supabase.rpc("lookup_user_id_by_email", {
    p_email: trimmed,
  });
  if (error) return { ok: false, error: error.message };
  if (!data) {
    return {
      ok: false,
      error: `No user with email ${trimmed}. They need to sign up first.`,
    };
  }
  return { ok: true, userId: data };
}

export async function createPlayer(
  input: z.infer<typeof createPlayerSchema>,
): Promise<ActionResult<{ playerId: string }>> {
  await requireOrganizerOrSuperAdmin();

  const parsed = createPlayerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  const linked = await resolveLinkedUserId(supabase, parsed.data.linked_email);
  if (!linked.ok) return { ok: false, error: linked.error };

  const { data, error } = await supabase
    .from("players")
    .insert({
      display_name: parsed.data.display_name,
      category: parsed.data.category as 1 | 2 | 3,
      phone: parsed.data.phone || null,
      batting_style: parsed.data.batting_style || null,
      bowling_style: parsed.data.bowling_style || null,
      linked_user_id: linked.userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return {
        ok: false,
        error: "That user is already linked to another player record.",
      };
    }
    return { ok: false, error: error?.message ?? "Insert failed" };
  }

  revalidatePath("/players");
  if (parsed.data.redirectTo) {
    redirect(parsed.data.redirectTo);
  }
  redirect("/players");
}

const updatePlayerSchema = z.object({
  playerId: z.string().uuid(),
  display_name: z.string().min(2),
  category: z.coerce.number().int().min(1).max(3),
  phone: z.string().optional().or(z.literal("")),
  batting_style: z.enum(["", ...battingStyles]).optional(),
  bowling_style: z.enum(["", ...bowlingStyles]).optional(),
  linked_email: emailField,
});

export async function updatePlayer(
  input: z.infer<typeof updatePlayerSchema>,
): Promise<ActionResult> {
  await requireOrganizerOrSuperAdmin();
  const parsed = updatePlayerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();

  const linked = await resolveLinkedUserId(supabase, parsed.data.linked_email);
  if (!linked.ok) return { ok: false, error: linked.error };

  const { error } = await supabase
    .from("players")
    .update({
      display_name: parsed.data.display_name,
      category: parsed.data.category as 1 | 2 | 3,
      phone: parsed.data.phone || null,
      batting_style: parsed.data.batting_style || null,
      bowling_style: parsed.data.bowling_style || null,
      linked_user_id: linked.userId,
    })
    .eq("id", parsed.data.playerId);

  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: "That user is already linked to another player record.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/players");
  redirect("/players");
}

const deletePlayerSchema = z.object({ playerId: z.string().uuid() });

export async function deletePlayer(
  input: z.infer<typeof deletePlayerSchema>,
): Promise<ActionResult> {
  await requireSuperAdmin();
  const parsed = deletePlayerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("players")
    .delete()
    .eq("id", parsed.data.playerId);

  if (error) {
    if (error.code === "23503") {
      return {
        ok: false,
        error:
          "This player is on a team roster or has match history. Remove them from rosters first.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/players");
  redirect("/players");
}
