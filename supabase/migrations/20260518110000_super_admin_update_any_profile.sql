-- The /admins page lets a super-admin promote / demote other users
-- via `update profiles set is_super_admin = …`. Until now that
-- request silently no-op'd: the only update policy on profiles was
-- `profiles_update_own` (auth.uid() = id), and PostgREST returns
-- success with 0 rows affected when RLS rejects an UPDATE. The user
-- saw a green toast but the badge never changed.
--
-- Add a second policy that gives super-admins write access to every
-- profile. The existing `prevent_self_promote` BEFORE-UPDATE trigger
-- still blocks anyone-who-isn't-a-super-admin from changing
-- is_super_admin, so the only new capability granted here is "super-
-- admin updates someone else's profile" — exactly what the /admins
-- page needs. profiles_update_own stays so a regular user can keep
-- updating their own display_name / avatar / phone via /me.

drop policy if exists "profiles_update_super" on profiles;
create policy "profiles_update_super" on profiles for update
  using (is_super_admin(auth.uid()))
  with check (is_super_admin(auth.uid()));
