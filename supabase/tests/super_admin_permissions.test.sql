-- The Super Admin's permissions are real and editable; User Management always stays on.
\set ON_ERROR_STOP 1
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000f9');
insert into app_users (id, username, full_name, is_super_admin) values ('a0000000-0000-0000-0000-0000000000f9', 'tsasa', 'Test Super', true);
\i :mig

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f9', true);
do $$ begin
  -- the migration gave the existing Super Admin everything, so nothing changes for them today
  if (select count(*) from user_permissions where user_id = 'a0000000-0000-0000-0000-0000000000f9') <> 8 then raise exception 'not seeded'; end if;
  if not app_has_perm('dialer') then raise exception 'seeded permission not held'; end if;
  -- taking Dialer and Workerbook away, and even unticking User Management: User Management stays
  perform app_admin_update_user('a0000000-0000-0000-0000-0000000000f9', 'Test Super', null, null,
    array['route_manager','bookings','sa_territory','sa_reporting'], '{}', null, true);
  if app_has_perm('dialer') or app_has_perm('workerbook') then raise exception 'permission not taken away'; end if;
  if not app_has_perm('sa_users') then raise exception 'User Management lost'; end if;
  if not app_has_perm('bookings') then raise exception 'kept permission lost'; end if;
  if not exists (select 1 from user_permissions where user_id = 'a0000000-0000-0000-0000-0000000000f9' and permission = 'sa_users') then raise exception 'sa_users row gone'; end if;
  raise notice 'super admin permissions: ok';
end $$;
rollback;
