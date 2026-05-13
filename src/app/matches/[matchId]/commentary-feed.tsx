import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

  const { data: inningsRows } = await supabase
    .from("innings")
    .select("id, innings_number, batting_team_id")
    .eq("match_id", matchId)
    .order("innings_number", { ascending: true });
  if (!inningsRows || inningsRows.length === 0) return null;

  const inningsIds = inningsRows.map((i) => i.id);
  const { data: ballRows } = await supabase
    .from("balls")
    .select("*")
    .in("innings_id", inningsIds)
    .eq("is_voided", false)
    .order("scored_at", { ascending: true });
  const balls = (ballRows ?? []) as BallRow[];
  if (balls.length === 0) return null;

  // Player names for the narrative.
  const playerIds = new Set<string>();
  for (const b of balls) {
    if (b.batter_id) playerIds.add(b.batter_id);
    if (b.non_striker_id) playerIds.add(b.non_striker_id);
    if (b.bowler_id) playerIds.add(b.bowler_id);
    if (b.fielder_id) playerIds.add(b.fielder_id);
    if (b.player_out_id) playerIds.add(b.player_out_id);
  }
  const { data: playerRows } = playerIds.size
    ? await supabase
        .from("players")
        .select("id, display_name")
        .in("id", Array.from(playerIds))
    : { data: [] as { id: string; display_name: string }[] };
  const playerNames = new Map<string, string>(
    (playerRows ?? []).map((p) => [p.id, p.display_name]),
  );

  // Team short_names for the per-innings header.
  const { data: teams } = await supabase
    .from("teams")
    .select("id, short_name")
    .in("id", [match.team_a_id, match.team_b_id]);
  const teamShort = new Map(
    (teams ?? []).map((t) => [t.id, t.short_name]),
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
    const lines = buildCommentaryLines({ balls: inningsBalls, playerNames });
    lines.forEach((l) => (l.inningsNumber = inn.innings_number));
    const team = teamShort.get(inn.batting_team_id) ?? "?";
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
      <CardHeader>
        <CardTitle className="text-base">Commentary</CardTitle>
        <CardDescription>
          Latest balls at the top. Auto-generated from each delivery.
        </CardDescription>
      </CardHeader>
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
                  className="flex items-start gap-3 px-4 py-2.5 text-sm"
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
