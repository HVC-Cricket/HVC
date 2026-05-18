"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOrganizer, requireTournamentAdmin, requireUser } from "@/lib/auth";
import { logMatchAuditEvent } from "@/lib/match-audit";
import { createClient } from "@/lib/supabase/server";

import type { ActionResult } from "@/app/tournaments/actions";
import type { Json } from "@/lib/supabase/database.types";

const matchStages = [
  "group",
  "qualifier",
  "qualifier_1",
  "eliminator",
  "qualifier_2",
  "quarter",
  "semi",
  "final",
  "exhibition",
] as const;

const matchStatuses = [
  "scheduled",
  "live",
  "innings_break",
  "completed",
  "abandoned",
] as const;

const baseMatchFields = {
  stage: z.enum(matchStages),
  team_a_id: z.string().uuid("Pick team A"),
  team_b_id: z.string().uuid("Pick team B"),
  scheduled_at: z.string().optional().or(z.literal("")),
  venue: z.string().optional().or(z.literal("")),
  overs_per_innings: z.coerce.number().int().positive().max(50),
  players_per_side: z.coerce.number().int().min(2).max(15),
};

const createMatchSchema = z
  .object({
    tournamentSlug: z.string().min(1),
    ...baseMatchFields,
  })
  .refine((d) => d.team_a_id !== d.team_b_id, {
    message: "Team A and Team B must be different",
    path: ["team_b_id"],
  });

const updateMatchSchema = z
  .object({
    matchId: z.string().uuid(),
    ...baseMatchFields,
    status: z.enum(matchStatuses),
    // Per-match rules override. When `override_categories` is true,
    // store `{ categories: { cat1_overs, cat3_overs } }` in
    // matches.rules_override. When false (or absent), clear the
    // column so the match inherits the tournament default.
    override_categories: z.boolean().optional(),
    match_cat1_overs: z.array(z.number().int().positive()).optional(),
    match_cat3_overs: z.array(z.number().int().positive()).optional(),
  })
  .refine((d) => d.team_a_id !== d.team_b_id, {
    message: "Team A and Team B must be different",
    path: ["team_b_id"],
  });

export type CreateMatchInput = z.infer<typeof createMatchSchema>;
export type UpdateMatchInput = z.infer<typeof updateMatchSchema>;

export async function createMatch(
  input: CreateMatchInput,
): Promise<ActionResult<{ matchId: string }>> {
  const parsed = createMatchSchema.safeParse(input);
  if (!parsed.success) {
    await requireUser();
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("id, slug")
    .eq("slug", parsed.data.tournamentSlug)
    .single();
  if (!tournament) {
    await requireUser();
    return { ok: false, error: "Tournament not found" };
  }
  await requireOrganizer(tournament.id);

  // Sanity-check: both teams belong to this tournament.
  const { data: validTeams } = await supabase
    .from("teams")
    .select("id")
    .eq("tournament_id", tournament.id)
    .in("id", [parsed.data.team_a_id, parsed.data.team_b_id]);
  if (!validTeams || validTeams.length !== 2) {
    return { ok: false, error: "Teams must belong to this tournament" };
  }

  // Auto-pick next match_number.
  const { data: maxRow } = await supabase
    .from("matches")
    .select("match_number")
    .eq("tournament_id", tournament.id)
    .order("match_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextNumber = (maxRow?.match_number ?? 0) + 1;

  const { data: created, error } = await supabase
    .from("matches")
    .insert({
      tournament_id: tournament.id,
      match_number: nextNumber,
      stage: parsed.data.stage,
      team_a_id: parsed.data.team_a_id,
      team_b_id: parsed.data.team_b_id,
      scheduled_at: parsed.data.scheduled_at || null,
      venue: parsed.data.venue || null,
      overs_per_innings: parsed.data.overs_per_innings,
      players_per_side: parsed.data.players_per_side,
    })
    .select("id")
    .single();

  if (error || !created) {
    return { ok: false, error: error?.message ?? "Insert failed" };
  }

  revalidatePath(`/tournaments/${tournament.slug}`);
  redirect(`/matches/${created.id}`);
}

export async function updateMatch(
  input: UpdateMatchInput,
): Promise<ActionResult> {
  const parsed = updateMatchSchema.safeParse(input);
  if (!parsed.success) {
    await requireUser();
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data: match } = await supabase
    .from("matches")
    .select("id, tournament_id")
    .eq("id", parsed.data.matchId)
    .single();
  if (!match) {
    await requireUser();
    return { ok: false, error: "Match not found" };
  }
  await requireOrganizer(match.tournament_id);

  // Compose the rules_override payload. When the toggle is off (or
  // absent), explicitly null it out so the match inherits the
  // tournament default cleanly. Only categories are overridable via
  // the UI today; other RuleSet fields stay tournament-level.
  const rulesOverride: Json | null = parsed.data.override_categories
    ? ({
        categories: {
          cat1_overs: parsed.data.match_cat1_overs ?? [],
          cat3_overs: parsed.data.match_cat3_overs ?? [],
        },
      } as Json)
    : null;

  const { error } = await supabase
    .from("matches")
    // Cast: `rules_override` is a brand-new column (migration
    // 20260518130000_*) and the generated database.types.ts is
    // still on the previous shape. Regen via `pnpm gen:types:*`
    // after the migration ships to drop this cast.
    .update({
      stage: parsed.data.stage,
      team_a_id: parsed.data.team_a_id,
      team_b_id: parsed.data.team_b_id,
      scheduled_at: parsed.data.scheduled_at || null,
      venue: parsed.data.venue || null,
      overs_per_innings: parsed.data.overs_per_innings,
      players_per_side: parsed.data.players_per_side,
      status: parsed.data.status,
      rules_override: rulesOverride,
    } as never)
    .eq("id", match.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/matches/${match.id}`);
  redirect(`/matches/${match.id}`);
}

const deleteMatchSchema = z.object({ matchId: z.string().uuid() });

export async function deleteMatch(
  input: z.infer<typeof deleteMatchSchema>,
): Promise<ActionResult> {
  const parsed = deleteMatchSchema.safeParse(input);
  if (!parsed.success) {
    await requireUser();
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data: match } = await supabase
    .from("matches")
    .select("id, tournament_id")
    .eq("id", parsed.data.matchId)
    .single();
  if (!match) {
    await requireUser();
    return { ok: false, error: "Match not found" };
  }
  await requireOrganizer(match.tournament_id);

  // Need tournament slug for redirect.
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("slug")
    .eq("id", match.tournament_id)
    .single();

  const { error } = await supabase
    .from("matches")
    .delete()
    .eq("id", match.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/tournaments/${tournament?.slug}`);
  redirect(`/tournaments/${tournament?.slug ?? ""}`);
}

const setTossSchema = z.object({
  matchId: z.string().uuid(),
  toss_winner_id: z.string().uuid(),
  toss_decision: z.enum(["bat", "bowl"]),
});

export async function setToss(
  input: z.infer<typeof setTossSchema>,
): Promise<ActionResult> {
  const parsed = setTossSchema.safeParse(input);
  if (!parsed.success) {
    await requireUser();
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data: match } = await supabase
    .from("matches")
    .select("id, tournament_id, team_a_id, team_b_id")
    .eq("id", parsed.data.matchId)
    .single();
  if (!match) {
    await requireUser();
    return { ok: false, error: "Match not found" };
  }
  // Scorers run pre-match setup (toss + XI) from the score page, so
  // tournament-admin (organizer OR scorer) is the right gate here.
  await requireTournamentAdmin(match.tournament_id);

  if (
    parsed.data.toss_winner_id !== match.team_a_id &&
    parsed.data.toss_winner_id !== match.team_b_id
  ) {
    return { ok: false, error: "Toss winner must be one of the two teams" };
  }

  const { error } = await supabase
    .from("matches")
    .update({
      toss_winner_id: parsed.data.toss_winner_id,
      toss_decision: parsed.data.toss_decision,
    })
    .eq("id", match.id);

  if (error) return { ok: false, error: error.message };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  await logMatchAuditEvent({
    matchId: match.id,
    eventType: "toss_set",
    actorId: user?.id ?? null,
    payload: {
      toss_winner_id: parsed.data.toss_winner_id,
      toss_decision: parsed.data.toss_decision,
    },
  });

  revalidatePath(`/matches/${match.id}`);
  return { ok: true, data: undefined };
}
