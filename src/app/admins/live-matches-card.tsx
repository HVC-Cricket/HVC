import { Radio } from "lucide-react";
import Link from "next/link";

import { LiveMatchCard } from "@/app/live-match-card";
import type {
  InningsScore,
  LiveMatchView,
  TeamView,
} from "@/app/home-types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatScheduledAt } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

const MATCH_SELECT = `
  id, tournament_id, team_a_id, team_b_id, status, started_at, scheduled_at, match_number, overs_per_innings,
  tournament:tournaments(id, slug, name),
  team_a:teams!matches_team_a_id_fkey(id, name, short_name, logo_url),
  team_b:teams!matches_team_b_id_fkey(id, name, short_name, logo_url),
  innings!innings_match_id_fkey(innings_number, batting_team_id, total_runs, total_wickets, total_legal_balls, target)
`;

type EmbeddedRow = {
  id: string;
  tournament_id: string;
  team_a_id: string;
  team_b_id: string;
  status: string;
  started_at: string | null;
  scheduled_at: string | null;
  match_number: number;
  overs_per_innings: number;
  tournament: { id: string; slug: string; name: string } | null;
  team_a: TeamView | null;
  team_b: TeamView | null;
  innings: Array<{
    innings_number: number;
    batting_team_id: string;
    total_runs: number;
    total_wickets: number;
    total_legal_balls: number;
    target: number | null;
  }>;
};

/**
 * Live + upcoming matches surfaced on /admins so a super-admin can
 * jump straight to active scoring without bouncing through the
 * tournament list. Live cards use the same `<LiveMatchCard />` the
 * homepage renders so the visuals stay in sync; upcoming matches use
 * a compact list (no scores yet, just team + time).
 *
 * Service-role read because we want every tournament regardless of
 * org-membership — admins see the whole world.
 */
export async function LiveMatchesCard() {
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const [liveRes, upcomingRes] = await Promise.all([
    supabase
      .from("matches")
      .select(MATCH_SELECT)
      .in("status", ["live", "innings_break"])
      .order("started_at", { ascending: false }),
    supabase
      .from("matches")
      .select(MATCH_SELECT)
      .eq("status", "scheduled")
      .gte("scheduled_at", now)
      .order("scheduled_at", { ascending: true })
      .limit(5),
  ]);

  const liveRows = (liveRes.data as unknown as EmbeddedRow[] | null) ?? [];
  const upcomingRows =
    (upcomingRes.data as unknown as EmbeddedRow[] | null) ?? [];

  const toInningsScore = (
    inn: EmbeddedRow["innings"][number],
  ): InningsScore => ({
    innings_number: inn.innings_number,
    batting_team_id: inn.batting_team_id,
    runs: inn.total_runs,
    wickets: inn.total_wickets,
    overs: `${Math.floor(inn.total_legal_balls / 6)}.${inn.total_legal_balls % 6}`,
    target: inn.target,
    legal_balls: inn.total_legal_balls,
  });

  const hasDeps = (m: EmbeddedRow) =>
    m.tournament != null && m.team_a != null && m.team_b != null;

  const liveMatches: LiveMatchView[] = liveRows.filter(hasDeps).map((m) => {
    const inns = m.innings.map(toInningsScore);
    return {
      id: m.id,
      status: m.status as "live" | "innings_break",
      tournament: { slug: m.tournament!.slug, name: m.tournament!.name },
      teamA: m.team_a!,
      teamB: m.team_b!,
      matchNumber: m.match_number,
      oversPerInnings: m.overs_per_innings,
      innings1: inns.find((i) => i.innings_number === 1) ?? null,
      innings2: inns.find((i) => i.innings_number === 2) ?? null,
    };
  });

  const upcoming = upcomingRows.filter(hasDeps);

  if (liveMatches.length === 0 && upcoming.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="size-4 text-muted-foreground" />
            Match feed
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 text-sm text-muted-foreground">
          No live or upcoming matches right now.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Radio className="size-4 text-muted-foreground" />
          Match feed
          <span className="ml-auto text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
            {liveMatches.length} live · {upcoming.length} upcoming
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {liveMatches.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {liveMatches.map((m) => (
              <LiveMatchCard key={m.id} match={m} />
            ))}
          </div>
        )}
        {upcoming.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Next up
            </div>
            <ul className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
              {upcoming.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/matches/${m.id}`}
                    prefetch
                    className="group flex items-center gap-3 px-3 py-2.5 text-sm transition hover:bg-muted/30"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium capitalize">
                        {m.team_a!.short_name} vs {m.team_b!.short_name}
                      </div>
                      <div className="truncate text-[11px] capitalize text-muted-foreground">
                        {m.tournament!.name} · Match {m.match_number}
                      </div>
                    </div>
                    <div className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                      {m.scheduled_at
                        ? formatScheduledAt(m.scheduled_at)
                        : "TBD"}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
