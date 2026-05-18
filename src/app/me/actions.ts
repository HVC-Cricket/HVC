"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { PHONE_ALLOWED_RE } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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

const schema = z.object({
  display_name: z.string().min(2, "Name must be at least 2 characters"),
  avatar_url: z
    .string()
    .url("Avatar URL must be a valid URL")
    .optional()
    .or(z.literal("")),
  // Optional player-row fields. Phone is honored for any linked user
  // (it's their own contact info). Category / batting / bowling are
  // additionally gated server-side on is_super_admin. Form layer hides
  // the admin fields but the server still verifies.
  category: z.enum(["", "1", "2", "3"]).optional(),
  phone: z
    .string()
    .regex(PHONE_ALLOWED_RE, "Phone must contain only digits and + - ( ) spaces")
    .optional()
    .or(z.literal("")),
  batting_style: z.enum(["", ...battingStyles]).optional(),
  bowling_style: z.enum(["", ...bowlingStyles]).optional(),
});

export async function updateProfile(input: {
  display_name: string;
  avatar_url: string;
  category?: string;
  phone?: string;
  batting_style?: string;
  bowling_style?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: parsed.data.display_name,
      avatar_url: parsed.data.avatar_url || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (error) return { ok: false, error: error.message };

  // Player-row update. Phone is editable by any linked user (it's
  // their own contact info). Category / batting / bowling are
  // additionally gated on is_super_admin — those are admin fields,
  // not self-service. Either gate failing silently skips that subset
  // of the update; the profile write still went through.
  const hasPlayerFields =
    parsed.data.category != null ||
    parsed.data.phone != null ||
    parsed.data.batting_style != null ||
    parsed.data.bowling_style != null;
  if (hasPlayerFields) {
    const [profileRes, playerRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("is_super_admin")
        .eq("id", user.id)
        .single(),
      supabase
        .from("players")
        .select("id")
        .eq("linked_user_id", user.id)
        .maybeSingle(),
    ]);
    const isSuperAdmin = profileRes.data?.is_super_admin === true;
    const linkedPlayerId = playerRes.data?.id ?? null;
    if (linkedPlayerId) {
      const playerUpdate: {
        category?: 1 | 2 | 3 | null;
        phone?: string | null;
        batting_style?: string | null;
        bowling_style?: string | null;
      } = {};
      if (parsed.data.phone !== undefined) {
        playerUpdate.phone = parsed.data.phone || null;
      }
      if (isSuperAdmin) {
        if (parsed.data.category !== undefined) {
          playerUpdate.category = parsed.data.category
            ? (Number(parsed.data.category) as 1 | 2 | 3)
            : null;
        }
        if (parsed.data.batting_style !== undefined) {
          playerUpdate.batting_style = parsed.data.batting_style || null;
        }
        if (parsed.data.bowling_style !== undefined) {
          playerUpdate.bowling_style = parsed.data.bowling_style || null;
        }
      }
      // Only fire the UPDATE if we actually have something to write —
      // non-super-admin with no `phone` in the payload shouldn't
      // pointlessly hit the database.
      //
      // Use the admin client here, NOT the user-scoped one. `players`
      // has an RLS policy (`players_update_admin`) that only permits
      // super-admin / organizer writes, so a regular linked user
      // updating their own phone would silently no-op (PostgREST
      // returns success with 0 rows affected). The column whitelist
      // above is the trust boundary: we've already confirmed
      // `linkedPlayerId` belongs to the authenticated user
      // (`linked_user_id = user.id`) and limited which columns are
      // writable, so service-role here doesn't expand surface area.
      if (Object.keys(playerUpdate).length > 0) {
        const adminClient = createAdminClient();
        const { error: playerError } = await adminClient
          .from("players")
          .update(playerUpdate)
          .eq("id", linkedPlayerId);
        if (playerError) return { ok: false, error: playerError.message };
      }
    }
  }

  revalidatePath("/me");
  return { ok: true };
}
