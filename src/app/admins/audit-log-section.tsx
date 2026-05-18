import { Activity } from "lucide-react";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type AuditEvent = {
  id: string;
  eventType: string;
  matchId: string;
  matchSummary: {
    matchNumber: number | null;
    tournamentName: string;
    tournamentSlug: string;
    teamA: string;
    teamB: string;
  } | null;
  createdAt: string;
  actorName: string | null;
  payload: Record<string, unknown> | null;
};

export function AuditLogSection({ events }: { events: AuditEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="size-4 text-muted-foreground" />
          Recent activity
          <span className="ml-auto text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
            Last {events.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {events.length === 0 ? (
          <p className="px-6 pb-6 pt-2 text-sm text-muted-foreground">
            No match audit events recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-foreground/10">
            {events.map((e) => (
              <li
                key={e.id}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 text-sm sm:px-6"
              >
                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {e.eventType}
                </span>
                <div className="min-w-0">
                  <Link
                    href={`/matches/${e.matchId}`}
                    className="block truncate font-medium capitalize hover:underline"
                  >
                    {e.matchSummary
                      ? `${e.matchSummary.tournamentName} · ${e.matchSummary.teamA} vs ${e.matchSummary.teamB}`
                      : e.matchId}
                  </Link>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {e.actorName ?? "System"} · {formatRelative(e.createdAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}
