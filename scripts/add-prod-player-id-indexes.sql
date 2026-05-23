-- =====================================================================
-- Apply the four missing player_id indexes to prod.
--
-- All four tables are tiny on prod (1800 / 350 / 1600 / 1450 rows),
-- so a regular CREATE INDEX builds in milliseconds and the brief
-- ACCESS EXCLUSIVE lock is imperceptible to the live scorer. We
-- initially tried CONCURRENTLY but `supabase db query` wraps the
-- file in a transaction and CONCURRENTLY can't run inside one.
-- Switching back to plain CREATE INDEX is fine at this scale; only
-- swap to CONCURRENTLY (and run via the Supabase SQL editor where
-- there's no implicit BEGIN/COMMIT) if any of these tables ever
-- crosses ~100k rows.
--
-- This matches `supabase/migrations/20260524000000_player_id_indexes.sql`
-- and is idempotent.
--
-- To run:
--   pnpm exec supabase db query --linked -f scripts/add-prod-player-id-indexes.sql
-- =====================================================================

create index if not exists idx_match_players_player
  on match_players (player_id);

create index if not exists idx_team_players_player
  on team_players (player_id);

create index if not exists idx_historical_batting_player
  on historical_match_batting (player_id);

create index if not exists idx_historical_bowling_player
  on historical_match_bowling (player_id);
