import { ImageResponse } from "next/og";

import { computeBowlerStats } from "@/lib/scoring/stats";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const WIDTH = 1200;
const HEIGHT = 630;

// Cricket-blue palette tuned to match the app's --primary token. The
// satori subset can't read CSS variables, so the OKLCH values from
// globals.css are converted to fixed hex/rgba here.
const BG_DEEP = "#0b1730";
const BG_MID = "#13244a";
const BG = `linear-gradient(135deg, ${BG_DEEP} 0%, ${BG_MID} 55%, ${BG_DEEP} 100%)`;

const BLUE = "#3b82f6";
const BLUE_DEEP = "#1e4fa3";
const BLUE_SOFT = "rgba(59, 130, 246, 0.15)";
const BLUE_LINE = "rgba(59, 130, 246, 0.45)";

const GOLD = "#f5c451";
const GOLD_SOFT = "rgba(245, 196, 81, 0.16)";
const GOLD_LINE = "rgba(245, 196, 81, 0.55)";

const TEXT = "#f1f5f9";
const MUTED = "#94a3b8";
const SURFACE = "rgba(255,255,255,0.04)";
const SURFACE_LINE = "rgba(255,255,255,0.10)";

type MatchRow = {
  id: string;
  match_number: number;
  overs_per_innings: number;
  result_type: string | null;
  winner_id: string | null;
  win_margin: string | null;
  team_a: { id: string; name: string; short_name: string } | null;
  team_b: { id: string; name: string; short_name: string } | null;
  tournament: { name: string } | null;
  innings: Array<{
    id: string;
    innings_number: number;
    batting_team_id: string;
    total_runs: number;
    total_wickets: number;
    total_legal_balls: number;
  }>;
};

type BallRow = {
  batter_id: string;
  bowler_id: string;
  runs_off_bat: number;
  extras: number;
  extra_type:
    | "wide"
    | "no_ball"
    | "bye"
    | "leg_bye"
    | "penalty"
    | null;
  is_wicket: boolean;
  wicket_type: string | null;
  over_number: number;
};

function oversFromBalls(b: number): string {
  return `${Math.floor(b / 6)}.${b % 6}`;
}

function errorImage(message: string, status = 404) {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          background: BG,
          color: TEXT,
          fontSize: 42,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {message}
      </div>
    ),
    { width: WIDTH, height: HEIGHT, status },
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await params;
  const supabase = createAdminClient();

  // The matches table has two FKs touching `innings`:
  //   1. innings.match_id → matches.id  (the "innings of this match")
  //   2. matches.current_innings_id → innings.id  (the live cursor)
  // PostgREST refuses to embed without an explicit hint, so we name
  // the FK we actually want.
  const { data: rawMatch, error: matchErr } = await supabase
    .from("matches")
    .select(
      `
      id, match_number, overs_per_innings, result_type, winner_id, win_margin,
      team_a:teams!matches_team_a_id_fkey(id, name, short_name),
      team_b:teams!matches_team_b_id_fkey(id, name, short_name),
      tournament:tournaments(name),
      innings!innings_match_id_fkey(id, innings_number, batting_team_id, total_runs, total_wickets, total_legal_balls)
      `,
    )
    .eq("id", matchId)
    .maybeSingle();

  if (matchErr) {
    console.error("[og/match] embed query failed", matchErr);
    return errorImage("Failed to load match", 500);
  }
  if (!rawMatch) {
    return errorImage("Match not found");
  }
  // PostgREST sometimes returns embed-by-FK as a single object and
  // sometimes as a 1-element array depending on schema detection.
  // Normalize so the renderer can rely on plain objects.
  type Raw = Omit<MatchRow, "team_a" | "team_b" | "tournament"> & {
    team_a:
      | { id: string; name: string; short_name: string }
      | Array<{ id: string; name: string; short_name: string }>
      | null;
    team_b:
      | { id: string; name: string; short_name: string }
      | Array<{ id: string; name: string; short_name: string }>
      | null;
    tournament: { name: string } | Array<{ name: string }> | null;
  };
  const raw = rawMatch as unknown as Raw;
  const oneOf = <T,>(v: T | T[] | null): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : v;
  const match: MatchRow = {
    ...raw,
    team_a: oneOf(raw.team_a),
    team_b: oneOf(raw.team_b),
    tournament: oneOf(raw.tournament),
  };

  if (!match.team_a || !match.team_b || !match.tournament) {
    console.error("[og/match] embed missing", {
      id: matchId,
      team_a: !!match.team_a,
      team_b: !!match.team_b,
      tournament: !!match.tournament,
      raw_team_a: raw.team_a,
      raw_tournament: raw.tournament,
    });
    return errorImage("Match not found");
  }

  const inningsIds = match.innings.map((i) => i.id);
  const ballsRes = inningsIds.length
    ? await supabase
        .from("balls")
        .select(
          "batter_id, bowler_id, runs_off_bat, extras, extra_type, is_wicket, wicket_type, over_number",
        )
        .in("innings_id", inningsIds)
        .eq("is_voided", false)
    : { data: [] as BallRow[] };
  const balls = (ballsRes.data ?? []) as BallRow[];

  // Per-batter aggregates — mirror computeBatterStats inline so we
  // only walk the array once across every batter.
  const batters = new Map<
    string,
    { runs: number; balls_faced: number; fours: number; sixes: number }
  >();
  let total4 = 0;
  let total6 = 0;
  let totalWkts = 0;
  for (const b of balls) {
    const cur = batters.get(b.batter_id) ?? {
      runs: 0,
      balls_faced: 0,
      fours: 0,
      sixes: 0,
    };
    cur.runs += b.runs_off_bat;
    if (b.extra_type !== "wide") cur.balls_faced += 1;
    if (b.runs_off_bat === 4) {
      cur.fours += 1;
      total4 += 1;
    }
    if (b.runs_off_bat === 6) {
      cur.sixes += 1;
      total6 += 1;
    }
    if (b.is_wicket) totalWkts += 1;
    batters.set(b.batter_id, cur);
  }
  const topBatter = [...batters.entries()].sort(
    (a, b) => b[1].runs - a[1].runs,
  )[0];

  // Per-bowler aggregates via the shared scoring lib so the
  // wicket-credit rules stay in one place (run_outs don't count, etc.).
  const bowlerIds = [...new Set(balls.map((b) => b.bowler_id))];
  const bowlerStats = bowlerIds.map((id) => ({
    id,
    stats: computeBowlerStats(balls, id),
  }));
  const topBowler = bowlerStats.sort((a, b) => {
    if (b.stats.wickets !== a.stats.wickets) {
      return b.stats.wickets - a.stats.wickets;
    }
    return a.stats.runs_conceded - b.stats.runs_conceded;
  })[0];

  // Resolve player display names for the two highlighted performers.
  const highlightIds = [topBatter?.[0], topBowler?.id].filter(
    (v): v is string => typeof v === "string",
  );
  const nameById = new Map<string, string>();
  if (highlightIds.length) {
    const { data: ps } = await supabase
      .from("players")
      .select("id, display_name")
      .in("id", highlightIds);
    for (const p of ps ?? []) nameById.set(p.id, p.display_name);
  }

  const teamAInn = match.innings.find(
    (i) => i.batting_team_id === match.team_a!.id,
  );
  const teamBInn = match.innings.find(
    (i) => i.batting_team_id === match.team_b!.id,
  );

  const isAWinner = match.winner_id === match.team_a.id;
  const isBWinner = match.winner_id === match.team_b.id;
  const winnerShort = isAWinner
    ? match.team_a.short_name
    : isBWinner
      ? match.team_b.short_name
      : null;
  const resultLine =
    winnerShort && match.win_margin
      ? `${winnerShort} won by ${match.win_margin}`
      : match.result_type === "tie"
        ? "Match tied"
        : match.result_type === "no_result"
          ? "No result"
          : "Result pending";
  const hasWinner = Boolean(winnerShort);

  const hasStats = balls.length > 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BG,
          color: TEXT,
          fontFamily: "system-ui, sans-serif",
          position: "relative",
        }}
      >
        {/* Soft radial glow — gives the canvas some depth instead of a flat gradient. */}
        <div
          style={{
            position: "absolute",
            top: -260,
            left: -180,
            width: 720,
            height: 720,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(59,130,246,0.25) 0%, rgba(59,130,246,0) 70%)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -300,
            right: -200,
            width: 720,
            height: 720,
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(245,196,81,0.18) 0%, rgba(245,196,81,0) 70%)",
            display: "flex",
          }}
        />
        {/* Thin accent rule along the top edge. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 4,
            background: `linear-gradient(90deg, ${BLUE_DEEP} 0%, ${BLUE} 50%, ${GOLD} 100%)`,
            display: "flex",
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            padding: "32px 44px 32px 44px",
            position: "relative",
          }}
        >
          {/* HEADER */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span
                style={{
                  fontSize: 13,
                  color: BLUE,
                  textTransform: "uppercase",
                  letterSpacing: 4,
                  fontWeight: 700,
                }}
              >
                Match Highlight
              </span>
              <span
                style={{
                  fontSize: 26,
                  color: TEXT,
                  marginTop: 2,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                }}
              >
                {match.tournament.name}
              </span>
              <span
                style={{
                  fontSize: 14,
                  color: MUTED,
                  marginTop: 2,
                  letterSpacing: 1,
                }}
              >
                Match {match.match_number} · {match.overs_per_innings} overs a side
              </span>
            </div>

            {/* HVC monogram badge */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 56,
                  height: 56,
                  borderRadius: 12,
                  background: BLUE_DEEP,
                  border: `1px solid ${BLUE_LINE}`,
                  fontSize: 22,
                  fontWeight: 800,
                  color: TEXT,
                  letterSpacing: -1,
                }}
              >
                HVC
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: TEXT,
                    letterSpacing: 1,
                  }}
                >
                  HEROES
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: MUTED,
                    textTransform: "uppercase",
                    letterSpacing: 2,
                    marginTop: 1,
                  }}
                >
                  Box Cricket
                </span>
              </div>
            </div>
          </div>

          {/* SCORES */}
          <div
            style={{
              display: "flex",
              alignItems: "stretch",
              justifyContent: "center",
              gap: 22,
              marginTop: 24,
            }}
          >
            <TeamBlock
              shortName={match.team_a.short_name}
              fullName={match.team_a.name}
              innings={teamAInn}
              isWinner={isAWinner}
            />

            {/* Center "vs" pip */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                width: 80,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 56,
                  height: 56,
                  borderRadius: "50%",
                  background: SURFACE,
                  border: `1px solid ${SURFACE_LINE}`,
                  fontSize: 18,
                  fontWeight: 800,
                  color: MUTED,
                  letterSpacing: 1,
                }}
              >
                vs
              </div>
            </div>

            <TeamBlock
              shortName={match.team_b.short_name}
              fullName={match.team_b.name}
              innings={teamBInn}
              isWinner={isBWinner}
            />
          </div>

          {/* RESULT */}
          <div
            style={{
              display: "flex",
              alignSelf: "center",
              alignItems: "center",
              gap: 12,
              padding: "10px 24px",
              background: hasWinner ? GOLD_SOFT : SURFACE,
              border: `1px solid ${hasWinner ? GOLD_LINE : SURFACE_LINE}`,
              borderRadius: 999,
              marginTop: 18,
            }}
          >
            {hasWinner && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: GOLD,
                  color: BG_DEEP,
                  fontSize: 13,
                  fontWeight: 900,
                }}
              >
                ★
              </div>
            )}
            <span
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: hasWinner ? GOLD : TEXT,
                letterSpacing: 0.5,
              }}
            >
              {resultLine}
            </span>
          </div>

          {/* STAT STRIP */}
          {hasStats && (
            <div
              style={{
                display: "flex",
                gap: 14,
                marginTop: "auto",
              }}
            >
              {topBatter && (
                <StatCard
                  label="Top Batter"
                  title={nameById.get(topBatter[0]) ?? "Unknown"}
                  value={`${topBatter[1].runs} (${topBatter[1].balls_faced})`}
                  sub={`${topBatter[1].fours}×4 · ${topBatter[1].sixes}×6`}
                  accent={BLUE}
                />
              )}
              {topBowler && (
                <StatCard
                  label="Top Bowler"
                  title={nameById.get(topBowler.id) ?? "Unknown"}
                  value={`${topBowler.stats.wickets}/${topBowler.stats.runs_conceded}`}
                  sub={`${oversFromBalls(topBowler.stats.legal_balls)} ov · ${topBowler.stats.dots} dots`}
                  accent={BLUE}
                />
              )}
              <StatCard
                label="Match Pulse"
                title={`${total4 + total6} boundaries`}
                value={`${total4}×4 · ${total6}×6`}
                sub={`${totalWkts} wickets fell`}
                accent={GOLD}
              />
            </div>
          )}
          {!hasStats && (
            <div
              style={{
                display: "flex",
                marginTop: "auto",
                padding: 14,
                borderRadius: 12,
                background: SURFACE,
                border: `1px solid ${SURFACE_LINE}`,
              }}
            >
              <span style={{ fontSize: 16, color: MUTED }}>
                Ball-by-ball stats not available for this match.
              </span>
            </div>
          )}
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      headers: {
        "cache-control": "public, max-age=120, s-maxage=120",
      },
    },
  );
}

function TeamBlock({
  shortName,
  fullName,
  innings,
  isWinner,
}: {
  shortName: string;
  fullName: string;
  innings: MatchRow["innings"][number] | undefined;
  isWinner: boolean;
}) {
  const scoreLine = innings
    ? `${innings.total_runs}/${innings.total_wickets}`
    : "—";
  const oversLine = innings
    ? `${oversFromBalls(innings.total_legal_balls)} ov`
    : "";
  const borderColor = isWinner ? GOLD_LINE : SURFACE_LINE;
  const bg = isWinner
    ? `linear-gradient(155deg, ${GOLD_SOFT} 0%, rgba(245,196,81,0.04) 100%)`
    : `linear-gradient(155deg, ${BLUE_SOFT} 0%, rgba(59,130,246,0.02) 100%)`;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "18px 26px",
        minWidth: 360,
        borderRadius: 18,
        background: bg,
        border: `1.5px solid ${borderColor}`,
        position: "relative",
      }}
    >
      {isWinner && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            position: "absolute",
            top: -12,
            padding: "3px 12px",
            background: GOLD,
            color: BG_DEEP,
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 2,
            borderRadius: 999,
            textTransform: "uppercase",
          }}
        >
          Winner
        </div>
      )}
      <span
        style={{
          fontSize: 44,
          fontWeight: 800,
          color: isWinner ? GOLD : TEXT,
          letterSpacing: 3,
          textTransform: "uppercase",
        }}
      >
        {shortName}
      </span>
      <span
        style={{
          fontSize: 12,
          color: MUTED,
          textTransform: "uppercase",
          letterSpacing: 2,
          marginTop: -2,
        }}
      >
        {fullName}
      </span>
      <span
        style={{
          fontSize: 64,
          fontWeight: 900,
          color: TEXT,
          marginTop: 6,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: -1,
        }}
      >
        {scoreLine}
      </span>
      {oversLine && (
        <span
          style={{
            fontSize: 14,
            color: MUTED,
            marginTop: 0,
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          {oversLine}
        </span>
      )}
    </div>
  );
}

function StatCard({
  label,
  title,
  value,
  sub,
  accent,
}: {
  label: string;
  title: string;
  value: string;
  sub: string;
  accent: string;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        padding: "14px 18px",
        borderRadius: 14,
        background: SURFACE,
        border: `1px solid ${SURFACE_LINE}`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Left accent bar */}
      <div
        style={{
          position: "absolute",
          top: 14,
          bottom: 14,
          left: 0,
          width: 3,
          background: accent,
          borderRadius: 999,
          display: "flex",
        }}
      />
      <span
        style={{
          fontSize: 11,
          color: accent,
          textTransform: "uppercase",
          letterSpacing: 2,
          fontWeight: 700,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: TEXT,
          marginTop: 4,
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontSize: 26,
          fontWeight: 800,
          color: TEXT,
          marginTop: 2,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: -0.5,
        }}
      >
        {value}
      </span>
      <span style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>{sub}</span>
    </div>
  );
}
