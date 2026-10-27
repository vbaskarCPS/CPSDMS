-- Road cache (RUN_56): the map builder keeps the roads it gets from OpenStreetMap. ADDITIVE ONLY.
--
-- The builder's roads come from the free Overpass servers, which are often overloaded: loading an
-- area could take minutes and several tries. Now the first load of a patch of ground saves its roads
-- here, and every later load (by anyone) reads them back in a second or two. Only ground nobody has
-- loaded yet goes to Overpass.
--
-- The ground is a grid of cells 0.02° on a side (about 2.2 km north–south). A cell is "loaded" once
-- every road in it has been saved. Cells older than 180 days count as not loaded, so roads refresh.
--
--   road_cache_ways   one row per OpenStreetMap way: id, name, line
--   road_cache_cells  which cells are fully loaded, and when
--   road_cache_get(cells, s, w, n, e)   which of those cells are loaded + the saved roads in the box
--   road_cache_put(cells, ways)         save roads; marks the cells loaded (send cells on the last batch)
--
-- Both need Territory (sa_territory) or Super Admin. Nobody reads or writes the tables directly.

create table if not exists public.road_cache_ways (
  osm_id     bigint primary key,
  name       text,
  unnamed    boolean not null default false,
  geom       geometry(LineString, 4326) not null,
  fetched_at timestamptz not null default now()
);
create index if not exists road_cache_ways_geom_idx on public.road_cache_ways using gist (geom);

create table if not exists public.road_cache_cells (
  cell       text primary key check (cell ~ '^-?[0-9]{1,5}:-?[0-9]{1,5}$'),
  ways       integer not null default 0,
  fetched_at timestamptz not null default now()
);

alter table public.road_cache_ways enable row level security;
alter table public.road_cache_cells enable row level security;
revoke all on public.road_cache_ways, public.road_cache_cells from anon, authenticated;

create or replace function public.road_cache_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  select app_is_super_admin() or app_has_perm('sa_territory')
$$;
revoke all on function public.road_cache_allowed() from public, anon, authenticated;

create or replace function public.road_cache_get(p_cells text[], p_s double precision, p_w double precision,
                                                 p_n double precision, p_e double precision)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_have jsonb; v_ways jsonb;
begin
  if not road_cache_allowed() then raise exception 'Not allowed'; end if;
  if coalesce(array_length(p_cells, 1), 0) > 400 then raise exception 'Too many cells'; end if;
  if p_n - p_s > 0.5 or p_e - p_w > 0.8 then raise exception 'Area too big'; end if;
  select coalesce(jsonb_agg(cell), '[]'::jsonb) into v_have
    from road_cache_cells where cell = any(p_cells) and fetched_at > now() - interval '180 days';
  select coalesce(jsonb_agg(jsonb_build_object('id', osm_id, 'name', coalesce(name, ''), 'unnamed', unnamed,
                                               'g', (ST_AsGeoJSON(geom, 6)::jsonb)->'coordinates')), '[]'::jsonb)
    into v_ways
    from road_cache_ways where geom && ST_MakeEnvelope(p_w, p_s, p_e, p_n, 4326);
  return jsonb_build_object('have', v_have, 'ways', v_ways);
end $$;
revoke all on function public.road_cache_get(text[], double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.road_cache_get(text[], double precision, double precision, double precision, double precision) to authenticated;

create or replace function public.road_cache_put(p_cells text[], p_ways jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not road_cache_allowed() then raise exception 'Not allowed'; end if;
  if jsonb_typeof(coalesce(p_ways, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_ways, '[]'::jsonb)) > 5000 then
    raise exception 'Send at most 5000 roads at a time';
  end if;
  insert into road_cache_ways (osm_id, name, unnamed, geom, fetched_at)
  select (w->>'id')::bigint, nullif(w->>'name', ''), coalesce((w->>'unnamed')::boolean, false),
         ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type', 'LineString', 'coordinates', w->'g')::text), 4326), now()
    from jsonb_array_elements(coalesce(p_ways, '[]'::jsonb)) w
   where (w->>'id') ~ '^[0-9]{1,15}$' and jsonb_typeof(w->'g') = 'array' and jsonb_array_length(w->'g') >= 2
  on conflict (osm_id) do update set name = excluded.name, unnamed = excluded.unnamed, geom = excluded.geom, fetched_at = now();
  get diagnostics v_n = row_count;
  if coalesce(array_length(p_cells, 1), 0) > 0 then
    if array_length(p_cells, 1) > 400 then raise exception 'Too many cells'; end if;
    insert into road_cache_cells (cell, ways, fetched_at)
    select c, v_n, now() from unnest(p_cells) c
    on conflict (cell) do update set ways = excluded.ways, fetched_at = now();
  end if;
  return v_n;
end $$;
revoke all on function public.road_cache_put(text[], jsonb) from public, anon;
grant execute on function public.road_cache_put(text[], jsonb) to authenticated;
