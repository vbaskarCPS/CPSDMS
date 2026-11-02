-- MainstreetAI › split a city by reps. No business list needed: an admin picks a built city (its boundary and
-- streets come from free map data; the paid Google step can be skipped) and how many reps, and the city's main
-- roads are split into that many shares of about equal length (the app does the split; see src/v2/lib/msSplit.ts).
-- Each share becomes a zone: the roads plus 60 m either side (the storefronts), assigned to a rep. Reps' lists
-- build themselves as they add businesses.
--
-- Walked: the rep's phone sends its location every two minutes while their day is on (ms_rep_day_ping); those
-- points are now kept (ms_rep_track), so each road of a zone shows as walked, partly walked or not yet.
-- Additive only.

-- ── a zone's roads ──
create table if not exists public.ms_zone_roads (
  id bigint generated always as identity primary key,
  zone_id uuid not null references public.ms_zones(id),
  name text,
  geom geometry(LineString, 4326) not null,
  length_m integer not null
);
create index if not exists ms_zone_roads_zone on public.ms_zone_roads (zone_id);
create index if not exists ms_zone_roads_geom on public.ms_zone_roads using gist (geom);
alter table public.ms_zone_roads enable row level security;

-- ── where reps' phones were while their day was on ──
create table if not exists public.ms_rep_track (
  id bigint generated always as identity primary key,
  rep_id uuid not null references public.app_users(id),
  day_id uuid references public.ms_rep_days(id),
  at timestamptz not null default now(),
  geom geometry(Point, 4326) not null
);
create index if not exists ms_rep_track_rep_at on public.ms_rep_track (rep_id, at);
create index if not exists ms_rep_track_geom on public.ms_rep_track using gist (geom);
alter table public.ms_rep_track enable row level security;

-- the day ping keeps each point it accepts (same rules as before: accurate, moved 15 m or more)
create or replace function public.ms_rep_day_ping(p_lat double precision, p_lng double precision, p_accuracy numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare d ms_rep_days; v_m double precision; v_s double precision; v_today date := (now() at time zone 'America/Toronto')::date;
  v_pt geometry;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then return; end if;
  if coalesce(p_accuracy, 0) > 60 then return; end if;
  select * into d from ms_rep_days where rep_id = auth.uid() and day = v_today and ended_at is null for update;
  if d.id is null then return; end if;
  v_pt := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
  if d.last_lat is null then
    update ms_rep_days set last_lat = p_lat, last_lng = p_lng, last_at = now(), pings = pings + 1 where id = d.id;
    insert into ms_rep_track (rep_id, day_id, geom) values (auth.uid(), d.id, v_pt);
    return;
  end if;
  v_m := ST_Distance(v_pt::geography, ST_SetSRID(ST_MakePoint(d.last_lng, d.last_lat), 4326)::geography);
  if v_m < 15 then update ms_rep_days set pings = pings + 1 where id = d.id; return; end if;
  v_s := extract(epoch from now() - d.last_at);
  update ms_rep_days set
    distance_m = distance_m + case when v_s > 0 and v_m / v_s <= 3.5 and v_m <= 3000 then round(v_m)::int else 0 end,
    last_lat = p_lat, last_lng = p_lng, last_at = now(), pings = pings + 1
   where id = d.id;
  insert into ms_rep_track (rep_id, day_id, geom) values (auth.uid(), d.id, v_pt);
end $$;

-- ── the city's main roads, for the split (simplified, small) ──
create or replace function public.ms_city_road_pieces(p_city uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c ms_cities;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select * into c from ms_cities where id = p_city;
  if c.id is null then raise exception 'That city is gone'; end if;
  return jsonb_build_object(
    'city', jsonb_build_object('id', c.id, 'name', c.name, 'boundary', c.boundary, 'status', c.status),
    'zones', (select count(*) from ms_zones z where z.city_id = p_city and z.status = 'active'),
    'pieces', coalesce((
      select jsonb_agg(jsonb_build_array(l.id, l.name, round(ST_Length(l.geom::geography))::int,
               (ST_AsGeoJSON(ST_SimplifyPreserveTopology(l.geom, 0.00003), 5)::jsonb) -> 'coordinates'))
        from ms_city_lines l
       where l.city_id = p_city and l.kind = 'arterial' and coalesce(l.name, '') !~* 'service road'
         and GeometryType(l.geom) = 'LINESTRING'), '[]'::jsonb));
end $$;

-- ── make the zones: p_shares = [{name, rep_id, pieces: [line ids]}] ──
-- p_replace: the city's current zones are retired first (they're kept, just off). Businesses already in the city
-- move into the new zone they sit in.
create or replace function public.ms_create_road_zones(p_city uuid, p_campaign uuid, p_shares jsonb, p_replace boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c ms_cities; s jsonb; v_zone uuid; v_geom geometry; v_taken geometry; v_ids bigint[]; v_made int := 0; v_rep uuid; v_name text;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select * into c from ms_cities where id = p_city;
  if c.id is null then raise exception 'That city is gone'; end if;
  if not exists (select 1 from ms_campaigns where id = p_campaign) then raise exception 'Pick a campaign'; end if;
  if jsonb_typeof(p_shares) is distinct from 'array' or jsonb_array_length(p_shares) = 0 then raise exception 'Nothing to make'; end if;
  if jsonb_array_length(p_shares) > 60 then raise exception 'That’s too many zones at once'; end if;
  if exists (select 1 from ms_zones z where z.city_id = p_city and z.status = 'active') then
    if not coalesce(p_replace, false) then raise exception '% already has zones. Retire them first, or choose to replace them.', c.name; end if;
    update ms_zones set status = 'retired', retired_at = now(), updated_at = now() where city_id = p_city and status = 'active';
  end if;
  for s in select * from jsonb_array_elements(p_shares) loop
    select array_agg(x::bigint) into v_ids from jsonb_array_elements_text(s -> 'pieces') x;
    if v_ids is null then continue; end if;
    v_rep := nullif(s ->> 'rep_id', '')::uuid;
    if v_rep is not null and not exists (select 1 from user_permissions where user_id = v_rep and permission = 'mainstreet_rep') then
      raise exception 'That rep is gone'; end if;
    -- the storefronts: 60 m either side of the roads, inside the city
    select ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Intersection(
             ST_SimplifyPreserveTopology(ST_Buffer(ST_Union(l.geom)::geography, 60)::geometry, 0.00005), c.geom)), 3))
      into v_geom from ms_city_lines l where l.city_id = p_city and l.id = any (v_ids);
    -- where shares meet, the ground goes to the zone made first (zones can't share ground)
    select ST_Union(z.geom) into v_taken from ms_zones z where z.status = 'active' and ST_Intersects(z.geom, v_geom);
    if v_taken is not null then v_geom := ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Difference(v_geom, v_taken)), 3)); end if;
    if v_geom is null or ST_IsEmpty(v_geom) or ST_Area(v_geom::geography) < 100 then continue; end if;
    v_name := left(coalesce(nullif(trim(s ->> 'name'), ''), c.name || ' ' || (v_made + 1)), 80);
    insert into ms_zones (name, polygon, geom, center_lat, center_lng, city, city_id, status, created_by)
    values (v_name, ST_AsGeoJSON(v_geom, 6)::jsonb, v_geom, ST_Y(ST_PointOnSurface(v_geom)), ST_X(ST_PointOnSurface(v_geom)), c.name, p_city, 'active', auth.uid())
    returning id into v_zone;
    insert into ms_zone_roads (zone_id, name, geom, length_m)
    select v_zone, l.name, l.geom, round(ST_Length(l.geom::geography))::int
      from ms_city_lines l where l.city_id = p_city and l.id = any (v_ids) and GeometryType(l.geom) = 'LINESTRING';
    insert into ms_zone_campaigns (zone_id, campaign_id, rep_id, assigned_at, assigned_by)
    values (v_zone, p_campaign, v_rep, case when v_rep is not null then now() end, case when v_rep is not null then auth.uid() end)
    on conflict do nothing;
    v_made := v_made + 1;
  end loop;
  -- businesses already in the city sit in the new zones
  update ms_businesses b set zone_id = (select z.id from ms_zones z where z.city_id = p_city and z.status = 'active' and ST_Contains(z.geom, b.geom) limit 1)
   where b.city_id = p_city;
  update ms_zones z set business_count = (select count(*) from ms_businesses b where b.zone_id = z.id and b.status <> 'closed')
   where z.city_id = p_city and z.status = 'active';
  return jsonb_build_object('zones', v_made);
end $$;

-- ── walked: each road of a zone, against the rep's track (points within 40 m; a road counts as walked when most
-- of it is within 40 m of a line between two points 5 minutes or less apart, or of a visit) ──
create or replace function public.ms_zone_walked(p_zone uuid, p_rep uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rep uuid := coalesce(p_rep, auth.uid()); v_trail geometry;
begin
  if not (ms_is_admin() or (v_rep = auth.uid() and exists (select 1 from ms_zone_campaigns where zone_id = p_zone and rep_id = auth.uid()))) then
    raise exception 'Not allowed'; end if;
  -- the rep's trail near this zone: consecutive points joined when close in time, plus their visits
  select ST_Union(g) into v_trail from (
    select ST_MakeLine(prev, geom) g from (
      select geom, lag(geom) over (partition by day_id order by at) prev, at - lag(at) over (partition by day_id order by at) gap
        from ms_rep_track t
       where t.rep_id = v_rep and ST_DWithin(t.geom, (select geom from ms_zones where id = p_zone), 0.01)) x
     where prev is not null and gap <= interval '5 minutes'
    union all
    select geom from ms_rep_track t where t.rep_id = v_rep and ST_DWithin(t.geom, (select geom from ms_zones where id = p_zone), 0.002)
    union all
    select ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326) from ms_visits v
     where v.rep_id = v_rep and v.lat is not null and ST_DWithin(ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326), (select geom from ms_zones where id = p_zone), 0.002)) s;
  return (
    select jsonb_build_object(
      'total_m', coalesce(sum(r.length_m), 0),
      'walked_m', coalesce(sum(round(r.length_m * w.share)), 0),
      'roads', coalesce(jsonb_agg(jsonb_build_object('type', 'Feature',
                 'geometry', ST_AsGeoJSON(r.geom, 5)::jsonb,
                 'properties', jsonb_build_object('name', r.name, 'm', r.length_m,
                   'walked', case when w.share >= 0.7 then 'yes' when w.share >= 0.2 then 'partly' else 'no' end))), '[]'::jsonb))
      from ms_zone_roads r
      cross join lateral (select case when v_trail is null or r.length_m = 0 then 0
             else least(1, ST_Length(ST_Intersection(r.geom, ST_Buffer(v_trail::geography, 40)::geometry)::geography) / r.length_m) end share) w
     where r.zone_id = p_zone);
end $$;

-- every road zone, with how much has been walked (admins)
create or replace function public.ms_road_zones(p_city uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'name', z.name,
           'km', round((select sum(length_m) from ms_zone_roads r where r.zone_id = z.id) / 1000.0, 1),
           'rep', (select u.full_name from ms_zone_campaigns zc join app_users u on u.id = zc.rep_id where zc.zone_id = z.id limit 1),
           'rep_id', (select zc.rep_id from ms_zone_campaigns zc where zc.zone_id = z.id and zc.rep_id is not null limit 1),
           'businesses', z.business_count) order by z.name)
      from ms_zones z where z.city_id = p_city and z.status = 'active' and exists (select 1 from ms_zone_roads r where r.zone_id = z.id)), '[]'::jsonb);
end $$;

revoke all on function public.ms_city_road_pieces(uuid), public.ms_create_road_zones(uuid, uuid, jsonb, boolean),
  public.ms_zone_walked(uuid, uuid), public.ms_road_zones(uuid) from public, anon;
grant execute on function public.ms_city_road_pieces(uuid), public.ms_create_road_zones(uuid, uuid, jsonb, boolean),
  public.ms_zone_walked(uuid, uuid), public.ms_road_zones(uuid) to authenticated;
