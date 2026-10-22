-- The /demo tour, third pass: callbook (sealing) and aeration clients appear where Bridlewood really
-- has them, on every route, under made-up names with no phone numbers and a made-up history. Past
-- customers (the ✕ marks) stay made up, a few per route on its houses. Everything else as before.

create or replace function public.app_demo_start()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text; v_center uuid := gen_random_uuid(); v_date date := (now() at time zone 'America/Toronto')::date;
  v_pfx text; v_area text; v_alex text; v_sam text; v_stamp bigint := (extract(epoch from now()) * 1000)::bigint;
  v_live int; v_w text[]; v_cart1 text; v_cart2 text; v_cart3 text;
  v_r1 int; v_r2 int; v_r3 int; v_codes text[]; v_n int; v_mapping jsonb;
  src record; h record; i int; v_line text;
  first_names text[] := array['Dana','Omar','Lena','Ravi','Grace','Tom','Nadia','Paul','Mei','Jon','Sara','Ali','Kate','Ben','Rosa','Ivan','Lucy','Sam','Hana','Leo'];
  last_names text[] := array['Brooks','Haddad','Fischer','Patel','Moreau','Nguyen','Kowalski','Singh','Bennett','Oliveira','Murphy','Tremblay','Chen','Walsh','Roy','Diaz','Kim','Lambert','Ahmed','Ross'];
begin
  select count(*) into v_live from demo_sandboxes where expires_at > now();
  if v_live >= 60 then raise exception 'The demo is busy right now — please try again in a few minutes'; end if;
  if not exists (select 1 from route_maps where area_name = 'BRIDLEWOOD' and status = 'approved') then raise exception 'The demo map is not set up'; end if;

  loop
    v_code := translate(upper(substr(md5(gen_random_uuid()::text), 1, 3)), '0123456789', 'ABCDEFGHJK');
    exit when not exists (select 1 from demo_sandboxes where code = v_code);
  end loop;
  v_pfx := demo_prefix(v_code); v_area := 'DEMO ' || v_code;
  v_alex := 'rm_demo' || lower(v_code) || 'alex'; v_sam := 'rm_demo' || lower(v_code) || 'sam';
  v_w := array(select 'X' || v_code || g from generate_series(1, 7) g);
  insert into demo_sandboxes (code, center_id) values (v_code, v_center);

  insert into command_centers (id, username, password, display_name, region, workerbook_sheet_id, masterbookings_sheet_id,
                               services, cn_prefix, tax_name, tax_rate, is_active, center_type, digital_mapping_enabled, is_demo)
  values (v_center, 'demo_' || lower(v_code), md5(gen_random_uuid()::text), 'Demo ' || v_code, 'East', '', '',
          array['sealing'], 'X', 'HST', 13, true, 'road_trip', false, true);
  insert into daily_sessions (date, command_center_id, is_active, season_type, import_meta)
  values (v_date, v_center, true, 'sealing', jsonb_build_object('demo', v_code));

  -- the whole Bridlewood map under the sandbox's codes (same route numbers)
  insert into area_prefixes (area_name, prefix, pdf_page, region, route_count, route_start, city)
  select v_area, v_pfx, 0, 'East', count(*), min(route_number), 'Ottawa' from route_maps where area_name = 'BRIDLEWOOD' and status = 'approved';
  insert into map_area_centers (area_name, center_id) values (v_area, v_center);
  for src in select * from route_maps where area_name = 'BRIDLEWOOD' and status = 'approved' order by route_number loop
    insert into route_maps (area_name, route_number, route_code, route_color, segments, status, approved_at)
    values (v_area, src.route_number, v_pfx || lpad(src.route_number::text, 2, '0'), src.route_color, src.segments, 'approved', now());
    insert into route_houses (route_code, house_key, civic_no, civic_suffix, street_name, street_norm, unit_count, lat, lng, footprint, source, geo_source, geo_accuracy, geocoded_at, unit)
    select v_pfx || lpad(src.route_number::text, 2, '0'), house_key, civic_no, civic_suffix, street_name, street_norm, unit_count, lat, lng, footprint, source, geo_source, geo_accuracy, geocoded_at, unit
      from route_houses where route_code = src.route_code;
    get diagnostics v_n = row_count;
    -- built, placed and street-checked: a sandbox never asks OpenStreetMap or Mapbox for anything
    insert into route_house_builds (route_code, built_at, source, house_count, footprints_at, footprint_count, geocoded_at, geocode_note)
    values (v_pfx || lpad(src.route_number::text, 2, '0'), now(), 'osm', v_n, now(), 0, now(), 'demo copy of ' || src.route_code);
    insert into route_street_checks (route_code, street_norm, street_name, started_at, checked_at, found, lookups)
    select distinct v_pfx || lpad(src.route_number::text, 2, '0'), norm_street(s->>'name'), s->>'name', now(), now(), 0, 0
      from jsonb_array_elements(coalesce(src.segments, '[]')) s where coalesce(s->>'name', '') <> '' and norm_street(s->>'name') is not null;
  end loop;
  v_codes := array(select route_code from route_maps where area_name = v_area order by route_number);

  -- clients where Bridlewood really has them (its callbook and its aeration clients), under made-up
  -- names, with no phone numbers and a made-up history; past customers (✕ marks) made up on houses
  for src in select rm.route_number n, rm.route_code real_code, v_pfx || lpad(rm.route_number::text, 2, '0') code
               from route_maps rm where rm.area_name = 'BRIDLEWOOD' and rm.status = 'approved' loop
    insert into map_pcl_cache (route_code, area_name, region, prefix, clients, client_count, updated_at)
    select src.code, v_area, 'East', v_pfx, coalesce(jsonb_agg(jsonb_build_object(
             'houseNum', e->>'houseNum', 'streetName', e->>'streetName', 'lat', (e->>'lat')::float8, 'lng', (e->>'lng')::float8, 'src', 'crm', 'phone', '',
             'firstName', first_names[1 + (k::int * 7 + src.n) % 20], 'lastName', last_names[1 + (k::int * 13 + src.n * 3) % 20],
             'history', jsonb_build_array(jsonb_build_object('date', (v_date - ((1 + k::int % 3) || ' years')::interval)::date::text,
               'year', extract(year from v_date)::int - (1 + k::int % 3), 'price', '$' || (175 + (k::int % 5) * 25) || '.00', 'contractor', 'A past crew', 'serviceType', 'SS')))), '[]'),
           count(*), now()
      from map_pcl_cache c, jsonb_array_elements(c.clients) with ordinality x(e, k)
     where c.route_code = src.real_code and (e->>'lat') is not null and (e->>'lng') is not null
    having count(*) > 0;
    for v_line in select distinct service from map_pcl_by_service where route_code = src.real_code loop
      insert into map_pcl_by_service (route_code, service, clients, client_count, updated_at)
      select src.code, v_line, coalesce(jsonb_agg(jsonb_build_object(
               'houseNum', e->>'houseNum', 'streetName', e->>'streetName', 'lat', (e->>'lat')::float8, 'lng', (e->>'lng')::float8, 'src', 'crm', 'phone', '',
               'firstName', first_names[1 + (k::int * 11 + src.n) % 20], 'lastName', last_names[1 + (k::int * 3 + src.n * 7) % 20],
               'history', jsonb_build_array(jsonb_build_object('date', (v_date - interval '1 year')::date::text, 'year', extract(year from v_date)::int - 1,
                 'price', '$75.00', 'contractor', 'Aeration crew', 'serviceType', case v_line when 'aeration' then 'AER' when 'lawn_rejuv' then 'RJ' else 'CL' end)))), '[]'),
             count(*), now()
        from map_pcl_by_service c, jsonb_array_elements(c.clients) with ordinality x(e, k)
       where c.route_code = src.real_code and c.service = v_line and (e->>'lat') is not null and (e->>'lng') is not null
      having count(*) > 0;
    end loop;
    i := 0;
    for h in select civic_no, street_name from route_houses rh where rh.route_code = src.code and rh.unit is null
              and not exists (select 1 from map_pcl_cache c, jsonb_array_elements(c.clients) e where c.route_code = rh.route_code and e->>'houseNum' = rh.civic_no::text and e->>'streetName' = rh.street_name)
             order by md5(rh.house_key || v_code) limit 6 loop
      i := i + 1;
      insert into route_historical_properties (command_center_id, session_date, route_code, address, customer_name, client_type, property_type, price, payment_type, contractor_name)
      values (v_center, v_date - interval '1 year', src.code, h.civic_no || ' ' || h.street_name,
              first_names[1 + (i * 5 + src.n) % 20] || ' ' || last_names[1 + (i * 17 + src.n) % 20], 'Residential', 'Driveway', '$225.00', 'Cash', 'Last year''s crew');
    end loop;
  end loop;

  -- the three routes the tour uses: the biggest built routes (cart 1 = the visitor's, cart 2, and the one to assign)
  select array_agg(n order by c desc) into v_codes from (
    select rm.route_number n, (select count(*) from route_houses rh2 where rh2.route_code = rm.route_code) c
      from route_maps rm where rm.area_name = v_area) x;
  v_r1 := v_codes[1]; v_r2 := coalesce(v_codes[2], v_codes[1]); v_r3 := coalesce(v_codes[3], v_codes[1]);
  v_mapping := jsonb_build_object('prefix', v_pfx, 'areaName', v_area,
    'routeStart', (select min(route_number) from route_maps where area_name = v_area), 'routeEnd', (select max(route_number) from route_maps where area_name = v_area),
    'routeCodes', (select jsonb_agg(route_code order by route_number) from route_maps where area_name = v_area));

  insert into users (user_id, name, username, password, role, command_center_id, metadata) values
    (v_alex, 'Alex Morgan', 'demo_' || lower(v_code) || '_alex', md5(gen_random_uuid()::text), 'RouteManager', v_center,
     jsonb_build_object('phone', '(555) 010-0001', 'floatingFor', '[]'::jsonb, 'digitalMapping', v_mapping, 'digitalMappings', jsonb_build_array(v_mapping))),
    (v_sam, 'Sam Lee', 'demo_' || lower(v_code) || '_sam', md5(gen_random_uuid()::text), 'RouteManager', v_center,
     jsonb_build_object('phone', '(555) 010-0002', 'floatingFor', '[]'::jsonb, 'digitalMappings', '[]'::jsonb));
  insert into users (user_id, name, password, role, command_center_id, metadata)
  select v_w[g], n, lower(split_part(n, ' ', 1)), 'Worker', v_center,
         jsonb_build_object('phone', '(555) 010-01' || g, 'teamId', t, 'assignedManagerId', v_alex, 'alumniRate', 0, 'silverRate', 0, 'upsellsEnabled', true)
    from (values (1, 'Jordan Reyes', '1'), (2, 'Priya Shah', '1'), (3, 'Vidal Peyton', '2'), (4, 'Marcus Tran', '2'), (5, 'Amara Okafor', '3'), (6, 'Liam Carter', '3')) v(g, n, t);

  v_cart1 := 'sess_1_' || v_stamp; v_cart2 := 'sess_2_' || v_stamp; v_cart3 := 'sess_3_' || v_stamp;
  insert into logsheet_sessions (id, worker_id, team_worker_ids, date, command_center_id, status, stats, email_enabled, equiv_split, upsell_split) values
    (v_cart1, v_w[1], array[v_w[1], v_w[2]], v_date, v_center, 'OPEN', '{}', true, jsonb_build_object(v_w[1], 50, v_w[2], 50), jsonb_build_object(v_w[1], 50, v_w[2], 50)),
    (v_cart2, v_w[3], array[v_w[3], v_w[4]], v_date, v_center, 'OPEN', '{}', true, jsonb_build_object(v_w[3], 50, v_w[4], 50), jsonb_build_object(v_w[3], 50, v_w[4], 50)),
    (v_cart3, v_w[5], array[v_w[5], v_w[6]], v_date, v_center, 'OPEN', '{}', true, jsonb_build_object(v_w[5], 50, v_w[6], 50), jsonb_build_object(v_w[5], 50, v_w[6], 50));

  -- every route is on the day; cart 1 and cart 2 have theirs, the rest are open to assign
  insert into routes (route_code, session_date, command_center_id, manager_id, streets, assigned_worker_ids)
  select rm.route_code, v_date, v_center, v_alex, '{}',
         case rm.route_number when v_r1 then array[v_w[1], v_w[2]] when v_r2 then array[v_w[3], v_w[4]] else '{}'::text[] end
    from route_maps rm where rm.area_name = v_area;

  -- the partner's knocks and one pending booking on the visitor's route, away from the made-up clients
  v_n := 0;
  for h in select house_key, civic_no, street_name from route_houses rh
            where rh.route_code = v_pfx || lpad(v_r1::text, 2, '0') and rh.unit is null
              and not exists (select 1 from map_pcl_cache c, jsonb_array_elements(c.clients) e where c.route_code = rh.route_code and e->>'houseNum' = rh.civic_no::text and e->>'streetName' = rh.street_name)
              and not exists (select 1 from map_pcl_by_service c, jsonb_array_elements(c.clients) e where c.route_code = rh.route_code and e->>'houseNum' = rh.civic_no::text and e->>'streetName' = rh.street_name)
              and not exists (select 1 from route_historical_properties p where p.command_center_id = v_center and p.route_code = rh.route_code and p.address = rh.civic_no || ' ' || rh.street_name)
            order by rh.id limit 9 loop
    v_n := v_n + 1;
    if v_n <= 8 then
      insert into house_dispositions (route_code, house_key, status, note, command_center_id, worker_id, session_id)
      values (v_pfx || lpad(v_r1::text, 2, '0'), h.house_key,
              (array['not_home','not_home','not_home','not_home','no','no','go_back','invalid'])[v_n],
              case v_n when 7 then 'Back after 5' when 8 then 'Sealed last month by another company' end,
              v_center::text, v_w[2], v_cart1);
    else
      insert into bookings (booking_id, command_center_id, route_number, status, price, customer_details, log_notes, is_prepaid, session_date, data, services)
      values ('DEMO-' || v_code || '-1', v_center, v_pfx || lpad(v_r1::text, 2, '0'), 'pending', '250',
              jsonb_build_object('First Name', 'Grace', 'Last Name', 'Whitfield', 'Full Address', h.civic_no || ' ' || h.street_name, 'Home Phone', '', 'Cell Phone', '', 'Email Address', '', 'FO/BO/FP', ''),
              'Booked by the office — seal the driveway, customer home after 4', false, v_date,
              jsonb_build_object('Booking ID', 'DEMO-' || v_code || '-1', 'Route Number', v_pfx || lpad(v_r1::text, 2, '0'), 'First Name', 'Grace', 'Last Name', 'Whitfield', 'Full Address', h.civic_no || ' ' || h.street_name, 'Price', '250', 'Service Type', 'SS'),
              '[]'::jsonb);
    end if;
  end loop;

  return jsonb_build_object('code', v_code, 'center_id', v_center, 'date', v_date, 'manager', v_alex, 'other_manager', v_sam,
    'worker', v_w[1], 'partner', v_w[2], 'mover', v_w[3], 'late', v_w[7],
    'routes', jsonb_build_array(v_pfx || lpad(v_r1::text, 2, '0'), v_pfx || lpad(v_r2::text, 2, '0'), v_pfx || lpad(v_r3::text, 2, '0')),
    'route_nums', jsonb_build_array(v_r1, v_r2, v_r3),
    'carts', jsonb_build_array(v_cart1, v_cart2, v_cart3), 'booking', 'DEMO-' || v_code || '-1');
end $$;
revoke all on function public.app_demo_start() from public;
grant execute on function public.app_demo_start() to anon, authenticated;
