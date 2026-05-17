/**
 * Shared date / time formatters used across home, tournament list,
 * tournament detail, and match detail pages. Behaviour mirrors the
 * previous inline copies — change here and every page updates.
 */

/**
 * "Wed, 17 May 2026 · 4:30 PM" — used on the match detail card and
 * fixture preview. Null input renders as "TBD".
 */
export function formatScheduledAt(iso: string | null): string {
  if (!iso) return "TBD";
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

/**
 * "in 5 min" / "in 3h" / "Wed 4:30 PM" — used on the home page's
 * upcoming-match rows; window is dynamic, so the format shifts as the
 * fixture gets closer.
 */
export function formatUpcomingTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `in ${diffMin} min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `in ${diffHr}h`;
  return d.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * "17 May 2026" / "17 – 20 May, 2026" / "17 May – 3 Jun, 2026" — used
 * on the tournament list + tournament detail headers.
 */
export function formatDateRange(
  start: string | null,
  end: string | null,
): string {
  if (!start && !end) return "TBD";
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    if (s.toDateString() === e.toDateString()) return fmt(start);
    const sameMonth =
      s.getFullYear() === e.getFullYear() && s.getMonth() === e.getMonth();
    if (sameMonth) {
      return `${s.toLocaleDateString(undefined, { day: "numeric", month: "short" })} – ${e.getDate()}, ${e.getFullYear()}`;
    }
    return `${fmt(start)} – ${fmt(end)}`;
  }
  return `${start ? fmt(start) : "TBD"} – ${end ? fmt(end) : "TBD"}`;
}

/**
 * "17 May · 4:30 PM" — short fixture timestamp used in the tournament
 * detail's matches list (vertical row layout).
 */
export function formatMatchTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/**
 * "Caught And Bowled" — used wherever a snake_case enum value renders
 * as a human-readable label. Pure substitution; doesn't title-case
 * each word (callers that need that pair this with a `capitalize`
 * Tailwind class).
 */
export function formatEnumLabel(value: string): string {
  return value.replace(/_/g, " ");
}
