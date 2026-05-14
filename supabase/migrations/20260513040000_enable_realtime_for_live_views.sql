-- =====================================================================
-- 2026-05-13 — enable Supabase Realtime for live spectator views
-- ---------------------------------------------------------------------
-- Switching the spectator/scoring auto-refresh from a 2.5s setInterval
-- poll to a WebSocket-driven trigger via Supabase Realtime. The client
-- subscribes to changes on the three tables that materially affect the
-- live view and calls router.refresh() on any event (debounced):
--
--   * matches   — status transitions (live -> innings_break -> completed)
--   * innings   — every ball insert fires the recompute_innings trigger
--                  which UPDATEs the innings row, so subscribing here
--                  catches "score changed" for free
--   * balls     — INSERTs let us pick up scorer activity even before
--                  the trigger has committed
--
-- Cuts idle DB load to ~zero between balls and stays well under the
-- 200-concurrent-connection free-tier limit even at 70 concurrent
-- viewers per match. Idempotent — won't error if these tables are
-- already part of the publication.
--
-- RLS already permits SELECT on these tables for anon/authenticated
-- spectator reads, so no policy changes are needed.
-- =====================================================================

do $$
declare
  t text;
begin
  foreach t in array array['matches', 'innings', 'balls'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
