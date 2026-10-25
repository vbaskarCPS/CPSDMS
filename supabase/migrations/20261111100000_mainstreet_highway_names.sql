-- MainstreetAI (RUN_54): North / South in a zone's name is either side of the city's main highway. ADDITIVE ONLY.
--
-- Until now "North"/"South" meant above or below the middle of the city. Locally it means either side of
-- the highway (in Oakville, the QEW). The dividing highway is the city's longest named highway, unless
-- ms_cities.divider is set to another highway's name. A zone takes the side most of its ground is on.
-- If that highway clearly runs north–south (more than twice as tall as wide), the halves are East / West
-- (numbered north → south) instead.
--
--   ms_cities.divider            optional: the highway name to split on
--   ms_city_divider(city)        that highway as one line (null if the city has none)
--   ms_run_name_zones(run)       names a proposal's zones "<City> North 1…" / "<City> South 1…", west → east
--   ms_run_step                  shaping now names through ms_run_name_zones

alter table public.ms_cities add column if not exists divider text;

create or replace function public.ms_city_divider(p_city uuid)
returns geometry language sql stable security definer set search_path = public as $$
  with pick as (
    select coalesce((select divider from ms_cities where id = p_city),
                    (select name from ms_city_lines where city_id = p_city and kind = 'highway' and name is not null
                      group by name order by sum(ST_Length(geom::geography)) desc limit 1)) name
  )
  select ST_LineMerge(ST_Union(l.geom)) from ms_city_lines l, pick
   where l.city_id = p_city and l.kind = 'highway' and l.name = pick.name
$$;
revoke all on function public.ms_city_divider(uuid) from public, anon, authenticated;

create or replace function public.ms_run_name_zones(p_run uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare run ms_zone_runs; c ms_cities; div geometry; v_out jsonb; v_ns boolean := true;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select * into run from ms_zone_runs where id = p_run for update;
  if run.id is null then raise exception 'No such run'; end if;
  select * into c from ms_cities where id = run.city_id;
  div := ms_city_divider(run.city_id);
  -- a highway running north–south splits east / west
  if div is not null then
    -- (a diagonal highway like Oakville's QEW still splits north / south; only a clearly north–south one doesn't)
    v_ns := 2 * ST_Distance(ST_SetSRID(ST_MakePoint(ST_XMin(div), ST_YMin(div)), 4326)::geography, ST_SetSRID(ST_MakePoint(ST_XMax(div), ST_YMin(div)), 4326)::geography)
         >= ST_Distance(ST_SetSRID(ST_MakePoint(ST_XMin(div), ST_YMin(div)), 4326)::geography, ST_SetSRID(ST_MakePoint(ST_XMin(div), ST_YMax(div)), 4326)::geography);
  end if;
  with z as (
    select e.z,
           -- ground north of the highway vs south, by block area (no highway: the middle of the city)
           (select coalesce(sum(case when (case when div is null then ST_Y(k.center) >= c.center_lat
                                                when v_ns then ST_Y(k.center) >= ST_Y(ST_ClosestPoint(div, k.center))
                                                else ST_X(k.center) >= ST_X(ST_ClosestPoint(div, k.center)) end)
                                     then k.area_m2 else -k.area_m2 end), 0)
              from ms_blocks k where k.id in (select (b)::bigint from jsonb_array_elements_text(e.z->'blocks') b)) lean,
           case when v_ns then ST_X(ST_Centroid(ST_GeomFromGeoJSON((e.z->'polygon')::text)))
                else -ST_Y(ST_Centroid(ST_GeomFromGeoJSON((e.z->'polygon')::text))) end lng
      from jsonb_array_elements(run.proposal) e(z)
  ), s as (
    select z, case when v_ns then (case when lean >= 0 then 'North' else 'South' end)
                   else (case when lean >= 0 then 'East' else 'West' end) end half, lng from z
  ), n as (
    select z, half, row_number() over (partition by half order by lng) rn from s
  )
  select coalesce(jsonb_agg(z || jsonb_build_object('half', half, 'name', c.name || ' ' || half || ' ' || rn) order by half, rn), '[]'::jsonb)
    into v_out from n;
  update ms_zone_runs set proposal = v_out where id = p_run;
  return v_out;
end $$;
revoke all on function public.ms_run_name_zones(uuid) from public, anon;
grant execute on function public.ms_run_name_zones(uuid) to authenticated;

-- ms_run_step's shaping stage names through ms_run_name_zones (patched in place: only the naming lines change)
do $$
declare src text;
begin
  select pg_get_functiondef('public.ms_run_step(uuid)'::regprocedure) into src;
  if position('run.stage := ''ready'';' in src) = 0 then raise exception 'ms_run_step is not the expected version'; end if;
  src := replace(src,
    'update ms_zone_runs set stage = run.stage, cur_zone = run.cur_zone, cur_seed = run.cur_seed, cur_cnt = run.cur_cnt, cur_share = run.cur_share,
         moves = run.moves, proposal = run.proposal, stats = run.stats
   where id = p_run;',
    'update ms_zone_runs set stage = run.stage, cur_zone = run.cur_zone, cur_seed = run.cur_seed, cur_cnt = run.cur_cnt, cur_share = run.cur_share,
         moves = run.moves, proposal = run.proposal, stats = run.stats
   where id = p_run;
  if run.stage = ''ready'' then perform ms_run_name_zones(p_run); end if;');
  if position('perform ms_run_name_zones(p_run)' in src) = 0 then raise exception 'ms_run_step: could not add the naming step'; end if;
  execute src;
end $$;
