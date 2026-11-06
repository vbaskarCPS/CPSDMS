-- MainstreetAI › building many cities at once, all on the server. The osm-data job publishes every municipality's
-- boundary (cities/b/{osm id}.json) next to the 0.25° tiles of main roads, rail, rivers and commercial land (ms/).
-- A city queued here is loaded by a job every minute: its boundary, then each tile it touches (lines clipped to the
-- city, commercial land inside it), and then it joins the normal build queue (ms_city_jobs: blocks → density →
-- adjacency), the same as a city built from the Cities page. One city at a time, biggest first. Additive only.

create table if not exists public.ms_city_loads (
  city_id uuid primary key references public.ms_cities(id),
  osm_id bigint not null,
  requested_by uuid not null references public.app_users(id),
  rank int not null default 0,              -- lower goes first (by population)
  stage text not null default 'boundary' check (stage in ('boundary', 'tiles', 'queued', 'failed')),
  tiles text[],                             -- the tiles still to read
  tiles_total int,
  note text,
  updated_at timestamptz not null default now()
);
alter table public.ms_city_loads enable row level security;

-- queue cities: [{ osm_id, name, province, rank }]; a city already in the list (same name and province) is skipped
create or replace function public.ms_city_autoload_add(p_list jsonb, p_admin uuid)
returns int language plpgsql security definer set search_path = public as $$
declare c jsonb; v_id uuid; n int := 0;
begin
  for c in select * from jsonb_array_elements(p_list) loop
    if exists (select 1 from ms_cities where lower(name) = lower(trim(c->>'name')) and province = c->>'province') then continue; end if;
    insert into ms_cities (name, province, osm_relation_id, status, build_note, created_by)
    values (trim(c->>'name'), c->>'province', (c->>'osm_id')::bigint, 'new', 'Waiting to load the map data', p_admin)
    returning id into v_id;
    insert into ms_city_loads (city_id, osm_id, requested_by, rank) values (v_id, (c->>'osm_id')::bigint, p_admin, coalesce((c->>'rank')::int, 0));
    n := n + 1;
  end loop;
  return n;
end $$;

-- a city already in the list (one that failed) loaded the same way
create or replace function public.ms_city_autoload_retry(p_city uuid, p_osm_id bigint, p_admin uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into ms_city_loads (city_id, osm_id, requested_by, rank, stage) values (p_city, p_osm_id, p_admin, -1, 'boundary')
  on conflict (city_id) do update set osm_id = excluded.osm_id, stage = 'boundary', tiles = null, note = null, updated_at = now();
  update ms_cities set osm_relation_id = p_osm_id, status = 'new', build_note = 'Waiting to load the map data' where id = p_city;
end $$;

-- every minute: about 40 seconds of loading, one city at a time
create or replace function public.ms_city_autoload_step()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare t0 timestamptz := clock_timestamp(); l ms_city_loads; r record; g geometry; cg geometry; v_tile text; v_j jsonb; v_done int := 0;
  w float8; s float8; e float8; nn float8;
begin
  if not pg_try_advisory_xact_lock(hashtext('ms_city_autoload_step')) then return 0; end if;
  perform set_config('http.timeout_msec', '30000', true);
  loop
    exit when clock_timestamp() - t0 > interval '40 seconds';
    select * into l from ms_city_loads where stage in ('boundary', 'tiles') order by rank, updated_at limit 1;
    exit when l.city_id is null;
    begin
      if l.stage = 'boundary' then
        select status, content into r from http_get(osm_data_url(format('cities/b/%s.json', l.osm_id)));
        if r.status <> 200 then raise exception 'No boundary for this city in the map data (%)', r.status; end if;
        g := ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(r.content), 4326)), 3);
        if g is null or ST_IsEmpty(g) then raise exception 'The city boundary is empty'; end if;
        update ms_cities set boundary = ST_AsGeoJSON(g, 6)::jsonb, geom = g, center_lat = ST_Y(ST_PointOnSurface(g)), center_lng = ST_X(ST_PointOnSurface(g)),
               status = 'building', build_note = 'Loading the map data' where id = l.city_id;
        w := ST_XMin(g); s := ST_YMin(g); e := ST_XMax(g); nn := ST_YMax(g);
        select array_agg(format('%s_%s', i, j) order by i, j) into l.tiles
          from generate_series(floor(s / 0.25 + 1e-9)::int, floor(nn / 0.25 + 1e-9)::int) i,
               generate_series(floor(w / 0.25 + 1e-9)::int, floor(e / 0.25 + 1e-9)::int) j;
        update ms_city_loads set stage = 'tiles', tiles = l.tiles, tiles_total = coalesce(array_length(l.tiles, 1), 0), note = null, updated_at = now() where city_id = l.city_id;
        continue;
      end if;

      select geom into cg from ms_cities where id = l.city_id;
      if coalesce(array_length(l.tiles, 1), 0) = 0 then
        -- everything read: into the build queue (blocks → density → adjacency)
        update ms_cities set plazas = (select count(*) from ms_plazas where city_id = l.city_id), build_note = 'Cutting blocks' where id = l.city_id;
        insert into ms_city_jobs (city_id, requested_by, stage, note) values (l.city_id, l.requested_by, 'blocks', null)
        on conflict (city_id) do update set requested_by = excluded.requested_by, stage = 'blocks', note = null, requested_at = now(), updated_at = now();
        update ms_city_loads set stage = 'queued', note = null, updated_at = now() where city_id = l.city_id;
        v_done := v_done + 1;
        continue;
      end if;

      v_tile := l.tiles[1];
      select status, content into r from http_get(osm_data_url(format('ms/%s.json', v_tile)));
      if r.status = 200 then
        v_j := r.content::jsonb;
        insert into ms_city_lines (city_id, osm_id, kind, name, geom)
        select l.city_id, (x->>'id')::bigint, x->>'kind', x->>'name', d.geom
          from jsonb_array_elements(coalesce(v_j->'lines', '[]'::jsonb)) x
          cross join lateral (select ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type', 'LineString', 'coordinates', x->'c')::text), 4326) lg) a
          cross join lateral ST_Dump(ST_Intersection(a.lg, ST_Buffer(cg, 0.0005))) d
         where jsonb_array_length(x->'c') >= 2 and x->>'kind' in ('highway', 'rail', 'water', 'arterial')
           and ST_Intersects(a.lg, ST_Buffer(cg, 0.0005))
           and ST_GeometryType(d.geom) = 'ST_LineString' and ST_NPoints(d.geom) >= 2
           and not exists (select 1 from ms_city_lines m where m.city_id = l.city_id and m.osm_id = (x->>'id')::bigint);
        insert into ms_plazas (city_id, osm_id, name, kind, geom)
        select l.city_id, (x->>'id')::bigint, nullif(trim(coalesce(x->>'name', '')), ''), x->>'kind', b.pg
          from jsonb_array_elements(coalesce(v_j->'plazas', '[]'::jsonb)) x
          cross join lateral (select ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type', 'Polygon', 'coordinates', jsonb_build_array(x->'c'))::text), 4326)), 3) pg) b
         where jsonb_array_length(x->'c') >= 4 and x->>'kind' in ('retail', 'commercial', 'industrial', 'building')
           and ST_GeometryType(b.pg) = 'ST_Polygon' and ST_Area(b.pg::geography) >= 400
           and ST_Intersects(cg, ST_PointOnSurface(b.pg))
           and not exists (select 1 from ms_plazas m where m.city_id = l.city_id and m.osm_id = (x->>'id')::bigint);
      end if;   -- no tile there (open water, another province): nothing to read
      update ms_city_loads set tiles = l.tiles[2:], updated_at = now() where city_id = l.city_id;
      update ms_cities set build_note = format('Loading the map data (%s of %s)', l.tiles_total - array_length(l.tiles, 1) + 1, l.tiles_total) where id = l.city_id;
    exception when others then
      update ms_city_loads set stage = 'failed', note = left(sqlerrm, 300), updated_at = now() where city_id = l.city_id;
      update ms_cities set status = 'failed', build_note = left(sqlerrm, 300) where id = l.city_id;
    end;
  end loop;
  return v_done;
end $$;

revoke all on function public.ms_city_autoload_add(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.ms_city_autoload_retry(uuid, bigint, uuid) from public, anon, authenticated;
revoke all on function public.ms_city_autoload_step() from public, anon, authenticated;

select cron.schedule('ms-city-autoload', '* * * * *', 'select public.ms_city_autoload_step()');
