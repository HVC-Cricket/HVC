import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireTournamentAdmin } from "@/lib/auth";
import { listMatchAuditEvents } from "@/lib/match-audit";
import { createClient } from "@/lib/supabase/server";
import type { BallRow } from "@/lib/supabase/row-types";

export const dynamic = "force-dynamic";

/**
 * Activity log for a match — who scored which ball, when, and who
 * voided it (if anyone). Pure derived view over the existing
 * `balls.scored_by` / `voided_by` columns; no schema change.
 *
 * Tournament-admin-gated (matches `requireTournamentAdmin`). Each
 * recorded ball produces one event; voided balls produce two (record
 * + void) sorted chronologically with the latest at the top.
 */
export default async function ActivityPage(props: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await props.params;
  const supabase = await createClient();

  const { data: match } = await supabase
    .from("matches")
    .select("id, tournament_id, team_a_id, team_b_id, match_number, stage")
    .eq("id", matchId)
    .single();
  if (!match) notFound();
  await requireTournamentAdmin(match.tournament_id);

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("slug, name")
    .eq("id", match.tournament_id)
    .single();

  const { data: teams } = await supabase
    .from("teams")
    .select("id, short_name, name")
    .in("id", [match.team_a_id, match.team_b_id]);
  const teamShort = new Map((teams ?? []).map((t) => [t.id, t.short_name]));
  const teamA = teams?.find((t) => t.id === match.team_a_id);
  const teamB = teams?.find((t) => t.id === match.team_b_id);

  const { data: inningsRows } = await supabase
    .from("innings")
    .select("id, innings_number, batting_team_id")
    .eq("match_id", matchId);
  const innings = inningsRows ?? [];
  const inningsById = new Map(innings.map((i) => [i.id, i]));

  const { data: ballRows } = innings.length
    ? await supabase
        .from("balls")
        .select("*")
        .in("innings_id", innings.map((i) => i.id))
        .order("scored_at", { ascending: true })
    : { data: [] as BallRow[] };
  const balls = (ballRows ?? []) as BallRow[];

  // Player + scorer name maps.
  const playerIds = new Set<string>();
  const userIds = new Set<string>();
  for (const b of balls) {
    if (b.batter_id) playerIds.add(b.batter_id);
    if (b.bowler_id) playerIds.add(b.bowler_id);
    if (b.player_out_id) playerIds.add(b.player_out_id);
    if (b.scored_by) userIds.add(b.scored_by);
    if (b.voided_by) userIds.add(b.voided_by);
  }
  const { data: playerRows } = playerIds.size
    ? await supabase
        .from("players")
        .select("id, display_name")
        .in("id", Array.from(playerIds))
    : { data: [] as { id: string; display_name: string }[] };
  const playerName = new Map(
    (playerRows ?? []).map((p) => [p.id, p.display_name]),
  );
  // Match-level events come from a separate audit table (toss / XI /
  // start / completion / POTM). They get folded into the same stream.
  const auditEvents = await listMatchAuditEvents(matchId);
  for (const ev of auditEvents) {
    if (ev.actor_id) userIds.add(ev.actor_id);
  }

  const { data: profileRows } = userIds.size
    ? await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", Array.from(userIds))
    : { data: [] as { id: string; display_name: string }[] };
  const profileName = new Map(
    (profileRows ?? []).map((p) => [p.id, p.display_name]),
  );

  // Expand into events. Each ball produces one or two ball-events
  // (record + optional void); each match_audit_events row produces
  // one match-event. We tag with `source` so the renderer can style
  // them differently.
  type BallEvent = {
    source: "ball";
    key: string;
    kind: "recorded" | "voided";
    ts: string;
    scorerName: string;
    ball: BallRow;
  };
  type MatchEvent = {
    source: "match";
    key: string;
    ts: string;
    eventType: string;
    actorName: string;
    payload: Record<string, unknown> | null;
  };
  type Event = BallEvent | MatchEvent;
  const events: Event[] = [];

  for (const b of balls) {
    events.push({
      source: "ball",
      key: `${b.id}-rec`,
      kind: "recorded",
      ts: b.scored_at,
      scorerName: b.scored_by
        ? (profileName.get(b.scored_by) ?? shortId(b.scored_by))
        : "?",
      ball: b,
    });
    if (b.is_voided && b.voided_at) {
      events.push({
        source: "ball",
        key: `${b.id}-void`,
        kind: "voided",
        ts: b.voided_at,
        scorerName: b.voided_by
          ? (profileName.get(b.voided_by) ?? shortId(b.voided_by))
          : "?",
        ball: b,
      });
    }
  }

  for (const ev of auditEvents) {
    events.push({
      source: "match",
      key: ev.id,
      ts: ev.created_at,
      eventType: ev.event_type,
      actorName: ev.actor_id
        ? (profileName.get(ev.actor_id) ?? shortId(ev.actor_id))
        : "?",
      payload: ev.payload,
    });
  }

  events.sort((a, b) => b.ts.localeCompare(a.ts));

  return (
    <main className="flex-1 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {tournament && (
              <>
                <Link
                  href={`/tournaments/${tournament.slug}`}
                  className="hover:underline"
                >
                  {tournament.name}
                </Link>
                <span> · </span>
              </>
            )}
            <Link
              href={`/matches/${match.id}`}
              className="hover:underline"
            >
              Match {match.match_number}
            </Link>
            <span className="capitalize"> · {match.stage.replace(/_/g, " ")}</span>
          </p>
          <h1 className="text-2xl font-semibold">
            Activity log — {teamA?.short_name ?? "?"} vs {teamB?.short_name ?? "?"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Every recorded and voided ball plus match-level admin
            actions (toss, XI changes, innings transitions, POTM picks),
            in reverse chronological order.
          </p>
        </div>

        {events.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No activity yet</CardTitle>
              <CardDescription>
                Nothing recorded for this match. Once scoring starts, every
                ball lands here with the scorer who entered it.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr className="border-b border-foreground/10">
                    <th className="px-4 py-2 text-left font-medium">When</th>
                    <th className="px-2 py-2 text-left font-medium">Event</th>
                    <th className="px-2 py-2 text-left font-medium">Innings</th>
                    <th className="px-2 py-2 text-left font-medium">Over</th>
                    <th className="px-2 py-2 text-left font-medium">Ball</th>
                    <th className="px-4 py-2 text-left font-medium">Scorer</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => {
                    if (ev.source === "match") {
                      return (
                        <tr
                          key={ev.key}
                          className="border-b border-foreground/5 bg-blue-500/5 last:border-b-0"
                        >
                          <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                            {formatTimestamp(ev.ts)}
                          </td>
                          <td className="px-2 py-2">
                            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium uppercase text-blue-700">
                              {formatMatchEventLabel(ev.eventType)}
                            </span>
                          </td>
                          <td className="px-2 py-2 font-mono text-xs">—</td>
                          <td className="px-2 py-2 font-mono text-xs">—</td>
                          <td className="px-2 py-2 text-xs">
                            {describeMatchEvent(
                              ev.eventType,
                              ev.payload,
                              teamShort,
                              playerName,
                            )}
                          </td>
                          <td className="px-4 py-2 text-xs">{ev.actorName}</td>
                        </tr>
                      );
                    }
                    const inn = inningsById.get(ev.ball.innings_id);
                    const innLabel = inn
                      ? `${inn.innings_number > 2 ? "SO" : "I"}${inn.innings_number} · ${teamShort.get(inn.batting_team_id) ?? "?"}`
                      : "?";
                    const isVoid = ev.kind === "voided";
                    const isCarriedVoided = ev.kind === "recorded" && ev.ball.is_voided;
                    return (
                      <tr
                        key={ev.key}
                        className={
                          "border-b border-foreground/5 last:border-b-0 " +
                          (isVoid ? "bg-destructive/5" : "")
                        }
                      >
                        <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                          {formatTimestamp(ev.ts)}
                        </td>
                        <td className="px-2 py-2">
                          {isVoid ? (
                            <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium uppercase text-destructive">
                              Voided
                            </span>
                          ) : (
                            <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] font-medium uppercase text-foreground">
                              Recorded
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-2 font-mono text-xs">{innLabel}</td>
                        <td className="px-2 py-2 font-mono text-xs">
                          {ev.ball.over_number - 1}.{ev.ball.ball_in_over}
                        </td>
                        <td
                          className={
                            "px-2 py-2 " +
                            (isCarriedVoided
                              ? "text-muted-foreground line-through"
                              : "")
                          }
                        >
                          {describeBall(ev.ball, playerName)}
                        </td>
                        <td className="px-4 py-2 text-xs">{ev.scorerName}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  );
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;
}

function formatMatchEventLabel(type: string): string {
  switch (type) {
    case "toss_set":
      return "Toss";
    case "xi_changed":
      return "XI";
    case "match_started":
      return "Match start";
    case "innings_2_started":
      return "Innings 2";
    case "super_over_started":
      return "Super over";
    case "match_completed":
      return "Completed";
    case "match_unfinalized":
      return "Re-opened";
    case "potm_set":
      return "POTM set";
    case "potm_cleared":
      return "POTM cleared";
    default:
      return type.replace(/_/g, " ");
  }
}

function describeMatchEvent(
  type: string,
  payload: Record<string, unknown> | null,
  teamShort: Map<string, string>,
  playerName: Map<string, string>,
): string {
  const get = (k: string) => (payload && k in payload ? String(payload[k]) : null);
  const teamLabel = (id: string | null) =>
    id ? (teamShort.get(id) ?? id.slice(0, 8)) : "?";
  const playerLabel = (id: string | null) =>
    id ? (playerName.get(id) ?? id.slice(0, 8)) : "?";

  switch (type) {
    case "toss_set": {
      const winner = teamLabel(get("toss_winner_id"));
      const decision = get("toss_decision");
      return `${winner} won the toss, chose to ${decision ?? "?"}`;
    }
    case "xi_changed": {
      const team = teamLabel(get("team_id"));
      const count = get("player_count") ?? "?";
      return `${team} XI updated — ${count} players`;
    }
    case "match_started": {
      const batting = teamLabel(get("batting_team_id"));
      const striker = playerLabel(get("striker_id"));
      const nonStriker = playerLabel(get("non_striker_id"));
      const bowler = playerLabel(get("bowler_id"));
      return `${batting} batting · ${striker} + ${nonStriker} vs ${bowler}`;
    }
    case "innings_2_started": {
      const target = get("target") ?? "?";
      const striker = playerLabel(get("striker_id"));
      const bowler = playerLabel(get("bowler_id"));
      return `Target ${target} · ${striker} vs ${bowler}`;
    }
    case "super_over_started": {
      const innings = get("innings_number") ?? "?";
      const target = get("target") ?? "?";
      return `Super over (innings ${innings}) · target ${target}`;
    }
    case "match_completed": {
      const winner = teamLabel(get("winner_id"));
      const margin = get("win_margin") ?? "";
      const result = get("result_type");
      if (result === "tie") return "Match tied";
      return `${winner} ${margin}`;
    }
    case "potm_set":
      return `Picked ${playerLabel(get("player_id"))}`;
    case "potm_cleared":
      return "Cleared (reverted to auto)";
    case "match_unfinalized":
      return "Match re-opened (final result reverted)";
    default:
      return payload ? JSON.stringify(payload) : "—";
  }
}

function describeBall(b: BallRow, players: Map<string, string>): string {
  const batter = players.get(b.batter_id) ?? "?";
  const bowler = players.get(b.bowler_id) ?? "?";
  const outName = b.player_out_id
    ? (players.get(b.player_out_id) ?? "?")
    : null;

  const bits: string[] = [];
  if (b.is_wicket) {
    bits.push(
      `WICKET · ${b.wicket_type?.replace(/_/g, " ") ?? "out"}${outName ? ` (${outName})` : ""}`,
    );
  }
  if (b.extra_type === "wide") {
    bits.push(`Wide${b.extras > 1 ? ` +${b.extras - 1}` : ""}`);
  } else if (b.extra_type === "no_ball") {
    bits.push(`No-ball${b.runs_off_bat > 0 ? ` +${b.runs_off_bat}` : ""}`);
  } else if (b.extra_type === "bye") {
    bits.push(`${b.extras} bye${b.extras === 1 ? "" : "s"}`);
  } else if (!b.is_wicket) {
    // Plain off-the-bat runs.
    bits.push(`${b.runs_off_bat} run${b.runs_off_bat === 1 ? "" : "s"}`);
  }
  if (b.is_free_hit) bits.push("free hit");

  return `${bits.join(" · ")} — ${batter} v ${bowler}`;
}
