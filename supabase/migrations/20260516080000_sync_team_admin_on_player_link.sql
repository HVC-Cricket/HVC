-- =====================================================================
-- 2026-05-16 — Sync team admin role when a player gets (re)linked
-- ---------------------------------------------------------------------
-- The 20260516070000 trigger only watches team_players role changes.
-- That missed this flow:
--   1. Add unlinked player X to team T as captain
--      → trigger fires; players.linked_user_id is null → no team_admins
--   2. Later, link X to user U (update players.linked_user_id)
--      → no trigger fires on team_players → U still has no admin access
--
-- This migration adds the missing trigger on players: when
-- linked_user_id changes, re-evaluate every captain / vice-captain
-- team_players row for this player and re-sync team_admins:
--   • old user (if any) loses their auto-grants for this player's
--     captain/vc roles (manual rows untouched)
--   • new user (if any) gains auto-grants for those roles
--
-- The same backfill statement from the previous migration is re-run
-- so the case the user actually hit ("captain set first, linked
-- after") resolves immediately on apply. Idempotent under ON CONFLICT.
-- =====================================================================

create or replace function sync_team_admin_from_player_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Old linked user: drop any auto-grants we gave them for THIS
  -- player's captain/vc roles. Manual rows are untouched.
  if OLD.linked_user_id is not null
     and OLD.linked_user_id is distinct from NEW.linked_user_id then
    delete from team_admins ta
    using team_players tp
    where ta.team_id = tp.team_id
      and ta.user_id = OLD.linked_user_id
      and ta.source = 'role'
      and tp.player_id = OLD.id
      and tp.role in ('captain', 'vice_captain');
  end if;

  -- New linked user: grant for every team where this player holds
  -- captain or vice-captain right now.
  if NEW.linked_user_id is not null
     and NEW.linked_user_id is distinct from OLD.linked_user_id then
    insert into team_admins (team_id, user_id, source)
    select tp.team_id, NEW.linked_user_id, 'role'
    from team_players tp
    where tp.player_id = NEW.id
      and tp.role in ('captain', 'vice_captain')
    on conflict (team_id, user_id) do nothing;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_sync_team_admin_from_player_link on players;
create trigger trg_sync_team_admin_from_player_link
  after update of linked_user_id on players
  for each row
  execute function sync_team_admin_from_player_link();

-- Re-backfill — fixes any row that the previous migration's backfill
-- missed because the player wasn't linked at that time. Idempotent.
insert into team_admins (team_id, user_id, source)
select tp.team_id, pl.linked_user_id, 'role'
from team_players tp
join players pl on pl.id = tp.player_id
where tp.role in ('captain', 'vice_captain')
  and pl.linked_user_id is not null
on conflict (team_id, user_id) do nothing;
