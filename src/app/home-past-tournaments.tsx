import { ArrowRight, Trophy } from "lucide-react";
import Link from "next/link";

import { LogoPhoto } from "@/components/logo-photo";
import { createClient } from "@/lib/supabase/server";

type TournamentCard = {
  id: string;
  slug: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  logo_url: string | null;
  champion: {
    name: string;
    short_name: string;
    logo_url: string | null;
  } | null;
};

/**
 * Past-tournament archive shown on the homepage so the page is never
 * empty even when no match is live. Each tile has the tournament's own
 * logo, dates, and the champion's crest — clicking through opens the
 * tournament page (where the full champion hero card renders).
 *
 * Capped at 3 — long-form drill-down lives at `/tournaments`. The
 * "See all tournaments" link below the grid sends users there.
 */
export async function HomePastTournaments() {
  const supabase = await createClient();

  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("id, slug, name, start_date, end_date, logo_url")
    .eq("status", "completed")
    .order("end_date", { ascending: false, nullsFirst: false })
    .limit(3);

  if (!tournaments || tournaments.length === 0) return null;

  // Find each tournament's final winner in one batched query.
  const tIds = tournaments.map((t) => t.id);
  const { data: finals } = await supabase
    .from("matches")
    .select(
      "tournament_id, winner:teams!matches_winner_id_fkey(name, short_name, logo_url)",
    )
    .in("tournament_id", tIds)
    .eq("stage", "final")
    .eq("status", "completed")
    .not("winner_id", "is", null);

  type FinalRow = {
    tournament_id: string;
    winner: { name: string; short_name: string; logo_url: string | null } | null;
  };
  const winnerByTournament = new Map<
    string,
    TournamentCard["champion"]
  >();
  for (const r of (finals ?? []) as unknown as FinalRow[]) {
    if (r.winner) winnerByTournament.set(r.tournament_id, r.winner);
  }

  const cards: TournamentCard[] = tournaments.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    start_date: t.start_date,
    end_date: t.end_date,
    logo_url: t.logo_url,
    champion: winnerByTournament.get(t.id) ?? null,
  }));

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Trophy className="size-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wide">
          Past tournaments
        </h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((t) => (
          <Link
            key={t.id}
            href={`/tournaments/${t.slug}`}
            prefetch
            className="group flex items-start gap-3 rounded-xl border border-foreground/10 bg-background p-3 transition hover:border-primary/30 hover:bg-primary/5"
          >
            <LogoPhoto
              imageUrl={t.logo_url}
              name={t.name}
              fallback={<Trophy className="size-5" />}
              className="size-11 shrink-0 border border-foreground/10 bg-muted text-muted-foreground"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="truncate text-sm font-semibold capitalize">
                {t.name}
              </div>
              {(t.start_date || t.end_date) && (
                <div className="text-[11px] text-muted-foreground">
                  {formatDates(t.start_date, t.end_date)}
                </div>
              )}
              {t.champion && (
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                  <Trophy className="size-3 shrink-0 text-amber-500" />
                  {t.champion.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.champion.logo_url}
                      alt=""
                      className="size-4 shrink-0 rounded-full border border-foreground/10 object-cover"
                    />
                  ) : null}
                  <span className="truncate capitalize text-foreground">
                    {t.champion.name.replace(/^team\s+/i, "")}
                  </span>
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
      <Link
        href="/tournaments"
        prefetch
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
      >
        See all tournaments
        <ArrowRight className="size-3.5" />
      </Link>
    </section>
  );
}

function formatDates(
  start: string | null,
  end: string | null,
): string {
  if (!start && !end) return "";
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  };
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    // Year check must be done in IST too — Dec-31 23:00 IST is still
    // Dec-31, not Jan-1, even when the UTC component reads as the
    // next year.
    const yearOf = (d: Date) =>
      d.toLocaleDateString("en-CA", {
        year: "numeric",
        timeZone: "Asia/Kolkata",
      });
    if (yearOf(s) === yearOf(e)) {
      return `${s.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "Asia/Kolkata" })} – ${e.toLocaleDateString(undefined, opts)}`;
    }
    return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
  }
  return new Date(start ?? end!).toLocaleDateString(undefined, opts);
}
