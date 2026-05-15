-- =====================================================================
-- 2026-05-15 — `user-avatars` storage bucket
-- ---------------------------------------------------------------------
-- Adds a fifth public storage bucket for user profile photos. Mirrors
-- the existing logo-bucket setup: anyone can read, only authenticated
-- users can write. Lets the /me edit form swap a paste-a-URL field
-- for a real file picker via the shared LogoUploader component.
--
-- The user/avatar link itself lives on profiles.avatar_url and is
-- protected by that table's RLS — only the row owner can update it.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('user-avatars', 'user-avatars', true)
on conflict (id) do nothing;

-- Re-create the four logo-bucket policies to include user-avatars in
-- the bucket allow-list. These are the same `drop ... create` patterns
-- as the original setup in db.sql so the migration is idempotent.
drop policy if exists "Public reads logo buckets" on storage.objects;
create policy "Public reads logo buckets"
  on storage.objects for select to public
  using (
    bucket_id in (
      'tournament-logos','team-logos','player-photos','match-banners','user-avatars'
    )
  );

drop policy if exists "Authenticated uploads to logo buckets" on storage.objects;
create policy "Authenticated uploads to logo buckets"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in (
      'tournament-logos','team-logos','player-photos','match-banners','user-avatars'
    )
  );

drop policy if exists "Authenticated updates to logo buckets" on storage.objects;
create policy "Authenticated updates to logo buckets"
  on storage.objects for update to authenticated
  using (
    bucket_id in (
      'tournament-logos','team-logos','player-photos','match-banners','user-avatars'
    )
  );

drop policy if exists "Authenticated deletes from logo buckets" on storage.objects;
create policy "Authenticated deletes from logo buckets"
  on storage.objects for delete to authenticated
  using (
    bucket_id in (
      'tournament-logos','team-logos','player-photos','match-banners','user-avatars'
    )
  );
