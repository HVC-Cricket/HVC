-- =====================================================================
-- 2026-05-16 — Two-way sync: profiles.display_name ↔ players.display_name
-- ---------------------------------------------------------------------
-- Same pattern as 20260516040000_sync_avatar_photo.sql but for the
-- display name. Once a user has both a profile and a linked player,
-- their public name should be consistent across /me, /players/[id],
-- match scorecards, leaderboards, everywhere.
--
-- Backfill: where both sides are set but differ, profile wins (auth
-- identity is canonical). Empty-side cases get copied across. The
-- ongoing triggers then keep the two in lockstep.
-- =====================================================================

-- ---------------------------------------------------------------------
-- player.display_name → profile.display_name
-- ---------------------------------------------------------------------
create or replace function sync_profile_display_name_from_player()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.linked_user_id is not null
     and NEW.display_name is distinct from OLD.display_name
     and NEW.display_name is not null
     and NEW.display_name <> ''
  then
    update profiles
    set display_name = NEW.display_name
    where id = NEW.linked_user_id
      and display_name is distinct from NEW.display_name;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_profile_display_name_from_player on players;
create trigger trg_sync_profile_display_name_from_player
  after update of display_name on players
  for each row
  execute function sync_profile_display_name_from_player();

-- ---------------------------------------------------------------------
-- profile.display_name → player.display_name
-- ---------------------------------------------------------------------
create or replace function sync_player_display_name_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.display_name is distinct from OLD.display_name
     and NEW.display_name is not null
     and NEW.display_name <> ''
  then
    update players
    set display_name = NEW.display_name
    where linked_user_id = NEW.id
      and display_name is distinct from NEW.display_name;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_player_display_name_from_profile on profiles;
create trigger trg_sync_player_display_name_from_profile
  after update of display_name on profiles
  for each row
  execute function sync_player_display_name_from_profile();

-- ---------------------------------------------------------------------
-- Backfill existing rows.
-- ---------------------------------------------------------------------
-- 1. Empty profile name + linked player has a name → copy player→profile.
update profiles p
set display_name = pl.display_name
from players pl
where pl.linked_user_id = p.id
  and pl.display_name is not null
  and pl.display_name <> ''
  and (p.display_name is null or p.display_name = '');

-- 2. Empty player name + linked profile has a name → copy profile→player.
update players pl
set display_name = p.display_name
from profiles p
where pl.linked_user_id = p.id
  and p.display_name is not null
  and p.display_name <> ''
  and (pl.display_name is null or pl.display_name = '');

-- 3. Both set but different → profile wins. Auth identity is canonical;
--    the user can rename either side later and the triggers sync the
--    other side automatically.
update players pl
set display_name = p.display_name
from profiles p
where pl.linked_user_id = p.id
  and p.display_name is not null
  and p.display_name <> ''
  and pl.display_name is not null
  and pl.display_name <> ''
  and pl.display_name is distinct from p.display_name;
