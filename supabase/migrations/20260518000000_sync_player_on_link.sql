-- =====================================================================
-- 2026-05-18 — Sync player.display_name + photo_url when linked_user_id
--              is set (or changed). Fills the gap that the existing
--              update-time triggers left open.
-- ---------------------------------------------------------------------
-- The two earlier triggers (20260516040000 + 20260516050000) keep
-- profile ↔ player in sync ONLY when display_name / photo_url is
-- the column being updated. The link event itself (linked_user_id
-- changing from NULL → user, or changing to a different user) was
-- never wired up. So if a user signs up, updates their profile
-- name, AND THEN gets linked to a player, the name change happens
-- before the link exists — the trigger's `where linked_user_id =
-- NEW.id` matches nothing, no sync — and the subsequent linking
-- action doesn't touch display_name, so no further trigger fires.
-- Result: linked, but names stay out of sync forever.
--
-- Bharath Foundry hit this on prod (player display_name still
-- showed "Bharath Foundry" while his profile read "BHARATH G S
-- AGASTHYA "). This migration adds a BEFORE-trigger on
-- players.linked_user_id (UPDATE) and on INSERT, so any time a
-- player gets newly linked, the profile's name + avatar are pulled
-- into the player row in the same statement — no second UPDATE
-- needed, no recursion risk.
--
-- Backfill block at the end fixes existing mismatches (profile
-- wins, mirroring the convention from the earlier migrations).
-- =====================================================================

-- ---------------------------------------------------------------------
-- BEFORE UPDATE OF linked_user_id — fires on (re-)linking.
-- ---------------------------------------------------------------------
create or replace function sync_player_from_profile_on_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
begin
  -- Unlink (NEW = null) or no-op (same as OLD) — nothing to pull.
  if NEW.linked_user_id is null then
    return NEW;
  end if;
  if NEW.linked_user_id is not distinct from OLD.linked_user_id then
    return NEW;
  end if;

  select display_name, avatar_url
    into p
    from profiles
    where id = NEW.linked_user_id;

  if p.display_name is not null and p.display_name <> '' then
    NEW.display_name := p.display_name;
  end if;
  if p.avatar_url is not null then
    NEW.photo_url := p.avatar_url;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_sync_player_from_profile_on_link on players;
create trigger trg_sync_player_from_profile_on_link
  before update of linked_user_id on players
  for each row
  execute function sync_player_from_profile_on_link();

-- ---------------------------------------------------------------------
-- BEFORE INSERT — covers the case where a player is created
-- already-linked (e.g., bulk import that maps to existing users).
-- ---------------------------------------------------------------------
create or replace function sync_player_from_profile_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
begin
  if NEW.linked_user_id is null then
    return NEW;
  end if;

  select display_name, avatar_url
    into p
    from profiles
    where id = NEW.linked_user_id;

  if p.display_name is not null and p.display_name <> '' then
    NEW.display_name := p.display_name;
  end if;
  if p.avatar_url is not null then
    NEW.photo_url := p.avatar_url;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_sync_player_from_profile_on_insert on players;
create trigger trg_sync_player_from_profile_on_insert
  before insert on players
  for each row
  execute function sync_player_from_profile_on_insert();

-- ---------------------------------------------------------------------
-- Backfill — fix every already-linked player whose name or avatar
-- doesn't match its profile. Profile wins (same convention as the
-- earlier sync migrations).
-- ---------------------------------------------------------------------
update players pl
set display_name = coalesce(
      nullif(p.display_name, ''),
      pl.display_name
    ),
    photo_url = coalesce(p.avatar_url, pl.photo_url)
from profiles p
where pl.linked_user_id = p.id
  and (
    (
      p.display_name is not null
      and p.display_name <> ''
      and pl.display_name is distinct from p.display_name
    )
    or (
      p.avatar_url is not null
      and pl.photo_url is distinct from p.avatar_url
    )
  );
