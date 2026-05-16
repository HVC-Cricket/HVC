-- =====================================================================
-- 2026-05-16 — Two-way sync: profiles.avatar_url ↔ players.photo_url
-- ---------------------------------------------------------------------
-- A user who plays box-cricket has both a `profiles` row (auth user
-- metadata) and a `players` row (cricket record) linked via
-- `players.linked_user_id`. Photos live on both sides today
-- (profiles.avatar_url for the /me header, players.photo_url for the
-- /players/[id] header and roster grids). Uploading via one form
-- didn't reflect on the other, so a user who set their player photo
-- saw a generic avatar everywhere /me / the sign-in chrome reads.
--
-- Two AFTER UPDATE triggers mirror writes across the pair. The
-- `is distinct from` guards on both sides keep the cross-propagation
-- from recursing — the second update is a no-op (row already has the
-- target value).
--
-- Also runs a one-shot UPDATE to backfill the existing mismatched
-- rows (priority: player.photo_url wins where it's set and the
-- profile is empty).
-- =====================================================================

-- ---------------------------------------------------------------------
-- player → profile
-- ---------------------------------------------------------------------
create or replace function sync_profile_avatar_from_player()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.linked_user_id is not null
     and NEW.photo_url is distinct from OLD.photo_url
  then
    update profiles
    set avatar_url = NEW.photo_url
    where id = NEW.linked_user_id
      and avatar_url is distinct from NEW.photo_url;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_profile_avatar_from_player on players;
create trigger trg_sync_profile_avatar_from_player
  after update of photo_url on players
  for each row
  execute function sync_profile_avatar_from_player();

-- ---------------------------------------------------------------------
-- profile → player
-- ---------------------------------------------------------------------
create or replace function sync_player_photo_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.avatar_url is distinct from OLD.avatar_url then
    update players
    set photo_url = NEW.avatar_url
    where linked_user_id = NEW.id
      and photo_url is distinct from NEW.avatar_url;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_sync_player_photo_from_profile on profiles;
create trigger trg_sync_player_photo_from_profile
  after update of avatar_url on profiles
  for each row
  execute function sync_player_photo_from_profile();

-- ---------------------------------------------------------------------
-- Backfill existing mismatches (one-shot — idempotent under
-- "is distinct from" guards).
-- ---------------------------------------------------------------------
-- 1. Player has a photo, profile is empty → copy to profile.
update profiles p
set avatar_url = pl.photo_url
from players pl
where pl.linked_user_id = p.id
  and pl.photo_url is not null
  and p.avatar_url is null;

-- 2. Profile has an avatar, linked player is empty → copy to player.
update players pl
set photo_url = p.avatar_url
from profiles p
where pl.linked_user_id = p.id
  and p.avatar_url is not null
  and pl.photo_url is null;
