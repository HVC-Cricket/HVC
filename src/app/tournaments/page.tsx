import { CalendarDays, MapPin, Trophy, Users } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionContext } from "@/lib/auth";
import { type MatchStage, type MatchStatus } from "@/lib/constants/match";
import {
  deriveTournamentStatus,
  FORMAT_LABEL,
  STATUS_CLASSES,
  STATUS_LABEL,
  type TournamentFormat,
  type TournamentStatus,
} from "@/lib/constants/tournament";
import { formatDateRange } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type TournamentRow = {
  id: string;
  name: string;
  slug: string;
  format: TournamentFormat;
  status: TournamentStatus;
  venue: string | null;
  start_date: string | null;
  end_date: string | null;
  logo_url: string | null;
};

const STATUS_ORDER: Record<TournamentStatus, number> = {
  active: 0,
  draft: 1,
  completed: 2,
  archived: 3,
};

export default async function TournamentsPage() {
  const supabase = await createClient();
  const ctx = await getSessionContext();

  const { data: tournaments, error } = await supabase
    .from("tournaments")
    .select(
      "id, name, slug, format, status, venue, start_date, end_date, logo_url",
    )
    .order("created_at", { ascending: false });

  const rows = (tournaments as TournamentRow[] | null) ?? [];

  // Bulk-fetch teams + matches for ALL tournaments in two queries — used
  // to be N+1 per-tournament count queries. Same data, less round-trips.
  // We also need each match's status so we can derive the *effective*
  // tournament status (a draft tournament with a live match should
  // surface as Live, not Draft — `deriveTournamentStatus` handles that).
  const tournamentIds = rows.map((t) => t.id);
  const [teamRowsRes, matchRowsRes] =
    tournamentIds.length > 0
      ? await Promise.all([
          supabase
            .from("teams")
            .select("id, tournament_id")
            .in("tournament_id", tournamentIds),
          supabase
            .from("matches")
            .select("id, tournament_id, stage, status")
            .in("tournament_id", tournamentIds),
        ])
      : [{ data: [] }, { data: [] }];

  const teamCountById = new Map<string, number>();
  for (const r of teamRowsRes.data ?? []) {
    teamCountById.set(r.tournament_id, (teamCountById.get(r.tournament_id) ?? 0) + 1);
  }
  type MatchSummary = { stage: MatchStage; status: MatchStatus };
  const matchSummariesById = new Map<string, MatchSummary[]>();
  for (const r of matchRowsRes.data ?? []) {
    const list = matchSummariesById.get(r.tournament_id) ?? [];
    list.push({
      stage: r.stage as MatchStage,
      status: r.status as MatchStatus,
    });
    matchSummariesById.set(r.tournament_id, list);
  }

  // Replace each tournament's stored status with the derived one for
  // both sorting and rendering — keeps the rest of the page agnostic.
  const enriched = rows.map((t) => {
    const matchSummaries = matchSummariesById.get(t.id) ?? [];
    return {
      ...t,
      status: deriveTournamentStatus(t.status, matchSummaries, t.format),
      teamCount: teamCountById.get(t.id) ?? 0,
      matchCount: matchSummaries.length,
    };
  });
  const sorted = [...enriched].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Tournaments
            </h1>
            <p className="text-sm text-muted-foreground">
              {sorted.length === 0
                ? "Nothing organised yet."
                : `${sorted.length} tournament${sorted.length === 1 ? "" : "s"} organised in HVC Heroes.`}
            </p>
          </div>
          {ctx?.profile?.is_super_admin && (
            <Link href="/tournaments/new">
              <Button>New tournament</Button>
            </Link>
          )}
        </header>

        {error && (
          <p className="text-sm text-destructive">
            Failed to load tournaments: {error.message}
          </p>
        )}

        {!error && sorted.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                <Trophy className="size-5 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <CardTitle className="text-base">No tournaments yet</CardTitle>
                <CardDescription>
                  {ctx?.profile?.is_super_admin
                    ? "Create the first one to start scoring."
                    : "Check back once an admin sets one up."}
                </CardDescription>
              </div>
              {ctx?.profile?.is_super_admin && (
                <Link href="/tournaments/new">
                  <Button size="sm">New tournament</Button>
                </Link>
              )}
            </CardContent>
          </Card>
        )}

        {sorted.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((t) => (
              <TournamentCard
                key={t.id}
                tournament={t}
                teams={t.teamCount}
                matches={t.matchCount}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function TournamentCard({
  tournament: t,
  teams,
  matches,
}: {
  tournament: TournamentRow;
  teams: number;
  matches: number;
}) {
  return (
    <Link
      href={`/tournaments/${t.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-sm transition hover:border-foreground/25 hover:shadow-md"
    >
      <div className="flex items-start gap-3 p-4">
        {t.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={t.logo_url}
            alt=""
            className="size-12 shrink-0 rounded-lg border border-foreground/10 object-cover"
          />
        ) : (
          <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Trophy className="size-5" />
          </div>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-semibold capitalize">
              {t.name}
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusPill status={t.status} />
            <FormatChip format={t.format} />
          </div>
        </div>
      </div>

      <div className="space-y-1.5 px-4 pb-3 text-sm text-muted-foreground">
        {t.venue && (
          <div className="flex items-center gap-1.5">
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate capitalize">{t.venue}</span>
          </div>
        )}
        {(t.start_date || t.end_date) && (
          <div className="flex items-center gap-1.5">
            <CalendarDays className="size-3.5 shrink-0" />
            <span>{formatDateRange(t.start_date, t.end_date)}</span>
          </div>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-foreground/5 bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Users className="size-3.5" />
            <span className="tabular-nums">{teams}</span>
            <span>{teams === 1 ? "team" : "teams"}</span>
          </span>
          <span className="text-foreground/20">·</span>
          <span>
            <span className="tabular-nums">{matches}</span>{" "}
            {matches === 1 ? "match" : "matches"}
          </span>
        </div>
        <span className="font-medium text-foreground/60 transition group-hover:text-foreground">
          View →
        </span>
      </div>
    </Link>
  );
}

function StatusPill({ status }: { status: TournamentRow["status"] }) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
        STATUS_CLASSES[status]
      }
    >
      {status === "active" && (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
        </span>
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

function FormatChip({ format }: { format: TournamentRow["format"] }) {
  return (
    <span className="inline-flex items-center rounded-full border border-foreground/15 bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {FORMAT_LABEL[format]}
    </span>
  );
}

