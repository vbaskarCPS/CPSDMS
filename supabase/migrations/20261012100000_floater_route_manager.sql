-- Floater Route Manager permission. ADDITIVE ONLY.
--
-- An executive-level route manager can pick any of the day's live route managers (from any command
-- center) and open the floater map for them, to follow their progress. Granted per user in
-- Super Admin › Users, under Route Manager.
--
--   user_permissions.permission   may now also be 'rm_floater'
--   app_floater_managers()        every live session's route managers: their center, the routes and
--                                 areas assigned to them today, their workers and carts, and the
--                                 steps and gross logged so far. Floater Route Managers (and the
--                                 Super Admin) only.

alter table public.user_permissions drop constraint if exists user_permissions_permission_check;
alter table public.user_permissions add constraint user_permissions_permission_check check (permission in
  ('route_manager','rm_floater','workerbook','bookings','dialer','sa_users','sa_territory','sa_reporting'));

create or replace function public.app_floater_managers()
returns table (
  center_id uuid, center_name text, session_date date, season_type text,
  manager_id text, manager_name text, phone text,
  routes text[], areas text[], workers int, carts int, steps numeric, gross numeric
) language plpgsql stable security definer set search_path = public as $$
begin
  if not app_has_perm('rm_floater') then raise exception 'Not allowed'; end if;
  return query
  with live as (
    select distinct on (d.command_center_id) d.command_center_id cc, d.date, d.season_type
      from daily_sessions d where d.is_active
     order by d.command_center_id, d.date desc
  ), mgr as (
    select u.command_center_id cc, u.user_id, u.name, u.metadata m
      from users u join live l on l.cc = u.command_center_id where u.role = 'RouteManager'
  ), wk as (
    select u.command_center_id cc, u.user_id, u.metadata->>'assignedManagerId' mid, nullif(u.metadata->>'teamId', '') team
      from users u join live l on l.cc = u.command_center_id where u.role = 'Worker'
  ), ls as (   -- each logsheet counts once, for its lead worker's manager
    select l.command_center_id cc, w.mid, coalesce((l.stats->>'stepCount')::numeric, 0) st,
           coalesce((l.stats->>'prodGross')::numeric, 0) + coalesce((l.stats->>'upsellGross')::numeric, 0) gr
      from logsheet_sessions l join live v on v.cc = l.command_center_id and v.date = l.date
      join wk w on w.cc = l.command_center_id and w.user_id = l.worker_id
  )
  select c.id, c.display_name, l.date, l.season_type,
         m.user_id, m.name, nullif(m.m->>'phone', ''),
         coalesce((select array_agg(r.route_code order by r.route_code) from routes r
                    where r.command_center_id = m.cc and r.session_date = l.date and r.manager_id = m.user_id), '{}'),
         coalesce((select array_agg(distinct x->>'areaName') from jsonb_array_elements(
                    case when jsonb_typeof(m.m->'digitalMappings') = 'array' then m.m->'digitalMappings' else '[]'::jsonb end) x
                    where coalesce(x->>'areaName', '') <> ''), '{}'),
         (select count(*)::int from wk where wk.cc = m.cc and wk.mid = m.user_id),
         (select count(distinct wk.team)::int from wk where wk.cc = m.cc and wk.mid = m.user_id and wk.team is not null),
         (select coalesce(sum(ls.st), 0) from ls where ls.cc = m.cc and ls.mid = m.user_id),
         (select coalesce(sum(ls.gr), 0) from ls where ls.cc = m.cc and ls.mid = m.user_id)
    from mgr m join live l on l.cc = m.cc join command_centers c on c.id = m.cc
   order by c.display_name, m.name;
end $$;
revoke all on function public.app_floater_managers() from public, anon;
grant execute on function public.app_floater_managers() to authenticated;
