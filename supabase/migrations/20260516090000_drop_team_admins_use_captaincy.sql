-- =====================================================================
-- 2026-05-16 — Collapse "team admin" into captain / vice-captain
-- ---------------------------------------------------------------------
-- Having a separate `team_admins` table on top of the captain /
-- vice-captain roles on `team_players` proved confusing in practice
-- (two surfaces showing what's effectively the same access).
-- Captains and vice-captains whose player is linked to a user account
-- ARE the team admins — nothing else.
--
-- This migration:
--   1. Drops the role-sync triggers + functions (no shadow table to
--      sync anymore).
--   2. Redefines is_team_admin() to derive from team_players +
--      players.linked_user_id directly. Same function signature so
--      every existing RLS policy on `teams` and `team_players` that
--      called it keeps working — only the implementation changes.
--   3. Drops the team_admins table (cascades its indexes + policies).
--
-- The partial unique indexes on team_players (≤1 captain, ≤1
-- vice-captain) stay in place from migration 20260516070000 — those
-- still apply.
-- =====================================================================

-- 1. Remove the sync triggers + their functions
drop trigger if exists trg_sync_team_admin_from_role on team_players;
drop trigger if exists trg_sync_team_admin_from_player_link on players;
drop function if exists sync_team_admin_from_role();
drop function if exists sync_team_admin_from_player_link();

-- 2. Redefine is_team_admin(): derive from team_players + players
--    (captain / vice-captain whose player is linked to this user).
create or replace function is_team_admin(p_team_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from team_players tp
    join players p on p.id = tp.player_id
    where tp.team_id = p_team_id
      and tp.role in ('captain', 'vice_captain')
      and p.linked_user_id = p_user_id
  );
$$;

-- 3. Drop the table — policies and indexes go with it
drop table if exists team_admins;
