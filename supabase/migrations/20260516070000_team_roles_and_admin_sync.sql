-- =====================================================================
-- 2026-05-16 — Team captain / vice-captain enforcement + auto admin
-- ---------------------------------------------------------------------
-- Three things:
--
-- 1. At most ONE captain and ONE vice-captain per team. Enforced via
--    partial unique indexes on team_players (team_id) where role is
--    one of those.
--
-- 2. Captain + vice-captain (when the player is linked to a user)
--    automatically become team admins. Implemented as an
--    AFTER INSERT/UPDATE/DELETE trigger on team_players.
--
-- 3. The auto-derived team_admins rows are tagged with source='role'
--    so the cleanup path knows which ones to remove on demotion.
--    Manually-assigned rows (source='manual') survive role changes —
--    organizers can still hand-pick admins outside the captaincy.
--
-- "Mandatory captain/vc on every team" itself is a UI rule (banner on
-- the team page + match-XI gates) rather than a DB constraint, because
-- teams legitimately go through transient empty-roster states during
-- setup.
-- =====================================================================

-- 1. At-most-one captain / vice-captain per team
create unique index if not exists ux_team_players_one_captain
  on team_players (team_id) where role = 'captain';
create unique index if not exists ux_team_players_one_vice_captain
  on team_players (team_id) where role = 'vice_captain';

-- 2. team_admins.source: 'manual' (default) or 'role' (auto via captain/vc)
alter table team_admins
  add column if not exists source text not null default 'manual';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'team_admins_source_check'
  ) then
    alter table team_admins
      add constraint team_admins_source_check
      check (source in ('manual', 'role'));
  end if;
end $$;

-- 3. Sync trigger — when a team_players row gains/loses the
--    captain or vice_captain role, mirror that into team_admins for
--    the linked auth user (if any).
create or replace function sync_team_admin_from_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id      uuid;
  v_old_user_id  uuid;
begin
  if TG_OP = 'INSERT' then
    if NEW.role in ('captain', 'vice_captain') then
      select linked_user_id into v_user_id from players where id = NEW.player_id;
      if v_user_id is not null then
        insert into team_admins (team_id, user_id, source)
        values (NEW.team_id, v_user_id, 'role')
        on conflict (team_id, user_id) do nothing;
      end if;
    end if;
    return NEW;
  elsif TG_OP = 'UPDATE' then
    -- Demoted out of captaincy → drop the auto-grant (manual stays).
    if OLD.role in ('captain', 'vice_captain')
       and NEW.role not in ('captain', 'vice_captain') then
      select linked_user_id into v_old_user_id from players where id = OLD.player_id;
      if v_old_user_id is not null then
        delete from team_admins
        where team_id = OLD.team_id
          and user_id = v_old_user_id
          and source = 'role';
      end if;
    end if;
    -- Promoted into (or staying in) captaincy → ensure the row exists.
    if NEW.role in ('captain', 'vice_captain') then
      select linked_user_id into v_user_id from players where id = NEW.player_id;
      if v_user_id is not null then
        insert into team_admins (team_id, user_id, source)
        values (NEW.team_id, v_user_id, 'role')
        on conflict (team_id, user_id) do nothing;
      end if;
    end if;
    return NEW;
  elsif TG_OP = 'DELETE' then
    if OLD.role in ('captain', 'vice_captain') then
      select linked_user_id into v_old_user_id from players where id = OLD.player_id;
      if v_old_user_id is not null then
        delete from team_admins
        where team_id = OLD.team_id
          and user_id = v_old_user_id
          and source = 'role';
      end if;
    end if;
    return OLD;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sync_team_admin_from_role on team_players;
create trigger trg_sync_team_admin_from_role
  after insert or update or delete on team_players
  for each row
  execute function sync_team_admin_from_role();

-- 4. Backfill existing data — any captain/vc whose player is linked
--    to a user but doesn't have a corresponding team_admins row yet.
insert into team_admins (team_id, user_id, source)
select tp.team_id, pl.linked_user_id, 'role'
from team_players tp
join players pl on pl.id = tp.player_id
where tp.role in ('captain', 'vice_captain')
  and pl.linked_user_id is not null
on conflict (team_id, user_id) do nothing;
