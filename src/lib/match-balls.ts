import type { createClient } from "@/lib/supabase/server";

/**
 * True when at least one non-voided ball exists across any innings of
 * the match — i.e. scoring has actually begun. Used as the gate for
 * "Edit XI" actions / links: once a ball is in the book, the XI is
 * locked because changing it would invalidate match history.
 *
 * Undo-the-whole-thing-back-to-the-start path: `recordBall` flips
 * `is_voided = true` on undo (never deletes), so when every ball has
 * been voided this check returns false again and the XI re-opens for
 * editing — exactly the workflow the user described.
 *
 * Two queries (innings ids → balls count) because `balls.match_id`
 * doesn't exist; balls reference innings, innings reference the
 * match. PostgREST embed counting is finicky enough that two
 * round-trips is cheaper than chasing the right embed.
 */
export async function matchHasRecordedBalls(
  supabase: Awaited<ReturnType<typeof createClient>>,
  matchId: string,
): Promise<boolean> {
  const { data: innings } = await supabase
    .from("innings")
    .select("id")
    .eq("match_id", matchId);
  const inningsIds = (innings ?? []).map((i) => i.id);
  if (inningsIds.length === 0) return false;
  const { count } = await supabase
    .from("balls")
    .select("id", { count: "exact", head: true })
    .in("innings_id", inningsIds)
    .eq("is_voided", false);
  return (count ?? 0) > 0;
}
