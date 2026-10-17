-- Territory: the outline of every master map, for the "All maps" viewer and the map builder.
-- An outline is the concave hull of the map's approved route lines (the same shape Master Bookings
-- draws). Working them all out takes a few seconds, so each is kept in map_area_outlines and only
-- worked out again after that map's routes change (a trigger on route_maps drops the kept one).
-- Additive only: one new table, one trigger, one function.

create table if not exists public.map_area_outlines (
  area_name text primary key,
  outline   jsonb,
  made_at   timestamptz not null default now()
);
alter table public.map_area_outlines enable row level security;
revoke all on public.map_area_outlines from anon, authenticated;
-- read and written only through app_territory_outlines (security definer); no policies on purpose

create or replace function public.map_area_outline_forget() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then delete from map_area_outlines where area_name = old.area_name; end if;
  if tg_op in ('INSERT', 'UPDATE') then delete from map_area_outlines where area_name = new.area_name; end if;
  return null;
end $$;
revoke all on function public.map_area_outline_forget() from public, anon, authenticated;

drop trigger if exists route_maps_outline on public.route_maps;
create trigger route_maps_outline after insert or update or delete on public.route_maps
  for each row execute function public.map_area_outline_forget();

-- Every map with approved routes → its outline (GeoJSON), as { "<area>": <polygon>, ... }.
create or replace function public.app_territory_outlines()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v jsonb;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  -- work out the ones not kept yet
  insert into map_area_outlines (area_name, outline, made_at)
  select g.area_name, ST_AsGeoJSON(ST_Simplify(ST_ConcaveHull(g.geom, 0.4), 0.0002), 5)::jsonb, now()
    from (select rm.area_name,
                 ST_Collect(ST_Simplify(ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type', 'LineString', 'coordinates', seg->'coordinates')), 4326), 0.0003)) as geom
            from route_maps rm cross join lateral jsonb_array_elements(case when jsonb_typeof(rm.segments) = 'array' then rm.segments else '[]'::jsonb end) seg
           where rm.status = 'approved' and jsonb_typeof(seg->'coordinates') = 'array' and jsonb_array_length(seg->'coordinates') >= 2
             and not exists (select 1 from map_area_outlines o where o.area_name = rm.area_name)
           group by rm.area_name) g
  on conflict (area_name) do update set outline = excluded.outline, made_at = excluded.made_at;
  select coalesce(jsonb_object_agg(o.area_name, o.outline), '{}'::jsonb) into v
    from map_area_outlines o
   where o.outline is not null and exists (select 1 from route_maps rm where rm.area_name = o.area_name and rm.status = 'approved');
  return v;
end $$;
revoke all on function public.app_territory_outlines() from public, anon;
grant execute on function public.app_territory_outlines() to authenticated;
