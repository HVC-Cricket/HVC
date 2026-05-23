-- =====================================================================
-- 2026-05-24 — Player-id indexes for hot per-player queries.
--
-- Four tables had composite UNIQUE constraints that include player_id
-- as the second column (e.g. UNIQUE (match_id, player_id)), but no
-- standalone index on player_id. Direct `WHERE player_id = X` queries
-- fell back to Seq Scan because the composite is ordered by the
-- leading column.
--
-- Hot consumers:
--   • match_players.player_id      → /me, /players/[id], /players/[id]/edit
--   • team_players.player_id       → isTeamAdmin auth check, career section
--   • historical_match_batting.player_id   → player career card (S1–S6)
--   • historical_match_bowling.player_id   → player career card (S1–S6)
--
-- Indexes are idempotent (`if not exists`) so this migration is safe
-- to run against an environment that already has them (e.g. prod, if
-- a sibling script applied them CONCURRENTLY first).
-- =====================================================================

create index if not exists idx_match_players_player
  on match_players (player_id);

create index if not exists idx_team_players_player
  on team_players (player_id);

create index if not exists idx_historical_batting_player
  on historical_match_batting (player_id);

create index if not exists idx_historical_bowling_player
  on historical_match_bowling (player_id);
