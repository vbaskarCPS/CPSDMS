-- The Benny on MainstreetAI: cutting zones ("cut Barrie into 4", "re-cut Hamilton South 3 and 4 into 3 zones",
-- "redo all of Hamilton as 10"). It uses Zones › Generate's own generator (ms_generate_zones → ms_run_step →
-- ms_run_accept), with one thing added: a run can be worked out OVER zones that exist, so the new zones are seen on
-- the map before anything is retired. Saving the run retires the zones it replaces and makes the new ones, together.
--   ms_zone_runs.replaces   the zones a run replaces when it is accepted (null for an ordinary run)
--   ms_generate_zones_over  the generator itself, now with p_replace (those zones' blocks count as free) and p_only
--                           (cut nothing but their blocks); ms_generate_zones calls it with neither, as before
--   ms_run_accept           retires the replaced zones first; refuses when the area was cut again in the meantime
--   benny_ms_cities         the loaded cities in words: blocks, density, zones, what is in no zone yet
--   benny_ms_check_cut      checks a cut for a card (changes nothing)
--   benny_ms_run            a worked-out run in words and shapes, for the chat's map and the card that saves it
-- Also: zones in words now carry their density (the size the generator evens out), as the Zones screen shows it.

alter table public.ms_zone_runs add column if not exists replaces uuid[];

-- the generator moves to ms_generate_zones_over, with the two new arguments; ms_generate_zones (what the Zones screen
-- and the city auto-build call) becomes a call to it with neither, so there is still one generator
do $$
declare d text; n text;
begin
  if to_regprocedure('public.ms_generate_zones_over(uuid, uuid, integer, uuid[], boolean)') is not null then return; end if;
  d := pg_get_functiondef('public.ms_generate_zones(uuid, uuid, integer)'::regprocedure);
  n := replace(d, 'ms_generate_zones(p_city uuid, p_campaign uuid, p_target integer)',
                  'ms_generate_zones_over(p_city uuid, p_campaign uuid, p_target integer, p_replace uuid[], p_only boolean)');
  if n = d then raise exception 'ms_generate_zones: header not found'; end if; d := n;
  n := replace(d, 'where zb.block_id = k.id and z.status = ''active'')',
                  'where zb.block_id = k.id and z.status = ''active'' and not (z.id = any (coalesce(p_replace, ''{}''::uuid[]))))');
  if n = d then raise exception 'ms_generate_zones: generated-zone filter not found'; end if; d := n;
  n := replace(d, 'z.run_id is null and z.geom is not null and ST_Contains(z.geom, k.center));',
                  'z.run_id is null and z.geom is not null and not (z.id = any (coalesce(p_replace, ''{}''::uuid[]))) and ST_Contains(z.geom, k.center))
     and (not coalesce(p_only, false)
          or exists (select 1 from ms_zone_blocks zb where zb.block_id = k.id and zb.zone_id = any (coalesce(p_replace, ''{}''::uuid[])))
          or exists (select 1 from ms_zones z where z.id = any (coalesce(p_replace, ''{}''::uuid[])) and z.run_id is null and z.geom is not null and ST_Contains(z.geom, k.center)));');
  if n = d then raise exception 'ms_generate_zones: drawn-zone filter not found'; end if; d := n;
  n := replace(d, 'insert into ms_zone_runs (city_id, campaign_id, target, stage, created_by) values (p_city, p_campaign, p_target, ''growing'', auth.uid())',
                  'if p_replace is not null and exists (select 1 from unnest(p_replace) r where not exists (select 1 from ms_zones z where z.id = r and z.status = ''active'' and z.city_id = p_city)) then
    raise exception ''One of the zones to re-cut is not an active zone of %'', cty.name; end if;
  insert into ms_zone_runs (city_id, campaign_id, target, stage, created_by, replaces) values (p_city, p_campaign, p_target, ''growing'', auth.uid(), nullif(p_replace, ''{}''::uuid[]))');
  if n = d then raise exception 'ms_generate_zones: run insert not found'; end if; d := n;
  execute d;
end $$;
revoke all on function public.ms_generate_zones_over(uuid, uuid, integer, uuid[], boolean) from public, anon;
grant execute on function public.ms_generate_zones_over(uuid, uuid, integer, uuid[], boolean) to authenticated, service_role;

create or replace function public.ms_generate_zones(p_city uuid, p_campaign uuid, p_target integer)
returns uuid language plpgsql security definer set search_path to 'public' as $$
begin
  return ms_generate_zones_over(p_city, p_campaign, p_target, null, false);
end $$;

-- ms_run_accept: a run that replaces zones retires them first; no run is saved over an area that was zoned since
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.ms_run_accept(uuid)'::regprocedure);
  if position('run.replaces' in d) > 0 then return; end if;
  n := replace(d, 'for z in select * from jsonb_array_elements(run.proposal) loop',
                  'if run.replaces is not null then
    if exists (select 1 from unnest(run.replaces) r where not exists (select 1 from ms_zones zz where zz.id = r and zz.status = ''active'')) then
      raise exception ''The zones this was cut from have changed since. Discard it and cut again''; end if;
    update ms_zones set status = ''retired'' where id = any (run.replaces);
    update ms_businesses set zone_id = null where zone_id = any (run.replaces);
  end if;
  if exists (select 1 from jsonb_array_elements(run.proposal) pz, jsonb_array_elements_text(pz->''blocks'') pb
              join ms_zone_blocks zb on zb.block_id = pb::bigint join ms_zones zz on zz.id = zb.zone_id and zz.status = ''active'') then
    raise exception ''Part of this area is in a zone already (it was cut again since). Discard it and cut again''; end if;
  for z in select * from jsonb_array_elements(run.proposal) loop');
  if n = d then raise exception 'ms_run_accept: loop not found'; end if;
  execute n;
end $$;

-- zones in words: with their density
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.benny_ms_zones(text, text)'::regprocedure);
  if position('''density''' in d) = 0 then
    n := replace(d, 'select z.name, z.city, z.area, z.status,', 'select z.name, z.city, z.area, z.status, z.business_count as density,');
    n := replace(n, '''businesses'', t.businesses, ''campaigns'', t.campaigns', '''density'', t.density, ''businesses'', t.businesses, ''campaigns'', t.campaigns');
    if n = d or position('''density'', t.density' in n) = 0 then raise exception 'benny_ms_zones: not patched'; end if;
    execute n;
  end if;
  d := pg_get_functiondef('public.benny_ms_map(text, float8, float8, float8, float8, text)'::regprocedure);
  if position('''density''' in d) = 0 then
    n := replace(d, 'select z.id, z.name, z.city, z.geom,', 'select z.id, z.name, z.city, z.geom, z.business_count as density,');
    n := replace(n, '''city'', t.city, ''businesses'', t.businesses,', '''city'', t.city, ''density'', t.density, ''businesses'', t.businesses,');
    if n = d or position('''density'', t.density' in n) = 0 then raise exception 'benny_ms_map: not patched'; end if;
    execute n;
  end if;
end $$;

-- the blocks of a city a cut would use: p_ids = the zones being re-cut, p_only = nothing but their blocks
create or replace function public.benny_ms_cut_blocks(p_city uuid, p_ids uuid[], p_only boolean)
returns table (id bigint, density int) language sql stable security definer set search_path to 'public' as $$
  select k.id, coalesce(k.density, 0)
    from ms_blocks k
   where k.city_id = p_city
     and not exists (select 1 from ms_zone_blocks zb join ms_zones z on z.id = zb.zone_id where zb.block_id = k.id and z.status = 'active' and not (z.id = any (p_ids)))
     and not exists (select 1 from ms_zones z where z.status = 'active' and z.run_id is null and z.geom is not null and not (z.id = any (p_ids)) and st_contains(z.geom, k.center))
     and (not p_only
          or exists (select 1 from ms_zone_blocks zb where zb.block_id = k.id and zb.zone_id = any (p_ids))
          or exists (select 1 from ms_zones z where z.id = any (p_ids) and z.run_id is null and z.geom is not null and st_contains(z.geom, k.center)))
$$;
revoke all on function public.benny_ms_cut_blocks(uuid, uuid[], boolean) from public, anon, authenticated;

create or replace function public.benny_ms_cities(p_q text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare q text := nullif(trim(coalesce(p_q, '')), '');
begin
  perform benny_ms_ok();
  return jsonb_build_object('cities', coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', c.name, 'province', c.province, 'state', case when c.status = 'built' then null else c.status end,
        'blocks', x.blocks, 'density', x.density, 'zones', x.zones, 'zones_with_no_rep', nullif(x.open, 0),
        'in_no_zone_yet', case when x.free_blocks > 0 then jsonb_build_object('blocks', x.free_blocks, 'density', x.free_density) end,
        'proposals_waiting', nullif(x.waiting, 0))) order by c.name)
      from ms_cities c
      cross join lateral (select
          (select count(*)::int from ms_blocks k where k.city_id = c.id) as blocks,
          (select coalesce(sum(k.density), 0)::int from ms_blocks k where k.city_id = c.id) as density,
          (select count(*)::int from ms_zones z where z.city_id = c.id and z.status = 'active') as zones,
          (select count(*)::int from ms_zones z where z.city_id = c.id and z.status = 'active'
              and (not exists (select 1 from ms_zone_campaigns zc where zc.zone_id = z.id) or exists (select 1 from ms_zone_campaigns zc where zc.zone_id = z.id and zc.rep_id is null))) as open,
          (select count(*)::int from benny_ms_cut_blocks(c.id, '{}'::uuid[], false)) as free_blocks,
          (select coalesce(sum(b.density), 0)::int from benny_ms_cut_blocks(c.id, '{}'::uuid[], false) b) as free_density,
          (select count(*)::int from ms_zone_runs r where r.city_id = c.id and r.status = 'proposed') as waiting) x
     where q is null or c.name ilike '%' || q || '%' or c.province ilike q), '[]'::jsonb),
    'note', 'density = commercial land and main-road frontage: the size the zone generator evens out. A city''s density over its zones is about what each zone holds.');
end $$;
revoke all on function public.benny_ms_cities(text) from public, anon;
grant execute on function public.benny_ms_cities(text) to authenticated;

-- p_zones: the zones to re-cut: ["Hamilton South 3 (2)", …] (names or ids), ["all"] for every active zone of the city,
--          or nothing to cut only what is in no zone yet
create or replace function public.benny_ms_check_cut(p_city text, p_target int, p_zones jsonb default null, p_campaign text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare cty ms_cities; q text := trim(coalesce(p_city, '')); v_n int; v_names text; e text; v_all boolean := false; ids uuid[] := '{}'; probs text[] := '{}';
  zid uuid; camp uuid; camp_name text; v_blocks int; v_dense int; v_density bigint; v_only boolean;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  perform benny_ms_ok();
  if q = '' then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Which city?')); end if;
  if lower(q) ~ uuid_re then
    select * into cty from ms_cities where id = lower(q)::uuid;
  else
    select count(*), string_agg(c.name, ', ' order by c.name) into v_n, v_names from ms_cities c where lower(c.name) = lower(q);
    if v_n = 0 then
      select count(*), string_agg(c.name, ', ' order by c.name) into v_n, v_names from ms_cities c where c.name ilike '%' || q || '%';
      if v_n = 1 then select * into cty from ms_cities c where c.name ilike '%' || q || '%'; end if;
    elsif v_n = 1 then
      select * into cty from ms_cities c where lower(c.name) = lower(q);
    end if;
    if v_n > 1 then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Which one: ' || v_names || '?')); end if;
  end if;
  if cty.id is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('No city called ' || q || ' is loaded. A new city is loaded on the Cities screen.')); end if;
  if cty.status <> 'built' then return jsonb_build_object('ok', false, 'problems', jsonb_build_array(cty.name || ' is still being built: the Cities screen shows how far it is.')); end if;
  if not exists (select 1 from ms_blocks where city_id = cty.id) then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array(cty.name || ' hasn’t been cut into blocks yet: press Rebuild on it on the Cities screen.')); end if;
  if exists (select 1 from ms_blocks where city_id = cty.id and density is null) then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array(cty.name || ' isn’t finished building: press Build on it on the Cities screen.')); end if;
  if p_target is null then probs := probs || 'How many zones?'::text;
  elsif p_target < 1 or p_target > 60 then probs := probs || 'Between 1 and 60 zones.'::text; end if;

  -- the zones to re-cut
  if jsonb_typeof(p_zones) = 'array' then
    for e in select trim(x) from jsonb_array_elements_text(p_zones) x loop
      if e = '' then continue; end if;
      if lower(e) in ('all', 'every', 'everything', 'all of them', 'all zones', 'the whole city') then v_all := true; continue; end if;
      zid := null;
      if lower(e) ~ uuid_re then
        select z.id into zid from ms_zones z where z.id = lower(e)::uuid and z.status = 'active' and z.city_id = cty.id;
        v_n := case when zid is null then 0 else 1 end;
      else
        select count(*), min(z.id::text)::uuid, string_agg(z.name, ', ' order by z.name) into v_n, zid, v_names from ms_zones z where z.status = 'active' and z.city_id = cty.id and lower(z.name) = lower(e);
        if v_n = 0 then
          select count(*), min(z.id::text)::uuid, string_agg(z.name, ', ' order by z.name) into v_n, zid, v_names from ms_zones z where z.status = 'active' and z.city_id = cty.id and z.name ilike '%' || e || '%';
        end if;
      end if;
      if v_n = 0 then probs := probs || ('No active zone in ' || cty.name || ' is called ' || e || '.');
      elsif v_n > 1 then probs := probs || ('Which zone: ' || v_names || '?');
      elsif not (zid = any (ids)) then ids := ids || zid; end if;
    end loop;
  end if;
  if v_all then select coalesce(array_agg(z.id), '{}') into ids from ms_zones z where z.status = 'active' and z.city_id = cty.id; end if;
  v_only := not v_all and coalesce(array_length(ids, 1), 0) > 0;

  -- the campaign the new zones are for: the one named, else the one on the zones being re-cut, else the only active one
  q := trim(coalesce(p_campaign, ''));
  if q <> '' then
    select count(*), min(c.id::text)::uuid, string_agg(c.name, ', ' order by c.name) into v_n, camp, v_names from ms_campaigns c where c.is_active and (c.id::text = lower(q) or c.name ilike '%' || q || '%');
    if v_n = 0 then probs := probs || ('No active campaign is called ' || q || '.'); camp := null;
    elsif v_n > 1 then probs := probs || ('Which campaign: ' || v_names || '?'); camp := null; end if;
  else
    select count(distinct zc.campaign_id), min(zc.campaign_id::text)::uuid into v_n, camp from ms_zone_campaigns zc where zc.zone_id = any (ids);
    if v_n <> 1 then
      select count(*), min(c.id::text)::uuid, string_agg(c.name, ', ' order by c.name) into v_n, camp, v_names from ms_campaigns c where c.is_active;
      if v_n = 0 then probs := probs || 'There is no active campaign: add one on the Campaigns screen first.'::text; camp := null;
      elsif v_n > 1 then probs := probs || ('Which campaign are the new zones for: ' || v_names || '?'); camp := null; end if;
    end if;
  end if;
  if camp is not null then select c.name into camp_name from ms_campaigns c where c.id = camp; end if;

  -- what there is to cut
  select count(*)::int, count(*) filter (where b.density > 0)::int, coalesce(sum(b.density), 0) into v_blocks, v_dense, v_density from benny_ms_cut_blocks(cty.id, ids, v_only) b;
  if v_blocks = 0 then
    probs := probs || case when coalesce(array_length(ids, 1), 0) = 0
      then 'Every block of ' || cty.name || ' is in a zone already. Say which zones to re-cut, or all of them.'
      else 'Those zones have no blocks to cut (they were drawn by hand outside the city’s blocks).' end;
  elsif v_density = 0 then probs := probs || 'Nothing dense enough there (no main roads or commercial land).'::text;
  elsif p_target is not null and p_target between 1 and 60 and v_dense < p_target then
    probs := probs || ('That area is ' || v_dense || ' block' || case when v_dense = 1 then '' else 's' end || ' (the pieces between main roads), and a zone is made of whole blocks: ' || v_dense || ' zone' || case when v_dense = 1 then '' else 's' end || ' at most.');
  end if;
  if coalesce(array_length(probs, 1), 0) > 0 then return jsonb_build_object('ok', false, 'problems', to_jsonb(probs)); end if;

  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'city', jsonb_build_object('id', cty.id, 'name', cty.name), 'campaign', jsonb_build_object('id', camp, 'name', camp_name),
    'target', p_target, 'all', v_all, 'only', v_only,
    'replace', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', z.id, 'name', z.name, 'density', z.business_count,
          'reps', (select string_agg(distinct u.full_name, ', ') from ms_zone_campaigns zc join app_users u on u.id = zc.rep_id where zc.zone_id = z.id))) order by z.name), '[]'::jsonb)
        from ms_zones z where z.id = any (ids)),
    'area', jsonb_build_object('blocks', v_blocks, 'density', v_density, 'per_zone', ceil(v_density::numeric / p_target)),
    'zones_left_alone', (select nullif(count(*), 0) from ms_zones z where z.city_id = cty.id and z.status = 'active' and not (z.id = any (ids))),
    'proposals_waiting', (select nullif(count(*), 0) from ms_zone_runs r where r.city_id = cty.id and r.status = 'proposed'),
    'stamp', md5(cty.id::text || coalesce(camp::text, '') || p_target || v_blocks || v_density || coalesce((select string_agg(i::text, ',' order by i) from unnest(ids) i), '')),
    'ask', jsonb_build_object('city', cty.id, 'target', p_target, 'campaign', camp, 'zones', case when v_all then jsonb_build_array('all') else to_jsonb(ids) end)));
end $$;
revoke all on function public.benny_ms_check_cut(text, int, jsonb, text) from public, anon;
grant execute on function public.benny_ms_check_cut(text, int, jsonb, text) to authenticated;

-- a worked-out run: its zones in words, the zones it replaces, and its shapes for the chat's map
create or replace function public.benny_ms_run(p_run uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare run ms_zone_runs; v_city text; v_camp text;
begin
  perform benny_ms_ok();
  select * into run from ms_zone_runs where id = p_run;
  if run.id is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('That proposal isn’t there any more. Ask me to cut again.')); end if;
  if run.status = 'accepted' then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Those zones were already saved.')); end if;
  if run.status <> 'proposed' then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('That proposal was discarded. Ask me to cut again.')); end if;
  if run.stage <> 'ready' then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Those zones are still being worked out.')); end if;
  select c.name into v_city from ms_cities c where c.id = run.city_id;
  select c.name into v_camp from ms_campaigns c where c.id = run.campaign_id;
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'run', run.id, 'city', v_city, 'campaign', v_camp,
    'zones', (select coalesce(jsonb_agg(jsonb_build_object('name', z->>'name', 'density', (z->>'count')::int, 'plazas', (z->>'plazas')::int) order by z->>'name'), '[]'::jsonb) from jsonb_array_elements(run.proposal) z),
    'smallest', (run.stats->>'smallest')::int, 'largest', (run.stats->>'largest')::int,
    'replace', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', z.id, 'name', z.name, 'gone', case when z.status <> 'active' then true end,
          'reps', (select string_agg(distinct u.full_name, ', ') from ms_zone_campaigns zc join app_users u on u.id = zc.rep_id where zc.zone_id = z.id))) order by z.name)
        from ms_zones z where z.id = any (run.replaces)),
    'stamp', md5(run.id::text || run.status || run.stage || jsonb_array_length(run.proposal) || coalesce((select string_agg(z->>'name' || (z->>'count'), ',' order by z->>'name') from jsonb_array_elements(run.proposal) z), '')),
    'map', jsonb_build_object('title', 'Proposed zones in ' || v_city,
      'zones', (select coalesce(jsonb_agg(jsonb_build_object('name', z->>'name', 'who', 'density ' || (z->>'count'),
                  'polygon', st_asgeojson(st_simplifypreservetopology(st_geomfromgeojson((z->'polygon')::text), 0.0005), 5)::jsonb) order by z->>'name'), '[]'::jsonb)
                from jsonb_array_elements(run.proposal) z))));
end $$;
revoke all on function public.benny_ms_run(uuid) from public, anon;
grant execute on function public.benny_ms_run(uuid) to authenticated;
