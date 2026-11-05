-- Map outlines (Territory, All maps, and "Other maps" in the Map Builder) drawn tight around each area's streets:
-- the area's approved route lines widened ~60 m, small gaps between streets closed (~130 m), holes inside filled,
-- lightly simplified. Before, a loose concave hull of the lines, worked out once and never refreshed; now an outline
-- is redrawn whenever one of its area's routes changes. Additive only.

create or replace function public.map_area_outline(p_area text)
returns jsonb language sql stable security definer set search_path = public as $$
  with l as (
    select ST_Collect(ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type', 'LineString', 'coordinates', seg->'coordinates')), 4326)) g
      from route_maps rm cross join lateral jsonb_array_elements(case when jsonb_typeof(rm.segments) = 'array' then rm.segments else '[]'::jsonb end) seg
     where rm.area_name = p_area and rm.status = 'approved' and jsonb_typeof(seg->'coordinates') = 'array' and jsonb_array_length(seg->'coordinates') >= 2),
  shape as (
    select ST_Buffer(ST_Buffer(ST_Buffer(g::geography, 60)::geometry, 0.0012), -0.0012) s from l where g is not null),
  solid as (   -- each piece without its holes
    select ST_Collect(ST_MakePolygon(ST_ExteriorRing(d.geom))) s
      from shape, ST_Dump(shape.s) d where GeometryType(d.geom) = 'POLYGON')
  select ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_UnaryUnion(s), 0.0001), 5)::jsonb from solid where s is not null
$$;
revoke all on function public.map_area_outline(text) from public, anon, authenticated;

create or replace function public.app_territory_outlines()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  -- areas with no outline yet, or whose routes changed since it was drawn
  insert into map_area_outlines (area_name, outline, made_at)
  select a.area_name, map_area_outline(a.area_name), now()
    from (select rm.area_name, max(greatest(rm.updated_at, rm.approved_at, rm.created_at)) changed
            from route_maps rm where rm.status = 'approved' group by rm.area_name) a
    left join map_area_outlines o on o.area_name = a.area_name
   where o.area_name is null or o.made_at is null or a.changed > o.made_at
  on conflict (area_name) do update set outline = excluded.outline, made_at = excluded.made_at;
  select coalesce(jsonb_object_agg(o.area_name, o.outline), '{}'::jsonb) into v
    from map_area_outlines o
   where o.outline is not null and exists (select 1 from route_maps rm where rm.area_name = o.area_name and rm.status = 'approved');
  return v;
end $$;
