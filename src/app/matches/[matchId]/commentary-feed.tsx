import { Card, CardContent } from "@/components/ui/card";
import { buildCommentaryLines, type CommentaryLine } from "@/lib/commentary";
import { createClient } from "@/lib/supabase/server";
import type { BallRow } from "@/lib/supabase/row-types";

/**
 * Auto-generated ball-by-ball commentary for the match page. Groups
 * by innings (latest innings first) and within each innings shows
 * balls in reverse chronological order — the latest tap is always at
 * the top, like a live feed.
 *
 * No new schema; pure server-rendered text derived from `balls`.
 */
export async function CommentaryFeed({ matchId }: { matchId: string }) {
  const supabase = await createClient();

  const { data: match } = await supabase
    .from("matches")
    .select("id, team_a_id, team_b_id")
    .eq("id", matchId)
    .single();
  if (!match) return null;

  // innings + balls + teams + player-name source (match_players with
  // players embedded) all run in parallel — was 4 sequential awaits.
  // Balls are filtered through the innings!inner join so we don't need
  // innings IDs upfront; players come from match_players so we don't
  // wait on the balls result either.
  type EmbeddedXIRow = {
    player: {
      id: string;
      display_name: string;
      category: number | null;
    } | null;
  };
  const [inningsRes, ballsRes, teamsRes, xiRes] = await Promise.all([
    supabase
      .from("innings")
      .select("id, innings_number, batting_team_id")
      .eq("match_id", matchId)
      .order("innings_number", { ascending: true }),
    supabase
      .from("balls")
      .select("*, innings!inner(match_id)")
      .eq("innings.match_id", matchId)
      .eq("is_voided", false)
      .order("scored_at", { ascending: true }),
    supabase
      .from("teams")
      .select("id, name")
      .in("id", [match.team_a_id, match.team_b_id]),
    supabase
      .from("match_players")
      .select("player:players(id, display_name, category)")
      .eq("match_id", matchId),
  ]);

  const inningsRows = inningsRes.data;
  if (!inningsRows || inningsRows.length === 0) return null;

  const balls = (ballsRes.data as BallRow[] | null) ?? [];
  if (balls.length === 0) return null;

  const playerNames = new Map<string, string>();
  const playerCats = new Map<string, 1 | 2 | 3 | null>();
  for (const r of (xiRes.data as EmbeddedXIRow[] | null) ?? []) {
    if (!r.player) continue;
    playerNames.set(r.player.id, r.player.display_name);
    const c = r.player.category;
    playerCats.set(
      r.player.id,
      c === 1 || c === 2 || c === 3 ? c : null,
    );
  }

  const teamName = new Map(
    (teamsRes.data ?? []).map((t) => [t.id, t.name]),
  );

  // Build commentary per innings (so we can group + show innings headers).
  type InningsSection = {
    inningsNumber: number;
    label: string;
    lines: CommentaryLine[];
  };
  const sections: InningsSection[] = [];
  for (const inn of inningsRows) {
    const inningsBalls = balls.filter((b) => b.innings_id === inn.id);
    if (inningsBalls.length === 0) continue;
    const lines = buildCommentaryLines({
      balls: inningsBalls,
      playerNames,
      playerCats,
    });
    lines.forEach((l) => (l.inningsNumber = inn.innings_number));
    const team = teamName.get(inn.batting_team_id) ?? "?";
    const isSuperOver = inn.innings_number > 2;
    const label = isSuperOver
      ? `${team} — Super over ${inn.innings_number - 2}`
      : `${team} — Innings ${inn.innings_number}`;
    sections.push({
      inningsNumber: inn.innings_number,
      label,
      lines,
    });
  }

  // Latest innings first.
  sections.reverse();

  return (
    <Card>
      <CardContent className="space-y-4 p-0">
        {sections.map((section) => (
          <div key={section.inningsNumber}>
            <div className="border-y border-foreground/10 bg-muted/30 px-4 py-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              {section.label}
            </div>
            <ol className="divide-y divide-foreground/5">
              {[...section.lines].reverse().map((line) => (
                <li
                  key={line.key}
                  className={
                    "flex items-start gap-3 px-4 py-2.5 text-sm " +
                    (line.isNarration ? "bg-muted/20" : "")
                  }
                >
                  <span
                    className={
                      "shrink-0 font-mono text-xs " +
                      (line.isFreeHit
                        ? "rounded bg-yellow-500/15 px-1.5 py-0.5 text-yellow-700"
                        : "pt-0.5 text-muted-foreground")
                    }
                  >
                    {line.over}
                  </span>
                  <span
                    className={
                      line.isWicket
                        ? "font-medium text-destructive"
                        : line.isBoundary
                          ? "font-medium"
                          : line.isNarration
                            ? "italic text-muted-foreground"
                            : ""
                    }
                  >
                    {line.text}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
