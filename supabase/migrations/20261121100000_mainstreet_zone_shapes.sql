-- MainstreetAI (RUN_60): clean zone outlines. ADDITIVE ONLY.
--
-- A zone is its blocks glued together, but neighbouring blocks don't quite touch: thin road strips
-- (about 12 m) run between them, and small leftover pieces were dropped. The glued shape kept those
-- as holes and slits, drawn as lines inside the zone (Oakville South 1 had 12).
--
-- Now a zone's outline is closed up: gaps narrower than about 60 m are filled, and a hole inside a
-- zone is filled unless another zone sits in it. The outline never takes ground from a neighbouring
-- zone (their blocks are cut back out), and which blocks and businesses a zone holds don't change.
--
--   ms_zone_shape(run, zone)   the clean outline of one zone of a run
--   ms_run_step                shaping now draws zones with ms_zone_shape
--   (proposals still waiting are redrawn the same way)

create or replace function public.ms_zone_shape(p_run uuid, p_zone int)
returns geometry language sql stable security definer set search_path = public as $$
  with base as (
    select z.zone, ST_Union(k.geom) g
      from ms_zone_run_blocks z join ms_blocks k on k.id = z.block_id
     where z.run_id = p_run and z.zone is not null
     group by z.zone),
  mine as (select g from base where zone = p_zone),
  others as (select coalesce(ST_Union(g), 'SRID=4326;POLYGON EMPTY'::geometry) g from base where zone <> p_zone),
  -- close it up: grow ~30 m and shrink back (fills road strips and slits up to ~60 m wide)
  closed as (select (ST_Dump(ST_Transform(ST_Buffer(ST_Buffer(ST_Transform(mine.g, 3857), 40, 'join=mitre'), -40, 'join=mitre'), 4326))).geom p from mine),
  -- fill holes, except one with another zone inside it
  filled as (
    select ST_MakePolygon(ST_ExteriorRing(c.p), coalesce(array(
             select ST_ExteriorRing(r.geom) from ST_DumpRings(c.p) r, others o
              where r.path[1] > 0 and ST_Intersects(r.geom, o.g)), '{}'::geometry[])) p
      from closed c)
  select ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Difference(ST_Union(f.p), (select g from others))), 3))
    from filled f
$$;
revoke all on function public.ms_zone_shape(uuid, int) from public, anon, authenticated;

-- shaping draws each zone with ms_zone_shape (patched in place: only this expression changes)
do $$
declare src text;
begin
  src := pg_get_functiondef('public.ms_run_step(uuid)'::regprocedure);
  if position('ST_Multi(ST_Buffer(ST_Union(k.geom), 0)) g' in src) = 0 then raise exception 'ms_run_step is not the expected version'; end if;
  src := replace(src, 'ST_Multi(ST_Buffer(ST_Union(k.geom), 0)) g', 'ms_zone_shape(p_run, z.zone) g');
  execute src;
end $$;

-- proposals still waiting: redraw their zones the same way
update public.ms_zone_runs r
   set proposal = (select jsonb_agg(z || jsonb_build_object('polygon', ST_AsGeoJSON(ms_zone_shape(r.id, (z->>'key')::int))::jsonb) order by o)
                     from jsonb_array_elements(r.proposal) with ordinality e(z, o))
 where r.status = 'proposed' and jsonb_typeof(r.proposal) = 'array' and jsonb_array_length(r.proposal) > 0
   and exists (select 1 from ms_zone_run_blocks b where b.run_id = r.id);
