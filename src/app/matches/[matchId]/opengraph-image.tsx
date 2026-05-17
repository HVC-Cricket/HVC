import { ImageResponse } from "next/og";

import { formatEnumLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const alt = "HVC Heroes — match";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// Refresh every minute so live scores stay reasonably current in shares.
export const revalidate = 60;

export default async function MatchOgImage(props: {
  params: Promise<{ matchId: string }>;
  // Next 16: id is now a Promise too when generateImageMetadata is used;
  // for a single image (no generateImageMetadata) only `params` is async.
}) {
  const { matchId } = await props.params;
  const supabase = await createClient();

  const { data: match } = await supabase
    .from("matches")
    .select(
      "id, tournament_id, team_a_id, team_b_id, status, current_innings_id, scheduled_at, stage",
    )
    .eq("id", matchId)
    .single();
  if (!match) return fallback("Match not found");

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("name")
    .eq("id", match.tournament_id)
    .single();
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, short_name")
    .in("id", [match.team_a_id, match.team_b_id]);
  const teamA = teams?.find((t) => t.id === match.team_a_id);
  const teamB = teams?.find((t) => t.id === match.team_b_id);

  // Pull innings for scores.
  const { data: innings } = await supabase
    .from("innings")
    .select(
      "innings_number, batting_team_id, total_runs, total_wickets, total_legal_balls",
    )
    .eq("match_id", match.id)
    .order("innings_number", { ascending: true });

  type LineRow = { team: string; line: string };
  const lines: LineRow[] = [];
  for (const i of innings ?? []) {
    const teamShort =
      i.batting_team_id === teamA?.id
        ? teamA?.short_name
        : i.batting_team_id === teamB?.id
          ? teamB?.short_name
          : "?";
    const overs = `${Math.floor(i.total_legal_balls / 6)}.${i.total_legal_balls % 6}`;
    lines.push({
      team: teamShort ?? "?",
      line: `${i.total_runs}/${i.total_wickets} (${overs} ov)`,
    });
  }

  const statusLabel = ((): string => {
    switch (match.status) {
      case "live":
        return "LIVE";
      case "completed":
        return "FINAL";
      case "innings_break":
        return "INNINGS BREAK";
      case "abandoned":
        return "ABANDONED";
      default:
        return match.scheduled_at
          ? new Date(match.scheduled_at).toLocaleString("en-IN", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "SCHEDULED";
    }
  })();

  const teamAShort = teamA?.short_name ?? "?";
  const teamBShort = teamB?.short_name ?? "?";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#0a0a0a",
          color: "#fafafa",
          padding: 64,
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 28, color: "#a1a1aa" }}>
            {tournament?.name ?? "HVC Heroes"} ·{" "}
            {formatEnumLabel(match.stage)}
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: match.status === "live" ? "#ef4444" : "#a1a1aa",
              letterSpacing: 2,
            }}
          >
            {statusLabel}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            flex: 1,
            gap: 24,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 32,
              fontSize: 88,
              fontWeight: 800,
              letterSpacing: -2,
            }}
          >
            <span>{teamAShort}</span>
            <span style={{ fontSize: 44, color: "#71717a" }}>vs</span>
            <span>{teamBShort}</span>
          </div>

          {lines.length > 0 && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                fontSize: 36,
                fontFamily: "monospace",
                color: "#e4e4e7",
              }}
            >
              {lines.map((row) => (
                <div key={row.team} style={{ display: "flex", gap: 24 }}>
                  <span style={{ width: 90, color: "#a1a1aa" }}>{row.team}</span>
                  <span>{row.line}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            color: "#52525b",
            fontSize: 22,
          }}
        >
          <span>HVC Heroes</span>
          {match.status === "live" && (
            <span>follow live updates →</span>
          )}
        </div>
      </div>
    ),
    size,
  );
}

function fallback(text: string) {
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#fafafa",
          fontFamily: "system-ui",
          fontSize: 48,
        }}
      >
        {text}
      </div>
    ),
    size,
  );
}
