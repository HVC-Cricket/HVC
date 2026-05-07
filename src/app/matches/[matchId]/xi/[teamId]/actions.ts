"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireOrganizer, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import type { ActionResult } from "@/app/tournaments/actions";

const entrySchema = z.object({
  player_id: z.string().uuid(),
  batting_order: z.number().int().min(1).max(15).nullable(),
  is_captain: z.boolean(),
  is_keeper: z.boolean(),
  is_substitute: z.boolean(),
});

const saveSchema = z.object({
  matchId: z.string().uuid(),
  teamId: z.string().uuid(),
  entries: z.array(entrySchema).max(20),
});

export async function savePlayingXI(
  input: z.infer<typeof saveSchema>,
): Promise<ActionResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    await requireUser();
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { data: match } = await supabase
    .from("matches")
    .select("id, tournament_id, team_a_id, team_b_id, players_per_side")
    .eq("id", parsed.data.matchId)
    .single();
  if (!match) {
    await requireUser();
    return { ok: false, error: "Match not found" };
  }

  if (
    parsed.data.teamId !== match.team_a_id &&
    parsed.data.teamId !== match.team_b_id
  ) {
    await requireUser();
    return { ok: false, error: "Team does not belong to this match" };
  }

  await requireOrganizer(match.tournament_id);

  const captainCount = parsed.data.entries.filter((e) => e.is_captain).length;
  if (captainCount > 1) {
    return { ok: false, error: "Only one captain per team" };
  }
  const keeperCount = parsed.data.entries.filter((e) => e.is_keeper).length;
  if (keeperCount > 1) {
    return { ok: false, error: "Only one wicket-keeper per team" };
  }

  // Replace strategy: delete existing rows for this team+match, then insert new.
  // Cheap (XI rarely > 15 rows) and avoids per-row diff logic.
  const { error: delErr } = await supabase
    .from("match_players")
    .delete()
    .eq("match_id", match.id)
    .eq("team_id", parsed.data.teamId);
  if (delErr) return { ok: false, error: delErr.message };

  if (parsed.data.entries.length > 0) {
    const { error: insErr } = await supabase.from("match_players").insert(
      parsed.data.entries.map((e) => ({
        match_id: match.id,
        team_id: parsed.data.teamId,
        player_id: e.player_id,
        batting_order: e.batting_order,
        is_captain: e.is_captain,
        is_keeper: e.is_keeper,
        is_substitute: e.is_substitute,
      })),
    );
    if (insErr) {
      if (insErr.code === "23505") {
        return { ok: false, error: "Duplicate player in XI" };
      }
      return { ok: false, error: insErr.message };
    }
  }

  revalidatePath(`/matches/${match.id}`);
  revalidatePath(`/matches/${match.id}/xi/${parsed.data.teamId}`);
  return { ok: true, data: undefined };
}
