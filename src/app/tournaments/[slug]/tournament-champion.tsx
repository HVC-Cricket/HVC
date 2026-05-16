import { Trophy } from "lucide-react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

type Team = {
  id: string;
  name: string;
  short_name: string;
  logo_url: string | null;
};

/**
 * Hero block at the top of /tournaments/[slug] for completed
 * tournaments — surfaces the three things spectators actually care
 * about:
 *
 *   1. Champion + final scoreline + win margin
 *   2. Runner-up
 *   3. Player of the Tournament — most match-POM awards in this
 *      tournament; ties broken by total runs (from both balls and
 *      historical_match_batting so the figure works for old
 *      cricheroes-imported seasons too).
 *
 * Returns null if the tournament has no completed final, so it stays
 * invisible for in-progress tournaments.
 */
export async function TournamentChampion({
  tournamentId,
}: {
  tournamentId: string;
}) {
  const supabase = await createClient();

  // 1. Find the final match (must be completed + have a winner).
  const { data: finalMatch } = await supabase
    .from("matches")
    .select(
      "id, team_a_id, team_b_id, winner_id, win_margin, result_type, status",
    )
    .eq("tournament_id", tournamentId)
    .eq("stage", "final")
    .eq("status", "completed")
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!finalMatch || !finalMatch.winner_id) return null;

  // 2. Champion + runner-up teams + their innings.
  const [teamsRes, inningsRes, pomRes] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, short_name, logo_url")
      .in("id", [finalMatch.team_a_id, finalMatch.team_b_id]),
    supabase
      .from("innings")
      .select(
        "innings_number, batting_team_id, total_runs, total_wickets, total_legal_balls",
      )
      .eq("match_id", finalMatch.id)
      .order("innings_number", { ascending: true }),
    supabase
      .from("matches")
      .select("player_of_match_id")
      .eq("tournament_id", tournamentId)
      .not("player_of_match_id", "is", null),
  ]);

  const teamById = new Map<string, Team>(
    (teamsRes.data ?? []).map((t) => [t.id, t]),
  );
  const champion = teamById.get(finalMatch.winner_id);
  if (!champion) return null;
  const runnerUpId =
    finalMatch.team_a_id === finalMatch.winner_id
      ? finalMatch.team_b_id
      : finalMatch.team_a_id;
  const runnerUp = teamById.get(runnerUpId);

  // 3. Per-team final scoreline (formatted "52/2 (6.1)").
  const lineByTeam = new Map<string, string>();
  for (const i of inningsRes.data ?? []) {
    const overs = `${Math.floor(i.total_legal_balls / 6)}.${i.total_legal_balls % 6}`;
    lineByTeam.set(
      i.batting_team_id,
      `${i.total_runs}/${i.total_wickets} (${overs})`,
    );
  }

  // 4. POTM: count POM awards per player + tie-break by total runs.
  const pomCount = new Map<string, number>();
  for (const r of pomRes.data ?? []) {
    if (!r.player_of_match_id) continue;
    pomCount.set(
      r.player_of_match_id,
      (pomCount.get(r.player_of_match_id) ?? 0) + 1,
    );
  }
  const potm = pomCount.size > 0
    ? await pickPotm(supabase, tournamentId, pomCount)
    : null;

  return (
    <Card className="border-amber-200/40 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent dark:border-amber-400/20 dark:from-amber-400/15 dark:via-amber-400/5">
      <CardContent className="space-y-4 py-4">
        <div className="flex items-center gap-4">
          {champion.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={champion.logo_url}
              alt=""
              className="size-16 shrink-0 rounded-xl border border-amber-200/40 bg-background object-cover dark:border-amber-400/20"
            />
          ) : (
            <div className="flex size-16 shrink-0 items-center justify-center rounded-xl border border-amber-200/40 bg-background text-amber-700 dark:border-amber-400/20 dark:text-amber-300">
              <Trophy className="size-8" />
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">
              Champions
            </div>
            <div className="truncate text-xl font-semibold capitalize sm:text-2xl">
              {champion.name}
            </div>
            <div className="text-xs text-muted-foreground">
              <span className="capitalize">
                won by {finalMatch.win_margin ?? "—"}
              </span>
              {runnerUp && (
                <span className="ml-1.5 capitalize">
                  vs {runnerUp.name}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-lg border border-foreground/10 bg-background/60 p-2 text-xs">
          <div className="space-y-0.5">
            <div className="truncate font-medium capitalize">
              {champion.name}
            </div>
            <div className="font-mono tabular-nums text-muted-foreground">
              {lineByTeam.get(champion.id) ?? "—"}
            </div>
          </div>
          {runnerUp && (
            <div className="space-y-0.5">
              <div className="truncate font-medium capitalize">
                {runnerUp.name}
              </div>
              <div className="font-mono tabular-nums text-muted-foreground">
                {lineByTeam.get(runnerUp.id) ?? "—"}
              </div>
            </div>
          )}
        </div>

        {potm && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-foreground/10 bg-background/60 px-3 py-2">
            <div className="min-w-0 space-y-0.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Player of the Tournament
              </div>
              <Link
                href={`/players/${potm.id}`}
                className="block truncate text-sm font-medium capitalize hover:underline"
              >
                {potm.display_name}
              </Link>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-mono text-base font-semibold tabular-nums">
                {potm.pomCount}
              </div>
              <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
                POM {potm.pomCount === 1 ? "award" : "awards"}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Resolve the Player of the Tournament:
 * primary sort = most POM awards;
 * tie-break = total runs (balls + historical_match_batting combined).
 */
async function pickPotm(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tournamentId: string,
  pomCount: Map<string, number>,
): Promise<{ id: string; display_name: string; pomCount: number } | null> {
  // Top POM count(s).
  const maxCount = Math.max(...pomCount.values());
  const topPlayers = [...pomCount.entries()]
    .filter(([, c]) => c === maxCount)
    .map(([id]) => id);

  let winnerId: string;
  if (topPlayers.length === 1) {
    winnerId = topPlayers[0];
  } else {
    // Tie-break: total runs across the tournament (both eras).
    const runsByPlayer = new Map<string, number>();

    // Historical batting rows for matches in this tournament.
    const { data: histRows } = await supabase
      .from("historical_match_batting")
      .select("player_id, runs, match_id, matches!inner(tournament_id)")
      .eq("matches.tournament_id", tournamentId)
      .in("player_id", topPlayers);
    for (const r of (histRows ?? []) as { player_id: string | null; runs: number }[]) {
      if (!r.player_id) continue;
      runsByPlayer.set(
        r.player_id,
        (runsByPlayer.get(r.player_id) ?? 0) + (r.runs ?? 0),
      );
    }

    // Balls-derived runs for matches in this tournament.
    const { data: ballRows } = await supabase
      .from("balls")
      .select(
        "batter_id, runs_off_bat, innings!inner(matches!inner(tournament_id))",
      )
      .eq("innings.matches.tournament_id", tournamentId)
      .eq("is_voided", false)
      .in("batter_id", topPlayers);
    for (const r of (ballRows ?? []) as {
      batter_id: string;
      runs_off_bat: number;
    }[]) {
      runsByPlayer.set(
        r.batter_id,
        (runsByPlayer.get(r.batter_id) ?? 0) + (r.runs_off_bat ?? 0),
      );
    }

    topPlayers.sort(
      (a, b) => (runsByPlayer.get(b) ?? 0) - (runsByPlayer.get(a) ?? 0),
    );
    winnerId = topPlayers[0];
  }

  const { data: player } = await supabase
    .from("players")
    .select("id, display_name")
    .eq("id", winnerId)
    .single();
  if (!player) return null;
  return { id: player.id, display_name: player.display_name, pomCount: maxCount };
}
