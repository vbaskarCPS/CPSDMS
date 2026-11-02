-- MainstreetAI › Generate zones on a city that was built the old way (no blocks yet) now says to rebuild it,
-- instead of "every block is already in a zone". Additive only.

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
  if not exists (select 1 from ms_blocks where city_id = p_city) then raise exception '% hasn''t been cut into blocks yet. Go to Cities and press Rebuild on %, then come back', cty.name, cty.name; end if;
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
