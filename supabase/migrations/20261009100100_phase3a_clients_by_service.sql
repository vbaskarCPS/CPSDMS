-- Phase 3a (part 2) · past clients by service.
--
-- ADDITIVE ONLY. A property can be an aeration client, a sealing client, a rejuv client and a
-- window-cleaning client at once, and each route has a past-client list for each service.
--   clients.services       the service lines a client has history in (kept by the trigger)
--   history[].line         each history entry's service line: aeration | lawn_rejuv | sealing | cleaning
--   map_pcl_by_service     the map's past-client list per route for aeration, lawn rejuv and
--                          window cleaning. The RM map and the worker logsheet read the list for
--                          the live session's service.
-- The existing map_pcl_cache holds sealing clients (every entry in it today is sealing), so it
-- stays the one sealing list; imported sealing clients go there, as before.

create table if not exists public.map_pcl_by_service (
  route_code text not null,
  service text not null check (service in ('aeration', 'lawn_rejuv', 'cleaning')),
  clients jsonb not null default '[]',
  client_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (route_code, service)
);
alter table public.map_pcl_by_service enable row level security;
-- Read the same way map_pcl_cache is read today: the old RM map and logsheet use the app key.
drop policy if exists pcl_by_service_read on public.map_pcl_by_service;
create policy pcl_by_service_read on public.map_pcl_by_service for select to anon, authenticated using (true);
revoke all on public.map_pcl_by_service from anon, authenticated;
grant select on public.map_pcl_by_service to anon, authenticated;

alter table public.clients add column if not exists services text[] not null default '{}';
create index if not exists clients_services on public.clients using gin (services);

create or replace function public.clients_search_text()
returns trigger language plpgsql set search_path = public as $$
begin
  new.search_text := lower(concat_ws(' ', new.house_no, new.street_name, new.unit, new.city, new.route_code,
    (select string_agg(concat_ws(' ', p->>'first', p->>'last'), ' ') from jsonb_array_elements(new.people) p),
    array_to_string(new.phones, ' '), array_to_string(new.emails, ' ')));
  new.services := coalesce((select array_agg(distinct h->>'line' order by h->>'line') from jsonb_array_elements(new.history) h
                             where h->>'line' in ('aeration', 'lawn_rejuv', 'sealing', 'cleaning')), '{}');
  return new;
end $$;
update public.clients set updated_at = updated_at;   -- fills services for any rows already there

-- Imported clients on a route who have history in one service, in the shape the map reads,
-- with only that service's history.
create or replace function public.client_pcl_entries(p_route text, p_line text)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'firstName', coalesce(c.people->0->>'first', ''),
           'lastName', coalesce(c.people->0->>'last', ''),
           'houseNum', c.house_no,
           'streetName', c.street_name,
           'phone', coalesce(c.phones[1], ''),
           'city', c.city, 'lat', c.lat, 'lng', c.lng,
           'history', (select coalesce(jsonb_agg(jsonb_build_object(
                          'year', coalesce((h->>'year')::int, 0),
                          'price', coalesce(case when (h->>'price') ~ '^\d+(\.\d+)?$' then '$' || to_char((h->>'price')::numeric, 'FM999990.00') else h->>'price' end, ''),
                          'serviceType', coalesce(h->>'service', ''),
                          'contractor', coalesce(h->>'contractor', ''))
                        order by coalesce((h->>'year')::int, 0) desc), '[]')
                       from jsonb_array_elements(c.history) h where h->>'line' = p_line),
           'src', 'crm', 'cid', c.id)) order by c.street_norm, c.house_no), '[]')
    from clients c where c.route_code = p_route and p_line = any(c.services)
$$;
revoke all on function public.client_pcl_entries(text, text) from public, anon, authenticated;

create or replace function public.client_refresh_map_pcl(p_routes text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_route text; v_base jsonb; v_cur jsonb; v_ours jsonb; v_keys text[]; v_area text; v_prefix text; v_region text; v_all jsonb; v_line text;
begin
  foreach v_route in array coalesce(p_routes, '{}') loop
    continue when v_route is null;

    -- ── sealing: the existing map list (map_pcl_cache) plus imported sealing clients ──
    select clients into v_cur from map_pcl_cache where route_code = v_route;
    select clients into v_base from map_pcl_cache_base where route_code = v_route;
    v_base := coalesce(v_base, '[]');
    select coalesce(jsonb_agg(e), '[]') into v_cur
      from jsonb_array_elements(coalesce(v_cur, '[]')) e
     where coalesce(e->>'src', '') <> 'crm'
       and not exists (select 1 from jsonb_array_elements(v_base) b
                        where lower(coalesce(b->>'houseNum', '')) = lower(coalesce(e->>'houseNum', ''))
                          and norm_street(b->>'streetName') is not distinct from norm_street(e->>'streetName'));
    v_base := v_base || v_cur;
    insert into map_pcl_cache_base (route_code, clients, saved_at) values (v_route, v_base, now())
      on conflict (route_code) do update set clients = excluded.clients, saved_at = now();

    v_ours := client_pcl_entries(v_route, 'sealing');
    select coalesce(array_agg(lower(o->>'houseNum') || '|' || coalesce(norm_street(o->>'streetName'), '')), '{}') into v_keys
      from jsonb_array_elements(v_ours) o;
    -- an old entry at an imported address gives its history to the imported one
    select coalesce(jsonb_agg(b.e) filter (where not (b.k = any(v_keys))), '[]')
      into v_all
      from (select e, lower(coalesce(e->>'houseNum', '')) || '|' || coalesce(norm_street(e->>'streetName'), '') as k
              from jsonb_array_elements(v_base) e) b;
    select coalesce(jsonb_agg(
             case when old.e is null then o
                  else o || jsonb_build_object('history', (
                    select coalesce(jsonb_agg(distinct h), '[]') from (
                      select jsonb_array_elements(o->'history') h
                      union all select jsonb_array_elements(coalesce(old.e->'history', '[]'))) hh)) end), '[]')
      into v_ours
      from jsonb_array_elements(v_ours) o
      left join lateral (
        select e from jsonb_array_elements(v_base) e
         where lower(coalesce(e->>'houseNum', '')) = lower(o->>'houseNum')
           and norm_street(e->>'streetName') = norm_street(o->>'streetName') limit 1) old on true;
    v_all := v_all || v_ours;

    if exists (select 1 from map_pcl_cache where route_code = v_route) then
      update map_pcl_cache set clients = v_all, client_count = jsonb_array_length(v_all), updated_at = now() where route_code = v_route;
    elsif jsonb_array_length(v_all) > 0 then
      select rm.area_name into v_area from route_maps rm where rm.route_code = v_route and rm.status = 'approved' limit 1;
      select ap.prefix, ap.region into v_prefix, v_region from area_prefixes ap where ap.area_name = v_area;
      insert into map_pcl_cache (route_code, area_name, region, prefix, clients, client_count, updated_at)
      values (v_route, coalesce(v_area, ''), v_region, v_prefix, v_all, jsonb_array_length(v_all), now());
    end if;

    -- ── the other services: imported clients only ──
    foreach v_line in array array['aeration', 'lawn_rejuv', 'cleaning'] loop
      v_ours := client_pcl_entries(v_route, v_line);
      if jsonb_array_length(v_ours) > 0 then
        insert into map_pcl_by_service (route_code, service, clients, client_count, updated_at)
        values (v_route, v_line, v_ours, jsonb_array_length(v_ours), now())
        on conflict (route_code, service) do update set clients = excluded.clients, client_count = excluded.client_count, updated_at = now();
      else
        delete from map_pcl_by_service where route_code = v_route and service = v_line;
      end if;
    end loop;
  end loop;
end $$;
revoke all on function public.client_refresh_map_pcl(text[]) from public, anon, authenticated;

