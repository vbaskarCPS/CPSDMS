-- Clients: every past client already saved, organized by city › route map › route. ADDITIVE ONLY.
--
-- The digital maps' past-client lists (map_pcl_cache, ~45,700 sealing callbook clients loaded in the
-- old app) were only on the maps. This brings each of those addresses into Clients, one record per
-- address, as one import ("Past clients on the digital maps") that can be undone from
-- Super Admin › Territory › Client lists like any other import:
--   · their name, phone, city, map position, route and every year's sealing history
--   · an address that's already a client is left as it is (none are, today)
--   · the maps themselves don't change (they already show these clients)
--
--   client_imports.source   may now also be 'map'
--   app_client_tree(service) client counts by city, route map (area) and route, for the Clients page.
--                            Each route map sits under the city most of its clients are in.

alter table public.client_imports drop constraint if exists client_imports_source_check;
alter table public.client_imports add constraint client_imports_source_check check (source in ('file', 'sheet', 'map'));

create or replace function public.app_client_tree(p_service text default null)
returns table (city text, area_name text, region text, route_code text, clients int)
language sql stable set search_path = public as $$
  with c as (   -- clients this user may see (the clients table's own access rule applies)
    select coalesce(nullif(initcap(trim(cl.city)), ''), '') city, cl.route_code
      from clients cl where p_service is null or p_service = any(cl.services)
  ), r as (
    select distinct on (rm.route_code) rm.route_code, rm.area_name from route_maps rm where rm.status = 'approved'
     order by rm.route_code, rm.area_name
  ), cr as (
    select c.city, c.route_code, r.area_name from c left join r on r.route_code = c.route_code
  ), home as (   -- each route map's city: where most of its clients are; a route with no map, its own
    select coalesce(cr.area_name, '~' || cr.route_code) k, mode() within group (order by cr.city) city
      from cr where cr.route_code is not null group by 1
  )
  select h.city, cr.area_name, ap.region, cr.route_code, count(*)::int
    from cr join home h on h.k = coalesce(cr.area_name, '~' || cr.route_code)
    left join area_prefixes ap on ap.area_name = cr.area_name
   where cr.route_code is not null
   group by h.city, cr.area_name, ap.region, cr.route_code
  union all
  select cr.city, null, null, null, count(*)::int from cr where cr.route_code is null group by cr.city
$$;
revoke all on function public.app_client_tree(text) from public, anon;
grant execute on function public.app_client_tree(text) to authenticated;

-- ───────────── bring the maps' past clients into Clients (once) ─────────────
do $$
declare
  v_import uuid;
  v_inserted int;
  v_skipped int;
  v_unusable int;
begin
  if exists (select 1 from client_imports where source = 'map' and status <> 'undone') then
    raise notice 'The maps'' past clients are already in Clients; nothing to do.';
    return;
  end if;

  create temp table _legacy on commit drop as
  select trim(coalesce(e->>'houseNum', '')) house_no, nullif(trim(e->>'streetName'), '') street_name, norm_street(e->>'streetName') street_norm,
         nullif(trim(e->>'city'), '') city, m.route_code,
         case when (e->>'lat') ~ '^-?\d+(\.\d+)?$' then (e->>'lat')::float8 end lat,
         case when (e->>'lng') ~ '^-?\d+(\.\d+)?$' then (e->>'lng')::float8 end lng,
         nullif(trim(e->>'firstName'), '') first_name, nullif(trim(e->>'lastName'), '') last_name,
         nullif(right(regexp_replace(coalesce(e->>'phone', ''), '\D', '', 'g'), 10), '') phone,
         case when jsonb_typeof(e->'history') = 'array' then e->'history' else '[]'::jsonb end history
    from map_pcl_cache m, jsonb_array_elements(m.clients) e
   where coalesce(e->>'src', '') = '';
  select count(*) into v_unusable from _legacy where street_norm is null or house_no = '';
  delete from _legacy where street_norm is null or house_no = '';
  -- one spelling per city (the most common one): "OAKVILLE", "oakville " → "Oakville"
  update _legacy l set city = c.best
    from (select initcap(city) k, mode() within group (order by city) best from _legacy where city is not null group by 1) c
   where initcap(l.city) = c.k and l.city is distinct from c.best;
  alter table _legacy add column akey text;
  update _legacy set akey = client_address_key(house_no, street_norm, null, city);
  create index on _legacy (akey);

  -- one record per address: its people, phones and every year's history, from all its map entries
  create temp table _addr on commit drop as
  with ppl as (
    select akey, jsonb_agg(p order by p->>'last', p->>'first') people from (
      select distinct akey, jsonb_build_object('first', coalesce(first_name, ''), 'last', coalesce(last_name, '')) p
        from _legacy where first_name is not null or last_name is not null) x group by akey
  ), hist as (
    select akey, jsonb_agg(h order by (h->>'year')::int desc nulls last, h->>'service') history from (
      select distinct akey, jsonb_strip_nulls(jsonb_build_object(
               'line', 'sealing',
               'year', case when (hh->>'year') ~ '^\d{4}$' then (hh->>'year')::int end,
               'service', nullif(trim(hh->>'serviceType'), ''),
               'price', nullif(regexp_replace(coalesce(hh->>'price', ''), '[$,\s]', '', 'g'), ''),
               'contractor', nullif(trim(hh->>'contractor'), ''))) h
        from _legacy, jsonb_array_elements(history) hh) x group by akey
  ), base as (
    select akey, min(house_no) house_no, min(street_norm) street_norm,
           (array_agg(street_name order by street_name))[1] street_name,
           (array_agg(city) filter (where city is not null))[1] city,
           mode() within group (order by route_code) route_code,
           (array_agg(lat) filter (where lat is not null))[1] lat,
           (array_agg(lng) filter (where lng is not null))[1] lng,
           coalesce(array_agg(distinct phone) filter (where phone is not null), '{}') phones
      from _legacy group by akey
  )
  select b.*, coalesce(p.people, '[]') people, coalesce(h.history, '[]') history
    from base b left join ppl p on p.akey = b.akey left join hist h on h.akey = b.akey;

  insert into client_imports (file_name, source, status, counts)
  values ('Past clients on the digital maps (callbook)', 'map', 'running', '{}') returning id into v_import;

  with ins as (
    insert into clients (address_key, house_no, street_name, street_norm, city, lat, lng, route_code, match_how, people, phones, history)
    select a.akey, a.house_no, coalesce(a.street_name, a.street_norm), a.street_norm, a.city, a.lat, a.lng, a.route_code, 'map', a.people, a.phones, a.history
      from _addr a
     where client_find(a.house_no, a.street_norm, null, a.city) is null
    on conflict (address_key) do nothing
    returning id
  )
  insert into client_import_changes (import_id, client_id, action) select v_import, id, 'insert' from ins;
  get diagnostics v_inserted = row_count;
  v_skipped := (select count(*) from _addr) - v_inserted;

  update client_imports set status = 'done', finished_at = now(),
         counts = jsonb_build_object('inserted', v_inserted, 'merged', 0, 'skipped', v_skipped + v_unusable,
                                     'already_clients', v_skipped, 'no_address', v_unusable)
   where id = v_import;
  raise notice 'Brought % past clients into Clients (% already clients, % without a house number or street)', v_inserted, v_skipped, v_unusable;
end $$;
