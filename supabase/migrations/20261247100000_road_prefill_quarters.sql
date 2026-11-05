-- Map Builder › road pre-load in quarter squares: each 0.02° square is asked for in four 0.01° quarters, each saved
-- as it comes, so a busy road server only has to answer small requests. The square counts as loaded (and the builder
-- reads it from the cache) once all four quarters are in. Additive only.

alter table public.road_prefill_queue add column if not exists parts_done int[] not null default '{}';

create or replace function public.road_prefill_cell(p_cell text)
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  i int := split_part(p_cell, ':', 1)::int; j int := split_part(p_cell, ':', 2)::int;
  q int; qs numeric; qw numeric; v_box text; v_q text; v_url text; r record; v_json jsonb; v_n int; v_total int := 0;
  v_err text := ''; v_ok boolean; v_done int[];
begin
  select parts_done into v_done from road_prefill_queue where cell = p_cell;
  v_done := coalesce(v_done, '{}');
  perform set_config('http.timeout_msec', '12000', true);
  for q in 0..3 loop
    continue when q = any (v_done);
    qs := round((i * 0.02 + (q / 2) * 0.01)::numeric, 6); qw := round((j * 0.02 + (q % 2) * 0.01)::numeric, 6);
    v_box := format('%s,%s,%s,%s', qs, qw, qs + 0.01, qw + 0.01);
    v_q := format('[out:json][timeout:15];(way["highway"]["name"](%s);way["highway"]["highway"~"residential|service|unclassified|living_street"][!"name"](%s););out geom;', v_box, v_box);
    v_ok := false;
    foreach v_url in array array['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'] loop
      begin
        select status, content into r from http(('POST', v_url, array[]::http_header[], 'application/x-www-form-urlencoded',
          'data=' || replace(replace(replace(replace(v_q, '%', '%25'), '&', '%26'), '+', '%2B'), ';', '%3B'))::http_request);
        if r.status <> 200 then v_err := v_err || format('%s %s; ', split_part(v_url, '/', 3), r.status); continue; end if;
        v_json := r.content::jsonb;
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
        v_total := v_total + v_n;
        v_done := array_append(v_done, q);
        update road_prefill_queue set parts_done = v_done, ways = coalesce(ways, 0) + v_n where cell = p_cell;
        v_ok := true;
        exit;
      exception when others then
        v_err := v_err || format('%s: %s; ', split_part(v_url, '/', 3), left(sqlerrm, 60));
      end;
    end loop;
    exit when not v_ok;   -- servers busy: the rest of this square waits for a later run
  end loop;
  if cardinality(v_done) >= 4 then
    insert into road_cache_cells (cell, ways, fetched_at) values (p_cell, (select ways from road_prefill_queue where cell = p_cell), now())
    on conflict (cell) do update set ways = excluded.ways, fetched_at = now();
    update road_prefill_queue set done_at = now(), last_try = now(), tries = tries + 1, last_error = null where cell = p_cell;
    return v_total;
  end if;
  update road_prefill_queue set last_try = now(), tries = tries + 1, last_error = left(v_err, 500) where cell = p_cell;
  return -1;
end $$;
revoke all on function public.road_prefill_cell(text) from public, anon, authenticated;
