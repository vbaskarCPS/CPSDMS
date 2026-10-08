-- Start session's route picker: PCL counts and dots from the client database. ADDITIVE ONLY (two new functions).
--
-- The picker counted past clients from map_pcl_cache, the old builder's "Load PCL" cache, so clients
-- loaded through Territory › Client lists (which go into `clients`) never showed: a map could read
-- "0 PCL" on every route while its clients were saved. These read `clients` instead, by the routes
-- each map has. Counts and coordinates only: no names, phones or addresses leave the database.
--
--   app_area_pcl_counts(areas[])  route code → number of clients on it, for those maps
--   app_area_pcl_dots(area)       each client's route code and position, for one map

create or replace function public.app_area_pcl_counts(p_areas text[])
returns table (route_code text, n bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (app_has_perm('workerbook') or app_has_perm('route_manager') or app_has_perm('rm_floater')
          or app_has_perm('sa_territory') or app_has_perm('dialer')) then
    raise exception 'Not allowed';
  end if;
  return query
    select c.route_code, count(*)::bigint
      from clients c
     where c.route_code in (select rm.route_code from route_maps rm where rm.area_name = any(p_areas) and rm.status = 'approved')
     group by c.route_code;
end $$;
revoke all on function public.app_area_pcl_counts(text[]) from public, anon;
grant execute on function public.app_area_pcl_counts(text[]) to authenticated;

create or replace function public.app_area_pcl_dots(p_area text)
returns table (route_code text, lat double precision, lng double precision)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (app_has_perm('workerbook') or app_has_perm('route_manager') or app_has_perm('rm_floater')
          or app_has_perm('sa_territory') or app_has_perm('dialer')) then
    raise exception 'Not allowed';
  end if;
  return query
    select c.route_code, c.lat, c.lng
      from clients c
     where c.lat is not null and c.lng is not null
       and c.route_code in (select rm.route_code from route_maps rm where rm.area_name = p_area and rm.status = 'approved');
end $$;
revoke all on function public.app_area_pcl_dots(text) from public, anon;
grant execute on function public.app_area_pcl_dots(text) to authenticated;
