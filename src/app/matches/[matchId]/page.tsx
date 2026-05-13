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
import { getSessionContext, isTournamentOrganizer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { CommentaryFeed } from "./commentary-feed";
import { FullScorecard } from "./full-scorecard";
import { LiveScorePanel } from "./live-score-panel";
import { MatchCharts } from "./match-charts";
import { NotifyButton } from "./notify/notify-button";
import { MatchAwards } from "./player-of-match/match-awards";
import { TossForm } from "./toss-form";
import { XISection } from "./xi-section";

export const dynamic = "force-dynamic";

export default async function MatchDetailPage(props: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await props.params;
  const supabase = await createClient();
  const ctx = await getSessionContext();

  const { data: match } = await supabase
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .single();
  if (!match) notFound();

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("id, slug, name")
    .eq("id", match.tournament_id)
    .single();
  if (!tournament) notFound();

  const { data: teamRows } = await supabase
    .from("teams")
    .select("id, name, short_name")
    .in("id", [match.team_a_id, match.team_b_id]);
  const teamA = teamRows?.find((t) => t.id === match.team_a_id);
  const teamB = teamRows?.find((t) => t.id === match.team_b_id);

  const canManage = ctx
    ? await isTournamentOrganizer(tournament.id, ctx)
    : false;

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              <Link
                href={`/tournaments/${tournament.slug}`}
                className="hover:underline"
              >
                {tournament.name}
              </Link>
              <span> · Match {match.match_number}</span>
              <span className="capitalize"> · {match.stage.replace(/_/g, " ")}</span>
            </p>
            <h1 className="text-2xl font-semibold">
              {teamA?.name ?? "?"} vs {teamB?.name ?? "?"}
            </h1>
            <p className="text-sm text-muted-foreground capitalize">
              {match.status.replace(/_/g, " ")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {(match.status === "live" || match.status === "innings_break") && (
              <NotifyButton matchId={match.id} />
            )}
            {canManage && (
              <>
                <Link href={`/matches/${match.id}/score`}>
                  <Button size="sm">
                    {match.status === "scheduled" ? "Start scoring" : "Score"}
                  </Button>
                </Link>
                <Link href={`/matches/${match.id}/edit`}>
                  <Button variant="ghost" size="sm">
                    Edit
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>

        {(match.status === "live" ||
          match.status === "innings_break" ||
          match.status === "completed") && (
          <LiveScorePanel matchId={match.id} />
        )}

        {match.status === "completed" && (
          <MatchAwards matchId={match.id} canManage={canManage} />
        )}

        {(match.status === "live" ||
          match.status === "innings_break" ||
          match.status === "completed") && (
          <MatchCharts matchId={match.id} />
        )}

        {(match.status === "live" ||
          match.status === "innings_break" ||
          match.status === "completed") && (
          <CommentaryFeed matchId={match.id} />
        )}

        {match.status === "completed" && (
          <FullScorecard matchId={match.id} />
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <Row
              label="Scheduled"
              value={
                match.scheduled_at
                  ? new Date(match.scheduled_at).toLocaleString()
                  : "TBD"
              }
            />
            <Row label="Venue" value={match.venue ?? "—"} />
            <Row label="Overs / innings" value={String(match.overs_per_innings)} />
            <Row label="Players / side" value={String(match.players_per_side)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Toss</CardTitle>
            <CardDescription>
              {match.toss_winner_id && match.toss_decision
                ? `${tossWinnerName(match.toss_winner_id, teamA, teamB)} won the toss and chose to ${match.toss_decision}.`
                : "Not yet decided."}
            </CardDescription>
          </CardHeader>
          {canManage && teamA && teamB && (
            <CardContent>
              <TossForm
                matchId={match.id}
                teamA={{ id: teamA.id, name: teamA.name }}
                teamB={{ id: teamB.id, name: teamB.name }}
                current={
                  match.toss_winner_id && match.toss_decision
                    ? {
                        toss_winner_id: match.toss_winner_id,
                        toss_decision: match.toss_decision,
                      }
                    : null
                }
              />
            </CardContent>
          )}
        </Card>

        {teamA && teamB && (
          <XISection
            matchId={match.id}
            tournamentId={tournament.id}
            playersPerSide={match.players_per_side}
            teamA={teamA}
            teamB={teamB}
            canManage={canManage}
          />
        )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function tossWinnerName(
  winnerId: string,
  a?: { id: string; name: string },
  b?: { id: string; name: string },
) {
  if (a && winnerId === a.id) return a.name;
  if (b && winnerId === b.id) return b.name;
  return "(unknown)";
}
