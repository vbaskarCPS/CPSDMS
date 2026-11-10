-- The Benny's "side of a map" and whole-map day plans looked the map names up again for every route in the database
-- (thousands of times), which took 13–25 s: past the 8 s request limit, so they failed for real users.
-- The names are now looked up once. Same results, about 0.1 s. Additive only.

create or replace function public.benny_side(p_center uuid, p_of_maps text[], p_near_maps text[] default null, p_near_routes text[] default null,
                                             p_vs_maps text[] default null, p_vs_routes text[] default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_of text[] := benny_resolve_maps(p_of_maps); v_near_maps text[] := benny_resolve_maps(p_near_maps); v_vs_maps text[] := benny_resolve_maps(p_vs_maps);
        v_near text[]; v_vs text[]; g_near geometry; g_vs geometry; v jsonb; n int;
begin
  perform benny_ok_any(p_center);
  select coalesce(array_agg(distinct route_code), '{}') into v_near from route_maps
   where status = 'approved' and not (area_name = any (v_of))
     and (upper(route_code) = any (select upper(x) from unnest(coalesce(p_near_routes, '{}')) x) or area_name = any (v_near_maps));
  select coalesce(array_agg(distinct route_code), '{}') into v_vs from route_maps
   where status = 'approved' and not (area_name = any (v_of))
     and (upper(route_code) = any (select upper(x) from unnest(coalesce(p_vs_routes, '{}')) x) or area_name = any (v_vs_maps));
  if cardinality(v_of) = 0 then return jsonb_build_object('error', 'No map found to take a side of'); end if;
  if cardinality(v_near) = 0 then return jsonb_build_object('error', 'Nothing found for the side to be connected to'); end if;
  select st_collect(benny_route_geom(x)) into g_near from unnest(v_near) x;
  if cardinality(v_vs) > 0 then select st_collect(benny_route_geom(x)) into g_vs from unnest(v_vs) x; end if;
  with c as (
    select rm.route_code, rm.area_name, rm.route_number,
           st_distance(benny_route_geom(rm.route_code)::geography, g_near::geography) dn,
           case when g_vs is null then null else st_distance(benny_route_geom(rm.route_code)::geography, g_vs::geography) end dv,
           st_distance(st_centroid(benny_route_geom(rm.route_code)), st_centroid(g_near)) cn,
           case when g_vs is null then null else st_distance(st_centroid(benny_route_geom(rm.route_code)), st_centroid(g_vs)) end cv
      from route_maps rm where rm.status = 'approved' and rm.area_name = any (v_of)),
  ranked as (select c.*, row_number() over (order by dn nulls last, route_number) rn, count(*) over () total from c)
  select coalesce(jsonb_agg(jsonb_build_object('route', r.route_code, 'map', r.area_name, 'distance_m', round(r.dn)::int,
             'open_prebooks', (select count(*) from mb_bookings b join mb_lists l on l.id = b.list_id where l.center_id = p_center and b.route_code = r.route_code and b.status = 'open'))
           order by r.rn), '[]'), max(r.total)
    into v, n
    from ranked r
   where case when g_vs is null then r.rn <= ceil(r.total / 2.0)
              else r.dn < r.dv or (r.dn = r.dv and (r.cn < r.cv or (r.cn = r.cv and (select min(x) from unnest(v_near) x) < (select min(x) from unnest(v_vs) x)))) end;
  return jsonb_build_object('of_maps', to_jsonb(v_of), 'split', case when g_vs is null then 'nearer half' else 'nearer to this side than the other' end,
                            'of', coalesce(n, 0), 'routes', v, 'codes', (select coalesce(jsonb_agg(e->'route'), '[]') from jsonb_array_elements(v) e));
end $$;

do $$ declare src text; nsrc text; begin
  select pg_get_functiondef('public.benny_plan_day(uuid,date,jsonb,boolean)'::regprocedure) into src;
  nsrc := replace(src, 'v_bad text[];', 'v_bad text[]; v_emaps text[];');
  if nsrc = src then raise exception 'benny_plan_day: declare not found'; end if;
  src := nsrc;
  nsrc := replace(src,
    $a$    select coalesce(array_agg(distinct rm.route_code), '{}') into v_routes from route_maps rm$a$,
    $b$    v_emaps := benny_resolve_maps(array(select jsonb_array_elements_text(coalesce(e->'maps', '[]'))));
    select coalesce(array_agg(distinct rm.route_code), '{}') into v_routes from route_maps rm$b$);
  if nsrc = src then raise exception 'benny_plan_day: routes query not found'; end if;
  src := nsrc;
  nsrc := replace(src,
    $a$or rm.area_name = any (benny_resolve_maps(array(select jsonb_array_elements_text(coalesce(e->'maps', '[]'))))));$a$,
    $b$or rm.area_name = any (v_emaps));$b$);
  if nsrc = src then raise exception 'benny_plan_day: maps condition not found'; end if;
  execute nsrc;
end $$;

-- Map names as people say them: "North Vancouver 2", "north vancouver #2" and "NORTH VANCOUVER #2" are the same map.
-- An exact name (ignoring case, spaces and #) wins; otherwise a part of a name or a city (every map in it).
create or replace function public.benny_resolve_maps(p_maps text[])
returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(distinct ap.area_name), '{}')
    from area_prefixes ap, unnest(coalesce(p_maps, '{}')) m
   where length(trim(m)) > 0
     and (regexp_replace(upper(ap.area_name), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(m), '[^A-Z0-9]', '', 'g')
          or (not exists (select 1 from area_prefixes a2 where regexp_replace(upper(a2.area_name), '[^A-Z0-9]', '', 'g') = regexp_replace(upper(m), '[^A-Z0-9]', '', 'g'))
              and (ap.area_name ilike '%' || trim(m) || '%' or ap.city ilike '%' || trim(m) || '%')))
$$;
revoke all on function public.benny_resolve_maps(text[]) from public, anon, authenticated;
