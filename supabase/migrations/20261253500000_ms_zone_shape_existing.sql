-- MainstreetAI zones: a new zone's outline never covers a zone that is staying.
--
-- ms_zone_shape draws a generated zone's outline from its blocks and fills the gaps inside it (parks, rivers, ground
-- with no blocks), except a gap that holds another zone OF THE SAME RUN. It knew nothing of zones that already exist.
-- Nov 18: the Benny re-cut Edmonton North 1 into two; "Edmonton Downtown" (three blocks, made by hand on Nov 7) sits
-- in a gap inside it, the new outline was filled straight over it (1.5 km2), and saving the card was refused:
-- "This zone overlaps "Edmonton Downtown". Zones can't share ground."
--
-- Now the city's active zones that the run does not replace count as "others" too: a gap that holds one stays a
-- gap, and their ground is cut out of the outline. Zones › Generate uses the same function, so it gets this as well.

create or replace function public.ms_zone_shape(p_run uuid, p_zone integer)
returns geometry language sql stable security definer set search_path to 'public' as $function$
  with run as (select city_id, coalesce(replaces, '{}'::uuid[]) replaces from ms_zone_runs where id = p_run),
  base as (
    select z.zone, ST_Union(k.geom) g
      from ms_zone_run_blocks z join ms_blocks k on k.id = z.block_id
     where z.run_id = p_run and z.zone is not null
     group by z.zone),
  mine as (select g from base where zone = p_zone),
  others as (
    select coalesce(ST_Union(g), 'SRID=4326;POLYGON EMPTY'::geometry) g from (
      select g from base where zone <> p_zone
      union all
      -- zones that stay: active, in this city, not replaced by this run
      select zz.geom from ms_zones zz, run
       where zz.city_id = run.city_id and zz.status = 'active' and zz.geom is not null and not (zz.id = any (run.replaces))) o),
  closed as (select (ST_Dump(ST_Transform(ST_Buffer(ST_Buffer(ST_Transform(mine.g, 3857), 40, 'join=mitre'), -40, 'join=mitre'), 4326))).geom p from mine),
  filled as (
    select ST_MakePolygon(ST_ExteriorRing(c.p), coalesce(array(
             select ST_ExteriorRing(r.geom) from ST_DumpRings(c.p) r, others o
              where r.path[1] > 0 and ST_Intersects(r.geom, o.g)), '{}'::geometry[])) p
      from closed c)
  select ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Difference(ST_Union(f.p), (select g from others))), 3))
    from filled f
$function$;
