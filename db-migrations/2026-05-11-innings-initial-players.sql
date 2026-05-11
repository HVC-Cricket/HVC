-- =====================================================================
-- 2026-05-11 — Persist the initial striker / non-striker / bowler picks
-- ---------------------------------------------------------------------
-- startMatch / startSecondInnings / startSuperOverInnings take these as
-- input but until now only used them for engine validation. The picks
-- weren't stored anywhere, so the moment the innings row was created
-- and the page revalidated, the Scoreboard had no idea who was at the
-- crease — forcing the scorer to re-pick. Three new nullable FK columns
-- fix that; the state loader falls back to them when no balls have been
-- recorded yet.
--
-- Apply via Supabase Dashboard → SQL Editor or:
--   supabase db query --linked -f db-migrations/2026-05-11-innings-initial-players.sql
--
-- Idempotent — uses ADD COLUMN IF NOT EXISTS.
-- =====================================================================

alter table innings
  add column if not exists initial_striker_id uuid
    references players(id) on delete set null;

alter table innings
  add column if not exists initial_non_striker_id uuid
    references players(id) on delete set null;

alter table innings
  add column if not exists initial_bowler_id uuid
    references players(id) on delete set null;
