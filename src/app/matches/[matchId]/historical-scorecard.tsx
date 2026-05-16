import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

import { ScorecardInningsTabs } from "./scorecard-innings-tabs";

/**
 * Fallback scorecard for matches imported from CricHeroes (Seasons 1–6).
 * CricHeroes doesn't expose complete ball-by-ball, so we can't populate
 * `balls`. Instead we ship per-innings aggregates in three tables:
 * `historical_match_batting`, `historical_match_bowling`,
 * `historical_match_fall_of_wickets`. This component renders directly
 * from those without touching the engine or stats helpers.
 *
 * Same visual layout as `FullScorecard` so spectators don't notice the
 * difference unless they click into per-ball features (commentary,
 * Manhattan, etc.) which simply stay empty for historical matches.
 */
export async function HistoricalScorecard({ matchId }: { matchId: string }) {
  const supabase = await createClient();

  const { data: match } = await supabase
    .from("matches")
    .select("id, team_a_id, team_b_id")
    .eq("id", matchId)
    .single();
  if (!match) return null;

  const [inningsRes, teamsRes, battingRes, bowlingRes, fowRes] =
    await Promise.all([
      supabase
        .from("innings")
        .select(
          "id, innings_number, batting_team_id, bowling_team_id, total_runs, total_wickets, total_legal_balls, extras_wides, extras_no_balls, extras_byes, extras_leg_byes, extras_penalty",
        )
        .eq("match_id", match.id)
        .order("innings_number", { ascending: true }),
      supabase
        .from("teams")
        .select("id, name, short_name")
        .in("id", [match.team_a_id, match.team_b_id]),
      supabase
        .from("historical_match_batting")
        .select(
          "innings_number, batting_team_id, player_name, batting_order, is_captain, runs, balls_faced, fours, sixes, strike_rate, how_to_out, is_out",
        )
        .eq("match_id", match.id)
        .order("batting_order", { ascending: true }),
      supabase
        .from("historical_match_bowling")
        .select(
          "innings_number, bowling_team_id, player_name, bowling_order, overs, maidens, runs, wickets, dots, fours_conceded, sixes_conceded, wides, noballs, economy_rate",
        )
        .eq("match_id", match.id)
        .order("bowling_order", { ascending: true }),
      supabase
        .from("historical_match_fall_of_wickets")
        .select(
          "innings_number, batting_team_id, wicket_no, run_at_fall, over_at_fall, dismiss_player_name",
        )
        .eq("match_id", match.id)
        .order("wicket_no", { ascending: true }),
    ]);

  const innings = inningsRes.data;
  if (!innings || innings.length === 0) return null;

  const teamById = new Map((teamsRes.data ?? []).map((t) => [t.id, t]));
  const battingRows = battingRes.data ?? [];
  const bowlingRows = bowlingRes.data ?? [];
  const fowRows = fowRes.data ?? [];

  const tabs = innings.map((i) => {
    const battingTeam = teamById.get(i.batting_team_id);
    const bowlingTeam = teamById.get(i.bowling_team_id);
    const innBatters = battingRows.filter(
      (r) => r.innings_number === i.innings_number,
    );
    const innBowlers = bowlingRows.filter(
      (r) => r.innings_number === i.innings_number,
    );
    const innFow = fowRows.filter(
      (r) => r.innings_number === i.innings_number,
    );
    const overs = `${Math.floor(i.total_legal_balls / 6)}.${i.total_legal_balls % 6}`;
    const ordinal = ordinalInnings(i.innings_number);

    return {
      id: String(i.id),
      label: battingTeam?.short_name ?? "?",
      sub: `${ordinal} · ${i.total_runs}/${i.total_wickets} (${overs})`,
      panel: (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-foreground/5 bg-muted/30">
            <div className="flex items-baseline justify-between gap-2">
              <CardTitle className="text-base capitalize">
                {battingTeam?.name ?? "?"}
                <span className="ml-2 text-xs font-normal uppercase tracking-wide text-muted-foreground">
                  {ordinal}
                </span>
              </CardTitle>
              <CardDescription className="font-mono text-sm font-semibold text-foreground">
                {i.total_runs}/{i.total_wickets}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  ({overs} ov)
                </span>
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-0 p-0">
            <HistoricalBattingTable batters={innBatters} />
            <HistoricalFallOfWickets rows={innFow} />
            <HistoricalExtrasRow innings={i} />
            <HistoricalBowlingTable
              bowlers={innBowlers}
              bowlingTeamName={bowlingTeam?.name}
            />
          </CardContent>
        </Card>
      ),
    };
  });

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Scorecard</h2>
        <span className="text-xs text-muted-foreground">
          Per-player batting &amp; bowling
        </span>
      </div>
      <ScorecardInningsTabs tabs={tabs} />
    </section>
  );
}

function ordinalInnings(n: number): string {
  if (n === 1) return "1st innings";
  if (n === 2) return "2nd innings";
  if (n === 3) return "Super over 1";
  if (n === 4) return "Super over 2";
  return `Innings ${n}`;
}

type Batter = {
  player_name: string;
  is_captain: boolean;
  runs: number;
  balls_faced: number;
  fours: number;
  sixes: number;
  strike_rate: number | null;
  how_to_out: string | null;
  is_out: boolean;
};

function HistoricalBattingTable({ batters }: { batters: Batter[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-foreground/10 text-[10px] uppercase tracking-wide text-muted-foreground">
          <th className="px-3 py-2 text-left font-medium">Batter</th>
          <th className="px-1.5 py-2 text-right font-medium">R</th>
          <th className="px-1.5 py-2 text-right font-medium">B</th>
          <th className="px-1.5 py-2 text-right font-medium">4s</th>
          <th className="px-1.5 py-2 text-right font-medium">6s</th>
          <th className="px-3 py-2 text-right font-medium">SR</th>
        </tr>
      </thead>
      <tbody>
        {batters.map((b, idx) => (
          <tr
            key={idx}
            className="border-b border-foreground/5 last:border-b-0"
          >
            <td className="px-3 py-2">
              <div className="flex items-baseline gap-1.5">
                <span className="font-medium capitalize">
                  {b.player_name}
                </span>
                {b.is_captain && (
                  <span
                    className="font-mono text-[10px] text-muted-foreground"
                    title="Captain"
                  >
                    (c)
                  </span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {b.is_out
                  ? (b.how_to_out ?? "out")
                  : (b.how_to_out ?? "not out")}
              </div>
            </td>
            <td className="px-1.5 py-2 text-right font-mono font-semibold tabular-nums">
              {b.runs}
            </td>
            <td className="px-1.5 py-2 text-right font-mono tabular-nums text-muted-foreground">
              {b.balls_faced}
            </td>
            <td className="px-1.5 py-2 text-right font-mono tabular-nums text-muted-foreground">
              {b.fours}
            </td>
            <td className="px-1.5 py-2 text-right font-mono tabular-nums text-muted-foreground">
              {b.sixes}
            </td>
            <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
              {b.strike_rate != null ? b.strike_rate.toFixed(2) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HistoricalFallOfWickets({
  rows,
}: {
  rows: {
    wicket_no: number;
    run_at_fall: number;
    over_at_fall: number | null;
    dismiss_player_name: string | null;
  }[];
}) {
  if (rows.length === 0) return null;
  const text = rows
    .map((r) => {
      const player = r.dismiss_player_name ?? "?";
      const over = r.over_at_fall != null ? `${r.over_at_fall} ov` : "—";
      return `${r.run_at_fall}-${r.wicket_no} (${player}, ${over})`;
    })
    .join(", ");
  return (
    <div className="border-t border-foreground/10 bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground">
      <span className="font-medium uppercase tracking-wide">Fall</span>{" "}
      <span className="capitalize">{text}</span>
    </div>
  );
}

function HistoricalExtrasRow({
  innings,
}: {
  innings: {
    extras_wides: number;
    extras_no_balls: number;
    extras_byes: number;
    extras_leg_byes: number;
    extras_penalty: number;
  };
}) {
  const total =
    innings.extras_wides +
    innings.extras_no_balls +
    innings.extras_byes +
    innings.extras_leg_byes +
    innings.extras_penalty;
  const parts: string[] = [];
  if (innings.extras_wides) parts.push(`wd ${innings.extras_wides}`);
  if (innings.extras_no_balls) parts.push(`nb ${innings.extras_no_balls}`);
  if (innings.extras_byes) parts.push(`b ${innings.extras_byes}`);
  if (innings.extras_leg_byes) parts.push(`lb ${innings.extras_leg_byes}`);
  if (innings.extras_penalty) parts.push(`p ${innings.extras_penalty}`);
  return (
    <div className="flex items-baseline justify-between gap-2 border-t border-foreground/10 px-3 py-2 text-[11px] text-muted-foreground">
      <span>
        <span className="font-medium uppercase tracking-wide">Extras</span>{" "}
        {parts.length > 0 ? `(${parts.join(", ")})` : ""}
      </span>
      <span className="font-mono tabular-nums">{total}</span>
    </div>
  );
}

type Bowler = {
  player_name: string;
  overs: number;
  maidens: number;
  runs: number;
  wickets: number;
  dots: number;
  wides: number;
  noballs: number;
  economy_rate: number | null;
};

function HistoricalBowlingTable({
  bowlers,
  bowlingTeamName,
}: {
  bowlers: Bowler[];
  bowlingTeamName: string | undefined;
}) {
  if (bowlers.length === 0) return null;
  return (
    <>
      {bowlingTeamName && (
        <div className="border-t border-foreground/10 bg-muted/20 px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          {bowlingTeamName} · bowling
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-foreground/10 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="px-3 py-2 text-left font-medium">Bowler</th>
            <th className="px-1.5 py-2 text-right font-medium">O</th>
            <th className="px-1.5 py-2 text-right font-medium">M</th>
            <th className="px-1.5 py-2 text-right font-medium">R</th>
            <th className="px-1.5 py-2 text-right font-medium">W</th>
            <th className="px-1.5 py-2 text-right font-medium">·</th>
            <th className="px-1.5 py-2 text-right font-medium">Wd</th>
            <th className="px-1.5 py-2 text-right font-medium">Nb</th>
            <th className="px-3 py-2 text-right font-medium">Econ</th>
          </tr>
        </thead>
        <tbody>
          {bowlers.map((b, idx) => (
            <tr
              key={idx}
              className="border-b border-foreground/5 last:border-b-0"
            >
              <td className="px-3 py-2 capitalize">{b.player_name}</td>
              <td className="px-1.5 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {b.overs}
              </td>
              <td className="px-1.5 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {b.maidens}
              </td>
              <td className="px-1.5 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {b.runs}
              </td>
              <td className="px-1.5 py-2 text-right font-mono font-semibold tabular-nums">
                {b.wickets}
              </td>
              <td className="px-1.5 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {b.dots}
              </td>
              <td className="px-1.5 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {b.wides}
              </td>
              <td className="px-1.5 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {b.noballs}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {b.economy_rate != null ? b.economy_rate.toFixed(2) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
