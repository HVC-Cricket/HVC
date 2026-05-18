import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireTournamentAdmin } from "@/lib/auth";
import { matchHasRecordedBalls } from "@/lib/match-balls";
import { createClient } from "@/lib/supabase/server";

import { PickXITabs } from "./pick-xi-tabs";

/**
 * Combined Pick XI flow: both teams in one page, switchable via tabs.
 * Replaces the four-nav-event-per-match flow (back to score → tap Team
 * A → save → back → tap Team B → save → back) with a single screen
 * where each tab carries its own progress badge.
 *
 * The per-team route (`./[teamId]/page.tsx`) still exists and routes
 * the same scorer-or-organizer to a single-team picker — useful when
 * editing one side post-setup.
 */
export default async function PickXICombinedPage(props: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await props.params;
  const supabase = await createClient();

  const { data: match } = await supabase
    .from("matches")
    .select("id, tournament_id, players_per_side, team_a_id, team_b_id")
    .eq("id", matchId)
    .single();
  if (!match) notFound();

  await requireTournamentAdmin(match.tournament_id);

  // Teams, both rosters, and the existing XIs all run in parallel —
  // one wave instead of three sequential look-ups.
  const [teamsRes, rostersRes, existingRes] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, short_name")
      .in("id", [match.team_a_id, match.team_b_id]),
    supabase
      .from("team_players")
      .select("team_id, player_id, role, created_at")
      .in("team_id", [match.team_a_id, match.team_b_id])
      .order("created_at", { ascending: true }),
    supabase
      .from("match_players")
      .select("team_id, player_id, batting_order, is_captain, is_keeper, is_substitute")
      .eq("match_id", match.id),
  ]);

  const teams = teamsRes.data ?? [];
  const teamA = teams.find((t) => t.id === match.team_a_id);
  const teamB = teams.find((t) => t.id === match.team_b_id);
  if (!teamA || !teamB) notFound();

  const allPlayerIds = Array.from(
    new Set((rostersRes.data ?? []).map((r) => r.player_id)),
  );
  const { data: players } = allPlayerIds.length
    ? await supabase
        .from("players")
        .select("id, display_name, category")
        .in("id", allPlayerIds)
    : {
        data: [] as {
          id: string;
          display_name: string;
          category: number | null;
        }[],
      };
  const playerById = new Map((players ?? []).map((p) => [p.id, p]));

  const buildRows = (teamId: string) => {
    const roster = (rostersRes.data ?? []).filter((r) => r.team_id === teamId);
    const existing = new Map(
      (existingRes.data ?? [])
        .filter((m) => m.team_id === teamId)
        .map((m) => [m.player_id, m]),
    );
    return roster.map((r) => {
      const p = playerById.get(r.player_id);
      const ex = existing.get(r.player_id);
      return {
        player_id: r.player_id,
        display_name: p?.display_name ?? "(unknown)",
        category: (p?.category as 1 | 2 | 3 | null) ?? null,
        roster_role: r.role,
        included: !!ex,
        batting_order: ex?.batting_order ?? null,
        is_captain: !!ex?.is_captain,
        is_keeper: !!ex?.is_keeper,
        is_substitute: !!ex?.is_substitute,
      };
    });
  };

  const rowsA = buildRows(teamA.id);
  const rowsB = buildRows(teamB.id);

  const hasAnyRoster = rowsA.length > 0 || rowsB.length > 0;
  const xiLocked = await matchHasRecordedBalls(supabase, match.id);

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            <Link href={`/matches/${match.id}`} className="hover:underline">
              ← Match
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">Pick playing XIs</h1>
          <p className="text-sm text-muted-foreground">
            Tick {match.players_per_side} players for each team. Switch
            between teams via the tabs above. Captain comes from the team
            squad; the wicket-keeper rotates per delivery on the scoreboard;
            batting order is set live as each batter walks in.
          </p>
        </div>

        {xiLocked && (
          <Card className="border-foreground/15 bg-muted/30">
            <CardHeader>
              <CardTitle className="text-base">XI locked</CardTitle>
              <CardDescription>
                Scoring has started — the playing XI can&apos;t change
                while balls are on the books. Undo every ball back to
                the start of the match to re-open the form.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {!hasAnyRoster ? (
          <Card>
            <CardHeader>
              <CardTitle>No squads</CardTitle>
              <CardDescription>
                Add players to both team squads first. Open the team page
                from the tournament to manage the roster.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4">
              <PickXITabs
                matchId={match.id}
                playersPerSide={match.players_per_side}
                teamA={{
                  teamId: teamA.id,
                  name: teamA.name,
                  shortName: teamA.short_name,
                  rows: rowsA,
                }}
                teamB={{
                  teamId: teamB.id,
                  name: teamB.name,
                  shortName: teamB.short_name,
                  rows: rowsB,
                }}
                locked={xiLocked}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}
