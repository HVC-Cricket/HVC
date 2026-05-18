"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSuperAdmin } from "@/lib/auth";
import { notifyTournament } from "@/lib/push";
import { createAdminClient } from "@/lib/supabase/admin";
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

  const { data, error } = await supabase
    .from("profiles")
    .update({ is_super_admin: value, updated_at: new Date().toISOString() })
    .eq("id", userId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  // PostgREST returns success with 0 rows when RLS rejects the
  // UPDATE — that's how this whole feature shipped silently broken
  // before the `profiles_update_super` policy landed. Fail loud
  // here so any future RLS regression surfaces immediately.
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Update didn't apply — RLS on profiles may be blocking the write.",
    };
  }

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

/**
 * Permanently delete an auth user. Cascades through `profiles` (FK
 * with `on delete cascade`), nulls out `players.linked_user_id`,
 * and removes `tournament_admins` rows for the user. The actual
 * deletion goes through the Supabase admin API because `auth.users`
 * is in the protected `auth` schema and isn't writable via the
 * user-scoped REST client.
 *
 * Safeguards:
 *   - Caller must be super-admin (gate at the top + same gate is
 *     enforced on the page route).
 *   - Can't delete yourself — typically a footgun, and there's no
 *     way to undo it from the app.
 *   - Can't delete the last remaining super-admin — protects
 *     against an org locking itself out.
 *
 * Match data (balls, innings, match_players) is untouched — those
 * tables don't reference `auth.users` directly; they reference
 * `players`, which keeps its `display_name` after the link is
 * cleared.
 */
export async function deleteUser(
  userId: string,
): Promise<ActionResult<null>> {
  const ctx = await requireSuperAdmin();
  if (ctx.user.id === userId) {
    return {
      ok: false,
      error: "You can't delete your own account from here.",
    };
  }

  const supabase = await createClient();
  // Super-admins can't be deleted from here at all — they have to be
  // demoted first (via this same page) before deletion. This is
  // stronger than the previous "only block the last one" rule and
  // matches the new DB trigger `prevent_super_admin_delete` so the
  // server and the DB agree.
  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("is_super_admin")
    .eq("id", userId)
    .maybeSingle();
  if (targetProfile?.is_super_admin) {
    return {
      ok: false,
      error:
        "Super-admins can't be deleted. Demote them to a normal user first, then delete.",
    };
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admins");
  return { ok: true, data: null };
}

// ---------------------------------------------------------------------------
// Tournament push broadcast
// ---------------------------------------------------------------------------

const broadcastSchema = z.object({
  tournament_id: z.string().uuid(),
  title: z.string().min(2, "Title too short").max(80, "Title too long"),
  body: z.string().min(2, "Message too short").max(240, "Message too long"),
});

/**
 * Send a push notification to every device subscribed to any match
 * in the given tournament (de-duplicated by endpoint). Returns the
 * number of devices that received it and the number of dead
 * subscriptions pruned in the process.
 */
export async function broadcastToTournament(
  input: z.infer<typeof broadcastSchema>,
): Promise<ActionResult<{ sent: number; pruned: number }>> {
  await requireSuperAdmin();
  const parsed = broadcastSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  // Look up the tournament slug so the deep-link inside the
  // notification opens the tournament page (the per-match notifyMatch
  // payload uses `/matches/[id]`; for tournament-wide broadcasts the
  // matching destination is the tournament page).
  const supabase = await createClient();
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("slug")
    .eq("id", parsed.data.tournament_id)
    .single();
  if (!tournament) return { ok: false, error: "Tournament not found" };

  const result = await notifyTournament(parsed.data.tournament_id, {
    title: parsed.data.title,
    body: parsed.data.body,
    url: `/tournaments/${tournament.slug}`,
    // De-dup tag so a rapid second broadcast replaces the first on
    // the device, rather than stacking up.
    tag: `tournament-${parsed.data.tournament_id}-broadcast`,
  });

  return { ok: true, data: result };
}

// ---------------------------------------------------------------------------
// Storage: delete orphan objects in a bucket
// ---------------------------------------------------------------------------

const deleteOrphansSchema = z.object({
  bucket: z.string().min(1),
  // Paths to delete — caller is expected to supply only orphans
  // (objects whose corresponding DB column is null). Server still
  // re-walks the same orphan computation to make sure none of these
  // paths are referenced by a `*_url` somewhere, so a stale client
  // payload can't nuke a live file.
  paths: z.array(z.string().min(1)).min(1),
});

export async function deleteOrphanStorageObjects(
  input: z.infer<typeof deleteOrphansSchema>,
): Promise<ActionResult<{ deleted: number }>> {
  await requireSuperAdmin();
  const parsed = deleteOrphansSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  // Re-verify that every path supplied is genuinely orphan right
  // now — defends against the client posting a stale orphan list
  // after someone re-uploaded a file in another tab.
  const { loadStorageReport } = await import("./storage-loader");
  const report = await loadStorageReport();
  const bucketReport = report.find((b) => b.bucket === parsed.data.bucket);
  if (!bucketReport) {
    return { ok: false, error: "Unknown bucket" };
  }
  const orphanPaths = new Set(bucketReport.orphans.map((o) => o.path));
  const safePaths = parsed.data.paths.filter((p) => orphanPaths.has(p));
  if (safePaths.length === 0) {
    return {
      ok: false,
      error:
        "None of the requested paths are still orphan — list may be stale, refresh and retry.",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(parsed.data.bucket)
    .remove(safePaths);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admins");
  return { ok: true, data: { deleted: safePaths.length } };
}
