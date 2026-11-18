-- A past client always has a house on the worker's map.
--
-- The worker map marks past clients ON houses: a past client whose address has no house on the route is simply not
-- there. Where the address register doesn't cover a town (White Rock, South Surrey), a route's houses come from
-- OpenStreetMap the first time a worker opens the map; if that fetch hasn't run or failed, the route has no houses at
-- all and so no past clients (Nov 17: WHR11 and WHR145, 30 and 22 past clients, none shown). And OpenStreetMap misses
-- some addresses even when it works.
--
-- Every past client in the lists the workers read (map_pcl_by_service, map_pcl_cache) carries the coordinate that
-- placed it on its route. route_houses_from_pcl adds a house (source 'pcl') for each one that has none, so it shows
-- whatever the register or OpenStreetMap know. It never moves or replaces a house, and leaves alone:
--   - a past client more than 120 m from the route's streets (filed on the wrong route);
--   - one whose number already has a house within 30 m (the same house under another spelling of the street);
--   - house numbers that aren't a plain number ("12-4241": a unit, read by the app's own matching).
-- It runs when a past-client list is saved (triggers) and when a route's houses are first built. It writes no build
-- row, so a route's first open still asks the register and then OpenStreetMap for the rest of its houses.

create or replace function public.route_houses_from_pcl(p_route_code text) returns integer
language plpgsql security definer set search_path to 'public' as $$
declare v_lines geography; v_n integer := 0;
begin
  if nullif(trim(coalesce(p_route_code, '')), '') is null then return 0; end if;
  select ST_Union(l.line)::geography into v_lines from (
    select ST_MakeLine(ST_SetSRID(ST_MakePoint((c->>0)::float8, (c->>1)::float8), 4326) order by ord) as line
      from route_maps rm, jsonb_array_elements(rm.segments) with ordinality as s(seg, sord),
           jsonb_array_elements(s.seg->'coordinates') with ordinality as t(c, ord)
     where rm.route_code = p_route_code and rm.status = 'approved'
     group by rm.id, s.sord having count(*) >= 2) l;
  if v_lines is null then return 0; end if;

  with raw as (
    select trim(c->>'houseNum') hn, c->>'streetName' st, (c->>'lat')::float8 lat, (c->>'lng')::float8 lng
      from (select clients from map_pcl_by_service where route_code = p_route_code
            union all select clients from map_pcl_cache where route_code = p_route_code) s,
           jsonb_array_elements(coalesce(s.clients, '[]'::jsonb)) c
     where jsonb_typeof(s.clients) = 'array'
       and trim(coalesce(c->>'houseNum', '')) ~ '^[0-9]{1,6}\s*[A-Za-z]?$'
       and coalesce(c->>'lat', '') ~ '^-?[0-9]+(\.[0-9]+)?$' and coalesce(c->>'lng', '') ~ '^-?[0-9]+(\.[0-9]+)?$'),
  p as (
    select distinct on (hk) *
      from (select (substring(hn from '^([0-9]+)'))::int civ, lower(coalesce(substring(hn from '([A-Za-z])$'), '')) suf, st, norm_street(st) sn, lat, lng,
                   house_key((substring(hn from '^([0-9]+)'))::int, lower(coalesce(substring(hn from '([A-Za-z])$'), '')), norm_street(st)) hk
              from raw) x
     where sn is not null and lat between -90 and 90 and lng between -180 and 180
     order by hk)
  insert into route_houses (route_code, house_key, civic_no, civic_suffix, street_name, street_norm, unit_count, lat, lng, source)
  select p_route_code, p.hk, p.civ, nullif(p.suf, ''), initcap(trim(p.st)), p.sn, 1, p.lat, p.lng, 'pcl'
    from p
   where ST_DWithin(ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography, v_lines, 120)
     and not exists (select 1 from route_houses h where h.route_code = p_route_code and h.house_key = p.hk)
     and not exists (select 1 from route_houses h where h.route_code = p_route_code and h.civic_no = p.civ
                        and ST_DWithin(ST_SetSRID(ST_MakePoint(h.lng, h.lat), 4326)::geography, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)::geography, 30))
  on conflict (route_code, house_key) do nothing;
  get diagnostics v_n = row_count;

  -- a route already built keeps its count right; one not built yet gets no build row from here
  if v_n > 0 then
    update route_house_builds b set house_count = (select count(*) from route_houses h where h.route_code = p_route_code) where b.route_code = p_route_code;
  end if;
  return v_n;
end $$;
revoke all on function public.route_houses_from_pcl(text) from public, anon, authenticated;

-- when a past-client list is saved: its route gets the houses. Never in the way of the save itself.
create or replace function public.route_houses_from_pcl_trg() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  begin
    perform route_houses_from_pcl(new.route_code);
  exception when others then
    raise warning 'route_houses_from_pcl(%): %', new.route_code, sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.route_houses_from_pcl_trg() from public, anon, authenticated;

create or replace trigger pcl_houses after insert or update of clients on public.map_pcl_by_service
  for each row execute function public.route_houses_from_pcl_trg();
create or replace trigger pcl_houses after insert or update of clients on public.map_pcl_cache
  for each row execute function public.route_houses_from_pcl_trg();

-- when a route's houses are first built from the register: the past clients' houses are counted with them
do $do$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'build_route_houses';
  if position('route_houses_from_pcl(' in d) = 0 then
    if position('select count(*) into v_count from route_houses where route_code = p_route_code;' in d) = 0 then raise exception 'pcl houses: could not patch build_route_houses'; end if;
    execute replace(d, 'select count(*) into v_count from route_houses where route_code = p_route_code;',
      'perform route_houses_from_pcl(p_route_code);   -- a past client always has a house' || E'\n  ' || 'select count(*) into v_count from route_houses where route_code = p_route_code;');
  end if;
end $do$;

-- White Rock, where it was found, and Southwest Surrey #3 (routes 60 to 85, Nov 18: no houses on any of the 26):
-- every route with a past-client list gets its houses now
select sum(route_houses_from_pcl(r.route_code)) from (
  select distinct route_code from map_pcl_by_service where route_code like 'WHR%' or route_code ~ '^SWS(6[0-9]|7[0-9]|8[0-5])$'
  union select distinct route_code from map_pcl_cache where route_code like 'WHR%' or route_code ~ '^SWS(6[0-9]|7[0-9]|8[0-5])$') r;
