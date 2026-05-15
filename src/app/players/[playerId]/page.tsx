import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSessionContext, isOrganizerOrSuperAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type StatRow = {
  tournament_id: string;
  player_id: string;
  display_name: string;
  runs: number;
  balls_faced: number;
  fours: number;
  sixes: number;
  wickets: number;
  runs_conceded: number;
  legal_balls_bowled: number;
};

export default async function PlayerDetailPage(props: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await props.params;
  const supabase = await createClient();
  const ctx = await getSessionContext();
  const canManagePlayers = ctx ? await isOrganizerOrSuperAdmin(ctx) : false;

  const { data: player } = await supabase
    .from("players")
    .select(
      "id, display_name, category, batting_style, bowling_style, phone, linked_user_id, photo_url",
    )
    .eq("id", playerId)
    .single();
  if (!player) notFound();

  let linkedEmail: string | null = null;
  let linkedAvatarUrl: string | null = null;
  if (player.linked_user_id) {
    // Fetch the linked profile's avatar — falls back into the hero
    // photo slot when the player itself has no photo_url set.
    const { data: linkedProfile } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", player.linked_user_id)
      .maybeSingle();
    linkedAvatarUrl = linkedProfile?.avatar_url ?? null;

    if (ctx) {
      const { data } = await supabase.rpc("lookup_email_by_user_id", {
        p_user_id: player.linked_user_id,
      });
      linkedEmail = data ?? null;
    }
  }

  const heroPhoto = player.photo_url ?? linkedAvatarUrl;

  // Three parallel reads: stats view, match_players (for matches
  // count), and two balls queries split by which crease the player
  // was at. We split because Supabase's .or() filter combined with
  // a nested foreign-key select wasn't reliably returning rows —
  // two simple .eq()s is cheaper to reason about than a compound or.
  const [
    { data: rows },
    { data: matchRows },
    { data: ballsAsBatter },
    { data: ballsAsNonStriker },
  ] = await Promise.all([
    supabase
      .from("v_player_tournament_stats" as never)
      .select("*")
      .eq("player_id", playerId),
    // match_players is unique on (match_id, player_id) so a Set of
    // match_ids gives the correct distinct count.
    supabase
      .from("match_players")
      .select("match_id, matches!inner(tournament_id)")
      .eq("player_id", playerId),
    // Innings the player batted as striker (faced a ball).
    supabase
      .from("balls")
      .select("innings_id")
      .eq("batter_id", playerId)
      .eq("is_voided", false),
    // Innings the player was at the crease as non-striker without
    // necessarily facing a ball (run-out at non-striker, etc.).
    supabase
      .from("balls")
      .select("innings_id")
      .eq("non_striker_id", playerId)
      .eq("is_voided", false),
  ]);
  const stats = (rows as unknown as StatRow[] | null) ?? [];

  // Career total + per-tournament breakdown of matches played.
  // Also build a match_id → tournament_id index that the innings
  // breakdown below reuses (saves a separate fetch).
  const playedMatchIds = new Set<string>();
  const matchesByTournament = new Map<string, Set<string>>();
  const tournamentByMatch = new Map<string, string>();
  type MatchRow = { match_id: string; matches: { tournament_id: string } };
  for (const r of (matchRows ?? []) as unknown as MatchRow[]) {
    playedMatchIds.add(r.match_id);
    const tid = r.matches.tournament_id;
    if (!tid) continue;
    tournamentByMatch.set(r.match_id, tid);
    let s = matchesByTournament.get(tid);
    if (!s) {
      s = new Set();
      matchesByTournament.set(tid, s);
    }
    s.add(r.match_id);
  }
  const matchesPlayed = playedMatchIds.size;

  // Distinct innings_ids the player was at the crease for.
  const battedInningsIds = new Set<string>();
  for (const r of ballsAsBatter ?? []) battedInningsIds.add(r.innings_id);
  for (const r of ballsAsNonStriker ?? [])
    battedInningsIds.add(r.innings_id);

  // Map those innings → tournaments via match_id. We fetch the
  // innings row's match_id flat (no embedded join — that was returning
  // an unexpected shape), then look up the tournament in the index
  // already built above.
  const inningsByTournament = new Map<string, Set<string>>();
  if (battedInningsIds.size > 0) {
    const { data: inningsRows } = await supabase
      .from("innings")
      .select("id, match_id")
      .in("id", [...battedInningsIds]);
    for (const r of inningsRows ?? []) {
      const tid = tournamentByMatch.get(r.match_id);
      if (!tid) continue;
      let s = inningsByTournament.get(tid);
      if (!s) {
        s = new Set();
        inningsByTournament.set(tid, s);
      }
      s.add(r.id);
    }
  }
  const inningsBatted = battedInningsIds.size;

  const tournamentIds = Array.from(new Set(stats.map((s) => s.tournament_id)));
  const { data: tournaments } = tournamentIds.length
    ? await supabase
        .from("tournaments")
        .select("id, slug, name")
        .in("id", tournamentIds)
    : { data: [] as { id: string; slug: string; name: string }[] };
  const tournamentById = new Map(
    (tournaments ?? []).map((t) => [t.id, t]),
  );

  // Career totals across all tournaments where the player has any record.
  const career = stats.reduce(
    (acc, r) => ({
      runs: acc.runs + (r.runs ?? 0),
      balls_faced: acc.balls_faced + (r.balls_faced ?? 0),
      fours: acc.fours + (r.fours ?? 0),
      sixes: acc.sixes + (r.sixes ?? 0),
      wickets: acc.wickets + (r.wickets ?? 0),
      runs_conceded: acc.runs_conceded + (r.runs_conceded ?? 0),
      legal_balls_bowled: acc.legal_balls_bowled + (r.legal_balls_bowled ?? 0),
    }),
    {
      runs: 0,
      balls_faced: 0,
      fours: 0,
      sixes: 0,
      wickets: 0,
      runs_conceded: 0,
      legal_balls_bowled: 0,
    },
  );

  const careerSR =
    career.balls_faced > 0
      ? ((career.runs / career.balls_faced) * 100).toFixed(1)
      : "—";
  const careerEcon =
    career.legal_balls_bowled > 0
      ? ((career.runs_conceded / career.legal_balls_bowled) * 6).toFixed(2)
      : "—";

  // Filter the per-tournament rows down to those with any actual numbers.
  const playedRows = stats.filter(
    (r) =>
      r.runs > 0 ||
      r.balls_faced > 0 ||
      r.wickets > 0 ||
      r.legal_balls_bowled > 0,
  );

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            {heroPhoto ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={heroPhoto}
                alt=""
                className="h-16 w-16 rounded-full border border-foreground/10 object-cover"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                —
              </div>
            )}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                <Link href="/players" className="hover:underline">
                  ← Players
                </Link>
              </p>
              <h1 className="flex items-center gap-3 text-2xl font-semibold">
                {player.display_name}
                {player.category && (
                  <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-xs font-mono">
                    C{player.category}
                  </span>
                )}
              </h1>
              <p className="text-sm text-muted-foreground">
                {[player.batting_style, player.bowling_style]
                  .filter(Boolean)
                  .map((s) => s!.replace(/_/g, " "))
                  .join(" · ") || "—"}
              </p>
              {linkedEmail && (
                <p className="text-xs text-muted-foreground">
                  Linked to{" "}
                  <span className="font-mono">{linkedEmail}</span>
                </p>
              )}
            </div>
          </div>
          {canManagePlayers && (
            <Link href={`/players/${player.id}/edit`}>
              <Button variant="ghost" size="sm">
                Edit
              </Button>
            </Link>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Career</CardTitle>
            <CardDescription>
              Aggregated across every HVC Scoring tournament.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Matches" value={matchesPlayed} />
            <Stat label="Innings" value={inningsBatted} />
            <Stat label="Runs" value={career.runs} />
            <Stat label="4s" value={career.fours} />
            <Stat label="6s" value={career.sixes} />
            <Stat label="SR" value={careerSR} />
            <Stat label="Wickets" value={career.wickets} />
            <Stat
              label="Overs bowled"
              value={`${Math.floor(career.legal_balls_bowled / 6)}.${career.legal_balls_bowled % 6}`}
            />
            <Stat label="Econ" value={careerEcon} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By tournament</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {playedRows.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">
                No matches played yet.
              </p>
            ) : (
              // Horizontal scroll on mobile so the bowling columns
              // (W / Ov / Econ) remain reachable; tournament name
              // stays pinned to the left via sticky positioning so the
              // user always knows which row they're looking at.
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr className="border-y border-foreground/10">
                      <th className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-medium">
                        Tournament
                      </th>
                      <th className="px-2 py-2 text-right font-medium">M</th>
                      <th className="px-2 py-2 text-right font-medium">I</th>
                      <th className="px-2 py-2 text-right font-medium">R</th>
                      <th className="px-2 py-2 text-right font-medium">4s</th>
                      <th className="px-2 py-2 text-right font-medium">6s</th>
                      <th className="px-2 py-2 text-right font-medium">SR</th>
                      <th className="px-2 py-2 text-right font-medium">W</th>
                      <th className="px-2 py-2 text-right font-medium">Ov</th>
                      <th className="px-4 py-2 text-right font-medium">
                        Econ
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {playedRows.map((r) => {
                      const t = tournamentById.get(r.tournament_id);
                      const sr =
                        r.balls_faced > 0
                          ? ((r.runs / r.balls_faced) * 100).toFixed(1)
                          : "—";
                      const overs = `${Math.floor(r.legal_balls_bowled / 6)}.${r.legal_balls_bowled % 6}`;
                      const econ =
                        r.legal_balls_bowled > 0
                          ? ((r.runs_conceded / r.legal_balls_bowled) * 6).toFixed(2)
                          : "—";
                      return (
                        <tr
                          key={r.tournament_id}
                          className="border-b border-foreground/5 last:border-b-0"
                        >
                          <th
                            scope="row"
                            className="sticky left-0 z-10 bg-card px-4 py-2 text-left font-normal"
                          >
                            {t ? (
                              <Link
                                href={`/tournaments/${t.slug}`}
                                className="capitalize hover:underline"
                              >
                                {t.name}
                              </Link>
                            ) : (
                              "(unknown)"
                            )}
                          </th>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">
                            {matchesByTournament.get(r.tournament_id)?.size ?? 0}
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">
                            {inningsByTournament.get(r.tournament_id)?.size ?? 0}
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">
                            {r.runs}
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">
                            {r.fours}
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">
                            {r.sixes}
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">
                            {sr}
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">
                            {r.wickets}
                          </td>
                          <td className="px-2 py-2 text-right font-mono tabular-nums">
                            {r.legal_balls_bowled > 0 ? overs : "—"}
                          </td>
                          <td className="px-4 py-2 text-right font-mono tabular-nums">
                            {econ}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-foreground/10 bg-muted/30 px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-mono text-base">{value}</div>
    </div>
  );
}
