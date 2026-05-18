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

/**
 * Tournament-wide broadcast. Pulls every push subscription tied to
 * any match in the tournament, dedupes by endpoint (someone
 * subscribed to multiple matches gets ONE notification, not five),
 * and sends. Returns counts for the UI so the admin sees how many
 * devices got the ping.
 */
export async function notifyTournament(
  tournamentId: string,
  payload: MatchPushPayload,
): Promise<{ sent: number; pruned: number }> {
  if (!configureVapid()) {
    console.warn("[push] VAPID keys not configured — skipping broadcast");
    return { sent: 0, pruned: 0 };
  }

  const admin = createAdminClient();
  // Embed `matches` so we can filter by tournament_id without a
  // first round-trip for match ids.
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth, matches!inner(tournament_id)")
    .eq("matches.tournament_id", tournamentId);
  if (error) {
    console.error("[push] could not load tournament subscriptions:", error.message);
    return { sent: 0, pruned: 0 };
  }
  if (!subs || subs.length === 0) return { sent: 0, pruned: 0 };

  // De-dupe by endpoint so the user doesn't get N notifications when
  // they're subscribed to N matches in the same tournament.
  const byEndpoint = new Map<
    string,
    { id: string; endpoint: string; p256dh: string; auth: string }
  >();
  for (const s of subs as unknown as Array<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>) {
    if (!byEndpoint.has(s.endpoint)) byEndpoint.set(s.endpoint, s);
  }

  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;

  await Promise.all(
    Array.from(byEndpoint.values()).map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 3600 },
        );
        sent += 1;
      } catch (err: unknown) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? (err as { statusCode?: number }).statusCode
            : undefined;
        if (status === 404 || status === 410) {
          dead.push(sub.id);
          return;
        }
        console.error("[push] tournament sendNotification failed", status, err);
      }
    }),
  );

  if (dead.length > 0) {
    await admin.from("push_subscriptions").delete().in("id", dead);
  }
  return { sent, pruned: dead.length };
}

/**
 * Sends a single push to one known subscription — used for the
 * "Notifications on for this match" confirmation right after a user
 * subscribes, so they can verify their browser + permissions before
 * the first real event. Best-effort; logs and swallows errors.
 */
export async function notifyOne(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: MatchPushPayload,
) {
  if (!configureVapid()) {
    console.warn("[push] VAPID keys not configured — skipping confirmation");
    return;
  }
  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
      // Short TTL — if the device is offline at subscribe time, a stale
      // "you're subscribed" notification 10 minutes later is just noise.
      { TTL: 60 },
    );
  } catch (err: unknown) {
    const status =
      err && typeof err === "object" && "statusCode" in err
        ? (err as { statusCode?: number }).statusCode
        : undefined;
    console.error("[push] notifyOne failed", status, err);
  }
}
