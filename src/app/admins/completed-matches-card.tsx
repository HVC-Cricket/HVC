import { Sparkles } from "lucide-react";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createAdminClient } from "@/lib/supabase/admin";

type Row = {
  id: string;
  match_number: number;
  winner_id: string | null;
  win_margin: string | null;
  result_type: string | null;
  team_a: { id: string; short_name: string } | null;
  team_b: { id: string; short_name: string } | null;
  tournament: { name: string } | null;
};

/**
 * Lists the 10 most recently completed matches and gives each row a
 * link to the OG-image highlight card (`/api/og/match/<id>`). The link
 * opens in a new tab so the admin can right-click → save, drag into a
 * WhatsApp chat, or just eyeball the design.
 */
export async function CompletedMatchesCard() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("matches")
    .select(
      `
      id, match_number, winner_id, win_margin, result_type,
      team_a:teams!matches_team_a_id_fkey(id, short_name),
      team_b:teams!matches_team_b_id_fkey(id, short_name),
      tournament:tournaments(name)
      `,
    )
    .eq("status", "completed")
    .order("ended_at", { ascending: false, nullsFirst: false })
    .limit(10);

  const rows = (data as unknown as Row[] | null) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-muted-foreground" />
          Highlight cards
        </CardTitle>
        <CardDescription>
          One-tap PNG summary per completed match — team scores, result,
          top batter, top bowler, boundary count. Open in a new tab and
          right-click → save, or paste the URL into WhatsApp / Twitter for
          a native link preview.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0 sm:px-6">
        {rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-0">
            No completed matches yet.
          </p>
        ) : (
          <ul className="divide-y divide-foreground/10 rounded-md border border-foreground/10">
            {rows.map((m) => {
              const teamA = m.team_a?.short_name ?? "?";
              const teamB = m.team_b?.short_name ?? "?";
              const winner =
                m.winner_id === m.team_a?.id
                  ? teamA
                  : m.winner_id === m.team_b?.id
                    ? teamB
                    : null;
              const result =
                winner && m.win_margin
                  ? `${winner} won by ${m.win_margin}`
                  : m.result_type === "tie"
                    ? "Tie"
                    : "—";
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-3 px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium capitalize">
                      {teamA} vs {teamB}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {m.tournament?.name ?? "—"} · Match {m.match_number} ·{" "}
                      {result}
                    </div>
                  </div>
                  <Link
                    href={`/api/og/match/${m.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-md border border-foreground/15 bg-background px-2.5 py-1 text-xs font-medium transition hover:bg-muted"
                  >
                    Highlight ↗
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
