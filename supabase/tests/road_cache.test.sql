-- Road cache (RUN_56). Run after the migration in the same transaction; everything is rolled back.
\set ON_ERROR_STOP 1
\i :mig

insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000c1'), ('a0000000-0000-0000-0000-0000000000c2');
insert into app_users (id, username, full_name) values
  ('a0000000-0000-0000-0000-0000000000c1', 'rcter', 'Road Territory'),
  ('a0000000-0000-0000-0000-0000000000c2', 'rcnob', 'Road Nobody');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000c1', 'sa_territory');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c1', true);

do $$
declare v jsonb; n int;
begin
  -- nothing saved yet
  v := road_cache_get(array['2172:-3990','2172:-3989'], 43.44, -79.80, 43.46, -79.77);
  if jsonb_array_length(v->'have') <> 0 or jsonb_array_length(v->'ways') <> 0 then raise exception 'not empty: %', v; end if;
  -- a first batch without cells: roads saved, cells not yet loaded
  n := road_cache_put(null, '[{"id":11,"name":"Elm Rd","unnamed":false,"g":[[-79.79,43.45],[-79.78,43.45]]},
                              {"id":12,"name":"","unnamed":true,"g":[[-79.785,43.445],[-79.785,43.455],[-79.784,43.456]]},
                              {"id":13,"name":"Bad","g":[[-79.79,43.45]]}]');
  if n <> 2 then raise exception 'saved % (one-point road should be skipped)', n; end if;
  v := road_cache_get(array['2172:-3990','2172:-3989'], 43.44, -79.80, 43.46, -79.77);
  if jsonb_array_length(v->'have') <> 0 then raise exception 'cells loaded too early'; end if;
  if jsonb_array_length(v->'ways') <> 2 then raise exception 'roads not read back: %', v; end if;
  -- last batch with cells; an update to a road replaces it
  n := road_cache_put(array['2172:-3990','2172:-3989'], '[{"id":11,"name":"Elm Road","unnamed":false,"g":[[-79.79,43.45],[-79.775,43.45]]}]');
  v := road_cache_get(array['2172:-3990','2172:-3989','2173:-3990'], 43.44, -79.80, 43.46, -79.77);
  if jsonb_array_length(v->'have') <> 2 or v->'have' ? '2173:-3990' then raise exception 'wrong cells: %', v->'have'; end if;
  if (select name from road_cache_ways where osm_id = 11) <> 'Elm Road' then raise exception 'not replaced'; end if;
  if not exists (select 1 from jsonb_array_elements(v->'ways') w where w->>'name' = 'Elm Road' and jsonb_array_length(w->'g') = 2) then
    raise exception 'line not returned: %', v->'ways';
  end if;
  -- a road outside the box is not returned
  perform road_cache_put(null, '[{"id":14,"name":"Far St","g":[[-79.5,43.7],[-79.49,43.7]]}]');
  if exists (select 1 from jsonb_array_elements(road_cache_get(array[]::text[], 43.44, -79.80, 43.46, -79.77)->'ways') w where w->>'id' = '14') then
    raise exception 'far road returned';
  end if;
  -- old cells count as not loaded
  update road_cache_cells set fetched_at = now() - interval '200 days' where cell = '2172:-3990';
  if road_cache_get(array['2172:-3990'], 43.44, -79.80, 43.46, -79.77)->'have' ? '2172:-3990' then raise exception 'stale cell counted'; end if;
  -- limits
  begin perform road_cache_get(null, 43, -80, 44, -79); raise exception 'huge box allowed'; exception when others then
    if sqlerrm not like '%too big%' then raise; end if; end;
  raise notice 'road cache (territory): ok';
end $$;

-- without Territory: refused both ways
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000c2', true);
do $$
begin
  begin perform road_cache_get(array['1:1'], 43.44, -79.80, 43.46, -79.77); raise exception 'get allowed'; exception when others then
    if sqlerrm <> 'Not allowed' then raise; end if; end;
  begin perform road_cache_put(array['1:1'], '[]'); raise exception 'put allowed'; exception when others then
    if sqlerrm <> 'Not allowed' then raise; end if; end;
  raise notice 'road cache (no permission): ok';
end $$;
