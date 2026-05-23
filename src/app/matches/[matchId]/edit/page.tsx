import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireOrganizer } from "@/lib/auth";
import { matchHasRecordedBalls } from "@/lib/match-balls";
import {
  applyRulesOverride,
  getRuleSet,
  type RulesOverride,
} from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";

import { EditMatchForm } from "./edit-match-form";

export default async function EditMatchPage(props: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await props.params;
  const supabase = await createClient();

  const { data: match } = await supabase
    .from("matches")
    .select("*")
    .eq("id", matchId)
    .single();
  if (!match) notFound();

  await requireOrganizer(match.tournament_id);

  // Tournament + teams are independent now that we have match — fetch in parallel.
  const [tournamentRes, teamsRes] = await Promise.all([
    supabase
      .from("tournaments")
      .select("id, slug, name, format, rules")
      .eq("id", match.tournament_id)
      .single(),
    supabase
      .from("teams")
      .select("id, name, short_name")
      .eq("tournament_id", match.tournament_id)
      .order("name", { ascending: true }),
  ]);
  const tournament = tournamentRes.data;
  if (!tournament) notFound();
  const teams = teamsRes.data;

  // Compute the effective Cat 1 / Cat 3 schedule for this match. If
  // `rules_override` is set we surface those arrays so the form's
  // override toggle starts in the "On" state with current values;
  // otherwise fall back to the tournament default.
  const baseRules = getRuleSet(tournament.rules);
  const matchOverride =
    (match as { rules_override?: RulesOverride }).rules_override ?? null;
  const effectiveRules = applyRulesOverride(baseRules, matchOverride);

  // Field-level lock: once any ball is recorded for this match, the
  // structural fields (teams, overs / innings, players / side) are
  // frozen — changing them would silently invalidate the existing
  // match_players / innings / balls references. Rules + scheduling /
  // venue / status / stage stay editable so mid-match adjustments
  // (category override flip, status revert, scheduling tweaks) keep
  // working. The form-level lock is purely UI; server `updateMatch`
  // would also need to enforce — see TODO at the action.
  const xiLocked = await matchHasRecordedBalls(supabase, match.id);

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <Link
          href={`/matches/${match.id}`}
          prefetch
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          <span>Back to match</span>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle>Edit match</CardTitle>
            <CardDescription className="capitalize">
              {tournament.name} · Match {match.match_number}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EditMatchForm
              match={{
                id: match.id,
                stage: match.stage,
                team_a_id: match.team_a_id,
                team_b_id: match.team_b_id,
                scheduled_at: match.scheduled_at,
                venue: match.venue,
                overs_per_innings: match.overs_per_innings,
                players_per_side: match.players_per_side,
                umpire_1: match.umpire_1,
                umpire_2: match.umpire_2,
                scorer: match.scorer,
                status: match.status,
                override_categories: matchOverride != null,
                cat1_overs: effectiveRules.categories.cat1_overs,
                cat3_overs: effectiveRules.categories.cat3_overs,
              }}
              tournamentFormat={tournament.format}
              teams={teams ?? []}
              structuralLocked={xiLocked}
            />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
