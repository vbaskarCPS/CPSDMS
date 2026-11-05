-- Map Builder › pre-loading roads. The free Overpass road servers are often overloaded or down, so opening a new
-- area in the builder can wait minutes. This fills the builder's road cache (road_cache_cells / road_cache_ways,
-- the same 0.02° squares the builder saves) ahead of time: squares are queued with road_prefill_queue_box, and a job
-- every minute asks the road servers for the next few (about 45 seconds of work), saving each one as it comes.
-- A square whose server is down is simply tried again on a later run. Additive only.

create table if not exists public.road_prefill_queue (
  cell text primary key,            -- "lat index:lng index" of a 0.02° square, as the builder's cache uses
  label text,                       -- what it was queued for ("Surrey", "White Rock")
  queued_at timestamptz not null default now(),
  tries int not null default 0,
  last_try timestamptz,
  last_error text,
  done_at timestamptz,
  ways int
);
alter table public.road_prefill_queue enable row level security;

-- queue every square in a box that the cache doesn't have yet; returns how many were queued
create or replace function public.road_prefill_queue_box(p_label text, p_s float8, p_w float8, p_n float8, p_e float8)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  insert into road_prefill_queue (cell, label)
  select format('%s:%s', i, j), p_label
    from generate_series(floor(p_s / 0.02 + 1e-9)::int, floor(p_n / 0.02 + 1e-9)::int) i,
         generate_series(floor(p_w / 0.02 + 1e-9)::int, floor(p_e / 0.02 + 1e-9)::int) j
   where not exists (select 1 from road_cache_cells c where c.cell = format('%s:%s', i, j))
  on conflict (cell) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- one square: the builder's own query, from the first road server that answers
create or replace function public.road_prefill_cell(p_cell text)
returns int language plpgsql security definer set search_path = public, extensions as $$   -- http lives in extensions
declare
  i int := split_part(p_cell, ':', 1)::int; j int := split_part(p_cell, ':', 2)::int;
  v_box text; v_q text; v_url text; r record; v_json jsonb; v_n int; v_err text := '';
begin
  v_box := format('%s,%s,%s,%s', round((i * 0.02)::numeric, 6), round((j * 0.02)::numeric, 6), round(((i + 1) * 0.02)::numeric, 6), round(((j + 1) * 0.02)::numeric, 6));
  v_q := format('[out:json][timeout:25];(way["highway"]["name"](%s);way["highway"]["highway"~"residential|service|unclassified|living_street"][!"name"](%s););out geom;', v_box, v_box);
  perform set_config('http.timeout_msec', '20000', true);
  foreach v_url in array array['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'] loop
    begin
      select status, content into r from http(('POST', v_url, array[]::http_header[], 'application/x-www-form-urlencoded',
        'data=' || replace(replace(replace(replace(v_q, '%', '%25'), '&', '%26'), '+', '%2B'), ';', '%3B'))::http_request);
      if r.status <> 200 then v_err := v_err || format('%s %s; ', split_part(v_url, '/', 3), r.status); continue; end if;
      v_json := r.content::jsonb;
      -- a server that ran out of time answers 200 with a remark: not a real (empty) answer
      if coalesce(v_json->>'remark', '') ~* 'error|timed out|out of memory' then v_err := v_err || format('%s busy; ', split_part(v_url, '/', 3)); continue; end if;
      insert into road_cache_ways (osm_id, name, unnamed, geom, fetched_at)
      select (el->>'id')::bigint, nullif(el->'tags'->>'name', ''), (el->'tags'->>'name') is null,
             ST_SetSRID(ST_MakeLine(array_agg(ST_MakePoint((pt->>'lon')::float8, (pt->>'lat')::float8) order by o)), 4326), now()
        from jsonb_array_elements(coalesce(v_json->'elements', '[]'::jsonb)) el,
             jsonb_array_elements(el->'geometry') with ordinality g(pt, o)
       where el->>'type' = 'way' and jsonb_typeof(el->'geometry') = 'array' and jsonb_array_length(el->'geometry') >= 2
       group by el
      on conflict (osm_id) do update set name = excluded.name, unnamed = excluded.unnamed, geom = excluded.geom, fetched_at = now();
      get diagnostics v_n = row_count;
      insert into road_cache_cells (cell, ways, fetched_at) values (p_cell, v_n, now())
      on conflict (cell) do update set ways = excluded.ways, fetched_at = now();
      update road_prefill_queue set done_at = now(), ways = v_n, last_try = now(), tries = tries + 1, last_error = null where cell = p_cell;
      return v_n;
    exception when others then
      v_err := v_err || format('%s: %s; ', split_part(v_url, '/', 3), left(sqlerrm, 80));
    end;
  end loop;
  update road_prefill_queue set last_try = now(), tries = tries + 1, last_error = left(v_err, 500) where cell = p_cell;
  return -1;
end $$;

-- every minute: the squares not done yet (least tried first), for about 45 seconds; one run at a time
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
    if road_prefill_cell(v_cell) >= 0 then v_done := v_done + 1; end if;
  end loop;
  return v_done;
end $$;

revoke all on function public.road_prefill_queue_box(text, float8, float8, float8, float8) from public, anon, authenticated;
revoke all on function public.road_prefill_cell(text) from public, anon, authenticated;
revoke all on function public.road_prefill_step() from public, anon, authenticated;

select cron.schedule('road-prefill', '* * * * *', 'select public.road_prefill_step()');
