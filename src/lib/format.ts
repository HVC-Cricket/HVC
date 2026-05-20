/**
 * Shared date / time formatters used across home, tournament list,
 * tournament detail, and match detail pages. Behaviour mirrors the
 * previous inline copies — change here and every page updates.
 *
 * Timezone: HVC matches are scheduled in IST and stored as timestamptz
 * (UTC). Server components run on Vercel where the default locale is
 * UTC, so passing `undefined` to `toLocale*` rendered 14:00 IST as
 * "8:30 AM" while the client-side edit form (using the user's browser
 * locale) showed the correct "2:00 PM". Force IST everywhere so the
 * server output matches the editor input.
 */

const IST = "Asia/Kolkata";

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
    timeZone: IST,
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: IST,
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
    timeZone: IST,
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
      timeZone: IST,
    });
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    // Compare day-of-IST, not UTC. `toDateString()` uses local time;
    // explicit `toLocaleDateString` with the IST timezone keeps the
    // same-day check accurate when the runtime locale is UTC.
    const sIst = s.toLocaleDateString("en-CA", { timeZone: IST });
    const eIst = e.toLocaleDateString("en-CA", { timeZone: IST });
    if (sIst === eIst) return fmt(start);
    const sMonth = s.toLocaleDateString("en-CA", {
      month: "2-digit",
      year: "numeric",
      timeZone: IST,
    });
    const eMonth = e.toLocaleDateString("en-CA", {
      month: "2-digit",
      year: "numeric",
      timeZone: IST,
    });
    if (sMonth === eMonth) {
      const startShort = s.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        timeZone: IST,
      });
      const endDay = e.toLocaleDateString(undefined, {
        day: "numeric",
        timeZone: IST,
      });
      const year = e.toLocaleDateString(undefined, {
        year: "numeric",
        timeZone: IST,
      });
      return `${startShort} – ${endDay}, ${year}`;
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
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: IST })} · ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: IST })}`;
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
