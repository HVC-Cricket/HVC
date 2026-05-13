-- =====================================================================
-- 2026-05-13 — Multi-scorer concurrency lock on matches
-- ---------------------------------------------------------------------
-- Goal: ensure that only one tournament admin records balls at a time
-- for any given match. Without this, two admins both opening /score
-- and tapping run buttons produces duplicate / out-of-order ball rows
-- and a wrong engine state.
--
-- Model: each match has at most one active scorer. A row holds the
-- claim plus a heartbeat timestamp. The lock auto-expires after 2
-- minutes of no heartbeat, so a closed-tab scenario doesn't strand
-- the match. Another admin can also force-take-over explicitly.
--
-- The check + bump is done from Server Actions in the app (atomically
-- via a conditional UPDATE), so no triggers needed here.
-- =====================================================================

alter table matches
  add column if not exists primary_scorer_id uuid references auth.users(id) on delete set null;

alter table matches
  add column if not exists primary_scorer_heartbeat_at timestamptz;

create index if not exists idx_matches_primary_scorer
  on matches(primary_scorer_id)
  where primary_scorer_id is not null;
