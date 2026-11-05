-- Map Builder › road pre-load from published files: when the Overpass servers are down, a GitHub job
-- (.github/workflows/osm-roads.yml) cuts the roads out of OpenStreetMap's BC extract and publishes one JSON file per
-- 0.02° square on the osm-roads-data branch. The pre-load job reads a square's file first and only asks Overpass
-- when there is none. Additive only.

create or replace function public.road_prefill_from_file(p_cell text)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare r record; v_n int;
begin
  perform set_config('http.timeout_msec', '20000', true);
  select status, content into r from http_get(format('https://raw.githubusercontent.com/vbaskarCPS/CPSDMS/osm-roads-data/roads/%s.json', replace(p_cell, ':', '_')));
  if r.status <> 200 then return -1; end if;
  insert into road_cache_ways (osm_id, name, unnamed, geom, fetched_at)
  select (w->>'id')::bigint, nullif(w->>'name', ''), coalesce((w->>'unnamed')::boolean, false),
         ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type', 'LineString', 'coordinates', w->'g')::text), 4326), now()
    from jsonb_array_elements(r.content::jsonb) w
   where (w->>'id') ~ '^[0-9]{1,15}$' and jsonb_typeof(w->'g') = 'array' and jsonb_array_length(w->'g') >= 2
  on conflict (osm_id) do update set name = excluded.name, unnamed = excluded.unnamed, geom = excluded.geom, fetched_at = now();
  get diagnostics v_n = row_count;
  insert into road_cache_cells (cell, ways, fetched_at) values (p_cell, v_n, now())
  on conflict (cell) do update set ways = excluded.ways, fetched_at = now();
  update road_prefill_queue set done_at = now(), ways = v_n, last_try = now(), tries = tries + 1, last_error = null where cell = p_cell;
  return v_n;
end $$;

-- every minute: the squares not done yet, from their file when there is one, else from Overpass
create or replace function public.road_prefill_step()
returns int language plpgsql security definer set search_path = public as $$
declare t0 timestamptz := clock_timestamp(); v_cell text; v_done int := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('road_prefill_step')) then return 0; end if;
  loop
    exit when clock_timestamp() - t0 > interval '40 seconds';
    select cell into v_cell from road_prefill_queue
     where done_at is null and (last_try is null or last_try < now() - interval '2 minutes')
     order by tries, queued_at, cell limit 1;
    exit when v_cell is null;
    if road_prefill_from_file(v_cell) >= 0 or road_prefill_cell(v_cell) >= 0 then v_done := v_done + 1; end if;
  end loop;
  return v_done;
end $$;

revoke all on function public.road_prefill_from_file(text) from public, anon, authenticated;
revoke all on function public.road_prefill_step() from public, anon, authenticated;
