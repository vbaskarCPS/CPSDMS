-- The Benny: (1) "the side of map 2 connected to map 1" — a map's routes split by which side they are nearer;
-- (2) a start-the-day plan can name whole maps, not only route codes; (3) a route manager can only hand out
-- routes that are on their own map. Additive only.

-- The side of a map: the routes of p_of_maps nearer to "near" (maps and/or routes) than to "versus".
-- With no versus, the nearer half. A route touching both sides goes to the side whose middle is nearer, so two
-- managers splitting a map never both get it.
create or replace function public.benny_side(p_center uuid, p_of_maps text[], p_near_maps text[] default null, p_near_routes text[] default null,
                                             p_vs_maps text[] default null, p_vs_routes text[] default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_of text[] := benny_resolve_maps(p_of_maps); v_near text[]; v_vs text[]; g_near geometry; g_vs geometry; v jsonb; n int;
begin
  perform benny_ok_any(p_center);
  select coalesce(array_agg(distinct route_code), '{}') into v_near from route_maps
   where status = 'approved' and not (area_name = any (v_of))
     and (upper(route_code) = any (select upper(x) from unnest(coalesce(p_near_routes, '{}')) x) or area_name = any (benny_resolve_maps(p_near_maps)));
  select coalesce(array_agg(distinct route_code), '{}') into v_vs from route_maps
   where status = 'approved' and not (area_name = any (v_of))
     and (upper(route_code) = any (select upper(x) from unnest(coalesce(p_vs_routes, '{}')) x) or area_name = any (benny_resolve_maps(p_vs_maps)));
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
revoke all on function public.benny_side(uuid, text[], text[], text[], text[], text[]) from public, anon;
grant execute on function public.benny_side(uuid, text[], text[], text[], text[], text[]) to authenticated;

-- A start-the-day plan: each entry may also name whole maps ("maps": ["NORTH VANCOUVER #1"]) next to route codes.
do $$ declare src text; nsrc text; begin
  select pg_get_functiondef('public.benny_plan_day(uuid,date,jsonb,boolean)'::regprocedure) into src;
  nsrc := replace(src,
    $a$     where rm.status = 'approved' and upper(rm.route_code) in (select upper(x) from jsonb_array_elements_text(coalesce(e->'routes', '[]')) x);$a$,
    $b$     where rm.status = 'approved' and (upper(rm.route_code) in (select upper(x) from jsonb_array_elements_text(coalesce(e->'routes', '[]')) x)
            or rm.area_name = any (benny_resolve_maps(array(select jsonb_array_elements_text(coalesce(e->'maps', '[]'))))));$b$);
  if nsrc = src then raise exception 'benny_plan_day: routes line not found'; end if;
  execute nsrc;
end $$;

-- A route manager hands out only routes on their own map (super admins: any).
do $$ declare src text; nsrc text; begin
  select pg_get_functiondef('public.benny_check_give(uuid,text,text)'::regprocedure) into src;
  nsrc := replace(src,
    $a$  if v_mine is not null and rt.route_code is not null and not (rt.manager_id = any (v_mine)) and not ((w->>'manager') = any (v_mine)) then
    v_probs := v_probs || ('Route ' || rt.route_code || ' and ' || (w->>'name') || ' aren’t on your team.'); end if;$a$,
    $b$  if v_mine is not null and rt.route_code is not null and not (rt.manager_id = any (v_mine)) then
    v_probs := v_probs || ('Route ' || rt.route_code || ' is on ' || coalesce((select u.name from users u where u.user_id = rt.manager_id and u.command_center_id = p_center), 'another manager')
                           || '’s map, not yours.'); end if;$b$);
  if nsrc = src then raise exception 'benny_check_give: team check not found'; end if;
  execute nsrc;
end $$;
