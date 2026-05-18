-- Defense-in-depth: forbid deleting a super-admin profile row at the
-- DB level. The /admins UI hides the delete button on super-admin
-- rows and the `deleteUser` server action refuses outright, but a
-- direct Management API / SQL editor / service-role caller could
-- still issue `delete from auth.users where id = …` and have the FK
-- cascade through to `profiles`. This trigger sits BEFORE DELETE on
-- profiles and raises if `is_super_admin` is still true, so the
-- cascade itself fails — the auth.users delete therefore fails too.
--
-- To legitimately delete a super-admin, first demote them via
-- `update profiles set is_super_admin = false where id = …` (which
-- the existing prevent_self_promote trigger only blocks when the
-- caller is *not* a super-admin), then run the delete.

create or replace function prevent_super_admin_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.is_super_admin then
    raise exception 'Cannot delete a super-admin profile. Demote them first (set is_super_admin = false) before deleting.';
  end if;
  return old;
end $$;

drop trigger if exists trg_profiles_prevent_super_admin_delete on profiles;
create trigger trg_profiles_prevent_super_admin_delete
  before delete on profiles
  for each row execute function prevent_super_admin_delete();
