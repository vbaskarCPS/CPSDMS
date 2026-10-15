-- Master Bookings rounds (RUN_26): the seed, level reads, bulk taps, starting rounds, carried invalids.
-- Run after the migration in the same transaction; everything is rolled back.
\set ON_ERROR_STOP 1

-- older local copies lack these (the live database has them)
alter table area_prefixes add column if not exists city text;
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
  if to_regprocedure('public.crm_house_key(text,text)') is null then
    create function public.crm_house_key(p_house text, p_street_norm text) returns text language sql immutable as
      $f$ select lower(regexp_replace(coalesce(p_house, ''), '\s+', '', 'g')) || '|' || coalesce(p_street_norm, '') $f$;
  end if;
end $$;
\i :mig

insert into command_centers (id, username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id, center_type, services)
values ('c0000000-0000-0000-0000-0000000000f1', 'mbq-test', 'test-only', 'MBQ test', 'wb', 'mb', 'road_trip', '{sealing}');
insert into area_prefixes (area_name, prefix, region, route_start, route_count, city) values ('MBQ #1', 'MBQ', 'East', 1, 2, 'Testville');
insert into map_area_centers (area_name, center_id) values ('MBQ #1', 'c0000000-0000-0000-0000-0000000000f1');
insert into route_maps (area_name, route_number, route_code, route_color, segments, status) values
  ('MBQ #1', 1, 'MBQ01', '#f00', '[{"osmId":1,"name":"Elm Rd","coordinates":[[-79.80,43.50],[-79.79,43.50]]}]', 'approved'),
  ('MBQ #1', 2, 'MBQ02', '#0f0', '[]', 'approved');
-- MBQ01: 10 houses, 6 on Elm Rd, 4 on Oak St; MBQ02: 20 houses on Pine Ave
insert into route_houses (route_code, house_key, civic_no, street_name, street_norm, lat, lng, source)
select 'MBQ01', n || '|elm rd', n, 'Elm Rd', 'elm rd', 43.50, -79.80 + n * 0.0001, 'nar' from generate_series(1, 6) n
union all select 'MBQ01', n || '|oak st', n, 'Oak St', 'oak st', 43.501, -79.80 + n * 0.0001, 'nar' from generate_series(1, 4) n
union all select 'MBQ02', n || '|pine ave', n, 'Pine Ave', 'pine ave', 43.502, -79.80 + n * 0.0001, 'nar' from generate_series(1, 20) n;
insert into route_street_lines (route_code, street_norm, street_base, line) values
  ('MBQ01', 'elm rd', 'elm', 'SRID=4326;LINESTRING(-79.80 43.50, -79.79 43.50)'::geography),
  ('MBQ01', 'oak st', 'oak', 'SRID=4326;LINESTRING(-79.80 43.501, -79.79 43.501)'::geography),
  ('MBQ02', 'pine ave', 'pine', 'SRID=4326;LINESTRING(-79.80 43.502, -79.79 43.502)'::geography);

-- Round 1 knocks, 10 days ago: MBQ01 all 6 on Elm Rd (a minute apart; 1 invalid), none on Oak St → 60%, done.
-- MBQ02: 15 taps one second apart (bulk: only the first counts) and 2 real ones → 3 of 20 counted, flagged.
insert into client_visits (route_code, house_key, day, status, worker_id, at)
select 'MBQ01', n || '|elm rd', current_date - 10, case when n = 1 then 'invalid' else 'not_home' end, 'W1',
       (current_date - 10)::timestamp at time zone 'America/Toronto' + interval '15 hours' + n * interval '1 minute'
  from generate_series(1, 6) n;
insert into client_visits (route_code, house_key, day, status, worker_id, at)
select 'MBQ02', n || '|pine ave', current_date - 10, 'no', 'W2',
       (current_date - 10)::timestamp at time zone 'America/Toronto' + interval '16 hours' + n * interval '1 second'
  from generate_series(1, 15) n;
insert into client_visits (route_code, house_key, day, status, worker_id, at)
select 'MBQ02', n || '|pine ave', current_date - 9, 'not_home', 'W2',
       (current_date - 9)::timestamp at time zone 'America/Toronto' + interval '16 hours' + n * interval '2 minutes'
  from generate_series(16, 17) n;
insert into house_dispositions (route_code, house_key, status, command_center_id, worker_id)
select route_code, house_key, status, 'c0000000-0000-0000-0000-0000000000f1', worker_id from client_visits where route_code like 'MBQ%';
-- (the trigger just logged these as today's visits too; this test's history is the rows above)
delete from client_visits where route_code like 'MBQ%' and day = current_date;

insert into clients (address_key, house_no, street_name, street_norm, city, route_code, lat, lng, history) values
  ('mbq-1', '2', 'Elm Rd', 'elm rd', 'Testville', 'MBQ01', 43.50, -79.7998, '[{"line":"sealing","year":2025},{"line":"aeration","year":2024}]'),
  ('mbq-2', '3', 'Pine Ave', 'pine ave', 'Testville', 'MBQ02', 43.502, -79.7997, '[{"line":"sealing","year":2026}]');

-- the seed: re-run it now that there are knocks (the migration ran before them)
insert into mb_rounds (area_name, service, season, round_no, started_at, note)
select rm.area_name, 'sealing', extract(year from current_date)::int, 1, min(v.day)::timestamp at time zone 'America/Toronto', 'seed'
  from client_visits v join route_maps rm on rm.route_code = v.route_code and rm.status = 'approved'
 where rm.area_name = 'MBQ #1' group by rm.area_name;

-- signed in with Master Bookings, at this center
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000f1');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000f1', 'mbqad', 'MBQ Admin');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000f1', 'bookings');
insert into user_centers values ('a0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000f1');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f1', true);
\set yr `date +%Y`

select 'overview' k, jsonb_pretty(app_mb_overview('c0000000-0000-0000-0000-0000000000f1', 'sealing', :yr) -> 'maps' -> 0) o \gset
\echo :o
do $$
declare m jsonb := app_mb_overview('c0000000-0000-0000-0000-0000000000f1', 'sealing', extract(year from current_date)::int) -> 'maps' -> 0;
        r jsonb := m -> 'rounds' -> 0;
begin
  if (m->>'routes')::int <> 2 or m->>'first' <> 'MBQ01' or m->>'last' <> 'MBQ02' then raise exception 'routes wrong: %', m; end if;
  if (m->>'prev_sealing')::int <> 1 or (m->>'prev_aeration')::int <> 1 or (m->>'done_sealing')::int <> 1 then raise exception 'clients wrong: %', m; end if;
  if (r->>'no')::int <> 1 or (r->>'done')::int <> 1 or (r->>'flagged')::int <> 1 or (r->>'routes')::int <> 2 then raise exception 'round wrong: %', r; end if;
  if (r->>'knocked')::int <> 9 or (r->>'doors')::int <> 30 or jsonb_array_length(r->'days') <> 2 then raise exception 'round counts wrong: %', r; end if;
  if (m->>'current')::int <> 1 or (m->>'shown')::int <> 1 or (m->>'loose')::int <> 0 then raise exception 'current wrong: %', m; end if;
  if (m->>'suggest_new')::boolean then raise exception 'should not suggest yet (9 days)'; end if;
end $$;

-- level 2: routes, street heat, knocks, clients
do $$
declare v jsonb := app_mb_area_view(array['MBQ #1'], 'sealing', extract(year from current_date)::int, null);
        r1 jsonb; r2 jsonb; elm jsonb; oak jsonb;
begin
  select x into r1 from jsonb_array_elements(v->'routes') x where x->>'code' = 'MBQ01';
  select x into r2 from jsonb_array_elements(v->'routes') x where x->>'code' = 'MBQ02';
  if (r1->>'pct')::int <> 60 or not (r1->>'done')::boolean or (r1->>'flagged')::boolean then raise exception 'MBQ01 wrong: %', r1; end if;
  if (r2->>'pct')::int <> 15 or (r2->>'done')::boolean or not (r2->>'flagged')::boolean then raise exception 'MBQ02 wrong: %', r2; end if;
  select x into elm from jsonb_array_elements(v->'streets') x where x->>1 = 'elm rd';
  select x into oak from jsonb_array_elements(v->'streets') x where x->>1 = 'oak st';
  if (elm->>2)::int <> 6 or (elm->>3)::int <> 6 or (oak->>2)::int <> 4 or (oak->>3)::int <> 0 then raise exception 'streets wrong: % %', elm, oak; end if;
  if elm->4->>'type' is null then raise exception 'street line missing'; end if;
  if jsonb_array_length(v->'knocks') <> 23 then raise exception 'knocks: %', jsonb_array_length(v->'knocks'); end if;
  if jsonb_array_length(v->'clients') <> 2 then raise exception 'clients: %', v->'clients'; end if;
end $$;

-- level 3 and one house
do $$
declare v jsonb := app_mb_route('MBQ01', 'sealing', extract(year from current_date)::int, null); h jsonb; hs jsonb;
begin
  if jsonb_array_length(v->'houses') <> 10 or (v->>'doors')::int <> 10 or (v->>'knocked')::int <> 6 then raise exception 'route wrong: %', v - 'houses' - 'streets'; end if;
  select x into h from jsonb_array_elements(v->'houses') x where x->>'k' = '2|elm rd';
  if h->>'st' <> 'not_home' or h->>'c' is null or (h->>'f')::int <> 3 then raise exception 'house wrong: %', h; end if;
  hs := app_mb_house('MBQ01', '2|elm rd');
  if jsonb_array_length(hs->'visits') <> 1 or (hs->'visits'->0->'rounds'->0->>'no')::int <> 1 or hs->'client'->>'id' is null then raise exception 'house history wrong: %', hs; end if;
end $$;

-- settings
select 'settings' k, app_mb_save_settings('c0000000-0000-0000-0000-0000000000f1', 'sealing', :yr, null, 70);
do $$ begin
  if ((app_mb_overview('c0000000-0000-0000-0000-0000000000f1', 'sealing', extract(year from current_date)::int) -> 'maps' -> 0 -> 'rounds' -> 0 ->> 'done')::int) <> 0 then
    raise exception 'threshold 70%% should leave no route done';
  end if;
end $$;
select app_mb_save_settings('c0000000-0000-0000-0000-0000000000f1', 'sealing', :yr, null, 50) is not null k;

-- Round 2: knocks cleared and copied, history kept
select 'round 2' k, app_mb_start_round('MBQ #1', 'sealing', :yr);
do $$ begin
  if exists (select 1 from house_dispositions where route_code like 'MBQ%') then raise exception 'knocks not cleared'; end if;
  if (select count(*) from mb_cleared_knocks ck join mb_rounds r on r.id = ck.round_id where r.area_name = 'MBQ #1') <> 23 then raise exception 'copy missing'; end if;
  if (select count(*) from client_visits where route_code like 'MBQ%') <> 23 then raise exception 'history touched'; end if;
  if (select tgenabled from pg_trigger where tgname = 'crm_keep_visit') <> 'O' then raise exception 'trigger left off'; end if;
  if (select count(*) from mb_rounds where area_name = 'MBQ #1' and ended_at is null) <> 1 then raise exception 'one open round'; end if;
end $$;

-- Round 2 worked (backdate it two days so its knocks fall inside), 1|elm rd invalid again → Round 3 carries it
update mb_rounds set started_at = now() - interval '2 days' where area_name = 'MBQ #1' and round_no = 2;
update mb_rounds set ended_at = now() - interval '2 days' where area_name = 'MBQ #1' and round_no = 1;
insert into client_visits (route_code, house_key, day, status, worker_id, at) values
  ('MBQ01', '1|elm rd', current_date - 1, 'invalid', 'W3', now() - interval '1 day'),
  ('MBQ01', '2|elm rd', current_date - 1, 'invalid', 'W3', now() - interval '1 day' + interval '5 minutes');
select 'round 3' k, app_mb_start_round('MBQ #1', 'sealing', :yr);
do $$ begin
  if (select string_agg(route_code || ' ' || house_key, ',') from mb_carried_invalids ci join mb_rounds r on r.id = ci.round_id where r.round_no = 3 and r.area_name = 'MBQ #1') <> 'MBQ01 1|elm rd' then
    raise exception 'carried wrong';
  end if;
  if (select string_agg(house_key || ' ' || status, ',') from house_dispositions where route_code like 'MBQ%') <> '1|elm rd invalid' then raise exception 'carried knock wrong'; end if;
  if (select count(*) from client_visits where route_code like 'MBQ%' and day = current_date) <> 0 then raise exception 'carried invalid logged as a visit'; end if;
  if (app_mb_route('MBQ01', 'sealing', extract(year from current_date)::int, null) ->> 'doors')::int <> 9 then raise exception 'carried door still counted'; end if;
  if (app_mb_overview('c0000000-0000-0000-0000-0000000000f1', 'sealing', extract(year from current_date)::int) -> 'maps' -> 0 ->> 'current')::int <> 3 then raise exception 'current not 3'; end if;
  if (app_mb_area_view(array['MBQ #1'], 'sealing', extract(year from current_date)::int, 2) -> 'maps' -> 0 ->> 'round')::int <> 2 then raise exception 'picked round'; end if;
end $$;

-- a past season can't get a new round; not signed in with Master Bookings: refused
do $$ begin
  begin perform app_mb_start_round('MBQ #1', 'sealing', 2020); raise exception 'past season allowed';
  exception when others then if sqlerrm not like 'Rounds can only%' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000ee', true);
do $$ begin
  begin perform app_mb_overview('c0000000-0000-0000-0000-0000000000f1', 'sealing', 2026); raise exception 'should have been refused';
  exception when insufficient_privilege then null; end;
  begin perform app_mb_start_round('MBQ #1', 'sealing', 2026); raise exception 'should have been refused';
  exception when insufficient_privilege then null; end;
end $$;

select 'ALL OK' k;
