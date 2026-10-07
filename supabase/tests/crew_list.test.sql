-- Crew List: center type, pull into a road-trip center, rooms, search, send home → WDR, permissions.
\set ON_ERROR_STOP 1
begin;
insert into command_centers (id, username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id, center_type, cn_prefix)
values ('c0000000-0000-0000-0000-0000000000e1', 'rt-test', 'test-only', 'RT Test', 'wb', 'mb', 'road_trip', 'R'),
       ('c0000000-0000-0000-0000-0000000000e2', 'city-test', 'test-only', 'City Test', 'wb', 'mb', 'in_city', 'K');
insert into people (id, first_name, last_name, cell_phone) values
  ('d0000000-0000-0000-0000-0000000000b1', 'Kim', 'City', '905-555-0201'), ('d0000000-0000-0000-0000-0000000000b2', 'Ken', 'Quit', null),
  ('d0000000-0000-0000-0000-0000000000b3', 'Rae', 'Roadie', null);
insert into hires (id, person_id, center_id, year, cn, status) values
  ('e0000000-0000-0000-0000-0000000000b1', 'd0000000-0000-0000-0000-0000000000b1', 'c0000000-0000-0000-0000-0000000000e2', extract(year from current_date)::int, 'K1001', 'WDR'),
  ('e0000000-0000-0000-0000-0000000000b2', 'd0000000-0000-0000-0000-0000000000b2', 'c0000000-0000-0000-0000-0000000000e2', extract(year from current_date)::int, 'K1002', 'Q'),
  ('e0000000-0000-0000-0000-0000000000b3', 'd0000000-0000-0000-0000-0000000000b3', 'c0000000-0000-0000-0000-0000000000e1', extract(year from current_date)::int, 'R1001', 'active');
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000e9'), ('a0000000-0000-0000-0000-0000000000ea');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000e9', 'rtmgr', 'RT Mgr'), ('a0000000-0000-0000-0000-0000000000ea', 'nobod', 'No Body');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000e9', 'workerbook'), ('a0000000-0000-0000-0000-0000000000ea', 'workerbook');
insert into user_centers (user_id, center_id) values ('a0000000-0000-0000-0000-0000000000e9', 'c0000000-0000-0000-0000-0000000000e1');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000e9', true);
select 'rt list before' k, l->>'type' t, jsonb_array_length(l->'here') here from (select app_crew_list('c0000000-0000-0000-0000-0000000000e1') l) x;
select 'search k1' k, jsonb_array_length(s) n, s->0->>'home' home from (select app_crew_search('c0000000-0000-0000-0000-0000000000e1', 'k10') s) x;
select 'search phone' k, jsonb_array_length(app_crew_search('c0000000-0000-0000-0000-0000000000e1', '0201')) n;
select 'pull kim' k, app_crew_move(array['e0000000-0000-0000-0000-0000000000b1'::uuid], 'c0000000-0000-0000-0000-0000000000e1', '214');
do $$ begin perform app_crew_move(array['e0000000-0000-0000-0000-0000000000b2'::uuid], 'c0000000-0000-0000-0000-0000000000e1', null); raise notice 'FAIL quit pulled';
  exception when others then raise notice 'ok quit blocked: %', sqlerrm; end $$;
select 'rt list after' k, jsonb_array_length(l->'here') here, (select string_agg((r->>'cn') || ':' || coalesce(r->>'room', '-') || ':' || (r->>'status'), ' ') from jsonb_array_elements(l->'here') r) rows
  from (select app_crew_list('c0000000-0000-0000-0000-0000000000e1') l) x;
select app_crew_set_room('e0000000-0000-0000-0000-0000000000b1', ' 305 ');
select 'search excludes crew' k, jsonb_array_length(app_crew_search('c0000000-0000-0000-0000-0000000000e1', 'kim')) n;
select 'send home' k, app_crew_move(array['e0000000-0000-0000-0000-0000000000b1'::uuid], null, null);
-- someone with no access to either center can't move people
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000ea', true);
do $$ begin perform app_crew_move(array['e0000000-0000-0000-0000-0000000000b3'::uuid], null, null); raise notice 'ok (R1001 already home: no-op)';
  exception when others then raise notice 'blocked: %', sqlerrm; end $$;
do $$ begin perform app_crew_list('c0000000-0000-0000-0000-0000000000e1'); raise notice 'FAIL list allowed';
  exception when others then raise notice 'ok list blocked: %', sqlerrm; end $$;
do $$ begin perform app_set_center_type('c0000000-0000-0000-0000-0000000000e2', 'road_trip'); raise notice 'FAIL type changed';
  exception when others then raise notice 'ok type blocked: %', sqlerrm; end $$;
reset role;
select 'kim now' k, current_center_id, room, status from hires where id = 'e0000000-0000-0000-0000-0000000000b1';
select 'kim entries' k, string_agg(status, '>' order by id) from status_entries where hire_id = 'e0000000-0000-0000-0000-0000000000b1';
rollback;
