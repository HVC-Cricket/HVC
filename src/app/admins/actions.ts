"use server";

import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import type { ActionResult } from "@/app/tournaments/actions";

/**
 * Toggle the `is_super_admin` flag on a profile. Caller must already
 * be a super-admin (gate enforced both by `requireSuperAdmin` and by
 * the `prevent_self_promote` trigger on profiles, which only blocks
 * the change when the caller is *not* a super-admin).
 *
 * Demotion safeguard: refuses to demote the last super-admin so the
 * org never ends up locked out. Self-demotion is otherwise allowed —
 * the trigger permits it as long as the caller is currently super.
 */
export async function setSuperAdmin(
  userId: string,
  value: boolean,
): Promise<ActionResult<null>> {
  await requireSuperAdmin();
  const supabase = await createClient();

  if (!value) {
    // Count remaining super-admins after this change would land. If
    // it'd hit zero, bail.
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("is_super_admin", true)
      .neq("id", userId);
    if ((count ?? 0) === 0) {
      return {
        ok: false,
        error: "Can't demote the last super-admin — promote someone else first.",
      };
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({ is_super_admin: value, updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admins");
  return { ok: true, data: null };
}

/**
 * Set or clear the player linked to an auth user. Two-step write
 * because `players.linked_user_id` carries a partial unique index
 * (1 player per user):
 *   1. Clear any existing link from this user (so changing user → A
 *      to user → B doesn't violate the index).
 *   2. Set the new link, if a target player is given.
 *
 * Pass `playerId = null` to fully unlink.
 *
 * The `20260518000000_sync_player_on_link` trigger fires on the
 * second UPDATE and pulls display_name + avatar_url from the linked
 * profile into the player row.
 */
export async function setLinkedPlayer(
  userId: string,
  playerId: string | null,
): Promise<ActionResult<null>> {
  await requireSuperAdmin();
  const supabase = await createClient();

  const { error: clearError } = await supabase
    .from("players")
    .update({ linked_user_id: null })
    .eq("linked_user_id", userId);
  if (clearError) return { ok: false, error: clearError.message };

  if (playerId) {
    const { error: setError } = await supabase
      .from("players")
      .update({ linked_user_id: userId })
      .eq("id", playerId);
    if (setError) return { ok: false, error: setError.message };
  }

  revalidatePath("/admins");
  return { ok: true, data: null };
}
