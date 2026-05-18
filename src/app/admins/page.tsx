import { ShieldAlert } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

import { AuditLogSection } from "./audit-log-section";
import { MembersTable, type MemberRow, type PlayerOption } from "./members-table";

export const dynamic = "force-dynamic";

export default async function AdminsPage() {
  await requireSuperAdmin();

  const adminClient = createAdminClient();

  // Fan out every read in parallel — service-role bypasses RLS, so
  // we can pull auth.users + all the joined tables in one shot.
  const [
    usersRes,
    profilesRes,
    playersRes,
    tournamentAdminsRes,
    tournamentsCountRes,
    matchesCountRes,
    superCountRes,
    auditRes,
  ] = await Promise.all([
    adminClient.auth.admin.listUsers({ perPage: 1000 }),
    adminClient
      .from("profiles")
      .select("id, display_name, avatar_url, is_super_admin, created_at"),
    adminClient
      .from("players")
      .select("id, display_name, linked_user_id, photo_url"),
    adminClient
      .from("tournament_admins")
      .select("user_id, tournament_id, role"),
    adminClient
      .from("tournaments")
      .select("id", { count: "exact", head: true }),
    adminClient
      .from("matches")
      .select("id", { count: "exact", head: true }),
    adminClient
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("is_super_admin", true),
    adminClient
      .from("match_audit_events")
      .select("id, match_id, event_type, payload, created_at, actor_id")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  // Look up match → tournament summary for the audit log so each row
  // can read "Final · TWN vs MM" instead of a bare UUID. Skip the
  // joined query in `adminClient.from("match_audit_events")` above —
  // the multi-hop embed is fiddly and a separate `.in("id", …)` is
  // both simpler and easier to read.
  const auditMatchIds = [
    ...new Set((auditRes.data ?? []).map((e) => e.match_id)),
  ];
  const matchSummariesRes = auditMatchIds.length
    ? await adminClient
        .from("matches")
        .select(
          "id, match_number, tournament_id, team_a_id, team_b_id, tournaments(name, slug)",
        )
        .in("id", auditMatchIds)
    : { data: [] as never[] };
  const matchSummaryById = new Map<
    string,
    {
      matchNumber: number | null;
      tournamentName: string;
      tournamentSlug: string;
      teamA: string;
      teamB: string;
    }
  >();
  const teamIdsForAudit = [
    ...new Set(
      (matchSummariesRes.data ?? []).flatMap((m) => [m.team_a_id, m.team_b_id]),
    ),
  ];
  const teamShortByIdRes = teamIdsForAudit.length
    ? await adminClient
        .from("teams")
        .select("id, short_name")
        .in("id", teamIdsForAudit)
    : { data: [] as never[] };
  const teamShortById = new Map(
    (teamShortByIdRes.data ?? []).map((t) => [t.id, t.short_name]),
  );
  for (const m of matchSummariesRes.data ?? []) {
    const tournament = Array.isArray(m.tournaments)
      ? m.tournaments[0]
      : m.tournaments;
    matchSummaryById.set(m.id, {
      matchNumber: m.match_number,
      tournamentName: tournament?.name ?? "",
      tournamentSlug: tournament?.slug ?? "",
      teamA: teamShortById.get(m.team_a_id) ?? "",
      teamB: teamShortById.get(m.team_b_id) ?? "",
    });
  }

  const users = usersRes.data?.users ?? [];
  const profileById = new Map(
    (profilesRes.data ?? []).map((p) => [p.id, p]),
  );
  const allPlayers = playersRes.data ?? [];
  const playerByLinkedUser = new Map(
    allPlayers
      .filter((p) => p.linked_user_id)
      .map((p) => [p.linked_user_id as string, p]),
  );

  // Tournament-admin roles per user (organizer / scorer counts).
  const adminCountByUser = new Map<
    string,
    { organizer: number; scorer: number }
  >();
  for (const row of tournamentAdminsRes.data ?? []) {
    if (!row.user_id) continue;
    const c = adminCountByUser.get(row.user_id) ?? {
      organizer: 0,
      scorer: 0,
    };
    if (row.role === "organizer") c.organizer += 1;
    if (row.role === "scorer") c.scorer += 1;
    adminCountByUser.set(row.user_id, c);
  }

  // Resolve actor display names for the audit log.
  const actorNameById = new Map<string, string>();
  for (const u of users) {
    const p = profileById.get(u.id);
    actorNameById.set(u.id, p?.display_name ?? u.email ?? "Unknown");
  }

  const rows: MemberRow[] = users
    .map((u) => {
      const profile = profileById.get(u.id);
      const linkedPlayer = playerByLinkedUser.get(u.id);
      const counts = adminCountByUser.get(u.id) ?? { organizer: 0, scorer: 0 };
      return {
        userId: u.id,
        email: u.email ?? "—",
        displayName: profile?.display_name ?? u.email?.split("@")[0] ?? "",
        avatarUrl: profile?.avatar_url ?? null,
        isSuperAdmin: profile?.is_super_admin === true,
        organizerCount: counts.organizer,
        scorerCount: counts.scorer,
        linkedPlayer: linkedPlayer
          ? {
              id: linkedPlayer.id,
              displayName: linkedPlayer.display_name,
              photoUrl: linkedPlayer.photo_url ?? null,
            }
          : null,
        joinedAt: u.created_at,
      };
    })
    .sort((a, b) => {
      // Super admins first, then organizers, then alphabetical.
      if (a.isSuperAdmin !== b.isSuperAdmin) return a.isSuperAdmin ? -1 : 1;
      if ((a.organizerCount > 0) !== (b.organizerCount > 0))
        return a.organizerCount > 0 ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

  const playerOptions: PlayerOption[] = allPlayers
    .map((p) => ({
      id: p.id,
      displayName: p.display_name,
      linkedUserId: p.linked_user_id ?? null,
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  // Audit log rows shaped for the section component.
  const auditEvents = (auditRes.data ?? []).map((e) => ({
    id: e.id,
    eventType: e.event_type,
    matchId: e.match_id,
    matchSummary: matchSummaryById.get(e.match_id) ?? null,
    createdAt: e.created_at,
    actorName: e.actor_id ? (actorNameById.get(e.actor_id) ?? "Unknown") : null,
    payload: e.payload as Record<string, unknown> | null,
  }));

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <header className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldAlert className="size-5" />
          </div>
          <div className="space-y-0.5">
            <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
            <p className="text-sm text-muted-foreground">
              Members, roles, and recent activity. Super-admin only.
            </p>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick stats</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Users" value={users.length} />
            <Stat label="Super admins" value={superCountRes.count ?? 0} />
            <Stat label="Players" value={allPlayers.length} />
            <Stat label="Tournaments" value={tournamentsCountRes.count ?? 0} />
            <Stat label="Matches" value={matchesCountRes.count ?? 0} />
          </CardContent>
        </Card>

        <MembersTable rows={rows} playerOptions={playerOptions} />

        <AuditLogSection events={auditEvents} />
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-foreground/10 bg-background px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
