"use server";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const subscribeSchema = z.object({
  matchId: z.string().uuid(),
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

export async function subscribePush(
  input: z.infer<typeof subscribeSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = subscribeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  // Confirm the match actually exists before we accept a subscription —
  // stops random callers from filling the table with junk match_ids.
  const supabase = await createClient();
  const { data: match } = await supabase
    .from("matches")
    .select("id")
    .eq("id", parsed.data.matchId)
    .maybeSingle();
  if (!match) return { ok: false, error: "Match not found" };

  // Tag the row with the user_id if the caller is signed in (lets us
  // cascade-clean if the auth account is deleted). Anonymous spectators
  // get a NULL user_id — that's fine.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminClient();
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      match_id: parsed.data.matchId,
      user_id: user?.id ?? null,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.p256dh,
      auth: parsed.data.auth,
    },
    { onConflict: "match_id,endpoint" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

const unsubscribeSchema = z.object({
  matchId: z.string().uuid(),
  endpoint: z.string().url(),
});

export async function unsubscribePush(
  input: z.infer<typeof unsubscribeSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = unsubscribeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("push_subscriptions")
    .delete()
    .eq("match_id", parsed.data.matchId)
    .eq("endpoint", parsed.data.endpoint);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
