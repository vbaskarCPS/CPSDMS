-- MainstreetAI (RUN_51): cities, businesses and auto-generated zones. ADDITIVE ONLY (replaces two functions).
--
-- A city is built once: its boundary, its streets (highways, rail, water and arterials), the blocks
-- those streets cut it into, its plazas and industrial parks, and its brick-and-mortar businesses
-- (OSM + Google Places). Zones are then GENERATED per campaign: whole blocks grouped until each
-- holds its share of the campaign's eligible businesses, never crossing a highway, rail line or
-- river while a neighbour on this side remains, and never splitting a plaza. Every zone edge is a
-- real street. A proposal is reviewed (accept all / merge / regenerate); accepted zones are frozen.
--
--   ms_cities              one row per city: boundary, build state, counts
--   ms_city_lines          the streets that cut the city: kind highway | rail | water (barriers) | arterial
--   ms_blocks              the pieces between those streets
--   ms_plazas              retail / commercial / industrial properties, each pinned to one block
--   ms_businesses          every business found, with our category, chain flag, block, plaza and zone
--   ms_chain_names         names that are always a chain (seeded; the count rule catches the rest)
--   ms_campaign_categories which categories count for a campaign
--   ms_zone_runs           a generation: its proposal (zones as block sets) until accepted or discarded
--   ms_zone_blocks         which blocks a generated zone is made of (frozen ground)
--   ms_zones               + city_id, run_id, business_count, frozen_at; geom may now be a MultiPolygon
--
--   ms_save_city / ms_city_set_status / ms_city_replace_lines / ms_city_make_blocks / ms_city_replace_plazas
--   ms_city_upsert_businesses / ms_city_finish / ms_cities_list / ms_city_businesses
--   ms_set_campaign_categories
--   ms_generate_zones / ms_run_merge / ms_run_accept / ms_run_discard / ms_runs_list

-- ───────────── categories ─────────────
-- Fixed list, in the app too (src/v2/lib/mainstreet.ts BUSINESS_KINDS).
create or replace function public.ms_business_kinds()
returns text[] language sql immutable as $$
  select array['trades','clinic','agency','brokerage','restaurant','salon','auto','retail','fitness','industrial','other']
$$;

-- ───────────── cities ─────────────
create table if not exists public.ms_cities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  province text not null default 'ON',
  osm_relation_id bigint,
  boundary jsonb,                                   -- GeoJSON (Multi)Polygon
  geom geometry(Geometry, 4326),
  center_lat double precision,
  center_lng double precision,
  status text not null default 'new' check (status in ('new','building','built','failed')),
  build_note text,
  blocks int not null default 0,
  plazas int not null default 0,
  businesses int not null default 0,
  built_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ms_cities_name on public.ms_cities (lower(name), province);
alter table public.ms_cities enable row level security;
revoke all on public.ms_cities from anon, authenticated;
grant select on public.ms_cities to authenticated;
drop policy if exists ms_cities_read on public.ms_cities;
create policy ms_cities_read on public.ms_cities for select to authenticated using (ms_is_admin() or ms_is_rep());
drop trigger if exists touch on public.ms_cities;
create trigger touch before update on public.ms_cities for each row execute function public.touch_updated_at();

create table if not exists public.ms_city_lines (
  id bigint generated always as identity primary key,
  city_id uuid not null references public.ms_cities(id) on delete cascade,
  osm_id bigint,
  kind text not null check (kind in ('highway','rail','water','arterial')),
  name text,
  geom geometry(LineString, 4326) not null
);
create index if not exists ms_city_lines_city on public.ms_city_lines (city_id);
create index if not exists ms_city_lines_geom on public.ms_city_lines using gist (geom);
alter table public.ms_city_lines enable row level security;
revoke all on public.ms_city_lines from anon, authenticated;
grant select on public.ms_city_lines to authenticated;
drop policy if exists ms_city_lines_read on public.ms_city_lines;
create policy ms_city_lines_read on public.ms_city_lines for select to authenticated using (ms_is_admin());

create table if not exists public.ms_blocks (
  id bigint generated always as identity primary key,
  city_id uuid not null references public.ms_cities(id) on delete cascade,
  geom geometry(Polygon, 4326) not null,
  center geometry(Point, 4326) not null,
  area_m2 double precision not null
);
create index if not exists ms_blocks_city on public.ms_blocks (city_id);
create index if not exists ms_blocks_geom on public.ms_blocks using gist (geom);
alter table public.ms_blocks enable row level security;
revoke all on public.ms_blocks from anon, authenticated;
grant select on public.ms_blocks to authenticated;
drop policy if exists ms_blocks_read on public.ms_blocks;
create policy ms_blocks_read on public.ms_blocks for select to authenticated using (ms_is_admin());

create table if not exists public.ms_plazas (
  id bigint generated always as identity primary key,
  city_id uuid not null references public.ms_cities(id) on delete cascade,
  osm_id bigint,
  name text,
  kind text not null check (kind in ('retail','commercial','industrial','building')),
  geom geometry(Polygon, 4326) not null,
  block_id bigint references public.ms_blocks(id) on delete set null
);
create index if not exists ms_plazas_city on public.ms_plazas (city_id);
create index if not exists ms_plazas_geom on public.ms_plazas using gist (geom);
alter table public.ms_plazas enable row level security;
revoke all on public.ms_plazas from anon, authenticated;
grant select on public.ms_plazas to authenticated;
drop policy if exists ms_plazas_read on public.ms_plazas;
create policy ms_plazas_read on public.ms_plazas for select to authenticated using (ms_is_admin());

-- ───────────── businesses ─────────────
create table if not exists public.ms_businesses (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.ms_cities(id) on delete cascade,
  name text not null,
  name_norm text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  geom geometry(Point, 4326) not null,
  kind text not null default 'other',
  raw_types text[] not null default '{}',
  sources text[] not null default '{}',             -- 'osm', 'google'
  osm_id bigint,
  google_place_id text,
  phone text,
  website text,
  hours jsonb,
  status text not null default 'unknown' check (status in ('open','closed','unknown')),
  is_chain boolean not null default false,
  chain_note text,
  plaza_id bigint references public.ms_plazas(id) on delete set null,
  block_id bigint references public.ms_blocks(id) on delete set null,
  zone_id uuid references public.ms_zones(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ms_businesses_kind check (kind = any (ms_business_kinds()))
);
create unique index if not exists ms_businesses_google on public.ms_businesses (google_place_id) where google_place_id is not null;
create unique index if not exists ms_businesses_osm on public.ms_businesses (city_id, osm_id) where osm_id is not null;
create index if not exists ms_businesses_city on public.ms_businesses (city_id);
create index if not exists ms_businesses_zone on public.ms_businesses (zone_id);
create index if not exists ms_businesses_block on public.ms_businesses (block_id);
create index if not exists ms_businesses_geom on public.ms_businesses using gist (geom);
alter table public.ms_businesses enable row level security;
revoke all on public.ms_businesses from anon, authenticated;
grant select on public.ms_businesses to authenticated;
drop policy if exists ms_businesses_read on public.ms_businesses;
create policy ms_businesses_read on public.ms_businesses for select to authenticated using (
  ms_is_admin() or exists (select 1 from ms_zone_campaigns zc where zc.zone_id = ms_businesses.zone_id and zc.rep_id = auth.uid()));
drop trigger if exists touch on public.ms_businesses;
create trigger touch before update on public.ms_businesses for each row execute function public.touch_updated_at();

create table if not exists public.ms_chain_names (name_norm text primary key);
alter table public.ms_chain_names enable row level security;
revoke all on public.ms_chain_names from anon, authenticated;
insert into public.ms_chain_names (name_norm) values
  ('tim hortons'),('starbucks'),('mcdonalds'),('subway'),('wendys'),('burger king'),('a w'),('harveys'),('pizza pizza'),('dominos'),
  ('pizza hut'),('kfc'),('popeyes'),('taco bell'),('dairy queen'),('second cup'),('booster juice'),('freshii'),('swiss chalet'),('boston pizza'),
  ('shoppers drug mart'),('rexall'),('lcbo'),('beer store'),('canadian tire'),('walmart'),('costco'),('loblaws'),('fortinos'),('metro'),
  ('sobeys'),('food basics'),('no frills'),('longos'),('farm boy'),('whole foods'),('dollarama'),('home depot'),('rona'),('lowes'),
  ('best buy'),('staples'),('the source'),('winners'),('homesense'),('marshalls'),('indigo'),('chapters'),('sport chek'),('mark s'),
  ('td bank'),('td canada trust'),('rbc'),('royal bank'),('scotiabank'),('bmo'),('bank of montreal'),('cibc'),('national bank'),('tangerine'),
  ('petro canada'),('esso'),('shell'),('mobil'),('pioneer'),('canada post'),('ups store'),('fedex'),('purolator'),('enterprise rent a car'),
  ('goodlife fitness'),('la fitness'),('planet fitness'),('mr lube'),('jiffy lube'),('midas'),('speedy'),('kal tire'),('active green ross'),
  ('great clips'),('first choice haircutters'),('chatters'),('h r block'),('liberty tax'),('kumon'),('mathnasium'),('sylvan learning'),
  ('bulk barn'),('m m food market'),('pet valu'),('petsmart'),('global pet foods'),('michaels'),('ikea'),('the brick'),('leons'),
  ('nofrills'),('shoppers'),('dollar tree'),('circle k'),('7 eleven'),('mac s'),('hasty market'),('chevron'),('ultramar')
on conflict do nothing;

create table if not exists public.ms_campaign_categories (
  campaign_id uuid not null references public.ms_campaigns(id) on delete cascade,
  category text not null,
  primary key (campaign_id, category),
  constraint ms_campaign_categories_kind check (category = any (ms_business_kinds()))
);
alter table public.ms_campaign_categories enable row level security;
revoke all on public.ms_campaign_categories from anon, authenticated;
grant select on public.ms_campaign_categories to authenticated;
drop policy if exists ms_campaign_categories_read on public.ms_campaign_categories;
create policy ms_campaign_categories_read on public.ms_campaign_categories for select to authenticated using (ms_is_admin() or ms_is_rep());

-- ───────────── zones: generated ones ─────────────
alter table public.ms_zones add column if not exists city_id uuid references public.ms_cities(id) on delete set null;
alter table public.ms_zones add column if not exists run_id uuid;
alter table public.ms_zones add column if not exists business_count int;
alter table public.ms_zones add column if not exists frozen_at timestamptz;
alter table public.ms_zones alter column geom type geometry(Geometry, 4326);
create index if not exists ms_zones_city on public.ms_zones (city_id);

create table if not exists public.ms_zone_blocks (
  zone_id uuid not null references public.ms_zones(id) on delete cascade,
  block_id bigint not null references public.ms_blocks(id) on delete cascade,
  primary key (zone_id, block_id)
);
create index if not exists ms_zone_blocks_block on public.ms_zone_blocks (block_id);
alter table public.ms_zone_blocks enable row level security;
revoke all on public.ms_zone_blocks from anon, authenticated;
grant select on public.ms_zone_blocks to authenticated;
drop policy if exists ms_zone_blocks_read on public.ms_zone_blocks;
create policy ms_zone_blocks_read on public.ms_zone_blocks for select to authenticated using (ms_is_admin());

create table if not exists public.ms_zone_runs (
  id uuid primary key default gen_random_uuid(),
  city_id uuid not null references public.ms_cities(id) on delete cascade,
  campaign_id uuid not null references public.ms_campaigns(id) on delete cascade,
  target int not null,
  status text not null default 'proposed' check (status in ('proposed','accepted','discarded')),
  proposal jsonb not null default '[]',             -- [{key, name, polygon, blocks:[ids], count, plazas}]
  stats jsonb not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create index if not exists ms_zone_runs_city on public.ms_zone_runs (city_id, created_at desc);
alter table public.ms_zone_runs enable row level security;
revoke all on public.ms_zone_runs from anon, authenticated;
grant select on public.ms_zone_runs to authenticated;
drop policy if exists ms_zone_runs_read on public.ms_zone_runs;
create policy ms_zone_runs_read on public.ms_zone_runs for select to authenticated using (ms_is_admin());

do $$ declare t text; begin
  foreach t in array array['ms_cities','ms_businesses','ms_campaign_categories','ms_zone_runs'] loop
    execute format('drop trigger if exists audit on public.%I', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- (replaces RUN_50's) a generated zone may be a MultiPolygon; the overlap rule is the same
create or replace function public.ms_zone_prepare()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g geometry; other text;
begin
  if new.polygon is null or new.polygon->>'type' not in ('Polygon', 'MultiPolygon') then raise exception 'Draw the zone as a polygon'; end if;
  begin
    g := ST_SetSRID(ST_GeomFromGeoJSON(new.polygon::text), 4326);
  exception when others then raise exception 'That shape can’t be read: %', sqlerrm; end;
  if not ST_IsValid(g) then g := ST_MakeValid(g); end if;
  g := ST_CollectionExtract(g, 3);
  if ST_IsEmpty(g) or ST_NPoints(g) < 4 then raise exception 'A zone needs at least three corners'; end if;
  if ST_Area(g::geography) < 100 then raise exception 'That zone is too small to be real'; end if;
  new.geom := g;
  new.center_lat := ST_Y(ST_PointOnSurface(g));
  new.center_lng := ST_X(ST_PointOnSurface(g));
  if new.status = 'retired' and new.retired_at is null then new.retired_at := now(); end if;
  if new.status = 'active' then
    new.retired_at := null;
    select z.name into other from ms_zones z
     where z.id <> new.id and z.status = 'active'
       and ST_Intersects(z.geom, g)
       and ST_Area(ST_Intersection(z.geom, g)::geography) > 0.01 * least(ST_Area(z.geom::geography), ST_Area(g::geography))
     limit 1;
    if other is not null then raise exception 'This zone overlaps “%”. Zones can’t share ground.', other; end if;
  end if;
  return new;
end $$;
revoke all on function public.ms_zone_prepare() from public, anon, authenticated;

-- ───────────── building a city ─────────────
create or replace function public.ms_save_city(p_name text, p_province text, p_osm_relation_id bigint, p_boundary jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; g geometry;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Which city?'; end if;
  if p_boundary is not null then
    g := ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(p_boundary::text), 4326)), 3);
    if ST_IsEmpty(g) then raise exception 'The city boundary is empty'; end if;
  end if;
  select id into v_id from ms_cities where lower(name) = lower(trim(p_name)) and province = coalesce(p_province, 'ON');
  if v_id is null then
    insert into ms_cities (name, province, osm_relation_id, boundary, geom, center_lat, center_lng, created_by)
    values (trim(p_name), coalesce(p_province, 'ON'), p_osm_relation_id, p_boundary, g,
            case when g is null then null else ST_Y(ST_Centroid(g)) end, case when g is null then null else ST_X(ST_Centroid(g)) end, auth.uid())
    returning id into v_id;
  elsif p_boundary is not null then
    update ms_cities set osm_relation_id = coalesce(p_osm_relation_id, osm_relation_id), boundary = p_boundary, geom = g,
           center_lat = ST_Y(ST_Centroid(g)), center_lng = ST_X(ST_Centroid(g)) where id = v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.ms_save_city(text, text, bigint, jsonb) from public, anon;
grant execute on function public.ms_save_city(text, text, bigint, jsonb) to authenticated;

create or replace function public.ms_city_set_status(p_city uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  update ms_cities set status = p_status, build_note = p_note, built_at = case when p_status = 'built' then now() else built_at end where id = p_city;
  if not found then raise exception 'No such city'; end if;
end $$;
revoke all on function public.ms_city_set_status(uuid, text, text) from public, anon;
grant execute on function public.ms_city_set_status(uuid, text, text) to authenticated;

-- lines: [{osm_id, kind, name, coordinates:[[lng,lat],...]}]; replaces the city's lines, clipped to the boundary
create or replace function public.ms_city_replace_lines(p_city uuid, p_lines jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int; cg geometry;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select geom into cg from ms_cities where id = p_city;
  if cg is null then raise exception 'Build the city boundary first'; end if;
  delete from ms_city_lines where city_id = p_city;
  insert into ms_city_lines (city_id, osm_id, kind, name, geom)
  select p_city, (l->>'osm_id')::bigint, l->>'kind', l->>'name', (ST_Dump(ST_Intersection(ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type','LineString','coordinates', l->'coordinates')::text), 4326), ST_Buffer(cg, 0.0005)))).geom
    from jsonb_array_elements(p_lines) l
   where jsonb_array_length(l->'coordinates') >= 2 and l->>'kind' in ('highway','rail','water','arterial');
  delete from ms_city_lines where city_id = p_city and (ST_GeometryType(geom) <> 'ST_LineString' or ST_NPoints(geom) < 2);
  get diagnostics n = row_count;
  select count(*)::int into n from ms_city_lines where city_id = p_city;
  return n;
end $$;
revoke all on function public.ms_city_replace_lines(uuid, jsonb) from public, anon;
grant execute on function public.ms_city_replace_lines(uuid, jsonb) to authenticated;

-- the blocks: everything between the lines, inside the boundary; slivers under 300 m² are dropped
create or replace function public.ms_city_make_blocks(p_city uuid)
returns int language plpgsql security definer set search_path = public as $$
declare cg geometry; n int;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select geom into cg from ms_cities where id = p_city;
  if cg is null then raise exception 'Build the city boundary first'; end if;
  delete from ms_blocks where city_id = p_city;
  insert into ms_blocks (city_id, geom, center, area_m2)
  select p_city, g, ST_PointOnSurface(g), ST_Area(g::geography)
    from (
      select (ST_Dump(ST_CollectionExtract(ST_Intersection(poly, cg), 3))).geom g
        from (select (ST_Dump(ST_Polygonize(noded))).geom poly
                from (select ST_Node(ST_Collect(l.geom)) noded
                        from (select geom from ms_city_lines where city_id = p_city
                              union all select (ST_Dump(ST_Boundary(cg))).geom) l) nd) p
    ) x
   where ST_Area(g::geography) >= 300;
  update ms_cities set blocks = (select count(*) from ms_blocks where city_id = p_city) where id = p_city;
  select blocks into n from ms_cities where id = p_city;
  return n;
end $$;
revoke all on function public.ms_city_make_blocks(uuid) from public, anon;
grant execute on function public.ms_city_make_blocks(uuid) to authenticated;

-- plazas: [{osm_id, name, kind, coordinates:[[lng,lat],...]}] (outer ring); each pinned to the block under its centre
create or replace function public.ms_city_replace_plazas(p_city uuid, p_plazas jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  delete from ms_plazas where city_id = p_city;
  insert into ms_plazas (city_id, osm_id, name, kind, geom)
  select p_city, (p->>'osm_id')::bigint, nullif(trim(coalesce(p->>'name', '')), ''), p->>'kind', g
    from jsonb_array_elements(p_plazas) p
    cross join lateral (select ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(
                          jsonb_build_object('type','Polygon','coordinates', jsonb_build_array(p->'coordinates'))::text), 4326)), 3) g) x
   where jsonb_array_length(p->'coordinates') >= 4 and p->>'kind' in ('retail','commercial','industrial','building')
     and ST_GeometryType(g) = 'ST_Polygon' and ST_Area(g::geography) >= 400;
  update ms_plazas pl set block_id = (select b.id from ms_blocks b where b.city_id = p_city and ST_Contains(b.geom, ST_PointOnSurface(pl.geom)) limit 1)
   where pl.city_id = p_city;
  update ms_cities set plazas = (select count(*) from ms_plazas where city_id = p_city) where id = p_city;
  select plazas into n from ms_cities where id = p_city;
  return n;
end $$;
revoke all on function public.ms_city_replace_plazas(uuid, jsonb) from public, anon;
grant execute on function public.ms_city_replace_plazas(uuid, jsonb) to authenticated;

create or replace function public.ms_name_norm(p text)
returns text language sql immutable as $$
  select nullif(trim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[''’`.,&\-/()]+', ' ', 'g'), '\s+', ' ', 'g')), '')
$$;

-- businesses: [{name, address, lat, lng, kind, raw_types, source, osm_id, google_place_id, phone, website, hours, status}]
-- Google rows are matched to an OSM row of the same name within 60 m (the OSM row is kept, sources merged).
create or replace function public.ms_city_upsert_businesses(p_city uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; v_id uuid; v_norm text; v_lat double precision; v_lng double precision; n int := 0; v_kind text;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_norm := ms_name_norm(r->>'name'); v_lat := (r->>'lat')::double precision; v_lng := (r->>'lng')::double precision;
    if v_norm is null or v_lat is null or v_lng is null then continue; end if;
    v_kind := case when r->>'kind' = any (ms_business_kinds()) then r->>'kind' else 'other' end;
    v_id := null;
    if r->>'google_place_id' is not null then select id into v_id from ms_businesses where google_place_id = r->>'google_place_id'; end if;
    if v_id is null and r->>'osm_id' is not null then select id into v_id from ms_businesses where city_id = p_city and osm_id = (r->>'osm_id')::bigint; end if;
    if v_id is null then   -- the same place from the other source?
      select id into v_id from ms_businesses b
       where b.city_id = p_city and b.name_norm = v_norm
         and ST_DWithin(b.geom::geography, ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography, 60)
       order by ST_Distance(b.geom, ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)) limit 1;
    end if;
    if v_id is null then
      insert into ms_businesses (city_id, name, name_norm, address, lat, lng, geom, kind, raw_types, sources, osm_id, google_place_id, phone, website, hours, status)
      values (p_city, trim(r->>'name'), v_norm, r->>'address', v_lat, v_lng, ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326), v_kind,
              coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r->'raw_types', '[]')) x), '{}'), array[coalesce(r->>'source', 'osm')],
              (r->>'osm_id')::bigint, r->>'google_place_id', r->>'phone', r->>'website', r->'hours', coalesce(r->>'status', 'unknown'));
      n := n + 1;
    else
      update ms_businesses set
        sources = (select array_agg(distinct s) from unnest(sources || coalesce(r->>'source', 'osm')) s),
        google_place_id = coalesce(google_place_id, r->>'google_place_id'), osm_id = coalesce(osm_id, (r->>'osm_id')::bigint),
        address = coalesce(r->>'address', address), phone = coalesce(r->>'phone', phone), website = coalesce(r->>'website', website),
        hours = coalesce(r->'hours', hours), status = case when r->>'status' in ('open','closed') then r->>'status' else status end,
        raw_types = coalesce((select array_agg(distinct t) from unnest(raw_types || coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(r->'raw_types', '[]')) x), '{}')) t), '{}'),
        kind = case when kind = 'other' then v_kind else kind end,
        -- Google's rooftop position wins over OSM's
        lat = case when r->>'source' = 'google' then v_lat else lat end, lng = case when r->>'source' = 'google' then v_lng else lng end,
        geom = case when r->>'source' = 'google' then ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326) else geom end
      where id = v_id;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.ms_city_upsert_businesses(uuid, jsonb) from public, anon;
grant execute on function public.ms_city_upsert_businesses(uuid, jsonb) to authenticated;

-- after loading: each business gets its plaza and block, chains are flagged, and the city is marked built
create or replace function public.ms_city_finish(p_city uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  update ms_businesses b set plaza_id = (select p.id from ms_plazas p where p.city_id = p_city and ST_Contains(p.geom, b.geom) order by ST_Area(p.geom) limit 1)
   where b.city_id = p_city;
  update ms_businesses b set block_id = coalesce(
      (select p.block_id from ms_plazas p where p.id = b.plaza_id),
      (select k.id from ms_blocks k where k.city_id = p_city and ST_Contains(k.geom, b.geom) limit 1),
      (select k.id from ms_blocks k where k.city_id = p_city order by k.geom <-> b.geom limit 1))
   where b.city_id = p_city;
  -- a chain: on the list, or the same name at 3+ places in this city
  update ms_businesses b set is_chain = true, chain_note = 'Known chain' where b.city_id = p_city and not b.is_chain and b.name_norm in (select name_norm from ms_chain_names);
  update ms_businesses b set is_chain = true, chain_note = 'Same name at ' || c.n || ' locations'
    from (select name_norm, count(*) n from ms_businesses where city_id = p_city group by name_norm having count(*) >= 3) c
   where b.city_id = p_city and not b.is_chain and b.name_norm = c.name_norm;
  update ms_cities set businesses = (select count(*) from ms_businesses where city_id = p_city), status = 'built', built_at = now(), build_note = null where id = p_city;
  select jsonb_build_object('businesses', businesses, 'blocks', blocks, 'plazas', plazas,
           'chains', (select count(*) from ms_businesses where city_id = p_city and is_chain),
           'by_kind', (select jsonb_object_agg(kind, n) from (select kind, count(*) n from ms_businesses where city_id = p_city group by kind) k))
    into out from ms_cities where id = p_city;
  return out;
end $$;
revoke all on function public.ms_city_finish(uuid) from public, anon;
grant execute on function public.ms_city_finish(uuid) to authenticated;

create or replace function public.ms_cities_list()
returns table (id uuid, name text, province text, status text, build_note text, blocks int, plazas int, businesses int,
               eligible_open int, zones int, center_lat double precision, center_lng double precision, boundary jsonb, built_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.province, c.status, c.build_note, c.blocks, c.plazas, c.businesses,
         (select count(*)::int from ms_businesses b where b.city_id = c.id and not b.is_chain and b.status <> 'closed'),
         (select count(*)::int from ms_zones z where z.city_id = c.id and z.status = 'active'),
         c.center_lat, c.center_lng, c.boundary, c.built_at, c.created_at
    from ms_cities c where ms_is_admin() order by c.name;
$$;
revoke all on function public.ms_cities_list() from public, anon;
grant execute on function public.ms_cities_list() to authenticated;

-- the city's businesses for the map (admins)
create or replace function public.ms_city_businesses(p_city uuid)
returns table (id uuid, name text, address text, lat double precision, lng double precision, kind text, status text, is_chain boolean, chain_note text,
               sources text[], plaza_id bigint, block_id bigint, zone_id uuid, phone text, website text)
language sql stable security definer set search_path = public as $$
  select b.id, b.name, b.address, b.lat, b.lng, b.kind, b.status, b.is_chain, b.chain_note, b.sources, b.plaza_id, b.block_id, b.zone_id, b.phone, b.website
    from ms_businesses b where b.city_id = p_city and ms_is_admin() order by b.name;
$$;
revoke all on function public.ms_city_businesses(uuid) from public, anon;
grant execute on function public.ms_city_businesses(uuid) to authenticated;

-- ───────────── campaign categories ─────────────
create or replace function public.ms_set_campaign_categories(p_campaign uuid, p_categories text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from ms_campaigns where id = p_campaign) then raise exception 'No such campaign'; end if;
  delete from ms_campaign_categories where campaign_id = p_campaign and not (category = any(coalesce(p_categories, '{}')));
  insert into ms_campaign_categories (campaign_id, category)
  select p_campaign, c from unnest(coalesce(p_categories, '{}')) c where c = any (ms_business_kinds())
  on conflict do nothing;
end $$;
revoke all on function public.ms_set_campaign_categories(uuid, text[]) from public, anon;
grant execute on function public.ms_set_campaign_categories(uuid, text[]) to authenticated;

-- ───────────── generating zones ─────────────
-- Whole blocks, grouped: the densest free block seeds a zone, which absorbs its neighbours (same side of
-- any barrier first, most businesses first) until it holds its share. Blocks under a frozen zone are
-- never touched. Leftover blocks go to the lightest neighbouring zone. Names: "<City> North 1".
create or replace function public.ms_generate_zones(p_city uuid, p_campaign uuid, p_target int)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c ms_cities; v_run uuid; v_total int; v_share int; v_zone int := 0; v_seed bigint; v_next bigint; v_cnt int; v_added int;
  v_cats text[]; v_proposal jsonb := '[]'::jsonb; r record; v_half text; v_i int;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select * into c from ms_cities where id = p_city;
  if c.id is null or c.status <> 'built' then raise exception 'Build the city first'; end if;
  if p_target is null or p_target < 1 or p_target > 60 then raise exception 'Ask for between 1 and 60 zones'; end if;
  select array_agg(category) into v_cats from ms_campaign_categories where campaign_id = p_campaign;
  if v_cats is null then raise exception 'Pick the campaign’s business categories first (Campaigns › Edit)'; end if;

  -- free blocks: not under any active zone (generated ones by block; drawn ones by centre)
  drop table if exists gz_blk; drop table if exists gz_adj;
  create temp table gz_blk on commit drop as
  select k.id, k.geom, k.center, 0::int cnt, null::int zone
    from ms_blocks k
   where k.city_id = p_city
     and not exists (select 1 from ms_zone_blocks zb join ms_zones z on z.id = zb.zone_id where zb.block_id = k.id and z.status = 'active')
     and not exists (select 1 from ms_zones z where z.status = 'active' and z.run_id is null and z.geom is not null and ST_Contains(z.geom, k.center));
  create index on gz_blk (id); create index on gz_blk using gist (geom);
  update gz_blk g set cnt = s.n from (
    select b.block_id, count(*) n from ms_businesses b
     where b.city_id = p_city and not b.is_chain and b.status <> 'closed' and b.kind = any(v_cats) and b.zone_id is null
     group by b.block_id) s where s.block_id = g.id;
  select coalesce(sum(cnt), 0) into v_total from gz_blk;
  if v_total = 0 then raise exception 'No free businesses in % for this campaign', c.name; end if;
  if (select count(*) from gz_blk) = 0 then raise exception 'Every block of % is already in a zone', c.name; end if;
  v_share := ceil(v_total::numeric / p_target);

  -- neighbours, and whether the shared edge runs along a barrier (highway, rail, water)
  create temp table gz_adj on commit drop as
  select a.id a, b.id b,
         exists (select 1 from ms_city_lines l where l.city_id = p_city and l.kind in ('highway','rail','water')
                    and ST_DWithin(l.geom, ST_PointOnSurface(ST_CollectionExtract(ST_Intersection(a.geom, b.geom), 2)), 0.0001)) barrier
    from gz_blk a join gz_blk b on a.id < b.id and ST_Intersects(a.geom, b.geom) and ST_Length(ST_Intersection(a.geom, b.geom)) > 0.00005;
  insert into gz_adj select b, a, barrier from gz_adj;
  create index on gz_adj (a);

  -- grow zones; each new zone's share is what's left divided by the zones still to make, so one dense
  -- block bigger than its share doesn't starve the rest
  while v_zone < p_target loop
    select id into v_seed from gz_blk where zone is null and cnt > 0 order by cnt desc limit 1;
    exit when v_seed is null;
    v_share := greatest(1, ceil((select coalesce(sum(cnt), 0) from gz_blk where zone is null)::numeric / (p_target - v_zone)));
    v_zone := v_zone + 1;
    update gz_blk set zone = v_zone where id = v_seed;
    select cnt into v_cnt from gz_blk where id = v_seed;
    while v_cnt < v_share loop
      select n.id into v_next
        from gz_adj j join gz_blk z on z.id = j.a and z.zone = v_zone join gz_blk n on n.id = j.b and n.zone is null
       order by j.barrier, n.cnt desc, ST_Distance(n.center, (select center from gz_blk where id = v_seed)) limit 1;
      exit when v_next is null;
      update gz_blk set zone = v_zone where id = v_next;
      select sum(cnt) into v_cnt from gz_blk where zone = v_zone;
    end loop;
  end loop;

  -- what's left joins the lightest zone next door; islands join the nearest zone
  loop
    update gz_blk g set zone = s.zone from (
      select distinct on (n.id) n.id, z.zone
        from gz_blk n join gz_adj j on j.a = n.id join gz_blk z on z.id = j.b and z.zone is not null
       where n.zone is null
       order by n.id, j.barrier, (select sum(cnt) from gz_blk x where x.zone = z.zone)) s where s.id = g.id;
    get diagnostics v_added = row_count;
    exit when v_added = 0;
  end loop;
  update gz_blk g set zone = (select z.zone from gz_blk z where z.zone is not null order by z.center <-> g.center limit 1) where g.zone is null;

  -- name and shape them
  for r in
    select zone, ST_Multi(ST_Buffer(ST_Union(geom), 0)) g, sum(cnt) n, array_agg(id) ids
      from gz_blk where zone is not null group by zone
  loop
    v_half := case when ST_Y(ST_Centroid(r.g)) >= c.center_lat then 'North' else 'South' end;
    v_proposal := v_proposal || jsonb_build_array(jsonb_build_object(
      'key', r.zone, 'half', v_half, 'lng', ST_X(ST_Centroid(r.g)), 'polygon', ST_AsGeoJSON(r.g)::jsonb, 'blocks', to_jsonb(r.ids), 'count', r.n,
      'plazas', (select count(*) from ms_plazas p where p.block_id = any(r.ids))));
  end loop;
  -- number west → east inside each half
  select jsonb_agg(z || jsonb_build_object('name', c.name || ' ' || (z->>'half') || ' ' || rn) order by z->>'half', rn)
    into v_proposal
    from (select z, row_number() over (partition by z->>'half' order by (z->>'lng')::float) rn from jsonb_array_elements(v_proposal) z) x;

  insert into ms_zone_runs (city_id, campaign_id, target, proposal, stats, created_by)
  values (p_city, p_campaign, p_target, coalesce(v_proposal, '[]'::jsonb),
          jsonb_build_object('eligible', v_total, 'share', v_share, 'zones', jsonb_array_length(coalesce(v_proposal, '[]'::jsonb)),
                             'free_blocks', (select count(*) from gz_blk)), auth.uid())
  returning id into v_run;
  return v_run;
end $$;
revoke all on function public.ms_generate_zones(uuid, uuid, int) from public, anon;
grant execute on function public.ms_generate_zones(uuid, uuid, int) to authenticated;

-- merge two proposed zones that touch
create or replace function public.ms_run_merge(p_run uuid, p_a int, p_b int)
returns void language plpgsql security definer set search_path = public as $$
declare run ms_zone_runs; za jsonb; zb jsonb; g geometry; merged jsonb; rest jsonb;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select * into run from ms_zone_runs where id = p_run for update;
  if run.id is null or run.status <> 'proposed' then raise exception 'This proposal is closed'; end if;
  select z into za from jsonb_array_elements(run.proposal) z where (z->>'key')::int = p_a;
  select z into zb from jsonb_array_elements(run.proposal) z where (z->>'key')::int = p_b;
  if za is null or zb is null or p_a = p_b then raise exception 'Pick two different zones'; end if;
  g := ST_Multi(ST_Buffer(ST_Union(ST_GeomFromGeoJSON((za->'polygon')::text), ST_GeomFromGeoJSON((zb->'polygon')::text)), 0));
  if not ST_Intersects(ST_GeomFromGeoJSON((za->'polygon')::text), ST_GeomFromGeoJSON((zb->'polygon')::text)) then raise exception 'Those two zones don’t touch'; end if;
  merged := za || jsonb_build_object('polygon', ST_AsGeoJSON(g)::jsonb, 'blocks', (za->'blocks') || (zb->'blocks'),
                                     'count', (za->>'count')::int + (zb->>'count')::int, 'plazas', (za->>'plazas')::int + (zb->>'plazas')::int,
                                     'name', za->>'name' || ' + ' || regexp_replace(zb->>'name', '^.* ', ''));
  select coalesce(jsonb_agg(case when (z->>'key')::int = p_a then merged else z end), '[]'::jsonb) into rest
    from jsonb_array_elements(run.proposal) z where (z->>'key')::int <> p_b;
  update ms_zone_runs set proposal = rest, stats = stats || jsonb_build_object('zones', jsonb_array_length(rest)) where id = p_run;
end $$;
revoke all on function public.ms_run_merge(uuid, int, int) from public, anon;
grant execute on function public.ms_run_merge(uuid, int, int) to authenticated;

-- accept: the proposal becomes frozen zones with the campaign on them, and their businesses attached
create or replace function public.ms_run_accept(p_run uuid)
returns int language plpgsql security definer set search_path = public as $$
declare run ms_zone_runs; z jsonb; v_zone uuid; n int := 0; v_name text; v_try int;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select * into run from ms_zone_runs where id = p_run for update;
  if run.id is null or run.status <> 'proposed' then raise exception 'This proposal is closed'; end if;
  for z in select * from jsonb_array_elements(run.proposal) loop
    v_name := z->>'name'; v_try := 1;
    while exists (select 1 from ms_zones where lower(name) = lower(v_name)) loop v_try := v_try + 1; v_name := (z->>'name') || ' (' || v_try || ')'; end loop;
    insert into ms_zones (name, polygon, city_id, run_id, business_count, frozen_at, created_by)
    values (v_name, z->'polygon', run.city_id, run.id, (z->>'count')::int, now(), auth.uid()) returning id into v_zone;
    update ms_zones set city = (select name from ms_cities where id = run.city_id) where id = v_zone;
    insert into ms_zone_blocks (zone_id, block_id) select v_zone, (b)::bigint from jsonb_array_elements_text(z->'blocks') b on conflict do nothing;
    insert into ms_zone_campaigns (zone_id, campaign_id) values (v_zone, run.campaign_id) on conflict do nothing;
    update ms_businesses b set zone_id = v_zone where b.city_id = run.city_id and b.zone_id is null and b.block_id in (select block_id from ms_zone_blocks where zone_id = v_zone);
    n := n + 1;
  end loop;
  update ms_zone_runs set status = 'accepted', accepted_at = now() where id = p_run;
  return n;
end $$;
revoke all on function public.ms_run_accept(uuid) from public, anon;
grant execute on function public.ms_run_accept(uuid) to authenticated;

create or replace function public.ms_run_discard(p_run uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  update ms_zone_runs set status = 'discarded' where id = p_run and status = 'proposed';
end $$;
revoke all on function public.ms_run_discard(uuid) from public, anon;
grant execute on function public.ms_run_discard(uuid) to authenticated;

create or replace function public.ms_runs_list(p_city uuid)
returns table (id uuid, campaign_id uuid, campaign_name text, target int, status text, proposal jsonb, stats jsonb, created_at timestamptz, accepted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.campaign_id, c.name, r.target, r.status, r.proposal, r.stats, r.created_at, r.accepted_at
    from ms_zone_runs r join ms_campaigns c on c.id = r.campaign_id
   where r.city_id = p_city and ms_is_admin() order by r.created_at desc limit 20;
$$;
revoke all on function public.ms_runs_list(uuid) from public, anon;
grant execute on function public.ms_runs_list(uuid) to authenticated;

-- a frozen (generated) zone keeps its shape: redrawing it is refused
create or replace function public.ms_save_zone(p_id uuid, p_name text, p_polygon jsonb, p_city text default null, p_area text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Give the zone a name'; end if;
  if v_id is null then
    insert into ms_zones (name, polygon, city, area, created_by)
    values (trim(p_name), p_polygon, nullif(trim(coalesce(p_city, '')), ''), nullif(trim(coalesce(p_area, '')), ''), auth.uid())
    returning id into v_id;
  else
    if p_polygon is not null and exists (select 1 from ms_zones where id = v_id and frozen_at is not null) then
      raise exception 'This zone was generated and is frozen. Retire it and generate again instead.';
    end if;
    update ms_zones set name = trim(p_name), polygon = coalesce(p_polygon, polygon),
           city = coalesce(nullif(trim(coalesce(p_city, '')), ''), city), area = coalesce(nullif(trim(coalesce(p_area, '')), ''), area)
     where id = v_id;
    if not found then raise exception 'No such zone'; end if;
  end if;
  return v_id;
exception when unique_violation then raise exception 'There’s already a zone called “%”', trim(p_name);
end $$;

-- ms_zones_list gains the generated fields
drop function if exists public.ms_zones_list();
create or replace function public.ms_zones_list()
returns table (
  id uuid, name text, polygon jsonb, center_lat double precision, center_lng double precision,
  city text, area text, status text, created_at timestamptz, updated_at timestamptz, campaigns jsonb,
  city_id uuid, frozen_at timestamptz, business_count int
) language sql stable security definer set search_path = public as $$
  select z.id, z.name, z.polygon, z.center_lat, z.center_lng, z.city, z.area, z.status, z.created_at, z.updated_at,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'campaign_id', zc.campaign_id, 'name', c.name, 'color', c.color, 'is_active', c.is_active,
                     'rep_id', zc.rep_id, 'rep_name', u.full_name, 'assigned_at', zc.assigned_at) order by c.name)
                     from ms_zone_campaigns zc join ms_campaigns c on c.id = zc.campaign_id
                     left join app_users u on u.id = zc.rep_id
                    where zc.zone_id = z.id and (ms_is_admin() or zc.rep_id = auth.uid())), '[]'::jsonb),
         z.city_id, z.frozen_at, coalesce((select count(*)::int from ms_businesses b where b.zone_id = z.id), z.business_count)
    from ms_zones z
   where ms_is_admin() or exists (select 1 from ms_zone_campaigns zc where zc.zone_id = z.id and zc.rep_id = auth.uid())
   order by z.status, z.name;
$$;
revoke all on function public.ms_zones_list() from public, anon;
grant execute on function public.ms_zones_list() to authenticated;

-- retiring a generated zone frees its ground and its businesses
create or replace function public.ms_set_zone_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if p_status not in ('active', 'retired') then raise exception 'Status must be active or retired'; end if;
  update ms_zones set status = p_status where id = p_id;
  if not found then raise exception 'No such zone'; end if;
  if p_status = 'retired' then update ms_businesses set zone_id = null where zone_id = p_id;
  else update ms_businesses b set zone_id = p_id where b.zone_id is null and b.block_id in (select block_id from ms_zone_blocks where zone_id = p_id); end if;
end $$;

-- ───────────── search_path on the helpers (advisor finding) ─────────────
alter function public.ms_business_kinds() set search_path = public;
alter function public.ms_name_norm(text) set search_path = public;
