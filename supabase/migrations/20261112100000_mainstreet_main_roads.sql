-- MainstreetAI (RUN_55): zones cut only along main roads, and grown into tidy shapes. ADDITIVE ONLY
-- (replaces ms_city_make_blocks; patches ms_run_step in place).
--
-- Zone edges followed every block edge, and blocks were cut by every collector road and creek, so zones
-- came out wiggly. Clean edges matter more than equal zones, so:
--
--   ms_city_make_blocks(city)   blocks are cut ONLY by highways, rail, and main roads: a road name (East /
--                               West joined) with 5 km or more in the city (in a small town, half the town's
--                               diagonal, whichever is less), service roads excepted. Creeks
--                               and collector roads no longer cut. Slivers under 2 ha (between the two sides
--                               of a divided road) are dropped; thin or small blocks (under 10 ha, or long
--                               and skinny) join the neighbour they share the longest edge with. Plazas are re-pinned to the new blocks;
--                               businesses are re-pinned by ms_city_pin_businesses (their block links clear
--                               when the old blocks go). Clears the block neighbour list (rebuilt on demand).
--   ms_run_step                 growing: a zone takes the neighbouring block that keeps its outline most
--                               rectangle-like (least growth of its bounding box), not the nearest one;
--                               balancing: only beyond ±25% of the share (was ±10%)
--
-- Main roads are found from the city's own street list, so this works for any city without a list per city.

create or replace function public.ms_city_main_roads(p_city uuid)
returns table (base text, km numeric) language sql stable security definer set search_path = public as $$
  select regexp_replace(name, '\s+(East|West|North|South)$', '') base, round((sum(ST_Length(geom::geography)) / 1000)::numeric, 1) km
    from ms_city_lines
   where city_id = p_city and kind = 'arterial' and name is not null and name !~* 'service road'
   group by 1
  having sum(ST_Length(geom::geography)) >= least(5000, 0.5 * (
           select ST_Distance(ST_SetSRID(ST_MakePoint(ST_XMin(c.geom), ST_YMin(c.geom)), 4326)::geography,
                              ST_SetSRID(ST_MakePoint(ST_XMax(c.geom), ST_YMax(c.geom)), 4326)::geography)
             from ms_cities c where c.id = p_city))
   order by 2 desc
$$;
revoke all on function public.ms_city_main_roads(uuid) from public, anon;
grant execute on function public.ms_city_main_roads(uuid) to authenticated;

create or replace function public.ms_city_make_blocks(p_city uuid)
returns int language plpgsql security definer set search_path = public as $$
declare cg geometry; n int; v_from bigint; v_into bigint; v_merges int := 0; v_skip bigint[] := '{}';
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select geom into cg from ms_cities where id = p_city;
  if cg is null then raise exception 'Build the city boundary first'; end if;
  if exists (select 1 from ms_zone_blocks zb join ms_blocks b on b.id = zb.block_id join ms_zones z on z.id = zb.zone_id
              where b.city_id = p_city and z.status = 'active') then
    raise exception 'This city has accepted zones. Retire them before re-cutting its blocks.';
  end if;
  -- open proposals are made of the old blocks
  update ms_zone_runs set status = 'discarded' where city_id = p_city and status = 'proposed';
  delete from ms_block_adj where city_id = p_city;
  delete from ms_blocks where city_id = p_city;
  insert into ms_blocks (city_id, geom, center, area_m2)
  select p_city, g, ST_PointOnSurface(g), ST_Area(g::geography)
    from (
      select (ST_Dump(ST_CollectionExtract(ST_Intersection(poly, cg), 3))).geom g
        from (select (ST_Dump(ST_Polygonize(noded))).geom poly
                from (select ST_Node(ST_Collect(l.geom)) noded
                        from (select geom from ms_city_lines
                               where city_id = p_city
                                 and (kind in ('highway', 'rail')
                                      or (kind = 'arterial' and regexp_replace(name, '\s+(East|West|North|South)$', '') in (select base from ms_city_main_roads(p_city))))
                              union all select (ST_Dump(ST_Boundary(cg))).geom) l) nd) p
    ) x
   where ST_Area(g::geography) >= 20000;
  -- slivers (the strips between a highway's two sides and its ramps, or tiny leftovers) join the neighbour
  -- they share the longest edge with, so no zone can snake along a highway
  loop
    select k.id, nb.id into v_from, v_into
      from ms_blocks k
      join lateral (select b.id, ST_Length(ST_CollectionExtract(ST_Intersection(k.geom, b.geom), 2)) edge
                      from ms_blocks b where b.city_id = p_city and b.id <> k.id and ST_Intersects(k.geom, b.geom)
                     order by 2 desc limit 1) nb on nb.edge > 0
     where k.city_id = p_city and not (k.id = any(v_skip))
       and (k.area_m2 < 100000 or 4 * pi() * ST_Area(k.geom) / nullif(ST_Perimeter(k.geom) ^ 2, 0) < 0.12)
     order by k.area_m2 limit 1;
    exit when v_from is null or v_merges >= 500;
    update ms_blocks b set geom = g, center = ST_PointOnSurface(g), area_m2 = ST_Area(g::geography)
      from (select ST_CollectionExtract(ST_MakeValid(ST_Union(geom)), 3) g from ms_blocks where id in (v_from, v_into)) u
     where b.id = v_into and ST_GeometryType(u.g) = 'ST_Polygon';
    if not found then   -- they'd make two pieces: keep this one as it is
      v_skip := v_skip || v_from;
    else
      delete from ms_blocks where id = v_from;
    end if;
    v_merges := v_merges + 1; v_from := null; v_into := null;
  end loop;
  update ms_plazas pl set block_id = (select b.id from ms_blocks b where b.city_id = p_city and ST_Contains(b.geom, ST_PointOnSurface(pl.geom)) limit 1)
   where pl.city_id = p_city;
  update ms_cities set blocks = (select count(*) from ms_blocks where city_id = p_city) where id = p_city;
  select blocks into n from ms_cities where id = p_city;
  return n;
end $$;
revoke all on function public.ms_city_make_blocks(uuid) from public, anon;
grant execute on function public.ms_city_make_blocks(uuid) to authenticated;

-- ms_run_step: tidy growth, looser balancing (patched in place)
do $$
declare src text;
begin
  select pg_get_functiondef('public.ms_run_step(uuid)'::regprocedure) into src;
  if position('nb.center <-> (select k.center from ms_zone_run_blocks s join ms_blocks k on k.id = s.block_id' in src) = 0
     or position('v_ideal * 1.10' in src) = 0 then
    raise exception 'ms_run_step is not the expected version; not patched';
  end if;
  -- the block whose box adds least to the zone's box (ties: nearest the start)
  src := replace(src,
    '     order by j.barrier,
              nb.center <-> (select k.center from ms_zone_run_blocks s join ms_blocks k on k.id = s.block_id
                              where s.run_id = p_run and s.zone = run.cur_zone and s.seed limit 1),
              n.block_id',
    '     order by j.barrier,
              ST_Area(ST_Envelope(ST_Collect(nb.geom, (select ST_SetSRID(ST_Extent(zk.geom)::geometry, 4326) from ms_zone_run_blocks zs join ms_blocks zk on zk.id = zs.block_id
                                                        where zs.run_id = p_run and zs.zone = run.cur_zone))))
                - ST_Area(nb.geom),
              nb.center <-> (select k.center from ms_zone_run_blocks s join ms_blocks k on k.id = s.block_id
                              where s.run_id = p_run and s.zone = run.cur_zone and s.seed limit 1),
              n.block_id');
  src := replace(src, 'v_ideal * 1.10', 'v_ideal * 1.25');
  src := replace(src, 'v_ideal * 0.90', 'v_ideal * 0.75');
  if position('ST_Extent(zk.geom)' in src) = 0 or position('v_ideal * 1.25' in src) = 0 then raise exception 'ms_run_step: patch did not apply'; end if;
  execute src;
end $$;

-- ───────────── audit: not the automatic links ─────────────
-- Re-cutting a city's blocks clears every business's block link (11,000 rows in Oakville); auditing each of
-- those overran the 8 s limit. A business's block / plaza / zone links are worked out, not edited, and zones
-- are audited themselves, so only real changes to a business are audited now.
drop trigger if exists audit on public.ms_businesses;
create trigger audit after insert or delete on public.ms_businesses for each row execute function public.audit_row();
drop trigger if exists audit_edit on public.ms_businesses;
create trigger audit_edit after update on public.ms_businesses for each row
  when ((old.name, old.address, old.kind, old.status, old.is_chain, old.phone, old.website, old.google_place_id, old.osm_id, old.lat, old.lng)
        is distinct from (new.name, new.address, new.kind, new.status, new.is_chain, new.phone, new.website, new.google_place_id, new.osm_id, new.lat, new.lng))
  execute function public.audit_row();
