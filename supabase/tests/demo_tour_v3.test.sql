-- /demo sandbox, third pass: clients where Bridlewood has them, on every route, never with real names or phones.
\set ON_ERROR_STOP 1
\i supabase/migrations/20261101100000_territory_outlines.sql
\i supabase/migrations/20261104100000_demo_tour.sql
\i supabase/migrations/20261105100000_demo_tour_v2.sql
\i :mig

insert into route_maps (area_name, route_number, route_code, route_color, segments, status)
select 'BRIDLEWOOD', g, 'BRID' || lpad(g::text, 2, '0'), '#f00', '[{"osmId":1,"name":"Elm Rd","coordinates":[[-75.86,45.29],[-75.85,45.29]]}]', 'approved' from generate_series(1, 26) g;
insert into route_houses (route_code, house_key, civic_no, street_name, street_norm, lat, lng, source)
select r, g || '|elm rd', g, 'Elm Rd', 'elm rd', 45.29, -75.86 + g * 0.0001, 'osm' from generate_series(1, 50) g, unnest(array['BRID10','BRID08','BRID21']) r;
-- real clients: on a built route and on an unbuilt one (BRID03), sealing and aeration
insert into map_pcl_cache (route_code, area_name, clients, client_count)
select r, 'BRIDLEWOOD', (select jsonb_agg(jsonb_build_object('cid', 'real-' || g, 'firstName', 'Realfirst', 'lastName', 'Reallast', 'phone', '6135550000',
          'houseNum', g::text, 'streetName', 'Elm Rd', 'lat', 45.29, 'lng', -75.86 + g * 0.0001)) from generate_series(1, n) g), n
  from (values ('BRID10', 30), ('BRID03', 25)) v(r, n);
insert into map_pcl_by_service (route_code, service, clients, client_count)
values ('BRID03', 'aeration', (select jsonb_agg(jsonb_build_object('firstName', 'Realaer', 'phone', '6135551111', 'houseNum', g::text, 'streetName', 'Elm Rd', 'lat', 45.3, 'lng', -75.8)) from generate_series(1, 12) g), 12);

do $$
declare r jsonb; v_code text; cc uuid; pfx text; r1 text; t text;
begin
  r := app_demo_start();
  v_code := r->>'code'; cc := (r->>'center_id')::uuid; pfx := demo_prefix(v_code); r1 := r->'routes'->>0;
  if (select client_count from map_pcl_cache where route_code = pfx || '10') <> 30 then raise exception 'sealing clients on a built route'; end if;
  if (select client_count from map_pcl_cache where route_code = pfx || '03') <> 25 then raise exception 'sealing clients on an unbuilt route'; end if;
  if (select client_count from map_pcl_by_service where route_code = pfx || '03' and service = 'aeration') <> 12 then raise exception 'aeration clients'; end if;
  select string_agg(clients::text, '') into t from (select clients from map_pcl_cache where route_code like pfx || '%' union all select clients from map_pcl_by_service where route_code like pfx || '%') x;
  if t ~ 'Real|6135550000|6135551111|real-' then raise exception 'a real name, phone or id leaked'; end if;
  if (select (clients->0->>'houseNum') from map_pcl_cache where route_code = pfx || '03') is null then raise exception 'positions not kept'; end if;
  if (select count(*) from route_historical_properties where route_code = r1) < 2 then raise exception 'past customers'; end if;
  if (select count(*) from house_dispositions where route_code = r1) <> 8 then raise exception 'partner knocks'; end if;
  -- partner knocks never sit on a client's house
  if exists (select 1 from house_dispositions d join route_houses h on h.route_code = d.route_code and h.house_key = d.house_key
              join map_pcl_cache c on c.route_code = d.route_code, jsonb_array_elements(c.clients) e
             where d.route_code = r1 and e->>'houseNum' = h.civic_no::text and e->>'streetName' = h.street_name) then raise exception 'knock on a client'; end if;
  raise notice 'demo tour v3: ok';
end $$;
rollback;
