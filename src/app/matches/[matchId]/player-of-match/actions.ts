"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireTournamentAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  matchId: z.string().uuid(),
  playerId: z.string().uuid().nullable(),
});

export async function setPlayerOfMatch(
  input: z.infer<typeof schema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const supabase = await createClient();
  const { data: match } = await supabase
    .from("matches")
    .select("id, tournament_id, status")
    .eq("id", parsed.data.matchId)
    .single();
  if (!match) return { ok: false, error: "Match not found" };

  await requireTournamentAdmin(match.tournament_id);

  if (match.status !== "completed") {
    return {
      ok: false,
      error: "Player of the match can only be set after the match completes",
    };
  }

  // Validate the player is on one of the two XIs for this match.
  if (parsed.data.playerId) {
    const { data: row } = await supabase
      .from("match_players")
      .select("player_id")
      .eq("match_id", match.id)
      .eq("player_id", parsed.data.playerId)
      .maybeSingle();
    if (!row) {
      return {
        ok: false,
        error: "Player must be on one of the two XIs for this match",
      };
    }
  }

  const { error } = await supabase
    .from("matches")
    .update({ player_of_match_id: parsed.data.playerId })
    .eq("id", match.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/matches/${match.id}`);
  return { ok: true };
}
