/**
 * Cursor-paginate through a Supabase query so the server's PostgREST
 * `max-rows` cap (1000 by default) doesn't silently truncate large
 * tables. `.limit(N)` from the JS client only sets PostgREST's `Range`
 * header, which is bounded by `max-rows` — the server truncates
 * regardless of what the client asks for.
 *
 * Use for any query against a table that can plausibly exceed 1000
 * rows in production (`balls`, `historical_match_batting/bowling`).
 * Stops as soon as a partial page lands, so the cost in the common
 * case (small tournament, ~250 balls) is one round-trip.
 *
 * Caller hands in a function that builds the query for a given
 * `[from, to]` range so we can compose with `.in()`, `.eq()`, joins,
 * `.order()`, etc. without duplicating the query body.
 */
export const SUPABASE_PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data } = await query(from, from + SUPABASE_PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}
