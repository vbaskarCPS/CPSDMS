-- Territory outlines (RUN_33b): every master map's outline, kept between calls and dropped when its routes change.
-- Run after the migration in the same transaction; everything is rolled back.
\set ON_ERROR_STOP 1
\i :mig

insert into route_maps (area_name, route_number, route_code, route_color, segments, status) values
  ('TOQ #1', 1, 'TOQ01', '#f00', '[{"osmId":1,"name":"Elm Rd","coordinates":[[-79.80,43.50],[-79.79,43.50]]},{"osmId":2,"name":"Oak St","coordinates":[[-79.80,43.51],[-79.79,43.51]]}]', 'approved'),
  ('TOQ #1', 2, 'TOQ02', '#0f0', '[{"osmId":3,"name":"Pine Ave","coordinates":[[-79.795,43.49],[-79.795,43.52]]}]', 'approved'),
  ('TOQ #2', 1, 'TOR01', '#00f', '[{"osmId":4,"name":"Ash Cres","coordinates":[[-79.70,43.40],[-79.69,43.41]]},{"osmId":5,"name":"Fir Ln","coordinates":[[-79.70,43.41],[-79.69,43.40]]}]', 'approved'),
  ('TOQ #3', 1, 'TOS01', '#00f', '[{"osmId":6,"name":"Bad","coordinates":[[-79.6,43.3]]}]', 'pending');

-- signed in with Territory
insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000f7');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000f7', 'toqad', 'TOQ Admin');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000f7', 'sa_territory');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000f7', true);

do $$
declare v jsonb := app_territory_outlines(); t timestamptz;
begin
  if not (v ? 'TOQ #1' and v ? 'TOQ #2') then raise exception 'missing outlines: %', v; end if;
  if v ? 'TOQ #3' then raise exception 'a map with no approved routes got an outline'; end if;
  if v->'TOQ #1'->>'type' <> 'Polygon' then raise exception 'outline is not a polygon: %', v->'TOQ #1'; end if;
  if (select count(*) from map_area_outlines where area_name like 'TOQ%') <> 2 then raise exception 'not kept'; end if;
  select made_at into t from map_area_outlines where area_name = 'TOQ #2';
  -- a second call reuses what was kept
  perform app_territory_outlines();
  if (select made_at from map_area_outlines where area_name = 'TOQ #2') <> t then raise exception 'worked out again for no reason'; end if;
  -- a route changes: that map's outline is dropped and worked out again, the other kept
  update route_maps set segments = '[{"osmId":4,"name":"Ash Cres","coordinates":[[-79.70,43.40],[-79.60,43.45]]},{"osmId":5,"name":"Fir Ln","coordinates":[[-79.70,43.45],[-79.60,43.40]]}]' where route_code = 'TOR01';
  if exists (select 1 from map_area_outlines where area_name = 'TOQ #2') then raise exception 'changed map still kept'; end if;
  v := app_territory_outlines();
  if (v->'TOQ #2'->'coordinates'->0) is null or (v->'TOQ #2')::text not like '%-79.6%' then raise exception 'new outline not used: %', v->'TOQ #2'; end if;
  -- a map renamed / deleted: gone from the list
  delete from route_maps where area_name = 'TOQ #2';
  if app_territory_outlines() ? 'TOQ #2' then raise exception 'deleted map still listed'; end if;
  raise notice 'territory outlines: ok';
end $$;

-- not signed in with Territory: refused; and nobody reads the kept table directly
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000ee', true);
do $$ begin
  begin perform app_territory_outlines(); raise exception 'should have been refused';
  exception when others then if sqlerrm <> 'Not allowed' then raise; end if; end;
  if has_table_privilege('authenticated', 'public.map_area_outlines', 'select') then raise exception 'table readable'; end if;
  raise notice 'refused: ok';
end $$;
