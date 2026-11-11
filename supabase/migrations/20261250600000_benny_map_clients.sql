-- The Benny, maps: past clients by service for each master map, and which maps have the most of them per route.
--
-- "Highest rejuv past client density master map in Surrey" could not be answered: the maps lookup gave one past-client
-- total per map, and the split by service existed per route only. benny_maps_pcl returns what benny_maps does, plus
--   past_clients_by_service   { aeration, lawn_rejuv, sealing }   (a client with two services counts in both)
--   per_route                 past clients per approved route: of p_service when one is asked for, else of all
-- and orders the maps by per_route, highest first, when a service is asked for (by name otherwise, as before).
-- "Density" is per route on purpose: houses are only counted where a map's houses are built, and most maps have none.
-- The old benny_maps stays as it is. Additive; read-only; super admins, as before.

create or replace function public.benny_maps_pcl(p_center uuid, p_q text default null, p_service text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_region text; q text := nullif(trim(coalesce(p_q, '')), ''); v_svc text := nullif(lower(trim(coalesce(p_service, ''))), '');
begin
  perform benny_ok(p_center);
  if v_svc in ('rejuv', 'lawn rejuv', 'rj') then v_svc := 'lawn_rejuv'; elsif v_svc in ('aer', 'aerations') then v_svc := 'aeration'; elsif v_svc in ('seal', 'se') then v_svc := 'sealing'; end if;
  if v_svc is not null and v_svc not in ('aeration', 'lawn_rejuv', 'sealing') then
    return jsonb_build_object('problem', 'Past clients are kept by aeration, lawn_rejuv or sealing; “' || p_service || '” isn’t one of them.');
  end if;
  select region into v_region from command_centers where id = p_center;
  return (
    with m as (select ap.area_name, ap.city, ap.prefix from area_prefixes ap
                where (v_region is null or ap.region = v_region) and (q is null or ap.area_name ilike '%' || q || '%' or ap.city ilike '%' || q || '%')),
    rm as (select r.area_name, r.route_code from route_maps r join m on m.area_name = r.area_name where r.status = 'approved'),
    rs as (select area_name, count(*) routes, min(route_code) first_route, max(route_code) last_route from rm group by 1),
    hs as (select rm.area_name, count(*) houses from route_houses h join rm on rm.route_code = h.route_code group by 1),
    cs as (select rm.area_name, count(*) total,
                  count(*) filter (where 'aeration' = any (c.services)) aeration,
                  count(*) filter (where 'lawn_rejuv' = any (c.services)) lawn_rejuv,
                  count(*) filter (where 'sealing' = any (c.services)) sealing
             from clients c join rm on rm.route_code = c.route_code group by 1),
    x as (select m.area_name, m.city, m.prefix, coalesce(rs.routes, 0) routes, rs.first_route, rs.last_route, coalesce(hs.houses, 0) houses,
                 coalesce(cs.total, 0) total, coalesce(cs.aeration, 0) aeration, coalesce(cs.lawn_rejuv, 0) lawn_rejuv, coalesce(cs.sealing, 0) sealing,
                 case v_svc when 'aeration' then coalesce(cs.aeration, 0) when 'lawn_rejuv' then coalesce(cs.lawn_rejuv, 0) when 'sealing' then coalesce(cs.sealing, 0) else coalesce(cs.total, 0) end picked
            from m left join rs on rs.area_name = m.area_name left join hs on hs.area_name = m.area_name left join cs on cs.area_name = m.area_name),
    y as (select x.*, case when x.routes > 0 then round(x.picked::numeric / x.routes, 1) end per_route from x
           order by case when v_svc is not null then x.picked::numeric / nullif(x.routes, 0) end desc nulls last, x.area_name limit 40)
    select jsonb_build_object(
      'ranked_by', case when v_svc is not null then v_svc || ' past clients per route, highest first' else 'map name' end,
      'maps', coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'map', y.area_name, 'city', y.city, 'prefix', y.prefix, 'routes', y.routes, 'first_route', y.first_route, 'last_route', y.last_route,
          'houses', y.houses, 'past_clients', y.total,
          'past_clients_by_service', jsonb_build_object('aeration', y.aeration, 'lawn_rejuv', y.lawn_rejuv, 'sealing', y.sealing),
          'counted', case when v_svc is not null then y.picked end, 'per_route', y.per_route))
        order by case when v_svc is not null then y.picked::numeric / nullif(y.routes, 0) end desc nulls last, y.area_name), '[]'::jsonb),
      'note', 'per_route = past clients per approved route. Houses are only counted where a map’s houses are built (0 = not built yet), so they don’t give a density for most maps.')
      from y);
end $$;
revoke all on function public.benny_maps_pcl(uuid, text, text) from public, anon;
grant execute on function public.benny_maps_pcl(uuid, text, text) to authenticated;
