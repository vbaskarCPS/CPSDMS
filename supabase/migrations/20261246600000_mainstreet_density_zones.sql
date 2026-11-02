-- MainstreetAI › zones by density, with no business list. A city (or area) is built from free OpenStreetMap data
-- only: boundary, streets, blocks (cut by the main roads) and commercial land (retail, commercial and industrial
-- areas, plazas, business parks). Each block gets a density score:
--     1 point per 500 m² of commercial land in the block  +  1 point per 100 m of main-road frontage
-- and Zones › Generate grows that many zones of about equal density from whole blocks (the same generator as
-- before: ms_run_step grows, balances and shapes; ms_run_accept saves), so no single call runs long.
-- Walked (ms_zone_walked) now also works for these zones: their main roads come from the city's streets.
-- Additive only.

alter table public.ms_blocks add column if not exists density int;

-- density for the next batch of blocks that don't have it yet; returns how many are left
create or replace function public.ms_city_density_step(p_city uuid, p_batch int default 250)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  update ms_blocks k set density = round(
           coalesce((select sum(ST_Area(ST_Intersection(p.geom, k.geom)::geography)) from ms_plazas p
                      where p.city_id = p_city and ST_Intersects(p.geom, k.geom)), 0) / 500
         + coalesce((select sum(ST_Length(ST_Intersection(l.geom, ST_Buffer(k.geom, 0.0003))::geography)) from ms_city_lines l
                      where l.city_id = p_city and l.kind = 'arterial' and ST_Intersects(l.geom, ST_Buffer(k.geom, 0.0003))), 0) / 100)::int
   where k.id in (select id from ms_blocks where city_id = p_city and density is null order by id limit greatest(1, least(p_batch, 1000)));
  select count(*)::int into n from ms_blocks where city_id = p_city and density is null;
  return n;
end $$;

-- the starting blocks and the run, weighted by density (the campaign is kept on the run for the zones it makes)
create or replace function public.ms_generate_zones(p_city uuid, p_campaign uuid, p_target int)
returns uuid language plpgsql security definer set search_path = public as $$
declare cty ms_cities; v_run uuid; v_total int; v_k int; v_n int; i int; j int; it int;
  ids bigint[]; xs float8[]; ys float8[]; ws float8[]; mind float8[]; cl int[];
  cx float8[] := '{}'; cy float8[] := '{}'; sx float8[]; sy float8[]; sw float8[];
  d float8; best float8; bi int; bc int; v_seed bigint;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select * into cty from ms_cities where id = p_city;
  if cty.id is null or cty.status <> 'built' then raise exception 'Build the city first'; end if;
  if p_target is null or p_target < 1 or p_target > 60 then raise exception 'Ask for between 1 and 60 zones'; end if;
  if exists (select 1 from ms_blocks where city_id = p_city and density is null) then raise exception 'Finish building % first (Cities › Build)', cty.name; end if;
  if not exists (select 1 from ms_block_adj where city_id = p_city) then perform ms_city_make_adjacency(p_city); end if;

  insert into ms_zone_runs (city_id, campaign_id, target, stage, created_by) values (p_city, p_campaign, p_target, 'growing', auth.uid())
  returning id into v_run;
  -- free blocks (not under an active zone) and their density
  insert into ms_zone_run_blocks (run_id, block_id, cnt)
  select v_run, k.id, coalesce(k.density, 0)
    from ms_blocks k
   where k.city_id = p_city
     and not exists (select 1 from ms_zone_blocks zb join ms_zones z on z.id = zb.zone_id where zb.block_id = k.id and z.status = 'active')
     and not exists (select 1 from ms_zones z where z.status = 'active' and z.run_id is null and z.geom is not null and ST_Contains(z.geom, k.center));
  if not exists (select 1 from ms_zone_run_blocks where run_id = v_run) then raise exception 'Every block of % is already in a zone', cty.name; end if;
  select coalesce(sum(cnt), 0) into v_total from ms_zone_run_blocks where run_id = v_run;
  if v_total = 0 then raise exception 'Nothing dense enough in % yet (no main roads or commercial land found)', cty.name; end if;

  -- starting blocks: weighted k-means over the blocks with any density, then the densest block near each centre
  select array_agg(z.block_id order by z.block_id), array_agg(ST_X(k.center) order by z.block_id), array_agg(ST_Y(k.center) order by z.block_id),
         array_agg(z.cnt::float8 order by z.block_id)
    into ids, xs, ys, ws
    from ms_zone_run_blocks z join ms_blocks k on k.id = z.block_id where z.run_id = v_run and z.cnt > 0;
  v_n := coalesce(array_length(ids, 1), 0);
  v_k := least(p_target, v_n);
  -- first centre: the densest block; then each next one where density × distance² to the nearest centre is largest
  bi := 1; for i in 1..v_n loop if ws[i] > ws[bi] then bi := i; end if; end loop;
  cx := array_append(cx, xs[bi]); cy := array_append(cy, ys[bi]);
  mind := array_fill(1e30::float8, array[v_n]);
  for j in 2..v_k loop
    best := -1; bi := 1;
    for i in 1..v_n loop
      d := (xs[i] - cx[j - 1])^2 + ((ys[i] - cy[j - 1]) * 1.4)^2;
      if d < mind[i] then mind[i] := d; end if;
      if ws[i] * mind[i] > best then best := ws[i] * mind[i]; bi := i; end if;
    end loop;
    cx := array_append(cx, xs[bi]); cy := array_append(cy, ys[bi]);
  end loop;
  cl := array_fill(1, array[v_n]);
  for it in 1..8 loop
    for i in 1..v_n loop
      best := 1e30; bc := 1;
      for j in 1..v_k loop
        d := (xs[i] - cx[j])^2 + ((ys[i] - cy[j]) * 1.4)^2;
        if d < best then best := d; bc := j; end if;
      end loop;
      cl[i] := bc;
    end loop;
    sx := array_fill(0::float8, array[v_k]); sy := array_fill(0::float8, array[v_k]); sw := array_fill(0::float8, array[v_k]);
    for i in 1..v_n loop
      sx[cl[i]] := sx[cl[i]] + xs[i] * ws[i]; sy[cl[i]] := sy[cl[i]] + ys[i] * ws[i]; sw[cl[i]] := sw[cl[i]] + ws[i];
    end loop;
    for j in 1..v_k loop
      if sw[j] > 0 then cx[j] := sx[j] / sw[j]; cy[j] := sy[j] / sw[j]; end if;
    end loop;
  end loop;
  -- one starting block per zone
  for j in 1..v_k loop
    best := 1e30; v_seed := null;
    for i in 1..v_n loop
      if cl[i] = j then
        d := ((xs[i] - cx[j])^2 + ((ys[i] - cy[j]) * 1.4)^2) / greatest(ws[i], 1);
        if d < best then best := d; v_seed := ids[i]; end if;
      end if;
    end loop;
    if v_seed is not null then
      update ms_zone_run_blocks set zone = j, seed = true where run_id = v_run and block_id = v_seed;
    end if;
  end loop;
  analyze ms_zone_run_blocks;
  update ms_zone_runs set target = (select count(*) from ms_zone_run_blocks where run_id = v_run and seed),
         stats = jsonb_build_object('eligible', v_total, 'share', ceil(v_total::numeric / greatest(v_k, 1)), 'by', 'density',
                                    'free_blocks', (select count(*) from ms_zone_run_blocks where run_id = v_run)) where id = v_run;
  return v_run;
end $$;

-- walked: a zone's main roads are its saved roads, or else the city's main roads inside it
create or replace function public.ms_zone_walked(p_zone uuid, p_rep uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rep uuid := coalesce(p_rep, auth.uid()); v_trail geometry; z ms_zones;
begin
  if not (ms_is_admin() or (v_rep = auth.uid() and exists (select 1 from ms_zone_campaigns where zone_id = p_zone and rep_id = auth.uid()))) then
    raise exception 'Not allowed'; end if;
  select * into z from ms_zones where id = p_zone;
  if z.geom is null then return jsonb_build_object('total_m', 0, 'walked_m', 0, 'roads', '[]'::jsonb); end if;
  select ST_Union(g) into v_trail from (
    select ST_MakeLine(prev, geom) g from (
      select geom, lag(geom) over (partition by day_id order by at) prev, at - lag(at) over (partition by day_id order by at) gap
        from ms_rep_track t
       where t.rep_id = v_rep and ST_DWithin(t.geom, z.geom, 0.01)) x
     where prev is not null and gap <= interval '5 minutes'
    union all
    select geom from ms_rep_track t where t.rep_id = v_rep and ST_DWithin(t.geom, z.geom, 0.002)
    union all
    select ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326) from ms_visits v
     where v.rep_id = v_rep and v.lat is not null and ST_DWithin(ST_SetSRID(ST_MakePoint(v.lng, v.lat), 4326), z.geom, 0.002)) s;
  return (
    with roads as (
      select r.name, r.geom, r.length_m from ms_zone_roads r where r.zone_id = p_zone
      union all
      select l.name, g.geom, round(ST_Length(g.geom::geography))::int
        from ms_city_lines l
        cross join lateral (select (ST_Dump(ST_Intersection(l.geom, ST_Buffer(z.geom, 0.0003)))).geom) g
       where not exists (select 1 from ms_zone_roads r where r.zone_id = p_zone)
         and l.city_id = z.city_id and l.kind = 'arterial' and ST_Intersects(l.geom, ST_Buffer(z.geom, 0.0003))
         and GeometryType(g.geom) = 'LINESTRING')
    select jsonb_build_object(
      'total_m', coalesce(sum(r.length_m), 0),
      'walked_m', coalesce(sum(round(r.length_m * w.share)), 0),
      'roads', coalesce(jsonb_agg(jsonb_build_object('type', 'Feature',
                 'geometry', ST_AsGeoJSON(r.geom, 5)::jsonb,
                 'properties', jsonb_build_object('name', r.name, 'm', r.length_m,
                   'walked', case when w.share >= 0.7 then 'yes' when w.share >= 0.2 then 'partly' else 'no' end))), '[]'::jsonb))
      from roads r
      cross join lateral (select case when v_trail is null or r.length_m = 0 then 0
             else least(1, ST_Length(ST_Intersection(r.geom, ST_Buffer(v_trail::geography, 40)::geometry)::geography) / r.length_m) end share) w
     where r.length_m > 0);
end $$;

revoke all on function public.ms_city_density_step(uuid, int) from public, anon;
grant execute on function public.ms_city_density_step(uuid, int) to authenticated;
