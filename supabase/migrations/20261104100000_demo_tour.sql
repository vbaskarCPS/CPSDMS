-- The guided tour at /demo. Every visitor gets a throwaway command centre of their own with a live
-- day, two managers, six workers on three carts, four copies of real Ottawa routes (houses already
-- built, so nothing is geocoded), a partner's knocks, past customers, callbook clients and a pending
-- booking. Sandboxes are swept after three hours. Nothing here touches a real centre.

create table if not exists public.demo_sandboxes (
  code text primary key,
  center_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 hours'
);
alter table public.demo_sandboxes enable row level security;
revoke all on public.demo_sandboxes from anon, authenticated;

-- A sandbox's route codes: DX + the code + 01..04 (e.g. DXKQM01). Worker ids: X + code + 1..7.
create or replace function public.demo_prefix(p_code text) returns text language sql immutable as $$ select 'DX' || p_code $$;

create or replace function public.app_demo_start()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_code text; v_center uuid := gen_random_uuid(); v_date date := (now() at time zone 'America/Toronto')::date;
  v_pfx text; v_area text; v_alex text; v_sam text; v_stamp bigint := (extract(epoch from now()) * 1000)::bigint;
  v_src text[] := array['BRID08', 'BRID10', 'BRID21', 'BRID19'];   -- real Ottawa routes with houses already built
  v_codes text[]; v_mapping jsonb; i int; v_w text[]; v_cart1 text; v_cart2 text; v_cart3 text;
  h record; v_n int := 0; v_street text; v_live int;
begin
  select count(*) into v_live from demo_sandboxes where expires_at > now();
  if v_live >= 60 then raise exception 'The demo is busy right now — please try again in a few minutes'; end if;

  -- a code nobody live is using
  loop
    v_code := upper(substr(md5(gen_random_uuid()::text), 1, 3));
    v_code := translate(v_code, '0123456789', 'ABCDEFGHJK');
    exit when not exists (select 1 from demo_sandboxes where code = v_code);
  end loop;
  v_pfx := demo_prefix(v_code); v_area := 'DEMO ' || v_code;
  v_alex := 'rm_demo' || lower(v_code) || 'alex'; v_sam := 'rm_demo' || lower(v_code) || 'sam';
  v_codes := array(select v_pfx || lpad(g::text, 2, '0') from generate_series(1, 4) g);
  v_w := array(select 'X' || v_code || g from generate_series(1, 7) g);

  insert into demo_sandboxes (code, center_id) values (v_code, v_center);

  insert into command_centers (id, username, password, display_name, region, workerbook_sheet_id, masterbookings_sheet_id,
                               services, cn_prefix, tax_name, tax_rate, is_active, center_type, digital_mapping_enabled)
  values (v_center, 'demo_' || lower(v_code), md5(gen_random_uuid()::text), 'Demo ' || v_code, 'East', '', '',
          array['sealing'], 'X', 'HST', 13, true, 'road_trip', false);
  insert into daily_sessions (date, command_center_id, is_active, season_type, import_meta)
  values (v_date, v_center, true, 'sealing', jsonb_build_object('demo', v_code));

  -- the area: four routes copied from Bridlewood, houses and all
  insert into area_prefixes (area_name, prefix, pdf_page, region, route_count, route_start, city)
  values (v_area, v_pfx, 0, 'East', 4, 1, 'Ottawa');
  insert into map_area_centers (area_name, center_id) values (v_area, v_center);
  for i in 1..4 loop
    insert into route_maps (area_name, route_number, route_code, route_color, segments, status, approved_at)
    select v_area, i, v_codes[i], rm.route_color, rm.segments, 'approved', now() from route_maps rm where rm.route_code = v_src[i];
    insert into route_houses (route_code, house_key, civic_no, civic_suffix, street_name, street_norm, unit_count, lat, lng, footprint, source, geo_source, geo_accuracy, geocoded_at, unit)
    select v_codes[i], house_key, civic_no, civic_suffix, street_name, street_norm, unit_count, lat, lng, footprint, source, geo_source, geo_accuracy, geocoded_at, unit
      from route_houses where route_code = v_src[i];
    insert into route_house_builds (route_code, built_at, source, house_count, footprints_at, footprint_count, geocoded_at, geocode_note)
    select v_codes[i], now(), coalesce(b.source, 'osm'), b.house_count, now(), b.footprint_count, now(), 'demo copy of ' || v_src[i]
      from route_house_builds b where b.route_code = v_src[i];
  end loop;
  v_mapping := jsonb_build_object('prefix', v_pfx, 'areaName', v_area, 'routeStart', 1, 'routeEnd', 4, 'routeCodes', to_jsonb(v_codes));

  -- two managers (the tour runs as Alex; Sam is there to share the map with)
  insert into users (user_id, name, username, password, role, command_center_id, metadata) values
    (v_alex, 'Alex Morgan', 'demo_' || lower(v_code) || '_alex', md5(gen_random_uuid()::text), 'RouteManager', v_center,
     jsonb_build_object('phone', '(555) 010-0001', 'floatingFor', '[]'::jsonb, 'digitalMapping', v_mapping, 'digitalMappings', jsonb_build_array(v_mapping))),
    (v_sam, 'Sam Lee', 'demo_' || lower(v_code) || '_sam', md5(gen_random_uuid()::text), 'RouteManager', v_center,
     jsonb_build_object('phone', '(555) 010-0002', 'floatingFor', '[]'::jsonb, 'digitalMappings', '[]'::jsonb));

  -- six workers on three carts; worker 1 (Jordan) is the one the visitor plays; Vidal is on cart 2 to be moved
  insert into users (user_id, name, password, role, command_center_id, metadata)
  select v_w[g], n, lower(split_part(n, ' ', 1)), 'Worker', v_center,
         jsonb_build_object('phone', '(555) 010-01' || g, 'teamId', t, 'assignedManagerId', v_alex, 'alumniRate', 0, 'silverRate', 0, 'upsellsEnabled', true)
    from (values (1, 'Jordan Reyes', '1'), (2, 'Priya Shah', '1'), (3, 'Vidal Peyton', '2'), (4, 'Marcus Tran', '2'), (5, 'Amara Okafor', '3'), (6, 'Liam Carter', '3')) v(g, n, t);

  v_cart1 := 'sess_1_' || v_stamp; v_cart2 := 'sess_2_' || v_stamp; v_cart3 := 'sess_3_' || v_stamp;
  insert into logsheet_sessions (id, worker_id, team_worker_ids, date, command_center_id, status, stats, email_enabled, equiv_split, upsell_split) values
    (v_cart1, v_w[1], array[v_w[1], v_w[2]], v_date, v_center, 'OPEN', '{}', true, jsonb_build_object(v_w[1], 50, v_w[2], 50), jsonb_build_object(v_w[1], 50, v_w[2], 50)),
    (v_cart2, v_w[3], array[v_w[3], v_w[4]], v_date, v_center, 'OPEN', '{}', true, jsonb_build_object(v_w[3], 50, v_w[4], 50), jsonb_build_object(v_w[3], 50, v_w[4], 50)),
    (v_cart3, v_w[5], array[v_w[5], v_w[6]], v_date, v_center, 'OPEN', '{}', true, jsonb_build_object(v_w[5], 50, v_w[6], 50), jsonb_build_object(v_w[5], 50, v_w[6], 50));

  -- routes on the day: 01 → cart 1, 02 → cart 2; 03 and 04 wait for the manager to assign
  insert into routes (route_code, session_date, command_center_id, manager_id, streets, assigned_worker_ids) values
    (v_codes[1], v_date, v_center, v_alex, '{}', array[v_w[1], v_w[2]]),
    (v_codes[2], v_date, v_center, v_alex, '{}', array[v_w[3], v_w[4]]),
    (v_codes[3], v_date, v_center, v_alex, '{}', '{}'),
    (v_codes[4], v_date, v_center, v_alex, '{}', '{}');

  -- on route 01: the partner's knocks (grey, red, orange, pink), past customers (purple), callbook
  -- clients (blue), an aeration client (lime) and one pending booking (yellow), on real houses
  for h in (select house_key, civic_no, street_name, lat, lng from route_houses where route_code = v_codes[1] and unit is null order by id limit 16) loop
    v_n := v_n + 1;
    if v_n <= 4 then insert into house_dispositions (route_code, house_key, status, command_center_id, worker_id, session_id) values (v_codes[1], h.house_key, 'not_home', v_center::text, v_w[2], v_cart1);
    elsif v_n <= 6 then insert into house_dispositions (route_code, house_key, status, command_center_id, worker_id, session_id) values (v_codes[1], h.house_key, 'no', v_center::text, v_w[2], v_cart1);
    elsif v_n = 7 then insert into house_dispositions (route_code, house_key, status, note, command_center_id, worker_id, session_id) values (v_codes[1], h.house_key, 'go_back', 'Back after 5', v_center::text, v_w[2], v_cart1);
    elsif v_n = 8 then insert into house_dispositions (route_code, house_key, status, note, command_center_id, worker_id, session_id) values (v_codes[1], h.house_key, 'invalid', 'Sealed last month by another company', v_center::text, v_w[2], v_cart1);
    elsif v_n <= 11 then
      insert into route_historical_properties (command_center_id, session_date, route_code, address, customer_name, client_type, property_type, price, payment_type, contractor_name)
      values (v_center, v_date - interval '1 year', v_codes[1], h.civic_no || ' ' || h.street_name, (array['R. Dubois', 'K. Nguyen', 'M. Osei'])[v_n - 8], 'Residential', 'Driveway', '$225.00', 'Cash', 'Last year''s crew');
    elsif v_n <= 14 then
      insert into map_pcl_cache (route_code, area_name, region, prefix, clients, client_count, updated_at)
      values (v_codes[1], v_area, 'East', v_pfx, '[]', 0, now()) on conflict (route_code) do nothing;
      update map_pcl_cache set clients = clients || jsonb_build_array(jsonb_build_object(
          'houseNum', h.civic_no::text, 'streetName', h.street_name, 'lat', h.lat, 'lng', h.lng, 'src', 'crm', 'phone', '',
          'firstName', (array['Dana', 'Omar', 'Lena'])[v_n - 11], 'lastName', (array['Brooks', 'Haddad', 'Fischer'])[v_n - 11],
          'history', jsonb_build_array(jsonb_build_object('date', (v_date - interval '2 years')::text, 'year', extract(year from v_date)::int - 2, 'price', '$200.00', 'contractor', 'A past crew', 'serviceType', 'SS')))),
        client_count = client_count + 1 where route_code = v_codes[1];
    elsif v_n = 15 then
      insert into map_pcl_by_service (route_code, service, clients, client_count, updated_at)
      values (v_codes[1], 'aeration', jsonb_build_array(jsonb_build_object('houseNum', h.civic_no::text, 'streetName', h.street_name, 'lat', h.lat, 'lng', h.lng, 'src', 'crm', 'phone', '',
          'firstName', 'Sofia', 'lastName', 'Marin', 'history', jsonb_build_array(jsonb_build_object('date', (v_date - interval '1 year')::text, 'year', extract(year from v_date)::int - 1, 'price', '$75.00', 'contractor', 'Aeration crew', 'serviceType', 'AER')))), 1, now());
    else
      insert into bookings (booking_id, command_center_id, route_number, status, price, customer_details, log_notes, is_prepaid, session_date, data, services)
      values ('DEMO-' || v_code || '-1', v_center, v_codes[1], 'pending', '250', jsonb_build_object('First Name', 'Grace', 'Last Name', 'Whitfield', 'Full Address', h.civic_no || ' ' || h.street_name, 'Home Phone', '', 'Cell Phone', '', 'Email Address', '', 'FO/BO/FP', ''),
              'Booked by the office — seal the driveway, customer home after 4', false, v_date,
              jsonb_build_object('Booking ID', 'DEMO-' || v_code || '-1', 'Route Number', v_codes[1], 'First Name', 'Grace', 'Last Name', 'Whitfield', 'Full Address', h.civic_no || ' ' || h.street_name, 'Price', '250', 'Service Type', 'SS'),
              '[]'::jsonb);
    end if;
  end loop;

  return jsonb_build_object('code', v_code, 'center_id', v_center, 'date', v_date, 'manager', v_alex, 'other_manager', v_sam,
                            'worker', v_w[1], 'partner', v_w[2], 'mover', v_w[3], 'late', v_w[7], 'routes', to_jsonb(v_codes),
                            'carts', jsonb_build_array(v_cart1, v_cart2, v_cart3), 'booking', 'DEMO-' || v_code || '-1');
end $$;
revoke all on function public.app_demo_start() from public;
grant execute on function public.app_demo_start() to anon, authenticated;

-- Chris turned up late (step 6): the same as Workerbook › Day › Late arrival does.
create or replace function public.app_demo_late_arrival(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s demo_sandboxes; v_id text; v_alex text; v_date date; v_sess text;
begin
  select * into s from demo_sandboxes where code = upper(p_code) and expires_at > now();
  if s.code is null then raise exception 'This demo has ended — start it again'; end if;
  v_id := 'X' || s.code || '7'; v_alex := 'rm_demo' || lower(s.code) || 'alex';
  select date into v_date from daily_sessions where command_center_id = s.center_id and is_active;
  if exists (select 1 from users where user_id = v_id) then return jsonb_build_object('worker', v_id, 'already', true); end if;
  insert into users (user_id, name, password, role, command_center_id, metadata)
  values (v_id, 'Chris Martine', 'chris', 'Worker', s.center_id,
          jsonb_build_object('phone', '(555) 010-0107', 'teamId', v_id, 'assignedManagerId', v_alex, 'alumniRate', 0, 'silverRate', 0, 'upsellsEnabled', true));
  v_sess := 'sess_' || v_id || '_' || (extract(epoch from now()) * 1000)::bigint;
  insert into logsheet_sessions (id, worker_id, team_worker_ids, date, command_center_id, status, stats, email_enabled, equiv_split, upsell_split)
  values (v_sess, v_id, array[v_id], v_date, s.center_id, 'OPEN', '{}', true, jsonb_build_object(v_id, 100), jsonb_build_object(v_id, 100));
  return jsonb_build_object('worker', v_id, 'cart', v_sess);
end $$;
revoke all on function public.app_demo_late_arrival(text) from public;
grant execute on function public.app_demo_late_arrival(text) to anon, authenticated;

-- Sweep sandboxes past their time (and any whose centre is gone). Run hourly.
create or replace function public.app_demo_cleanup()
returns int language plpgsql security definer set search_path = public as $$
declare s demo_sandboxes; n int := 0; like_pfx text;
begin
  for s in select * from demo_sandboxes where expires_at < now() loop
    like_pfx := demo_prefix(s.code) || '%';
    delete from house_dispositions where command_center_id = s.center_id::text or route_code like like_pfx;
    delete from client_visits where route_code like like_pfx;
    delete from transactions where command_center_id = s.center_id;
    delete from pending_sales where command_center_id = s.center_id;
    delete from bookings where command_center_id = s.center_id;
    delete from route_historical_properties where command_center_id = s.center_id;
    delete from route_splits where command_center_id = s.center_id::text;
    delete from logsheet_sessions where command_center_id = s.center_id;
    delete from routes where command_center_id = s.center_id;
    delete from manager_locations where manager_id like 'rm_demo' || lower(s.code) || '%';
    delete from users where command_center_id = s.center_id;
    delete from daily_sessions where command_center_id = s.center_id;
    delete from map_pcl_cache where route_code like like_pfx;
    delete from map_pcl_cache_base where route_code like like_pfx;
    delete from map_pcl_by_service where route_code like like_pfx;
    delete from route_houses where route_code like like_pfx;
    delete from route_house_builds where route_code like like_pfx;
    delete from route_maps where route_code like like_pfx;
    delete from map_area_outlines where area_name = 'DEMO ' || s.code;
    delete from map_area_centers where center_id = s.center_id;
    delete from area_prefixes where area_name = 'DEMO ' || s.code;
    delete from command_centers where id = s.center_id;
    delete from demo_sandboxes where code = s.code;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.app_demo_cleanup() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'demo_cleanup';
    perform cron.schedule('demo_cleanup', '17 * * * *', 'select public.app_demo_cleanup()');
  end if;
end $$;
