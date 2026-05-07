"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireSuperAdmin, requireUser } from "@/lib/auth";
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

const createPlayerSchema = z.object({
  display_name: z.string().min(2, "Name must be at least 2 characters"),
  phone: z.string().optional().or(z.literal("")),
  batting_style: z.enum(["", ...battingStyles]).optional(),
  bowling_style: z.enum(["", ...bowlingStyles]).optional(),
  redirectTo: z.string().optional(),
});

export async function createPlayer(
  input: z.infer<typeof createPlayerSchema>,
): Promise<ActionResult<{ playerId: string }>> {
  await requireUser();

  const parsed = createPlayerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("players")
    .insert({
      display_name: parsed.data.display_name,
      phone: parsed.data.phone || null,
      batting_style: parsed.data.batting_style || null,
      bowling_style: parsed.data.bowling_style || null,
    })
    .select("id")
    .single();

  if (error || !data) {
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
  phone: z.string().optional().or(z.literal("")),
  batting_style: z.enum(["", ...battingStyles]).optional(),
  bowling_style: z.enum(["", ...bowlingStyles]).optional(),
});

export async function updatePlayer(
  input: z.infer<typeof updatePlayerSchema>,
): Promise<ActionResult> {
  await requireUser();
  const parsed = updatePlayerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("players")
    .update({
      display_name: parsed.data.display_name,
      phone: parsed.data.phone || null,
      batting_style: parsed.data.batting_style || null,
      bowling_style: parsed.data.bowling_style || null,
    })
    .eq("id", parsed.data.playerId);

  if (error) return { ok: false, error: error.message };

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
