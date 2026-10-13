-- Map Builder: delete a route number and shift the later routes of the prefix down one, across maps,
-- with everything filed under them. In a transaction, rolled back.
\set ON_ERROR_STOP 1
begin;

insert into command_centers (id, username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id, center_type, services)
values ('c0000000-0000-0000-0000-0000000000e9', 'zq-test', 'test-only', 'ZQ test', 'wb', 'mb', 'road_trip', '{sealing}');

-- two maps share prefix ZQ: ZQ #1 = ZQ01–ZQ04 (ZQ02 left blank), ZQ #2 = ZQ05–ZQ07
insert into area_prefixes (area_name, prefix, region, route_start, route_count) values
  ('ZQ #1', 'ZQ', 'East', 1, 4), ('ZQ #2', 'ZQ', 'East', 5, 3),
  ('ZQX', 'ZQX', 'East', 1, 2);                     -- a longer prefix that must not move
insert into route_maps (area_name, route_number, route_code, route_color, segments, status) values
  ('ZQ #1', 1, 'ZQ01', '#f00', '[]', 'approved'),
  ('ZQ #1', 3, 'ZQ03', '#0f0', '[]', 'approved'),
  ('ZQ #1', 4, 'ZQ04', '#00f', '[]', 'approved'),
  ('ZQ #2', 5, 'ZQ05', '#f0f', '[]', 'approved'),
  ('ZQ #2', 6, 'ZQ06', '#0ff', '[]', 'approved'),
  ('ZQ #2', 7, 'ZQ07', '#ff0', '[]', 'approved'),
  ('ZQX', 3, 'ZQX03', '#000', '[]', 'approved');
insert into route_street_lines_loaded (route_code) values ('ZQ03'), ('ZQ05') on conflict do nothing;

-- the door-visit log and the trigger that writes it, as on the live database (older local copies lack them)
do $$ begin
  if to_regclass('public.client_visits') is null then
    create table public.client_visits (route_code text not null, house_key text not null, day date not null, status text, note text,
      first_name text, worker_id text, center_id text, at timestamptz default now(), primary key (route_code, house_key, day));
    create or replace function public.crm_keep_visit() returns trigger language plpgsql as $f$
    begin
      if tg_op = 'DELETE' then
        delete from client_visits where route_code = old.route_code and house_key = old.house_key
          and day = (now() at time zone 'America/Toronto')::date and status = old.status;
        return null;
      end if;
      insert into client_visits (route_code, house_key, day, status, worker_id, center_id, at)
      values (new.route_code, new.house_key, (now() at time zone 'America/Toronto')::date, new.status, new.worker_id, new.command_center_id, now())
      on conflict (route_code, house_key, day) do update set status = excluded.status;
      return null;
    end $f$;
    create trigger crm_keep_visit after insert or delete or update on public.house_dispositions for each row execute function public.crm_keep_visit();
  end if;
end $$;

-- houses and a knock on ZQ03 and ZQ05; a client on ZQ03 with job history on ZQ03; one on ZQX03
insert into route_houses (route_code, house_key, civic_no, street_name, street_norm, unit_count, lat, lng, source) values
  ('ZQ03', '10|elm rd', 10, 'Elm Rd', 'elm rd', 1, 43.4, -79.8, 'nar'),
  ('ZQ05', '10|elm rd', 10, 'Elm Rd', 'elm rd', 1, 43.4, -79.8, 'nar'),
  ('ZQ02', '99|oak st', 99, 'Oak St', 'oak st', 1, 43.4, -79.8, 'osm');   -- worked out for the blank route: goes with it
insert into house_dispositions (route_code, house_key, status, command_center_id, worker_id) values
  ('ZQ03', '10|elm rd', 'no', 'cc', 'I1'), ('ZQ05', '10|elm rd', 'not_home', 'cc', 'I1');
update client_visits set day = day - 1 where route_code in ('ZQ03', 'ZQ05');   -- knocked yesterday
insert into clients (address_key, house_no, street_name, street_norm, city, route_code, match_how, people, phones, history) values
  ('zq-1', '10', 'Elm Rd', 'elm rd', 'Testville', 'ZQ03', 'given', '[]', '{}', '[{"year":2025,"route":"ZQ03","price":"199"},{"year":2024,"route":"ZQ07"}]'),
  ('zq-2', '11', 'Elm Rd', 'elm rd', 'Testville', 'ZQX03', 'given', '[]', '{}', '[{"year":2025,"route":"ZQX03"}]');
insert into transactions (id, command_center_id, route_code, customer_snapshot, price)
values ('zq-tx', 'c0000000-0000-0000-0000-0000000000e9', 'ZQ06', '{"routeCode":"ZQ06","address":"1 A St"}', 100);
insert into map_pcl_cache (route_code, area_name, region, prefix, clients, client_count) values ('ZQ04', 'ZQ #1', 'East', 'ZQ', '[]', 0);
insert into users (user_id, role, name, command_center_id, metadata) values
  ('rm_zq', 'RouteManager', 'ZQ Manager', 'c0000000-0000-0000-0000-0000000000e9',
   '{"digitalMappings":[{"prefix":"ZQ","areaName":"ZQ #2","routeStart":5,"routeEnd":7,"routeCodes":["ZQ05","ZQ06","ZQ07"]},
                        {"prefix":"ZQX","areaName":"ZQX","routeStart":1,"routeEnd":2,"routeCodes":["ZQX03"]}]}');

-- signed in with Territory
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000e9');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000e9', 'zqadm', 'ZQ Admin');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000e9', 'sa_territory');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000e9', true);

-- preview: nothing changes
select 'preview' k, app_route_shift_preview('ZQ', 2) p \gset
select 'preview' k, :'p'::jsonb->'maps' maps, :'p'::jsonb->'data' data;
do $$ begin
  if not exists (select 1 from route_maps where route_code = 'ZQ03' and route_number = 3) then raise exception 'preview changed something'; end if;
end $$;

-- blocked: the route to delete has a client on it
select 'blocked in use' k, app_route_shift_preview('ZQ', 3) ->> 'reason' reason, app_route_shift_preview('ZQ', 3) -> 'in_use' in_use;
-- blocked: a later route is on today's live day
insert into daily_sessions (date, command_center_id, is_active) values ((now() at time zone 'America/Toronto')::date, 'c0000000-0000-0000-0000-0000000000e9', true);
insert into routes (route_code, session_date, command_center_id) values ('ZQ06', (now() at time zone 'America/Toronto')::date, 'c0000000-0000-0000-0000-0000000000e9');
select 'blocked live' k, app_route_delete_shift('ZQ', 2) ->> 'reason' reason;
delete from routes where route_code = 'ZQ06';

-- delete ZQ02 (blank) → ZQ03..07 become ZQ02..06 across both maps
select 'apply' k, app_route_delete_shift('ZQ', 2) ->> 'ok' ok;

select 'drawings' k, string_agg(area_name || ':' || route_number || '=' || route_code, ' ' order by area_name, route_number) from route_maps where area_name like 'ZQ%';
select 'maps' k, string_agg(area_name || ' start ' || route_start || ' count ' || route_count, ' | ' order by area_name) from area_prefixes where area_name like 'ZQ%';
select 'houses' k, string_agg(route_code || ' ' || house_key, ', ' order by route_code) from route_houses where route_code like 'ZQ%';
select 'visits' k, string_agg(route_code || ' ' || day, ', ' order by route_code) from client_visits where route_code like 'ZQ%';
select 'knocks' k, string_agg(route_code || ' ' || status, ', ' order by route_code) from house_dispositions where route_code like 'ZQ%';
select 'clients' k, string_agg(address_key || ' ' || route_code || ' ' || history::text, ' | ' order by address_key) from clients where address_key like 'zq-%';
select 'sale' k, route_code, customer_snapshot->>'routeCode' snap from transactions where id = 'zq-tx';
select 'pcl cache' k, string_agg(route_code, ',') from map_pcl_cache where area_name like 'ZQ%';
select 'manager map' k, metadata->'digitalMappings' from users where user_id = 'rm_zq';
select 'audit' k, action, entity_id from audit_log where entity = 'route_maps' and entity_id = 'ZQ02' order by id desc limit 1;

do $$
declare ok boolean;
begin
  ok := (select string_agg(route_number || '=' || route_code, ',' order by route_number) from route_maps where area_name in ('ZQ #1', 'ZQ #2'))
          = '1=ZQ01,2=ZQ02,3=ZQ03,4=ZQ04,5=ZQ05,6=ZQ06'
    and (select route_code from route_maps where area_name = 'ZQX') = 'ZQX03'
    and (select route_start || '/' || route_count from area_prefixes where area_name = 'ZQ #1') = '1/3'
    and (select route_start || '/' || route_count from area_prefixes where area_name = 'ZQ #2') = '4/3'
    and (select route_start || '/' || route_count from area_prefixes where area_name = 'ZQX') = '1/2'
    and not exists (select 1 from route_houses where route_code = 'ZQ02' and house_key = '99|oak st')
    and (select string_agg(route_code, ',' order by route_code) from route_houses where route_code like 'ZQ%') = 'ZQ02,ZQ04'
    and (select string_agg(route_code || status, ',' order by route_code) from house_dispositions where route_code like 'ZQ%') = 'ZQ02no,ZQ04not_home'
    and (select route_code from clients where address_key = 'zq-1') = 'ZQ02'
    and (select history from clients where address_key = 'zq-1') = '[{"year":2025,"route":"ZQ02","price":"199"},{"year":2024,"route":"ZQ06"}]'::jsonb
    and (select route_code from clients where address_key = 'zq-2') = 'ZQX03'
    and (select history from clients where address_key = 'zq-2') = '[{"year":2025,"route":"ZQX03"}]'::jsonb
    and (select route_code || (customer_snapshot->>'routeCode') from transactions where id = 'zq-tx') = 'ZQ05ZQ05'
    and (select string_agg(route_code, ',') from map_pcl_cache where area_name like 'ZQ%') = 'ZQ03'
    and (select metadata->'digitalMappings'->0 from users where user_id = 'rm_zq') = '{"prefix":"ZQ","areaName":"ZQ #2","routeStart":4,"routeEnd":6,"routeCodes":["ZQ04","ZQ05","ZQ06"]}'::jsonb
    and (select metadata->'digitalMappings'->1 from users where user_id = 'rm_zq') = '{"prefix":"ZQX","areaName":"ZQX","routeStart":1,"routeEnd":2,"routeCodes":["ZQX03"]}'::jsonb
    and (select tgenabled from pg_trigger where tgname = 'route_maps_lines') = 'O'
    and exists (select 1 from audit_log where entity = 'route_maps' and entity_id = 'ZQ02' and action = 'delete_shift')
    -- the door visits moved with their routes, and the renumber logged no new visit
    and (select string_agg(route_code || '@' || (day = (now() at time zone 'America/Toronto')::date - 1), ',' order by route_code) from client_visits where route_code like 'ZQ%') = 'ZQ02@true,ZQ04@true'
    and (select tgenabled from pg_trigger where tgname = 'crm_keep_visit') = 'O';
  if not ok then raise exception 'route_delete_shift: results not as expected'; end if;
end $$;

-- not signed in with Territory: refused
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000ee', true);
do $$ begin
  begin perform app_route_delete_shift('ZQ', 1); raise exception 'should have been refused';
  exception when insufficient_privilege then null; end;
end $$;

select 'ALL OK' k;
rollback;
