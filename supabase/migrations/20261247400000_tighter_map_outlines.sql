-- Map outlines tighter still: the route lines widened ~35 m (was 60 m), gaps between streets closed only under
-- ~75 m (was ~130 m), holes inside filled, simplified to ~5 m. Additive only.

create or replace function public.map_area_outline(p_area text)
returns jsonb language sql stable security definer set search_path = public as $$
  with l as (
    select ST_Collect(ST_SetSRID(ST_GeomFromGeoJSON(jsonb_build_object('type', 'LineString', 'coordinates', seg->'coordinates')), 4326)) g
      from route_maps rm cross join lateral jsonb_array_elements(case when jsonb_typeof(rm.segments) = 'array' then rm.segments else '[]'::jsonb end) seg
     where rm.area_name = p_area and rm.status = 'approved' and jsonb_typeof(seg->'coordinates') = 'array' and jsonb_array_length(seg->'coordinates') >= 2),
  shape as (
    select ST_Buffer(ST_Buffer(ST_Buffer(g::geography, 35)::geometry, 0.0007), -0.0007) s from l where g is not null),
  solid as (
    select ST_Collect(ST_MakePolygon(ST_ExteriorRing(d.geom))) s
      from shape, ST_Dump(shape.s) d where GeometryType(d.geom) = 'POLYGON')
  select ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_UnaryUnion(s), 0.00005), 5)::jsonb from solid where s is not null
$$;
revoke all on function public.map_area_outline(text) from public, anon, authenticated;
