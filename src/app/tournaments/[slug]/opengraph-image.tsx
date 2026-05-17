import { ImageResponse } from "next/og";

import { formatEnumLabel } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const alt = "HVC Heroes — tournament";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

export default async function TournamentOgImage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const supabase = await createClient();

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("name, description, format, start_date, end_date, venue, status")
    .eq("slug", slug)
    .single();
  if (!tournament) return fallback("Tournament not found");

  const fmt = (d: string | null) =>
    d
      ? new Date(d).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : null;
  const start = fmt(tournament.start_date);
  const end = fmt(tournament.end_date);
  const dateLine =
    start && end ? `${start} — ${end}` : start ?? end ?? "Dates TBD";

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0a0a",
          color: "#fafafa",
          padding: 64,
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ fontSize: 28, color: "#a1a1aa", letterSpacing: 4 }}>
          HVC SCORING ·{" "}
          {formatEnumLabel(tournament.format).toUpperCase()}
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 88,
              fontWeight: 800,
              letterSpacing: -2,
              lineHeight: 1.05,
            }}
          >
            {tournament.name}
          </div>
          {tournament.description && (
            <div
              style={{
                fontSize: 28,
                color: "#d4d4d8",
                lineHeight: 1.4,
                maxWidth: 1000,
              }}
            >
              {tournament.description.length > 160
                ? tournament.description.slice(0, 160) + "…"
                : tournament.description}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            color: "#a1a1aa",
            fontSize: 26,
          }}
        >
          <span>{dateLine}</span>
          {tournament.venue && <span>{tournament.venue}</span>}
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
