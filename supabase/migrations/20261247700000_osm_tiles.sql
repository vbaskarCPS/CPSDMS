-- Map Builder › streets from the published OpenStreetMap tiles (osm-data branch: streets/{i}_{j}.json, 0.1° tiles for
-- the populated parts of BC, Ontario and Alberta; see .github/workflows/osm-data.yml). When the builder opens ground
-- its road cache doesn't have yet, it asks road_cache_fill first: the tiles covering those squares are loaded into
-- the cache (each 0.1° tile = 5 × 5 of the cache's 0.02° squares), and only squares with no tile go to Overpass.
-- The background pre-load (road_prefill_from_file) reads the same tiles. Additive only.

create or replace function public.osm_data_url(p_path text)
returns text language sql immutable set search_path = public as $$
  select 'https://raw.githubusercontent.com/vbaskarCPS/CPSDMS/osm-data/' || p_path
$$;

-- one 0.1° street tile into the road cache; -1 when there's no tile for that ground
create or replace function public.road_tile_load(p_i int, p_j int)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare r record; v_n int;
begin
  perform set_config('http.timeout_msec', '6000', true);
  select status, content into r from http_get(osm_data_url(format('streets/%s_%s.json', p_i, p_j)));
  if r.status <> 200 then return -1; end if;
  insert into road_cache_ways (osm_id, name, unnamed, geom, fetched_at)
  select (w->>'id')::bigint, nullif(w->>'name', ''), coalesce((w->>'unnamed')::boolean, false),
         ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type', 'LineString', 'coordinates', w->'g')::text), 4326), now()
    from jsonb_array_elements(r.content::jsonb) w
   where (w->>'id') ~ '^[0-9]{1,15}$' and jsonb_typeof(w->'g') = 'array' and jsonb_array_length(w->'g') >= 2
  on conflict (osm_id) do update set name = excluded.name, unnamed = excluded.unnamed, geom = excluded.geom, fetched_at = now();
  get diagnostics v_n = row_count;
  insert into road_cache_cells (cell, ways, fetched_at)
  select format('%s:%s', 5 * p_i + a, 5 * p_j + b), v_n, now() from generate_series(0, 4) a, generate_series(0, 4) b
  on conflict (cell) do update set ways = excluded.ways, fetched_at = now();
  update road_prefill_queue set done_at = now(), ways = v_n, last_try = now(), last_error = null
   where done_at is null and cell in (select format('%s:%s', 5 * p_i + a, 5 * p_j + b) from generate_series(0, 4) a, generate_series(0, 4) b);
  return v_n;
end $$;
revoke all on function public.road_tile_load(int, int) from public, anon, authenticated;

-- the builder: load one tile for squares the cache doesn't have (a dense city tile takes ~4 s, and a call gets 8 s);
-- returns the squares that are in the cache now. The builder calls it again while it keeps filling squares.
create or replace function public.road_cache_fill(p_cells text[])
returns text[] language plpgsql security definer set search_path = public as $$
declare t0 timestamptz := clock_timestamp(); t record; v_out text[];
begin
  if not road_cache_allowed() then raise exception 'Not allowed'; end if;
  if coalesce(array_length(p_cells, 1), 0) > 400 then raise exception 'Too many cells'; end if;
  for t in select distinct floor(split_part(c, ':', 1)::int / 5.0)::int i, floor(split_part(c, ':', 2)::int / 5.0)::int j
             from unnest(p_cells) c
            where c ~ '^-?\d+:-?\d+$' and not exists (select 1 from road_cache_cells k where k.cell = c) loop
    exit when clock_timestamp() - t0 > interval '1 second';   -- one tile per call (a missing tile is instant)
    perform road_tile_load(t.i, t.j);
  end loop;
  select array_agg(c) into v_out from unnest(p_cells) c where exists (select 1 from road_cache_cells k where k.cell = c);
  return coalesce(v_out, '{}');
end $$;
revoke all on function public.road_cache_fill(text[]) from public, anon;
grant execute on function public.road_cache_fill(text[]) to authenticated;

-- the background pre-load reads the tiles too
create or replace function public.road_prefill_from_file(p_cell text)
returns int language plpgsql security definer set search_path = public as $$
begin
  return road_tile_load(floor(split_part(p_cell, ':', 1)::int / 5.0)::int, floor(split_part(p_cell, ':', 2)::int / 5.0)::int);
end $$;
revoke all on function public.road_prefill_from_file(text) from public, anon, authenticated;
