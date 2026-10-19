-- The Super Admin's permissions are set like anyone else's. Until now the account had every
-- permission by definition and its boxes couldn't be changed. Now User Management shows its boxes
-- and they can be set; the one that stays on, and can't be taken away, is User Management.
-- Every Super Admin keeps what they have today: all permissions are written to their row here.

insert into user_permissions (user_id, permission)
select u.id, p from app_users u
cross join unnest(array['route_manager','rm_floater','workerbook','bookings','dialer','sa_users','sa_territory','sa_reporting']) p
where u.is_super_admin
on conflict do nothing;

-- A permission is held when it's on the user's row; the Super Admin always holds User Management.
create or replace function public.app_has_perm(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select (p = 'sa_users' and app_is_super_admin())
      or exists (select 1 from user_permissions up join app_users u on u.id = up.user_id
                 where up.user_id = auth.uid() and up.permission = p and u.is_active)
$$;

-- Saving a user: a Super Admin's User Management permission is kept whatever the boxes say, and
-- their Route Manager center can be any center (they see them all).
create or replace function public.app_admin_update_user(
  p_user uuid, p_full_name text, p_phone text, p_email text,
  p_permissions text[], p_centers uuid[], p_rm_center uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  had_sa boolean; v_perms text[] := coalesce(p_permissions, '{}');
begin
  if not app_has_perm('sa_users') then raise exception 'Not allowed'; end if;
  select exists (select 1 from user_permissions where user_id = p_user and permission like 'sa\_%')
    into had_sa;
  if (had_sa or exists (select 1 from unnest(v_perms) x where x like 'sa\_%')
      or (select is_super_admin from app_users where id = p_user)) and not app_is_super_admin() then
    raise exception 'Only the Super Admin can change Super Admin accounts or permissions';
  end if;
  if (select is_super_admin from app_users where id = p_user) and not ('sa_users' = any(v_perms)) then
    v_perms := array_append(v_perms, 'sa_users');
  end if;
  -- the Super Admin sees every center, so any of them can be their Route Manager center
  if p_rm_center is not null and not (p_rm_center = any(p_centers))
     and not (select is_super_admin from app_users where id = p_user) then
    raise exception 'The RM center must be one of the user''s centers';
  end if;
  update app_users set full_name = trim(p_full_name), phone = p_phone, email = p_email,
                       rm_center_id = p_rm_center, is_active = p_active
   where id = p_user;
  delete from user_permissions where user_id = p_user and permission <> all(v_perms);
  insert into user_permissions (user_id, permission)
    select p_user, x from unnest(v_perms) x on conflict do nothing;
  delete from user_centers where user_id = p_user and center_id <> all(p_centers);
  insert into user_centers (user_id, center_id)
    select p_user, x from unnest(p_centers) x on conflict do nothing;
end $$;
