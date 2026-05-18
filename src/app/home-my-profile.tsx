import { ArrowRight, User } from "lucide-react";
import Link from "next/link";

import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * Homepage strip that shows up only for signed-in users who have a
 * `players.linked_user_id` pointing at them — their cricket profile
 * as a quick snapshot. Anon visitors + signed-in users who don't play
 * see nothing.
 *
 * Single linked player by design (the partial unique index on
 * players.linked_user_id enforces 1:1).
 */
export async function HomeMyProfile() {
  const ctx = await getSessionContext();
  if (!ctx?.user) return null;

  const supabase = await createClient();

  // Find the player record linked to this user.
  const { data: player } = await supabase
    .from("players")
    .select("id, display_name, photo_url, category")
    .eq("linked_user_id", ctx.user.id)
    .maybeSingle();
  if (!player) return null;

  // Career snapshot — read from v_player_tournament_stats (already
  // historical-aware after migration 20260516030000_*) and sum across
  // all tournaments, plus a distinct match count from match_players.
  const [statsRes, matchesRes] = await Promise.all([
    supabase
      .from("v_player_tournament_stats" as never)
      .select("runs, wickets")
      .eq("player_id", player.id),
    supabase
      .from("match_players")
      .select("match_id")
      .eq("player_id", player.id),
  ]);
  type StatRow = { runs: number | null; wickets: number | null };
  const stats = (statsRes.data as unknown as StatRow[] | null) ?? [];
  const totalRuns = stats.reduce((a, r) => a + (r.runs ?? 0), 0);
  const totalWickets = stats.reduce((a, r) => a + (r.wickets ?? 0), 0);

  const matchSet = new Set<string>();
  for (const r of matchesRes.data ?? []) matchSet.add(r.match_id);
  const matchCount = matchSet.size;

  // If the linked player has truly never played anywhere, keep the
  // strip minimal — just a "View profile" link.
  return (
    <Link
      href="/me"
      prefetch
      className="group flex items-center gap-3 rounded-xl border border-primary/15 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-3 transition hover:border-primary/30 hover:from-primary/15"
    >
      {player.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={player.photo_url}
          alt=""
          className="size-12 shrink-0 rounded-full border border-foreground/10 object-cover"
        />
      ) : (
        <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <User className="size-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
            You
          </span>
          {player.category && (
            <span className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-mono">
              C{player.category}
            </span>
          )}
        </div>
        <div className="truncate text-base font-semibold capitalize">
          {player.display_name}
        </div>
        <div className="text-xs text-muted-foreground">
          {matchCount}{" "}
          {matchCount === 1 ? "match" : "matches"} · {totalRuns}{" "}
          {totalRuns === 1 ? "run" : "runs"} · {totalWickets}{" "}
          {totalWickets === 1 ? "wicket" : "wickets"}
        </div>
      </div>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:text-primary group-hover:translate-x-0.5" />
    </Link>
  );
}
