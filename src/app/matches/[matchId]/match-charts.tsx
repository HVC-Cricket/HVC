import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

const COLOURS = {
  i1: "#3b82f6", // blue-500
  i2: "#f97316", // orange-500
  i3: "#a855f7", // purple-500 (super over 1)
  i4: "#10b981", // emerald-500 (super over 2)
  wicket: "#dc2626", // red-600
  axis: "#94a3b8", // slate-400
  grid: "#e2e8f0", // slate-200
} as const;

type BallRow = {
  innings_id: string;
  over_number: number;
  ball_in_over: number;
  legal_ball_seq: number | null;
  runs_off_bat: number;
  extras: number;
  extra_type: string | null;
  is_wicket: boolean;
  scored_at: string;
};

type InningsRow = {
  id: string;
  innings_number: number;
  batting_team_id: string;
  total_runs: number;
  target: number | null;
};

type Team = {
  id: string;
  name: string;
  short_name: string;
};

type InningsView = {
  inn: InningsRow;
  team: Team | undefined;
  /** Per-over aggregates indexed by over_number (1-based). */
  overs: { over: number; runs: number; wickets: number }[];
  /** Worm points: x = delivery index (0-based), y = cumulative runs. */
  worm: { x: number; y: number }[];
  totalDeliveries: number;
  finalRuns: number;
};

export async function MatchCharts({ matchId }: { matchId: string }) {
  const supabase = await createClient();

  const { data: innings } = await supabase
    .from("innings")
    .select("id, innings_number, batting_team_id, total_runs, target")
    .eq("match_id", matchId)
    .order("innings_number", { ascending: true });
  if (!innings || innings.length === 0) return null;

  const inningsIds = innings.map((i) => i.id);
  const { data: balls } = await supabase
    .from("balls")
    .select(
      "innings_id, over_number, ball_in_over, legal_ball_seq, runs_off_bat, extras, extra_type, is_wicket, scored_at",
    )
    .in("innings_id", inningsIds)
    .eq("is_voided", false)
    .order("scored_at", { ascending: true });
  if (!balls || balls.length === 0) return null;

  const teamIds = Array.from(new Set(innings.map((i) => i.batting_team_id)));
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name, short_name")
    .in("id", teamIds);
  const teamById = new Map((teams ?? []).map((t) => [t.id, t]));

  const views: InningsView[] = innings.map((inn) =>
    buildInningsView(
      inn,
      teamById.get(inn.batting_team_id),
      (balls as BallRow[]).filter((b) => b.innings_id === inn.id),
    ),
  );

  // Determine the maximum over count across innings — used to set a
  // shared x-axis on Manhattan so both panels are visually comparable.
  const maxOver = Math.max(1, ...views.flatMap((v) => v.overs.map((o) => o.over)));
  const maxOverRuns = Math.max(
    1,
    ...views.flatMap((v) => v.overs.map((o) => o.runs)),
  );
  const maxDeliveries = Math.max(1, ...views.map((v) => v.totalDeliveries));
  const maxRunsAcross = Math.max(1, ...views.map((v) => v.finalRuns));

  const inningsColour = (innNum: number) =>
    innNum === 1 ? COLOURS.i1 : innNum === 2 ? COLOURS.i2 : innNum === 3 ? COLOURS.i3 : COLOURS.i4;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manhattan</CardTitle>
          <CardDescription>
            Runs per over. Red dots above the bar mark wickets in that over.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {views.map((v) => (
            <ManhattanPanel
              key={v.inn.id}
              view={v}
              maxOver={maxOver}
              maxRuns={maxOverRuns}
              colour={inningsColour(v.inn.innings_number)}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Worm</CardTitle>
          <CardDescription>
            Cumulative runs per delivery. Each innings is one line — steeper
            slopes mean a faster scoring rate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WormChart
            views={views}
            maxX={maxDeliveries}
            maxY={maxRunsAcross}
            inningsColour={inningsColour}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function buildInningsView(
  inn: InningsRow,
  team: Team | undefined,
  rows: BallRow[],
): InningsView {
  // Per-over aggregates
  const byOver = new Map<number, { over: number; runs: number; wickets: number }>();
  for (const b of rows) {
    const key = b.over_number;
    const cur =
      byOver.get(key) ?? { over: key, runs: 0, wickets: 0 };
    cur.runs += b.runs_off_bat + b.extras;
    if (b.is_wicket) cur.wickets += 1;
    byOver.set(key, cur);
  }
  const overs = Array.from(byOver.values()).sort((a, b) => a.over - b.over);

  // Worm: cumulative runs per delivery (1 step per ball, including extras).
  const worm: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  let runs = 0;
  rows.forEach((b, i) => {
    runs += b.runs_off_bat + b.extras;
    worm.push({ x: i + 1, y: runs });
  });

  return {
    inn,
    team,
    overs,
    worm,
    totalDeliveries: rows.length,
    finalRuns: runs,
  };
}

function ManhattanPanel({
  view,
  maxOver,
  maxRuns,
  colour,
}: {
  view: InningsView;
  maxOver: number;
  maxRuns: number;
  colour: string;
}) {
  // SVG layout
  const width = 600;
  const height = 160;
  const margin = { top: 24, right: 12, bottom: 28, left: 32 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const xStep = plotW / maxOver;
  // Round the y-axis ceiling up to the next multiple of 5 so gridlines are friendly.
  const yMax = Math.max(5, Math.ceil(maxRuns / 5) * 5);
  const yScale = (v: number) => plotH - (v / yMax) * plotH;

  const yTicks = computeTicks(yMax, 4);

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium">
          <span
            className="mr-1.5 inline-block size-2 rounded-full align-middle"
            style={{ backgroundColor: colour }}
          />
          {view.team?.short_name ?? `Innings ${view.inn.innings_number}`} ·{" "}
          <span className="font-mono">{view.finalRuns}</span>
        </span>
        <span className="text-muted-foreground">{view.overs.length} overs</span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        role="img"
        aria-label={`Manhattan chart for ${view.team?.name ?? "innings"}`}
      >
        {/* Y gridlines + tick labels */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={margin.left}
              x2={width - margin.right}
              y1={margin.top + yScale(t)}
              y2={margin.top + yScale(t)}
              stroke={COLOURS.grid}
              strokeDasharray="2 3"
            />
            <text
              x={margin.left - 6}
              y={margin.top + yScale(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="10"
              fill={COLOURS.axis}
            >
              {t}
            </text>
          </g>
        ))}

        {/* Bars */}
        {view.overs.map((o) => {
          const x = margin.left + (o.over - 1) * xStep + xStep * 0.15;
          const w = xStep * 0.7;
          const h = (o.runs / yMax) * plotH;
          const y = margin.top + plotH - h;
          return (
            <g key={o.over}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill={colour}
                opacity="0.85"
                rx="1.5"
              />
              {/* Runs label above each bar */}
              {o.runs > 0 && (
                <text
                  x={x + w / 2}
                  y={y - 3}
                  textAnchor="middle"
                  fontSize="10"
                  fill={colour}
                  fontFamily="ui-monospace, monospace"
                >
                  {o.runs}
                </text>
              )}
              {/* Wicket dots, stacked above the runs label */}
              {Array.from({ length: o.wickets }).map((_, i) => (
                <circle
                  key={i}
                  cx={x + w / 2}
                  cy={Math.max(margin.top - 4, y - 14 - i * 6)}
                  r={3}
                  fill={COLOURS.wicket}
                />
              ))}
            </g>
          );
        })}

        {/* X-axis baseline + over numbers */}
        <line
          x1={margin.left}
          x2={width - margin.right}
          y1={margin.top + plotH}
          y2={margin.top + plotH}
          stroke={COLOURS.axis}
        />
        {Array.from({ length: maxOver }, (_, i) => i + 1).map((o) => (
          <text
            key={o}
            x={margin.left + (o - 1) * xStep + xStep / 2}
            y={margin.top + plotH + 14}
            textAnchor="middle"
            fontSize="10"
            fill={COLOURS.axis}
          >
            {o}
          </text>
        ))}
      </svg>
    </div>
  );
}

function WormChart({
  views,
  maxX,
  maxY,
  inningsColour,
}: {
  views: InningsView[];
  maxX: number;
  maxY: number;
  inningsColour: (innNum: number) => string;
}) {
  const width = 600;
  const height = 220;
  const margin = { top: 16, right: 12, bottom: 28, left: 36 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const yMax = Math.max(10, Math.ceil(maxY / 10) * 10);
  const xMax = Math.max(1, maxX);
  const xScale = (v: number) => (v / xMax) * plotW;
  const yScale = (v: number) => plotH - (v / yMax) * plotH;

  const yTicks = computeTicks(yMax, 5);
  const xTicks = computeTicks(xMax, Math.min(6, xMax));

  // Innings 2 target: horizontal dashed line at i1.totalRuns + 1
  const i1 = views.find((v) => v.inn.innings_number === 1);
  const target = i1 ? i1.finalRuns + 1 : null;

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full"
        role="img"
        aria-label="Worm chart"
      >
        {/* Y gridlines + tick labels */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={margin.left}
              x2={width - margin.right}
              y1={margin.top + yScale(t)}
              y2={margin.top + yScale(t)}
              stroke={COLOURS.grid}
              strokeDasharray="2 3"
            />
            <text
              x={margin.left - 6}
              y={margin.top + yScale(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="10"
              fill={COLOURS.axis}
            >
              {t}
            </text>
          </g>
        ))}

        {/* Target line for the chase */}
        {target !== null && target <= yMax && (
          <g>
            <line
              x1={margin.left}
              x2={width - margin.right}
              y1={margin.top + yScale(target)}
              y2={margin.top + yScale(target)}
              stroke={COLOURS.i2}
              strokeDasharray="4 3"
              opacity="0.6"
            />
            <text
              x={width - margin.right - 4}
              y={margin.top + yScale(target) - 3}
              textAnchor="end"
              fontSize="10"
              fill={COLOURS.i2}
            >
              target {target}
            </text>
          </g>
        )}

        {/* Worm lines */}
        {views.map((v) => {
          if (v.worm.length < 2) return null;
          const colour = inningsColour(v.inn.innings_number);
          const d = v.worm
            .map(
              (p, i) =>
                `${i === 0 ? "M" : "L"} ${margin.left + xScale(p.x)} ${margin.top + yScale(p.y)}`,
            )
            .join(" ");
          return (
            <path
              key={v.inn.id}
              d={d}
              fill="none"
              stroke={colour}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}

        {/* X-axis baseline + delivery ticks */}
        <line
          x1={margin.left}
          x2={width - margin.right}
          y1={margin.top + plotH}
          y2={margin.top + plotH}
          stroke={COLOURS.axis}
        />
        {xTicks.map((t) => (
          <text
            key={t}
            x={margin.left + xScale(t)}
            y={margin.top + plotH + 14}
            textAnchor="middle"
            fontSize="10"
            fill={COLOURS.axis}
          >
            {t}
          </text>
        ))}
        <text
          x={margin.left + plotW / 2}
          y={height - 4}
          textAnchor="middle"
          fontSize="10"
          fill={COLOURS.axis}
        >
          deliveries
        </text>
      </svg>

      <div className="flex flex-wrap gap-3 text-xs">
        {views.map((v) => (
          <span key={v.inn.id} className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: inningsColour(v.inn.innings_number) }}
            />
            <span>
              {v.team?.short_name ?? `Innings ${v.inn.innings_number}`} ·{" "}
              <span className="font-mono">{v.finalRuns}</span>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function computeTicks(max: number, count: number): number[] {
  if (count <= 1) return [0, max];
  const step = max / count;
  // Round step up to a "nice" number (1, 2, 5, 10, 20, 50, ...).
  const niceStep = niceNumber(step);
  const ticks: number[] = [];
  for (let v = 0; v <= max + niceStep / 2; v += niceStep) {
    ticks.push(Math.round(v));
  }
  return ticks;
}

function niceNumber(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const f = n / 10 ** exp;
  const niceF = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return niceF * 10 ** exp;
}
