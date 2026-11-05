-- Map Builder › move a route to another number, shifting the routes in between by one, across every map with the
-- prefix (the reverse of route_delete_shift). Adding a route always gives it the next free number at the end
-- (WHR147); "Move to number…" then puts it where it belongs (WHR60) and moves WHR60–146 up to WHR61–147, with
-- everything filed under them: street lines, houses, clients, knocks, visits, bookings, sales, job history, day plans,
-- managers' digital maps. The maps' number spans follow. Also: the Masterbookings tables (mb_bookings,
-- mb_carried_invalids) are now among the route-code columns, so delete-and-shift moves them too. Additive only.

create or replace function public.route_code_columns()
returns table(t text, c text) language sql immutable set search_path = public as $$
  values ('route_maps', 'route_code'), ('route_street_lines', 'route_code'), ('route_street_lines_loaded', 'route_code'),
         ('route_street_checks', 'route_code'), ('route_houses', 'route_code'), ('route_house_builds', 'route_code'),
         ('route_cleanup_pass', 'route_code'), ('route_houses_point_revert_backup', 'route_code'),
         ('house_dispositions', 'route_code'), ('client_visits', 'route_code'), ('clients', 'route_code'),
         ('map_pcl_cache', 'route_code'), ('map_pcl_cache_base', 'route_code'), ('map_pcl_by_service', 'route_code'),
         ('pcl_cache', 'route_code'), ('routes', 'route_code'), ('route_splits', 'route_code'),
         ('bookings', 'route_number'), ('pending_sales', 'route_code'), ('payout_sales', 'route_code'),
         ('transactions', 'route_code'), ('route_historical_properties', 'route_code'),
         ('rf_review_queue', 'current_route_code'), ('rf_review_queue', 'suggested_route_code'),
         ('mb_bookings', 'route_code'), ('mb_carried_invalids', 'route_code')
$$;

-- a manager's digital map entry: its route codes renamed, its start/end numbers moved the same way
create or replace function public.route_move_mapping(e jsonb, p_prefix text, p_map jsonb, p_from int, p_to int)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v int;
  f int;
begin
  if jsonb_typeof(e) <> 'object' or e->>'prefix' is distinct from p_prefix then return e; end if;
  if jsonb_typeof(e->'routeCodes') = 'array' then
    e := jsonb_set(e, '{routeCodes}', coalesce((select jsonb_agg(to_jsonb(coalesce(p_map->>c, c)) order by o)
                                                 from jsonb_array_elements_text(e->'routeCodes') with ordinality as x(c, o)), '[]'::jsonb));
  end if;
  foreach f in array array[1, 2] loop
    if (e->>(case f when 1 then 'routeStart' else 'routeEnd' end)) ~ '^\d+$' then
      v := (e->>(case f when 1 then 'routeStart' else 'routeEnd' end))::int;
      v := case when v = p_from then p_to
                when p_to < p_from and v between p_to and p_from - 1 then v + 1
                when p_to > p_from and v between p_from + 1 and p_to then v - 1 else v end;
      e := jsonb_set(e, array[case f when 1 then 'routeStart' else 'routeEnd' end], to_jsonb(v));
    end if;
  end loop;
  return e;
end $$;

create or replace function public.route_move_shift(p_prefix text, p_from int, p_to int, p_apply boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_area text; v_start int; v_end int; v_map jsonb := '{}'; v_olds text[]; v_tmps text[]; n int; r record;
  v_live text[]; v_moves jsonb; v_data jsonb; v_lo int; v_hi int; v_dir int;
  v_today date := (now() at time zone 'America/Toronto')::date;
begin
  if p_prefix is null or p_prefix !~ '^[A-Z]+$' or p_from is null or p_to is null or p_from < 1 or p_to < 1 then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  if p_from = p_to then return jsonb_build_object('ok', false, 'reason', 'same_number', 'code', route_code_for(p_prefix, p_from)); end if;
  perform pg_advisory_xact_lock(hashtext('route_delete_shift:' || p_prefix));

  -- the route has to be drawn (saved); it stays on its own map, so the new number is within that map's
  -- numbers, or one past its last
  select rm.area_name into v_area from route_maps rm join area_prefixes ap on ap.area_name = rm.area_name and ap.prefix = p_prefix
   where rm.route_number = p_from limit 1;
  if v_area is null then return jsonb_build_object('ok', false, 'reason', 'not_drawn', 'code', route_code_for(p_prefix, p_from)); end if;
  select coalesce(route_start, 1), coalesce(route_start, 1) + coalesce(route_count, 0) - 1 into v_start, v_end from area_prefixes where area_name = v_area;
  if p_to < v_start or p_to > v_end + 1 then
    return jsonb_build_object('ok', false, 'reason', 'outside_map', 'code', route_code_for(p_prefix, p_from), 'area', v_area,
                              'first', route_code_for(p_prefix, v_start), 'last', route_code_for(p_prefix, v_end + 1));
  end if;

  -- old code → new code for the moved route and every number in between (also the unpadded spelling, BSW7)
  v_lo := least(p_from, p_to); v_hi := greatest(p_from, p_to); v_dir := case when p_to < p_from then 1 else -1 end;
  for n in v_lo .. v_hi loop
    v_map := v_map || jsonb_build_object(route_code_for(p_prefix, n), route_code_for(p_prefix, case when n = p_from then p_to else n + v_dir end));
    if n < 10 then v_map := v_map || jsonb_build_object(p_prefix || n::text, route_code_for(p_prefix, case when n = p_from then p_to else n + v_dir end)); end if;
  end loop;
  select coalesce(array_agg(key), '{}'), coalesce(array_agg(distinct '~' || value), '{}') into v_olds, v_tmps from jsonb_each_text(v_map);

  -- none of them on today's live day
  select array_agg(distinct route_code order by route_code) into v_live from routes where session_date >= v_today and route_code = any (v_olds);

  -- what moves, per map
  select coalesce(jsonb_agg(m order by (m->>'start')::int), '[]') into v_moves from (
    select jsonb_build_object('area', rm.area_name, 'start', min(rm.route_number),
             'first', route_code_for(p_prefix, min(rm.route_number)), 'last', route_code_for(p_prefix, max(rm.route_number)),
             'first_to', route_code_for(p_prefix, min(rm.route_number) + v_dir), 'last_to', route_code_for(p_prefix, max(rm.route_number) + v_dir),
             'count', count(*)) m
      from route_maps rm join area_prefixes ap on ap.area_name = rm.area_name and ap.prefix = p_prefix
     where rm.route_number between v_lo and v_hi and rm.route_number <> p_from
     group by rm.area_name) z;
  v_data := jsonb_build_object(
    'routes_drawn', (select count(*) from route_maps rm join area_prefixes ap on ap.area_name = rm.area_name and ap.prefix = p_prefix where rm.route_number between v_lo and v_hi),
    'clients', route_code_count('clients', 'route_code', v_olds), 'houses', route_code_count('route_houses', 'route_code', v_olds),
    'knocks', route_code_count('house_dispositions', 'route_code', v_olds), 'visits', route_code_count('client_visits', 'route_code', v_olds),
    'bookings', route_code_count('bookings', 'route_number', v_olds) + route_code_count('mb_bookings', 'route_code', v_olds),
    'sales', route_code_count('payout_sales', 'route_code', v_olds) + route_code_count('transactions', 'route_code', v_olds));

  if v_live is not null then
    return jsonb_build_object('ok', false, 'reason', 'live_today', 'code', route_code_for(p_prefix, p_from), 'live', to_jsonb(v_live), 'moves', v_moves, 'data', v_data);
  end if;
  if not p_apply then
    return jsonb_build_object('ok', true, 'preview', true, 'code', route_code_for(p_prefix, p_from), 'to', route_code_for(p_prefix, p_to),
                              'area', v_area, 'moves', v_moves, 'data', v_data);
  end if;

  -- ── apply ── (a renumber, so the street-line rebuild and the visit log are paused while rows move)
  alter table route_maps disable trigger route_maps_lines;
  if to_regclass('public.client_visits') is not null then alter table house_dispositions disable trigger crm_keep_visit; end if;

  for r in select * from route_code_columns() loop
    if to_regclass('public.' || r.t) is not null then
      execute format('update public.%I set %I = ''~'' || ($1 ->> %I) where %I = any ($2)', r.t, r.c, r.c, r.c) using v_map, v_olds;
    end if;
  end loop;
  for r in select * from route_code_columns() loop
    if to_regclass('public.' || r.t) is not null then
      execute format('update public.%I set %I = substr(%I, 2) where %I = any ($1)', r.t, r.c, r.c, r.c) using v_tmps;
    end if;
  end loop;

  update route_maps rm set route_number = -(case when rm.route_number = p_from then p_to else rm.route_number + v_dir end)
    from area_prefixes ap where ap.area_name = rm.area_name and ap.prefix = p_prefix and rm.route_number between v_lo and v_hi;
  update route_maps rm set route_number = -rm.route_number
    from area_prefixes ap where ap.area_name = rm.area_name and ap.prefix = p_prefix and rm.route_number < 0;

  update clients c set history = (
      select jsonb_agg(case when v_map ? (e->>'route') then jsonb_set(e, '{route}', to_jsonb(v_map->>(e->>'route'))) else e end order by o)
      from jsonb_array_elements(c.history) with ordinality as x(e, o))
  where jsonb_typeof(c.history) = 'array' and c.history::text ~ p_prefix
    and exists (select 1 from jsonb_array_elements(c.history) e where v_map ? (e->>'route'));
  update transactions set customer_snapshot = jsonb_set(customer_snapshot, '{routeCode}', to_jsonb(v_map->>(customer_snapshot->>'routeCode')))
  where jsonb_typeof(customer_snapshot) = 'object' and v_map ? (customer_snapshot->>'routeCode');
  update sessions s set routes = (
      select jsonb_agg(case when v_map ? (e->>'code') then jsonb_set(e, '{code}', to_jsonb(v_map->>(e->>'code'))) else e end order by o)
      from jsonb_array_elements(s.routes) with ordinality as x(e, o))
  where jsonb_typeof(s.routes) = 'array' and exists (select 1 from jsonb_array_elements(s.routes) e where v_map ? (e->>'code'));
  update users set metadata = metadata
      || case when jsonb_typeof(metadata->'digitalMappings') = 'array' then jsonb_build_object('digitalMappings', (
           select jsonb_agg(route_move_mapping(e, p_prefix, v_map, p_from, p_to) order by o)
           from jsonb_array_elements(metadata->'digitalMappings') with ordinality as x(e, o))) else '{}'::jsonb end
      || case when jsonb_typeof(metadata->'digitalMapping') = 'object' then
           jsonb_build_object('digitalMapping', route_move_mapping(metadata->'digitalMapping', p_prefix, v_map, p_from, p_to)) else '{}'::jsonb end
  where role = 'RouteManager' and metadata::text ~ ('"prefix": "' || p_prefix || '"');

  -- the maps' spans: every number moves the same way; the route's own map gains its new number
  update area_prefixes ap set route_start = s.lo, route_count = s.cnt
    from (select a.area_name, min(nn) lo, count(*) cnt
            from area_prefixes a,
                 lateral (select case when g = p_from then null else case when g between v_lo and v_hi then g + v_dir else g end end nn
                            from generate_series(coalesce(a.route_start, 1), coalesce(a.route_start, 1) + coalesce(a.route_count, 0) - 1) g
                          union all select p_to where a.area_name = v_area) x
           where a.prefix = p_prefix and nn is not null
           group by a.area_name) s
   where ap.area_name = s.area_name and (ap.route_start is distinct from s.lo or ap.route_count is distinct from s.cnt);

  alter table route_maps enable trigger route_maps_lines;
  if to_regclass('public.client_visits') is not null then alter table house_dispositions enable trigger crm_keep_visit; end if;

  insert into audit_log (actor, entity, entity_id, action, before, after)
  values (auth.uid(), 'route_maps', route_code_for(p_prefix, p_from), 'move_shift',
          jsonb_build_object('prefix', p_prefix, 'from', p_from, 'to', p_to, 'area', v_area),
          jsonb_build_object('moves', v_moves, 'data', v_data));
  return jsonb_build_object('ok', true, 'code', route_code_for(p_prefix, p_from), 'to', route_code_for(p_prefix, p_to), 'area', v_area, 'moves', v_moves, 'data', v_data);
end $$;
revoke all on function public.route_move_shift(text, int, int, boolean) from public, anon, authenticated;
revoke all on function public.route_move_mapping(jsonb, text, jsonb, int, int) from public, anon, authenticated;

create or replace function public.app_route_move_preview(p_prefix text, p_from int, p_to int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed' using errcode = '42501'; end if;
  return route_move_shift(p_prefix, p_from, p_to, false);
end $$;
create or replace function public.app_route_move(p_prefix text, p_from int, p_to int)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed' using errcode = '42501'; end if;
  return route_move_shift(p_prefix, p_from, p_to, true);
end $$;
revoke all on function public.app_route_move_preview(text, int, int), public.app_route_move(text, int, int) from public, anon;
grant execute on function public.app_route_move_preview(text, int, int), public.app_route_move(text, int, int) to authenticated;
