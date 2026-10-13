-- RUN_25 — Map Builder: delete a route number and shift the later routes down.
--
-- A route left blank (or drawn by mistake) can be deleted from the Map Builder. Every later route
-- with the same prefix moves down one number, across every map with that prefix (BSW #4's BSW63–76
-- become BSW62–75, and a later map's routes would follow), and everything filed under a moved route
-- code moves with it: its drawing and street lines, houses and knocks, door visits, past clients and
-- their job history, bookings, pending and paid sales, the PCL caches, saved day plans and the route
-- managers' digital-map settings. The maps' start numbers and route counts follow.
--
-- Safety:
--   * one all-or-nothing step: any problem and nothing changes
--   * the deleted route itself must not be in use (clients, knocks, visits, bookings, sales, job
--     history, hand-added houses): those can't move anywhere, so it says what's there and stops
--   * no route of the prefix may be on today's live day (the managers' screens are using the codes)
--   * Super Admin › Territory only (sa_territory), signed in
-- History logs (audit log, import logs, archived days, email logs) keep the codes they had.

-- The code the Map Builder writes for a prefix and number: BSW07, BSW62, MLT100.
create or replace function public.route_code_for(p_prefix text, p_n int)
returns text language sql immutable set search_path = public as $$
  select p_prefix || case when p_n < 10 then '0' || p_n::text else p_n::text end
$$;

-- A route manager's digital-map setting for one map, after the shift: its route list renamed (the
-- deleted route dropped) and its start/end numbers moved.
create or replace function public.route_shift_mapping(e jsonb, p_prefix text, p_n int, p_map jsonb, p_del text[])
returns jsonb language plpgsql immutable set search_path = public as $$
declare v_start int; v_end int;
begin
  if jsonb_typeof(e) <> 'object' or e->>'prefix' is distinct from p_prefix then return e; end if;
  if jsonb_typeof(e->'routeCodes') = 'array' then
    e := jsonb_set(e, '{routeCodes}', coalesce((
      select jsonb_agg(to_jsonb(coalesce(p_map->>c, c)) order by o)
      from jsonb_array_elements_text(e->'routeCodes') with ordinality as x(c, o)
      where not (c = any (p_del))), '[]'::jsonb));
  end if;
  if (e->>'routeStart') ~ '^\d+$' then
    v_start := (e->>'routeStart')::int;
    if v_start > p_n then e := jsonb_set(e, '{routeStart}', to_jsonb(v_start - 1)); end if;
  end if;
  if (e->>'routeEnd') ~ '^\d+$' then
    v_end := (e->>'routeEnd')::int;
    if v_end >= p_n then e := jsonb_set(e, '{routeEnd}', to_jsonb(v_end - 1)); end if;
  end if;
  return e;
end $$;

-- Every column a route code is filed under (table, column, has a unique key on it).
create or replace function public.route_code_columns()
returns table (t text, c text) language sql immutable set search_path = public as $$
  values ('route_maps', 'route_code'), ('route_street_lines', 'route_code'), ('route_street_lines_loaded', 'route_code'),
         ('route_street_checks', 'route_code'), ('route_houses', 'route_code'), ('route_house_builds', 'route_code'),
         ('route_cleanup_pass', 'route_code'), ('route_houses_point_revert_backup', 'route_code'),
         ('house_dispositions', 'route_code'), ('client_visits', 'route_code'), ('clients', 'route_code'),
         ('map_pcl_cache', 'route_code'), ('map_pcl_cache_base', 'route_code'), ('map_pcl_by_service', 'route_code'),
         ('pcl_cache', 'route_code'), ('routes', 'route_code'), ('route_splits', 'route_code'),
         ('bookings', 'route_number'), ('pending_sales', 'route_code'), ('payout_sales', 'route_code'),
         ('transactions', 'route_code'), ('route_historical_properties', 'route_code'),
         ('rf_review_queue', 'current_route_code'), ('rf_review_queue', 'suggested_route_code')
$$;

-- How many rows of a table have one of these codes (0 when the table isn't there).
create or replace function public.route_code_count(p_table text, p_col text, p_codes text[])
returns bigint language plpgsql stable set search_path = public as $$
declare n bigint;
begin
  if to_regclass('public.' || p_table) is null then return 0; end if;
  execute format('select count(*) from public.%I where %I = any ($1)', p_table, p_col) into n using p_codes;
  return n;
end $$;

-- The work. p_apply false = only say what would happen.
create or replace function public.route_delete_shift(p_prefix text, p_number int, p_apply boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_areas text[];
  v_owner text;
  v_del text[];
  v_max int;
  v_map jsonb := '{}';
  v_olds text[] := '{}';
  v_tmps text[] := '{}';
  v_n int;
  r record;
  v_maps jsonb;
  v_use jsonb;
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_live text[];
  v_data jsonb;
  v_hist bigint;
  v_t text;
begin
  if p_prefix is null or p_prefix !~ '^[A-Z]+$' or p_number is null or p_number < 1 then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;
  perform pg_advisory_xact_lock(hashtext('route_delete_shift:' || p_prefix));

  select array_agg(area_name order by route_start) into v_areas from area_prefixes where prefix = p_prefix;
  if v_areas is null then return jsonb_build_object('ok', false, 'reason', 'no_prefix'); end if;

  -- the map the number belongs to: the one that has it drawn, else the one whose span holds it
  select area_name into v_owner from route_maps where area_name = any (v_areas) and route_number = p_number limit 1;
  if v_owner is null then
    select area_name into v_owner from area_prefixes
    where prefix = p_prefix and p_number between coalesce(route_start, 1) and coalesce(route_start, 1) + coalesce(route_count, 0) - 1
    order by route_start limit 1;
  end if;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'not_on_a_map', 'code', route_code_for(p_prefix, p_number));
  end if;

  v_del := array[route_code_for(p_prefix, p_number)];
  if p_number < 10 then v_del := v_del || (p_prefix || p_number::text); end if;

  -- the highest number in use for the prefix: drawn, in a map's span, or filed anywhere
  select greatest(
           (select max(route_number) from route_maps where area_name = any (v_areas)),
           (select max(coalesce(route_start, 1) + coalesce(route_count, 0) - 1) from area_prefixes where prefix = p_prefix),
           (select max((regexp_match(route_code, '^' || p_prefix || '0*(\d+)$'))[1]::int) from clients where route_code ~ ('^' || p_prefix || '\d+$')),
           (select max((regexp_match(route_code, '^' || p_prefix || '0*(\d+)$'))[1]::int) from route_houses where route_code ~ ('^' || p_prefix || '\d+$')),
           (select max((regexp_match(route_code, '^' || p_prefix || '0*(\d+)$'))[1]::int) from house_dispositions where route_code ~ ('^' || p_prefix || '\d+$')),
           p_number) into v_max;

  -- old code → new code for every later number (also the unpadded spelling, BSW7)
  for v_n in p_number + 1 .. v_max loop
    v_map := v_map || jsonb_build_object(route_code_for(p_prefix, v_n), route_code_for(p_prefix, v_n - 1));
    if v_n < 10 then v_map := v_map || jsonb_build_object(p_prefix || v_n::text, route_code_for(p_prefix, v_n - 1)); end if;
  end loop;
  select coalesce(array_agg(key), '{}'), coalesce(array_agg(distinct '~' || value), '{}') into v_olds, v_tmps from jsonb_each_text(v_map);

  -- the deleted route must not be in use: those records couldn't move anywhere
  select count(*) into v_hist from clients c, jsonb_array_elements(case when jsonb_typeof(c.history) = 'array' then c.history else '[]' end) e
  where c.history::text ~ p_prefix and e->>'route' = any (v_del);
  v_use := jsonb_strip_nulls(jsonb_build_object(
    'clients', nullif(route_code_count('clients', 'route_code', v_del), 0),
    'knocks', nullif(route_code_count('house_dispositions', 'route_code', v_del), 0),
    'visits', nullif(route_code_count('client_visits', 'route_code', v_del), 0),
    'bookings', nullif(route_code_count('bookings', 'route_number', v_del), 0),
    'pending_sales', nullif(route_code_count('pending_sales', 'route_code', v_del), 0),
    'sales', nullif(route_code_count('payout_sales', 'route_code', v_del) + route_code_count('transactions', 'route_code', v_del), 0),
    'job_history', nullif(v_hist, 0),
    'hand_added_houses', nullif((select count(*) from route_houses where route_code = any (v_del) and source = 'manual'), 0),
    'day_plans', nullif(route_code_count('routes', 'route_code', v_del) + route_code_count('route_splits', 'route_code', v_del), 0)));

  -- no route of the prefix on today's live day
  select array_agg(distinct route_code order by route_code) into v_live from routes
  where session_date >= v_today and (route_code = any (v_olds) or route_code = any (v_del));

  -- the maps that move: each one's later routes, from → to
  select coalesce(jsonb_agg(m order by m->>'start'), '[]') into v_maps from (
    select jsonb_build_object('area', ap.area_name, 'start', coalesce(ap.route_start, 1),
             'first', route_code_for(p_prefix, x.lo), 'last', route_code_for(p_prefix, x.hi),
             'first_to', route_code_for(p_prefix, x.lo - 1), 'last_to', route_code_for(p_prefix, x.hi - 1), 'count', x.n) as m
    from area_prefixes ap,
         lateral (select min(rn) lo, max(rn) hi, count(*) n from (
                    select route_number rn from route_maps where area_name = ap.area_name and route_number > p_number
                    union
                    select g from generate_series(greatest(coalesce(ap.route_start, 1), p_number + 1),
                                                  coalesce(ap.route_start, 1) + coalesce(ap.route_count, 0) - 1) g) s) x
    where ap.prefix = p_prefix and x.n > 0) z;

  v_data := jsonb_build_object(
    'routes_drawn', (select count(*) from route_maps where area_name = any (v_areas) and route_number > p_number),
    'clients', route_code_count('clients', 'route_code', v_olds),
    'houses', route_code_count('route_houses', 'route_code', v_olds),
    'knocks', route_code_count('house_dispositions', 'route_code', v_olds),
    'visits', route_code_count('client_visits', 'route_code', v_olds),
    'bookings', route_code_count('bookings', 'route_number', v_olds),
    'sales', route_code_count('payout_sales', 'route_code', v_olds) + route_code_count('transactions', 'route_code', v_olds));

  if v_use <> '{}'::jsonb then
    return jsonb_build_object('ok', false, 'reason', 'in_use', 'code', v_del[1], 'area', v_owner, 'in_use', v_use, 'maps', v_maps, 'data', v_data);
  end if;
  if v_live is not null then
    return jsonb_build_object('ok', false, 'reason', 'live_today', 'code', v_del[1], 'area', v_owner, 'live', to_jsonb(v_live), 'maps', v_maps, 'data', v_data);
  end if;
  if not p_apply then
    return jsonb_build_object('ok', true, 'preview', true, 'code', v_del[1], 'area', v_owner, 'maps', v_maps, 'data', v_data);
  end if;

  -- ── apply ──
  -- these two react to route codes changing (street lines rebuilt; a knock logged as today's door
  -- visit); a renumber isn't either, so they're paused for this step and the rows are moved as they are
  alter table route_maps disable trigger route_maps_lines;
  if to_regclass('public.client_visits') is not null then
    alter table house_dispositions disable trigger crm_keep_visit;
  end if;

  -- 1. the deleted route's own drawing and what was worked out from it (its houses, street lines,
  --    PCL caches); anything else under its code stopped this above
  delete from route_maps where area_name = v_owner and route_number = p_number;
  foreach v_t in array array['route_maps', 'route_street_lines', 'route_street_lines_loaded', 'route_street_checks',
                             'route_houses', 'route_house_builds', 'route_cleanup_pass', 'route_houses_point_revert_backup',
                             'map_pcl_cache', 'map_pcl_cache_base', 'map_pcl_by_service', 'pcl_cache'] loop
    if to_regclass('public.' || v_t) is not null then
      execute format('delete from public.%I where route_code = any ($1)', v_t) using v_del;
    end if;
  end loop;
  -- a Route Finder suggestion of the deleted route no longer points anywhere
  if to_regclass('public.rf_review_queue') is not null then
    update rf_review_queue set suggested_route_code = null where suggested_route_code = any (v_del);
  end if;

  -- 2. every later code → the one below it, in two passes (~new, then new) so no two rows ever
  --    share a code on the way
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

  -- 3. the drawings' numbers (negated on the way, for the same reason)
  update route_maps set route_number = -(route_number - 1) where area_name = any (v_areas) and route_number > p_number;
  update route_maps set route_number = -route_number where area_name = any (v_areas) and route_number < 0;

  -- 4. codes inside records: job history, a sale's customer, saved day plans, managers' digital maps
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
  where jsonb_typeof(s.routes) = 'array'
    and exists (select 1 from jsonb_array_elements(s.routes) e where v_map ? (e->>'code'));
  update users set metadata = metadata
      || case when jsonb_typeof(metadata->'digitalMappings') = 'array' then jsonb_build_object('digitalMappings', (
           select jsonb_agg(route_shift_mapping(e, p_prefix, p_number, v_map, v_del) order by o)
           from jsonb_array_elements(metadata->'digitalMappings') with ordinality as x(e, o))) else '{}'::jsonb end
      || case when jsonb_typeof(metadata->'digitalMapping') = 'object' then
           jsonb_build_object('digitalMapping', route_shift_mapping(metadata->'digitalMapping', p_prefix, p_number, v_map, v_del)) else '{}'::jsonb end
  where role = 'RouteManager' and metadata::text ~ ('"prefix": "' || p_prefix || '"');

  -- 5. the maps: the deleted route's map is one shorter; later maps start one lower
  update area_prefixes set route_count = greatest(coalesce(route_count, 0) - 1, 0)
  where area_name = v_owner and p_number between coalesce(route_start, 1) and coalesce(route_start, 1) + coalesce(route_count, 0) - 1;
  update area_prefixes set route_start = route_start - 1 where prefix = p_prefix and route_start > p_number;

  alter table route_maps enable trigger route_maps_lines;
  if to_regclass('public.client_visits') is not null then
    alter table house_dispositions enable trigger crm_keep_visit;
  end if;

  insert into audit_log (actor, entity, entity_id, action, before, after)
  values (auth.uid(), 'route_maps', v_del[1], 'delete_shift',
          jsonb_build_object('prefix', p_prefix, 'number', p_number, 'area', v_owner),
          jsonb_build_object('maps', v_maps, 'data', v_data));

  return jsonb_build_object('ok', true, 'code', v_del[1], 'area', v_owner, 'maps', v_maps, 'data', v_data);
end $$;

-- What deleting a route would do (nothing is changed).
create or replace function public.app_route_shift_preview(p_prefix text, p_number int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed' using errcode = '42501'; end if;
  return route_delete_shift(p_prefix, p_number, false);
end $$;

-- Delete the route and shift the later ones down.
create or replace function public.app_route_delete_shift(p_prefix text, p_number int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed' using errcode = '42501'; end if;
  return route_delete_shift(p_prefix, p_number, true);
end $$;

revoke all on function public.route_delete_shift(text, int, boolean) from public, anon, authenticated;
revoke all on function public.route_shift_mapping(jsonb, text, int, jsonb, text[]) from public, anon, authenticated;
revoke all on function public.route_code_count(text, text, text[]) from public, anon, authenticated;
revoke all on function public.route_code_columns() from public, anon, authenticated;
revoke all on function public.app_route_shift_preview(text, int) from public, anon;
revoke all on function public.app_route_delete_shift(text, int) from public, anon;
grant execute on function public.app_route_shift_preview(text, int) to authenticated;
grant execute on function public.app_route_delete_shift(text, int) to authenticated;
