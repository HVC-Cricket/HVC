import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Match-level audit logging. Sibling to the per-ball log built into
 * the `balls` table (`scored_by` / `voided_by` columns) — this one
 * covers admin actions that AREN'T ball entries: toss, XI changes,
 * match start, innings transitions, completion, POTM picks.
 *
 * Writes go through the service-role admin client because the audit
 * table has RLS denying all (server-side `requireTournamentAdmin`
 * authorization is already done by the calling Server Action).
 *
 * Every call is best-effort — audit failures NEVER surface back to
 * the caller, so a transient logging issue can't break user actions.
 */

export type MatchAuditEventType =
  | "toss_set"
  | "xi_changed"
  | "match_started"
  | "innings_2_started"
  | "super_over_started"
  | "match_completed"
  | "match_unfinalized"
  | "potm_set"
  | "potm_cleared";

export type MatchAuditEvent = {
  id: string;
  match_id: string;
  event_type: MatchAuditEventType | string;
  actor_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export async function logMatchAuditEvent(args: {
  matchId: string;
  eventType: MatchAuditEventType;
  actorId: string | null;
  payload?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("match_audit_events").insert({
      match_id: args.matchId,
      event_type: args.eventType,
      actor_id: args.actorId,
      payload: (args.payload ?? null) as Json,
    });
  } catch (err) {
    console.error("[match-audit] failed to log", args.eventType, err);
  }
}

/**
 * Read all audit events for a match, oldest first. Caller is
 * expected to have done its own auth gating before invoking.
 */
export async function listMatchAuditEvents(
  matchId: string,
): Promise<MatchAuditEvent[]> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("match_audit_events")
      .select("id, match_id, event_type, actor_id, payload, created_at")
      .eq("match_id", matchId)
      .order("created_at", { ascending: true });
    return (data ?? []) as MatchAuditEvent[];
  } catch (err) {
    console.error("[match-audit] failed to read", err);
    return [];
  }
}
