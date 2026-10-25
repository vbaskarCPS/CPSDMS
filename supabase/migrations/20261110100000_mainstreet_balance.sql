-- MainstreetAI (RUN_53): the city finish and zone generation in short steps, and evener zones.
-- ADDITIVE ONLY (replaces three functions, adds two tables and three columns).
--
-- The app's database calls are cut off at 8 seconds (and a function can't be given longer), so the
-- heavy work now runs in steps of a few seconds that the app calls until done, saving as it goes:
--
--   ms_city_pin_businesses(city, batch)   NEW. Businesses with no block yet get their plaza and block,
--                                         `batch` at a time; returns how many still wait. Clearing blocks
--                                         or plazas (a rebuild) clears those links, so they're redone.
--   ms_city_finish(city)                  chains, counts, and the block neighbour list (ms_block_adj);
--                                         writes only rows that change
--   ms_generate_zones(city, campaign, n)  sets up a run: the free blocks, and one starting block per zone,
--                                         placed by where the eligible businesses are (weighted k-means), so
--                                         dense areas get more, smaller zones
--   ms_run_step(run)                      NEW. Up to ~4 s of the next stage:
--                                           growing    all zones grow together: the smallest zone so far takes
--                                                      its best neighbouring free block (same side of a highway /
--                                                      rail / river first, then nearest its start). Zones stay in
--                                                      one piece and plazas are never split (a plaza sits in one
--                                                      block)
--                                           leftovers  remaining blocks join the lightest zone next door
--                                           balancing  an edge block moves to a lighter neighbour while that
--                                                      narrows the gap and the giving zone stays in one piece;
--                                                      ends when all zones are within 10% of their share,
--                                                      nothing more can move, or after 600 moves
--                                           shaping    outlines, names ("<City> North 1" west → east), counts
--                                           ready      the proposal can be merged, accepted or discarded
--                                         returns {stage, zone, zones, moves}
--   ms_run_accept                         refuses a run that isn't ready
--
--   ms_block_adj           which blocks touch, and whether the shared edge is a barrier (per city)
--   ms_zone_run_blocks     a run's working map: each free block, its business count, its zone
--   ms_zone_runs           + stage, cur_zone, cur_seed, cur_cnt, cur_share, moves

-- ───────────── tables ─────────────
create table if not exists public.ms_block_adj (
  city_id uuid not null references public.ms_cities(id) on delete cascade,
  a bigint not null references public.ms_blocks(id) on delete cascade,
  b bigint not null references public.ms_blocks(id) on delete cascade,
  barrier boolean not null default false,
  primary key (a, b)
);
create index if not exists ms_block_adj_city on public.ms_block_adj (city_id);
alter table public.ms_block_adj enable row level security;
revoke all on public.ms_block_adj from anon, authenticated;
grant select on public.ms_block_adj to authenticated;
drop policy if exists ms_block_adj_read on public.ms_block_adj;
create policy ms_block_adj_read on public.ms_block_adj for select to authenticated using (ms_is_admin());

create table if not exists public.ms_zone_run_blocks (
  run_id uuid not null references public.ms_zone_runs(id) on delete cascade,
  block_id bigint not null references public.ms_blocks(id) on delete cascade,
  cnt int not null default 0,
  zone int,
  skip boolean not null default false,
  seed boolean not null default false,
  primary key (run_id, block_id)
);
alter table public.ms_zone_run_blocks add column if not exists seed boolean not null default false;
create index if not exists ms_zone_run_blocks_zone on public.ms_zone_run_blocks (run_id, zone);
alter table public.ms_zone_run_blocks enable row level security;
revoke all on public.ms_zone_run_blocks from anon, authenticated;
grant select on public.ms_zone_run_blocks to authenticated;
drop policy if exists ms_zone_run_blocks_read on public.ms_zone_run_blocks;
create policy ms_zone_run_blocks_read on public.ms_zone_run_blocks for select to authenticated using (ms_is_admin());

alter table public.ms_zone_runs add column if not exists stage text not null default 'ready';
alter table public.ms_zone_runs add column if not exists cur_zone int not null default 0;
alter table public.ms_zone_runs add column if not exists cur_seed bigint;
alter table public.ms_zone_runs add column if not exists cur_cnt int not null default 0;
alter table public.ms_zone_runs add column if not exists cur_share int not null default 0;
alter table public.ms_zone_runs add column if not exists moves int not null default 0;
alter table public.ms_zone_runs drop constraint if exists ms_zone_runs_stage_check;
alter table public.ms_zone_runs add constraint ms_zone_runs_stage_check check (stage in ('growing','leftovers','balancing','shaping','ready'));

-- ───────────── the city: pins, neighbours, finish ─────────────
create or replace function public.ms_city_pin_businesses(p_city uuid, p_batch integer default 1000)
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  with todo as (
    select b.id, b.geom from ms_businesses b where b.city_id = p_city and b.block_id is null
     order by b.id limit greatest(1, least(coalesce(p_batch, 1000), 3000))
  ), pl as (
    select t.id, t.geom, (select p.id from ms_plazas p where p.city_id = p_city and ST_Contains(p.geom, t.geom) order by ST_Area(p.geom) limit 1) plaza_id
      from todo t
  ), bl as (
    select pl.id, pl.plaza_id, coalesce(
             (select p.block_id from ms_plazas p where p.id = pl.plaza_id),
             (select k.id from ms_blocks k where k.city_id = p_city and ST_Contains(k.geom, pl.geom) limit 1),
             (select k.id from ms_blocks k where k.city_id = p_city order by k.geom <-> pl.geom limit 1)) block_id
      from pl
  )
  update ms_businesses b set plaza_id = bl.plaza_id, block_id = bl.block_id from bl where b.id = bl.id;
  select count(*)::int into n from ms_businesses where city_id = p_city and block_id is null;
  return n;
end $$;
revoke all on function public.ms_city_pin_businesses(uuid, integer) from public, anon;
grant execute on function public.ms_city_pin_businesses(uuid, integer) to authenticated;

-- which blocks touch (shared edge longer than ~5 m), and whether that edge runs along a barrier
create or replace function public.ms_city_make_adjacency(p_city uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  delete from ms_block_adj where city_id = p_city;
  insert into ms_block_adj (city_id, a, b, barrier)
  select p_city, x.a, x.b, x.barrier from (
    select a.id a, b.id b,
           exists (select 1 from ms_city_lines l where l.city_id = p_city and l.kind in ('highway','rail','water')
                      and ST_DWithin(l.geom, ST_PointOnSurface(ST_CollectionExtract(ST_Intersection(a.geom, b.geom), 2)), 0.0001)) barrier
      from ms_blocks a join ms_blocks b on a.city_id = p_city and b.city_id = p_city and a.id < b.id
       and ST_Intersects(a.geom, b.geom) and ST_Length(ST_Intersection(a.geom, b.geom)) > 0.00005
  ) x;
  insert into ms_block_adj (city_id, a, b, barrier) select city_id, b, a, barrier from ms_block_adj where city_id = p_city on conflict do nothing;
  select count(*)::int into n from ms_block_adj where city_id = p_city;
  return n;
end $$;
revoke all on function public.ms_city_make_adjacency(uuid) from public, anon;
grant execute on function public.ms_city_make_adjacency(uuid) to authenticated;

create or replace function public.ms_city_finish(p_city uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb; v_left int;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  v_left := ms_city_pin_businesses(p_city, 1000);   -- a small city, or a step left over
  if v_left > 0 then raise exception '% businesses still need their block. Press Carry on.', v_left; end if;
  update ms_businesses b set is_chain = true, chain_note = 'Known chain'
   where b.city_id = p_city and not b.is_chain and b.name_norm in (select name_norm from ms_chain_names);
  update ms_businesses b set is_chain = true, chain_note = 'Same name at ' || c.n || ' locations'
    from (select name_norm, count(*) n from ms_businesses where city_id = p_city group by name_norm having count(*) >= 3) c
   where b.city_id = p_city and not b.is_chain and b.name_norm = c.name_norm;
  perform ms_city_make_adjacency(p_city);
  update ms_cities set businesses = (select count(*) from ms_businesses where city_id = p_city), status = 'built', built_at = now(), build_note = null where id = p_city;
  select jsonb_build_object('businesses', businesses, 'blocks', blocks, 'plazas', plazas,
           'chains', (select count(*) from ms_businesses where city_id = p_city and is_chain),
           'by_kind', (select jsonb_object_agg(kind, n) from (select kind, count(*) n from ms_businesses where city_id = p_city group by kind) k))
    into out from ms_cities where id = p_city;
  return out;
end $$;
revoke all on function public.ms_city_finish(uuid) from public, anon;
grant execute on function public.ms_city_finish(uuid) to authenticated;

-- ───────────── generating, in steps ─────────────
create or replace function public.ms_generate_zones(p_city uuid, p_campaign uuid, p_target int)
returns uuid language plpgsql security definer set search_path = public as $$
declare cty ms_cities; v_run uuid; v_cats text[]; v_total int; v_k int; v_iter int;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select * into cty from ms_cities where id = p_city;
  if cty.id is null or cty.status <> 'built' then raise exception 'Build the city first'; end if;
  if p_target is null or p_target < 1 or p_target > 60 then raise exception 'Ask for between 1 and 60 zones'; end if;
  select array_agg(category) into v_cats from ms_campaign_categories where campaign_id = p_campaign;
  if v_cats is null then raise exception 'Pick the campaign’s business categories first (Campaigns › Edit)'; end if;
  if not exists (select 1 from ms_block_adj where city_id = p_city) then perform ms_city_make_adjacency(p_city); end if;

  insert into ms_zone_runs (city_id, campaign_id, target, stage, created_by) values (p_city, p_campaign, p_target, 'growing', auth.uid())
  returning id into v_run;
  -- free blocks (not under an active zone) and their eligible businesses
  insert into ms_zone_run_blocks (run_id, block_id, cnt)
  select v_run, k.id, coalesce(s.n, 0)
    from ms_blocks k
    left join (select b.block_id, count(*)::int n from ms_businesses b
                where b.city_id = p_city and not b.is_chain and b.status <> 'closed' and b.kind = any(v_cats) and b.zone_id is null
                group by b.block_id) s on s.block_id = k.id
   where k.city_id = p_city
     and not exists (select 1 from ms_zone_blocks zb join ms_zones z on z.id = zb.zone_id where zb.block_id = k.id and z.status = 'active')
     and not exists (select 1 from ms_zones z where z.status = 'active' and z.run_id is null and z.geom is not null and ST_Contains(z.geom, k.center));
  if not exists (select 1 from ms_zone_run_blocks where run_id = v_run) then raise exception 'Every block of % is already in a zone', cty.name; end if;
  select coalesce(sum(cnt), 0) into v_total from ms_zone_run_blocks where run_id = v_run;
  if v_total = 0 then raise exception 'No free businesses in % for this campaign', cty.name; end if;

  -- starting blocks: weighted k-means over the blocks with eligible businesses, then the busiest block
  -- nearest each centre (one per zone)
  drop table if exists gz_pts; drop table if exists gz_ctr;
  create temp table gz_pts on commit drop as
    select z.block_id id, ST_X(k.center) x, ST_Y(k.center) y, z.cnt w, 0 c
      from ms_zone_run_blocks z join ms_blocks k on k.id = z.block_id where z.run_id = v_run and z.cnt > 0;
  v_k := least(p_target, (select count(*) from gz_pts)::int);
  -- first centres: the busiest block, then each next one where (businesses × distance² to the nearest centre) is largest
  create temp table gz_ctr (c int primary key, x float8, y float8) on commit drop;
  insert into gz_ctr select 0, x, y from gz_pts order by w desc, id limit 1;
  for v_iter in 1..v_k - 1 loop
    insert into gz_ctr
      select v_iter, p.x, p.y from gz_pts p
       order by p.w * (select min((g.x - p.x)^2 + ((g.y - p.y) * 1.4)^2) from gz_ctr g) desc, p.id limit 1;
  end loop;
  for v_iter in 1..12 loop
    update gz_pts p set c = (select g.c from gz_ctr g order by (g.x - p.x)^2 + ((g.y - p.y) * 1.4)^2 limit 1);
    update gz_ctr g set x = s.x, y = s.y
      from (select c, sum(x * w) / sum(w) x, sum(y * w) / sum(w) y from gz_pts group by c) s where s.c = g.c;
  end loop;
  with pick as (
    select distinct on (g.c) g.c, p.id
      from gz_ctr g join gz_pts p on p.c = g.c
     order by g.c, ((g.x - p.x)^2 + ((g.y - p.y) * 1.4)^2) / greatest(p.w, 1)
  )
  update ms_zone_run_blocks z set zone = pick.c + 1, seed = true from pick where z.run_id = v_run and z.block_id = pick.id;
  analyze ms_zone_run_blocks;
  update ms_zone_runs set target = (select count(*) from ms_zone_run_blocks where run_id = v_run and seed),
         stats = jsonb_build_object('eligible', v_total, 'share', ceil(v_total::numeric / p_target),
                                    'free_blocks', (select count(*) from ms_zone_run_blocks where run_id = v_run)) where id = v_run;
  return v_run;
end $$;
revoke all on function public.ms_generate_zones(uuid, uuid, int) from public, anon;
grant execute on function public.ms_generate_zones(uuid, uuid, int) to authenticated;

create or replace function public.ms_run_step(p_run uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  run ms_zone_runs; c ms_cities; t0 timestamptz := clock_timestamp(); budget interval := interval '4 seconds';
  v_ideal numeric; v_next bigint; v_next_cnt int; v_added int; mv record; v_reach int; v_left int; v_proposal jsonb := '[]'::jsonb; r record; v_half text;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select * into run from ms_zone_runs where id = p_run for update;
  if run.id is null then raise exception 'No such run'; end if;
  if run.status <> 'proposed' or run.stage = 'ready' then
    return jsonb_build_object('stage', run.stage, 'zone', run.cur_zone, 'zones', run.target, 'moves', run.moves);
  end if;
  select * into c from ms_cities where id = run.city_id;
  v_ideal := (run.stats->>'eligible')::numeric / run.target;

  -- ── growing: the smallest zone takes its best free neighbour ──
  if run.stage = 'growing' then
    drop table if exists gz_tot;
    create temp table gz_tot on commit drop as
      select zone, sum(cnt)::int n, false boxed from ms_zone_run_blocks where run_id = p_run and zone is not null group by zone;
    create unique index on gz_tot (zone);
  end if;
  while run.stage = 'growing' and clock_timestamp() - t0 < budget loop
    select zone into run.cur_zone from gz_tot where not boxed order by n, zone limit 1;
    if run.cur_zone is null then run.stage := 'leftovers'; run.cur_zone := run.target; exit; end if;
    v_next := null;
    select n.block_id, n.cnt into v_next, v_next_cnt
      from ms_zone_run_blocks z
      join ms_block_adj j on j.a = z.block_id
      join ms_zone_run_blocks n on n.run_id = p_run and n.block_id = j.b and n.zone is null
      join ms_blocks nb on nb.id = n.block_id
     where z.run_id = p_run and z.zone = run.cur_zone
     order by j.barrier,
              nb.center <-> (select k.center from ms_zone_run_blocks s join ms_blocks k on k.id = s.block_id
                              where s.run_id = p_run and s.zone = run.cur_zone and s.seed limit 1),
              n.block_id
     limit 1;
    if v_next is null then
      update gz_tot set boxed = true where zone = run.cur_zone;   -- nothing free next to it
    else
      update ms_zone_run_blocks set zone = run.cur_zone where run_id = p_run and block_id = v_next;
      update gz_tot set n = n + v_next_cnt where zone = run.cur_zone;
    end if;
  end loop;

  -- ── leftovers ──
  while run.stage = 'leftovers' and clock_timestamp() - t0 < budget loop
    update ms_zone_run_blocks g set zone = s.zone from (
      select distinct on (n.block_id) n.block_id, z.zone
        from ms_zone_run_blocks n
        join ms_block_adj j on j.a = n.block_id
        join ms_zone_run_blocks z on z.run_id = p_run and z.block_id = j.b and z.zone is not null
        join (select zone, sum(cnt) tot from ms_zone_run_blocks where run_id = p_run and zone is not null group by zone) t on t.zone = z.zone
       where n.run_id = p_run and n.zone is null
       order by n.block_id, j.barrier, t.tot) s
     where g.run_id = p_run and g.block_id = s.block_id;
    get diagnostics v_added = row_count;
    if v_added = 0 then
      -- islands (nothing touching): the nearest zone
      update ms_zone_run_blocks g set zone = (
          select z.zone from ms_zone_run_blocks z join ms_blocks zb on zb.id = z.block_id
           where z.run_id = p_run and z.zone is not null
           order by zb.center <-> (select center from ms_blocks where id = g.block_id) limit 1)
       where g.run_id = p_run and g.zone is null;
      run.stage := 'balancing';
    end if;
  end loop;

  -- ── balancing ──
  if run.stage = 'balancing' then
    drop table if exists gz_tot;
    create temp table gz_tot on commit drop as
      select zone, sum(cnt)::int n, count(*)::int blocks from ms_zone_run_blocks where run_id = p_run group by zone;
    create unique index on gz_tot (zone);
  end if;
  while run.stage = 'balancing' and clock_timestamp() - t0 < budget loop
    if run.moves >= 600 or ((select max(n) from gz_tot) <= v_ideal * 1.10 and (select min(n) from gz_tot) >= v_ideal * 0.90) then
      run.stage := 'shaping'; exit;
    end if;
    mv := null;
    select k.block_id id, k.cnt, k.zone dz, nz.zone rz into mv
      from ms_zone_run_blocks k
      join gz_tot dt on dt.zone = k.zone
      join ms_block_adj j on j.a = k.block_id
      join ms_zone_run_blocks nb on nb.run_id = p_run and nb.block_id = j.b and nb.zone <> k.zone
      join gz_tot nz on nz.zone = nb.zone
     where k.run_id = p_run and not k.skip and k.cnt > 0 and dt.blocks > 1
       and dt.n - nz.n > k.cnt                      -- the move narrows the gap between the two
     order by (dt.n - nz.n) desc, j.barrier, k.cnt, k.block_id
     limit 1;
    if mv.id is null then run.stage := 'shaping'; exit; end if;
    -- does the giving zone stay in one piece without this block?
    with recursive walk(id) as (
      (select x.block_id from ms_zone_run_blocks x where x.run_id = p_run and x.zone = mv.dz and x.block_id <> mv.id limit 1)
      union
      select j.b from walk w join ms_block_adj j on j.a = w.id
        join ms_zone_run_blocks x on x.run_id = p_run and x.block_id = j.b and x.zone = mv.dz and x.block_id <> mv.id
    )
    select count(*) into v_reach from walk;
    select blocks - 1 into v_left from gz_tot where zone = mv.dz;
    if v_reach < v_left then
      update ms_zone_run_blocks set skip = true where run_id = p_run and block_id = mv.id;
    else
      update ms_zone_run_blocks set zone = mv.rz where run_id = p_run and block_id = mv.id;
      update ms_zone_run_blocks set skip = false where run_id = p_run and skip;   -- the map changed: try refused blocks again
      update gz_tot set n = n - mv.cnt, blocks = blocks - 1 where zone = mv.dz;
      update gz_tot set n = n + mv.cnt, blocks = blocks + 1 where zone = mv.rz;
      run.moves := run.moves + 1;
    end if;
  end loop;

  -- ── shaping ──
  if run.stage = 'shaping' and clock_timestamp() - t0 < budget then
    for r in
      select z.zone, ST_Multi(ST_Buffer(ST_Union(k.geom), 0)) g, sum(z.cnt) n, array_agg(z.block_id order by z.block_id) ids
        from ms_zone_run_blocks z join ms_blocks k on k.id = z.block_id
       where z.run_id = p_run and z.zone is not null group by z.zone
    loop
      v_half := case when ST_Y(ST_Centroid(r.g)) >= c.center_lat then 'North' else 'South' end;
      v_proposal := v_proposal || jsonb_build_array(jsonb_build_object(
        'key', r.zone, 'half', v_half, 'lng', ST_X(ST_Centroid(r.g)), 'polygon', ST_AsGeoJSON(r.g)::jsonb, 'blocks', to_jsonb(r.ids), 'count', r.n,
        'plazas', (select count(*) from ms_plazas p where p.block_id = any(r.ids))));
    end loop;
    select jsonb_agg(z || jsonb_build_object('name', c.name || ' ' || (z->>'half') || ' ' || rn) order by z->>'half', rn)
      into v_proposal
      from (select z, row_number() over (partition by z->>'half' order by (z->>'lng')::float) rn from jsonb_array_elements(v_proposal) z) x;
    run.proposal := coalesce(v_proposal, '[]'::jsonb);
    run.stats := run.stats || jsonb_build_object('zones', jsonb_array_length(run.proposal), 'balance_moves', run.moves,
                   'smallest', (select min((z->>'count')::int) from jsonb_array_elements(run.proposal) z),
                   'largest', (select max((z->>'count')::int) from jsonb_array_elements(run.proposal) z));
    run.stage := 'ready';
  end if;

  update ms_zone_runs set stage = run.stage, cur_zone = run.cur_zone, cur_seed = run.cur_seed, cur_cnt = run.cur_cnt, cur_share = run.cur_share,
         moves = run.moves, proposal = run.proposal, stats = run.stats
   where id = p_run;
  return jsonb_build_object('stage', run.stage, 'zone', run.cur_zone, 'zones', run.target, 'moves', run.moves);
end $$;
revoke all on function public.ms_run_step(uuid) from public, anon;
grant execute on function public.ms_run_step(uuid) to authenticated;

-- accept only a finished proposal (otherwise as RUN_51)
create or replace function public.ms_run_accept(p_run uuid)
returns int language plpgsql security definer set search_path = public as $$
declare run ms_zone_runs; z jsonb; v_zone uuid; n int := 0; v_name text; v_try int;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select * into run from ms_zone_runs where id = p_run for update;
  if run.id is null or run.status <> 'proposed' then raise exception 'This proposal is closed'; end if;
  if run.stage <> 'ready' then raise exception 'This proposal is still being worked out'; end if;
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
  delete from ms_zone_run_blocks where run_id = p_run;
  return n;
end $$;
revoke all on function public.ms_run_accept(uuid) from public, anon;
grant execute on function public.ms_run_accept(uuid) to authenticated;

-- a discarded run's working map isn't needed
create or replace function public.ms_run_discard(p_run uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  update ms_zone_runs set status = 'discarded' where id = p_run and status = 'proposed';
  delete from ms_zone_run_blocks where run_id = p_run;
end $$;
revoke all on function public.ms_run_discard(uuid) from public, anon;
grant execute on function public.ms_run_discard(uuid) to authenticated;

-- the runs list shows where a run is
drop function if exists public.ms_runs_list(uuid);
create or replace function public.ms_runs_list(p_city uuid)
returns table (id uuid, campaign_id uuid, campaign_name text, target int, status text, stage text, proposal jsonb, stats jsonb, created_at timestamptz, accepted_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.campaign_id, c.name, r.target, r.status, r.stage, r.proposal, r.stats, r.created_at, r.accepted_at
    from ms_zone_runs r join ms_campaigns c on c.id = r.campaign_id
   where r.city_id = p_city and ms_is_admin() order by r.created_at desc limit 20;
$$;
revoke all on function public.ms_runs_list(uuid) from public, anon;
grant execute on function public.ms_runs_list(uuid) to authenticated;
