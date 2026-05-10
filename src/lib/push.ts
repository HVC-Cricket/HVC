import "server-only";

import webpush from "web-push";

import { createAdminClient } from "@/lib/supabase/admin";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:hvc.cricket@gmail.com";

let configured = false;

function configureVapid(): boolean {
  if (configured) return true;
  if (!PUBLIC_KEY || !PRIVATE_KEY) return false;
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  configured = true;
  return true;
}

export type MatchPushPayload = {
  title: string;
  body: string;
  url: string;
  /** De-duplication key — newer notifications with the same tag replace the old one. */
  tag?: string;
};

/**
 * Sends `payload` to every active push subscription for `matchId`. Dead
 * subscriptions (404 / 410 from the push service) are pruned. Errors per
 * subscription are logged but never re-thrown — the caller (recordBall
 * via `after()`) treats this as best-effort.
 */
export async function notifyMatch(matchId: string, payload: MatchPushPayload) {
  if (!configureVapid()) {
    console.warn("[push] VAPID keys not configured — skipping dispatch");
    return;
  }

  const admin = createAdminClient();
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("match_id", matchId);
  if (error) {
    console.error("[push] could not load subscriptions:", error.message);
    return;
  }
  if (!subs || subs.length === 0) return;

  const body = JSON.stringify(payload);
  const dead: string[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 600 },
        );
      } catch (err: unknown) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        if (status === 404 || status === 410) {
          dead.push(sub.id);
          return;
        }
        console.error("[push] sendNotification failed", status, err);
      }
    }),
  );

  if (dead.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", dead);
  }
}
