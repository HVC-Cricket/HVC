import { CalendarDays, Trophy } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { LiveRefresh } from "@/components/live-refresh";
import { formatScheduledAt, formatUpcomingTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getTeamInitials } from "@/lib/utils";

import { HomeMyProfile } from "./home-my-profile";
import { HomePastTournaments } from "./home-past-tournaments";
import type {
  InningsScore,
  LiveMatchView,
  RecentMatchView,
  TeamView,
  UpcomingMatchView,
  UpcomingTournamentView,
} from "./home-types";
import { LiveMatchCard } from "./live-match-card";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();

  const now = new Date();
  const next24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // Three independent match queries in parallel, each embedding its
  // related tournament + teams + innings via PostgREST nested selects.
  // Was two sequential waves (matches first, then look-ups by ID);
  // collapsing to one wave saves a full round-trip on every visit.
  const matchSelect = `
    id, tournament_id, team_a_id, team_b_id, status, started_at,
    scheduled_at, match_number, overs_per_innings,
    tournament:tournaments(id, slug, name),
    team_a:teams!matches_team_a_id_fkey(id, name, short_name, logo_url),
    team_b:teams!matches_team_b_id_fkey(id, name, short_name, logo_url),
    innings!innings_match_id_fkey(innings_number, batting_team_id, total_runs, total_wickets, total_legal_balls, target)
  `;
  const [liveRes, upcomingRes, recentRes, upcomingTournamentsRes] =
    await Promise.all([
      supabase
        .from("matches")
        .select(matchSelect)
        .in("status", ["live", "innings_break"])
        .order("started_at", { ascending: false }),
      supabase
        .from("matches")
        .select(matchSelect)
        .eq("status", "scheduled")
        .gte("scheduled_at", now.toISOString())
        .lte("scheduled_at", next24h.toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(5),
      supabase
        .from("matches")
        .select(matchSelect)
        .eq("status", "completed")
        .order("started_at", { ascending: false })
        .limit(3),
      // Tournaments the admin has flagged as 'upcoming' — surfaced as a
      // hero strip above Live now (gated on no live match in flight).
      // We pull the metadata only here; team / match counts and the
      // earliest scheduled-match timestamp come from a follow-up query
      // since they require IN-clause joins on the IDs we just selected.
      supabase
        .from("tournaments")
        .select("id, name, slug, logo_url, venue")
        .eq("status", "upcoming")
        .order("start_date", { ascending: true, nullsFirst: false }),
    ]);

  // Shape of an embedded row — PostgREST returns nested objects as
  // single-object (one-to-one) or arrays (one-to-many).
  type EmbeddedMatchRow = {
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

  const toInningsScore = (
    inn: EmbeddedMatchRow["innings"][number],
  ): InningsScore => ({
    innings_number: inn.innings_number,
    batting_team_id: inn.batting_team_id,
    runs: inn.total_runs,
    wickets: inn.total_wickets,
    overs: `${Math.floor(inn.total_legal_balls / 6)}.${inn.total_legal_balls % 6}`,
    target: inn.target,
    legal_balls: inn.total_legal_balls,
  });

  const hasDeps = (m: EmbeddedMatchRow) =>
    m.tournament != null && m.team_a != null && m.team_b != null;

  const liveRows = (liveRes.data as EmbeddedMatchRow[] | null) ?? [];
  const upcomingRows = (upcomingRes.data as EmbeddedMatchRow[] | null) ?? [];
  const recentRows = (recentRes.data as EmbeddedMatchRow[] | null) ?? [];

  const liveMatches: LiveMatchView[] = liveRows.filter(hasDeps).map((m) => {
    const inns = m.innings.map(toInningsScore);
    return {
      id: m.id,
      status: m.status as "live" | "innings_break",
      tournament: { slug: m.tournament!.slug, name: m.tournament!.name },
      matchNumber: m.match_number,
      oversPerInnings: m.overs_per_innings,
      teamA: m.team_a!,
      teamB: m.team_b!,
      innings1: inns.find((i) => i.innings_number === 1) ?? null,
      innings2: inns.find((i) => i.innings_number === 2) ?? null,
    };
  });

  const upcomingMatches: UpcomingMatchView[] = upcomingRows
    .filter(hasDeps)
    .map((m) => ({
      id: m.id,
      tournament: { slug: m.tournament!.slug, name: m.tournament!.name },
      matchNumber: m.match_number,
      scheduledAt: m.scheduled_at!,
      teamA: m.team_a!,
      teamB: m.team_b!,
    }));

  const recentMatches: RecentMatchView[] = recentRows
    .filter(hasDeps)
    .map((m) => {
      const inns = m.innings.map(toInningsScore);
      return {
        id: m.id,
        tournament: { slug: m.tournament!.slug, name: m.tournament!.name },
        matchNumber: m.match_number,
        teamA: m.team_a!,
        teamB: m.team_b!,
        innings1: inns.find((i) => i.innings_number === 1) ?? null,
        innings2: inns.find((i) => i.innings_number === 2) ?? null,
      };
    });

  // Hero data for tournaments admins have flagged as 'upcoming'.
  // Second wave so the team / match counts can use the IN-clause on
  // tournament IDs we just learned about. Hero hides automatically
  // the moment any live match exists — the Live section takes over.
  const upcomingTournamentRows =
    (upcomingTournamentsRes.data as
      | Array<{
          id: string;
          name: string;
          slug: string;
          logo_url: string | null;
          venue: string | null;
        }>
      | null) ?? [];
  const upcomingTournaments: UpcomingTournamentView[] = [];
  if (upcomingTournamentRows.length > 0 && liveMatches.length === 0) {
    const ids = upcomingTournamentRows.map((t) => t.id);
    const [teamRowsRes, matchRowsRes] = await Promise.all([
      supabase.from("teams").select("tournament_id").in("tournament_id", ids),
      supabase
        .from("matches")
        .select("tournament_id, scheduled_at")
        .in("tournament_id", ids),
    ]);
    const teamCount = new Map<string, number>();
    for (const r of teamRowsRes.data ?? []) {
      teamCount.set(r.tournament_id, (teamCount.get(r.tournament_id) ?? 0) + 1);
    }
    const matchAgg = new Map<string, { count: number; firstAt: string | null }>();
    for (const r of matchRowsRes.data ?? []) {
      const cur = matchAgg.get(r.tournament_id) ?? { count: 0, firstAt: null };
      cur.count += 1;
      if (r.scheduled_at && (cur.firstAt === null || r.scheduled_at < cur.firstAt)) {
        cur.firstAt = r.scheduled_at;
      }
      matchAgg.set(r.tournament_id, cur);
    }
    for (const t of upcomingTournamentRows) {
      const agg = matchAgg.get(t.id);
      upcomingTournaments.push({
        id: t.id,
        name: t.name,
        slug: t.slug,
        logoUrl: t.logo_url,
        venue: t.venue,
        teamCount: teamCount.get(t.id) ?? 0,
        matchCount: agg?.count ?? 0,
        firstScheduledAt: agg?.firstAt ?? null,
      });
    }
  }

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-8">
        {liveMatches.length > 0 && <LiveRefresh />}

        {upcomingTournaments.length > 0 && (
          <section className="space-y-3">
            {upcomingTournaments.map((t) => (
              <UpcomingTournamentCard key={t.id} tournament={t} />
            ))}
          </section>
        )}

        {liveMatches.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
              </span>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                Live now
              </h2>
              <span className="text-xs text-muted-foreground">
                · {liveMatches.length}{" "}
                {liveMatches.length === 1 ? "match" : "matches"} in flight
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {liveMatches.map((m) => (
                <LiveMatchCard key={m.id} match={m} />
              ))}
            </div>
          </section>
        )}

        {/* Signed-in viewers who play see their own snapshot here. */}
        <Suspense fallback={null}>
          <HomeMyProfile />
        </Suspense>

        {upcomingMatches.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                Up next
              </h2>
              <span className="text-xs text-muted-foreground">
                · within 24 hours
              </span>
            </div>
            <div className="space-y-2">
              {upcomingMatches.map((m) => (
                <UpcomingMatchRow key={m.id} match={m} />
              ))}
            </div>
          </section>
        )}

        {recentMatches.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Trophy className="size-4 text-primary" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground">
                Recent results
              </h2>
            </div>
            <div className="space-y-2">
              {recentMatches.map((m) => (
                <RecentMatchRow key={m.id} match={m} />
              ))}
            </div>
          </section>
        )}

        {/* Always-visible archive of completed tournaments — keeps the
            page useful between live matches. */}
        <Suspense fallback={null}>
          <HomePastTournaments />
        </Suspense>

        <footer className="border-t border-foreground/10 pt-6 text-center text-xs text-muted-foreground">
          <p>HVC Heroes · Box-cricket scoring app</p>
        </footer>
      </div>
    </main>
  );
}


function UpcomingTournamentCard({
  tournament: t,
}: {
  tournament: UpcomingTournamentView;
}) {
  return (
    <Link
      href={`/tournaments/${t.slug}`}
      className="group relative block overflow-hidden rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-violet-500/5 to-transparent p-4 transition hover:border-violet-500/50 sm:p-5"
    >
      <div className="flex items-center gap-2">
        <CalendarDays className="size-4 text-violet-600 dark:text-violet-400" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
          Upcoming
        </span>
      </div>
      <div className="mt-2 flex items-start gap-3">
        {t.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={t.logoUrl}
            alt=""
            className="size-12 shrink-0 rounded-lg border border-foreground/10 object-cover"
          />
        ) : (
          <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-300">
            <Trophy className="size-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold capitalize">{t.name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            <span className="tabular-nums">{t.teamCount}</span>{" "}
            {t.teamCount === 1 ? "team" : "teams"}
            <span className="mx-1.5 text-foreground/20">·</span>
            <span className="tabular-nums">{t.matchCount}</span>{" "}
            {t.matchCount === 1 ? "match" : "matches"}
          </p>
          {t.firstScheduledAt && (
            <p className="mt-1.5 text-sm font-medium">
              Starts {formatScheduledAt(t.firstScheduledAt)}
            </p>
          )}
          {t.venue && (
            <p className="text-[11px] text-muted-foreground capitalize">
              {t.venue}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}

function UpcomingMatchRow({ match }: { match: UpcomingMatchView }) {
  return (
    <Link
      href={`/matches/${match.id}`}
      className="group flex items-center gap-3 rounded-lg border border-foreground/10 bg-background px-3 py-2.5 transition hover:border-primary/30 hover:bg-primary/5"
    >
      <TeamBadge team={match.teamA} />
      <span className="text-xs font-medium text-muted-foreground">vs</span>
      <TeamBadge team={match.teamB} />
      <div className="ml-auto text-right text-[11px] text-muted-foreground">
        <div className="font-medium text-foreground">
          {formatUpcomingTime(match.scheduledAt)}
        </div>
        <div className="capitalize">{match.tournament.name}</div>
      </div>
    </Link>
  );
}

function RecentMatchRow({ match }: { match: RecentMatchView }) {
  const aScore = match.innings1?.batting_team_id === match.teamA.id
    ? match.innings1
    : match.innings2?.batting_team_id === match.teamA.id
      ? match.innings2
      : null;
  const bScore = match.innings1?.batting_team_id === match.teamB.id
    ? match.innings1
    : match.innings2?.batting_team_id === match.teamB.id
      ? match.innings2
      : null;
  const aRuns = aScore?.runs ?? 0;
  const bRuns = bScore?.runs ?? 0;
  const winnerId =
    aRuns > bRuns ? match.teamA.id : bRuns > aRuns ? match.teamB.id : null;

  return (
    <Link
      href={`/matches/${match.id}`}
      className="group flex items-center gap-3 rounded-lg border border-foreground/10 bg-background px-3 py-2.5 transition hover:border-primary/30 hover:bg-primary/5"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <ResultLine team={match.teamA} score={aScore} won={winnerId === match.teamA.id} />
        <ResultLine team={match.teamB} score={bScore} won={winnerId === match.teamB.id} />
      </div>
      <div className="shrink-0 text-right text-[10px] uppercase tracking-wide text-muted-foreground">
        <span className="capitalize">{match.tournament.name}</span>
        <span> · #{match.matchNumber}</span>
      </div>
    </Link>
  );
}

function ResultLine({
  team,
  score,
  won,
}: {
  team: TeamView;
  score: InningsScore | null;
  won: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {team.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={team.logo_url}
          alt=""
          className="size-5 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[8px] font-semibold text-primary">
          {getTeamInitials(team.short_name)}
        </span>
      )}
      <span
        className={
          "font-mono text-xs font-semibold uppercase " +
          (won ? "text-foreground" : "text-muted-foreground")
        }
      >
        {team.short_name}
      </span>
      {won && (
        <Trophy className="size-3 text-amber-500" aria-label="Winner" />
      )}
      <span className="ml-auto font-mono tabular-nums">
        {score ? `${score.runs}/${score.wickets}` : "—"}
        {score && (
          <span className="ml-1 text-[10px] text-muted-foreground">
            ({score.overs})
          </span>
        )}
      </span>
    </div>
  );
}

function TeamBadge({ team }: { team: TeamView }) {
  return (
    <span className="flex items-center gap-1.5">
      {team.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={team.logo_url}
          alt=""
          className="size-6 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary">
          {getTeamInitials(team.short_name)}
        </span>
      )}
      <span className="font-mono text-xs font-semibold uppercase">
        {team.short_name}
      </span>
    </span>
  );
}

