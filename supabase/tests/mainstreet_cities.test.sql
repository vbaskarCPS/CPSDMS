-- MainstreetAI cities and generated zones (RUN_51). Run after RUN_50 and this migration; everything rolls back.
\set ON_ERROR_STOP 1
\i :mig

insert into auth.users (id) values ('a0000000-0000-0000-0000-00000000ad11'), ('a0000000-0000-0000-0000-00000000ad12');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-00000000ad11', 'msadb', 'Mainstreet Admin'), ('a0000000-0000-0000-0000-00000000ad12', 'repto', 'Rep Two');
insert into user_permissions values ('a0000000-0000-0000-0000-00000000ad11', 'mainstreet_admin'), ('a0000000-0000-0000-0000-00000000ad12', 'mainstreet_rep');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000ad11', true);

-- A square city 0..0.04 degrees (about 4 km × 4 km), cut by a 3×3 grid of arterials, with a highway
-- running north–south at x = 0.02. Businesses: dense in the south-west, a plaza straddling an
-- arterial on the east, a sprinkle elsewhere.
do $$
declare vcity uuid; camp uuid; run uuid; r record; n int; j jsonb; zones int; k text; lines jsonb := '[]'; biz jsonb := '[]'; x float; y float; i int;
begin
  vcity := ms_save_city('Testville', 'ON', 1, '{"type":"Polygon","coordinates":[[[0,0],[0.04,0],[0.04,0.04],[0,0.04],[0,0]]]}');
  if (select status from ms_cities where id = vcity) <> 'new' then raise exception 'status'; end if;
  if (select round(center_lat::numeric, 3) from ms_cities where id = vcity) <> 0.020 then raise exception 'centre'; end if;
  -- saving again with no boundary keeps it
  if ms_save_city('testville', 'ON', null, null) <> vcity then raise exception 'vcity not reused'; end if;

  -- arterials at x = 0.01, 0.03 and y = 0.01, 0.02, 0.03; the highway at x = 0.02
  foreach x in array array[0.01, 0.03] loop
    lines := lines || jsonb_build_object('osm_id', 100 + (x*1000)::int, 'kind', 'arterial', 'name', 'Ave ' || x, 'coordinates', jsonb_build_array(jsonb_build_array(x, -0.001), jsonb_build_array(x, 0.041)));
  end loop;
  foreach y in array array[0.01, 0.02, 0.03] loop
    lines := lines || jsonb_build_object('osm_id', 200 + (y*1000)::int, 'kind', 'arterial', 'name', 'St ' || y, 'coordinates', jsonb_build_array(jsonb_build_array(-0.001, y), jsonb_build_array(0.041, y)));
  end loop;
  lines := lines || jsonb_build_object('osm_id', 300, 'kind', 'highway', 'name', 'Hwy', 'coordinates', '[[0.02,-0.001],[0.02,0.041]]'::jsonb);
  lines := lines || jsonb_build_object('osm_id', 301, 'kind', 'bogus', 'coordinates', '[[0,0],[1,1]]'::jsonb);   -- ignored
  n := ms_city_replace_lines(vcity, lines);
  if n <> 6 then raise exception 'lines: %', n; end if;
  n := ms_city_make_blocks(vcity);
  if n <> 16 then raise exception 'blocks: % (expected 4 × 4)', n; end if;
  if exists (select 1 from ms_blocks where city_id = vcity and not ST_Within(geom, ST_Buffer((select geom from ms_cities where id = vcity), 0.00001))) then raise exception 'a block leaks outside the vcity'; end if;

  -- a plaza across the arterial at x = 0.03 (east side): everything in it must stay together
  n := ms_city_replace_plazas(vcity, jsonb_build_array(jsonb_build_object('osm_id', 900, 'name', 'East Plaza', 'kind', 'retail',
         'coordinates', '[[0.028,0.005],[0.034,0.005],[0.034,0.008],[0.028,0.008],[0.028,0.005]]'::jsonb)));
  if n <> 1 then raise exception 'plazas: %', n; end if;
  if (select block_id from ms_plazas where city_id = vcity) is null then raise exception 'plaza not pinned'; end if;

  -- businesses: 40 in the SW block (0..0.01, 0..0.01), 10 in the plaza (5 each side of the arterial), 1 per other block
  for i in 1..40 loop
    biz := biz || jsonb_build_object('name', 'SW Shop ' || i, 'lat', 0.001 + (i % 8) * 0.001, 'lng', 0.001 + (i / 8) * 0.0015, 'kind', case when i % 4 = 0 then 'retail' else 'trades' end, 'source', 'osm', 'osm_id', 1000 + i);
  end loop;
  for i in 1..10 loop
    biz := biz || jsonb_build_object('name', 'Plaza Unit ' || i, 'lat', 0.0065, 'lng', case when i <= 5 then 0.0285 + i * 0.0002 else 0.0305 + (i - 5) * 0.0005 end, 'kind', 'salon', 'source', 'google', 'google_place_id', 'g' || i);
  end loop;
  for i in 0..15 loop
    biz := biz || jsonb_build_object('name', 'Corner Clinic ' || i, 'lat', 0.0095 + (i / 4) * 0.01, 'lng', 0.0095 + (i % 4) * 0.01, 'kind', 'clinic', 'source', 'osm', 'osm_id', 2000 + i);
  end loop;
  -- a chain by list and a chain by count (3 Tim Hortons), and one closed place
  biz := biz || jsonb_build_object('name', 'Tim Hortons', 'lat', 0.015, 'lng', 0.005, 'kind', 'restaurant', 'source', 'google', 'google_place_id', 'th1');
  biz := biz || jsonb_build_object('name', 'Joe’s Pizza', 'lat', 0.015, 'lng', 0.006, 'kind', 'restaurant', 'source', 'google', 'google_place_id', 'jp1');
  biz := biz || jsonb_build_object('name', 'Joe''s Pizza', 'lat', 0.025, 'lng', 0.006, 'kind', 'restaurant', 'source', 'google', 'google_place_id', 'jp2');
  biz := biz || jsonb_build_object('name', 'JOE’S  PIZZA', 'lat', 0.035, 'lng', 0.006, 'kind', 'restaurant', 'source', 'google', 'google_place_id', 'jp3');
  biz := biz || jsonb_build_object('name', 'Joes Pizza', 'lat', 0.035, 'lng', 0.016, 'kind', 'restaurant', 'source', 'google', 'google_place_id', 'jp4');
  biz := biz || jsonb_build_object('name', 'Gone Fishing', 'lat', 0.015, 'lng', 0.015, 'kind', 'retail', 'source', 'google', 'google_place_id', 'gf1', 'status', 'closed');
  n := ms_city_upsert_businesses(vcity, biz);
  if n <> 72 then raise exception 'inserted: %', n; end if;
  -- the same OSM shop coming from Google 20 m away is merged, not doubled; Google's position wins
  n := ms_city_upsert_businesses(vcity, jsonb_build_array(jsonb_build_object('name', 'SW Shop 1', 'lat', 0.00201, 'lng', 0.0010, 'kind', 'trades', 'source', 'google', 'google_place_id', 'gsw1', 'phone', '905', 'website', 'https://x')));
  if n <> 0 then raise exception 'duplicate not merged'; end if;
  select * into r from ms_businesses where google_place_id = 'gsw1';
  if r.osm_id <> 1001 or not ('osm' = any(r.sources) and 'google' = any(r.sources)) or r.phone <> '905' or r.lat <> 0.00201 then raise exception 'merge fields: %', r; end if;
  -- bad rows are skipped quietly
  if ms_city_upsert_businesses(vcity, '[{"name":"","lat":1,"lng":1},{"name":"No position"}]') <> 0 then raise exception 'bad rows inserted'; end if;

  j := ms_city_finish(vcity);
  if (j->>'businesses')::int <> 72 then raise exception 'finish count: %', j; end if;
  if (select status from ms_cities where id = vcity) <> 'built' then raise exception 'not built'; end if;
  if not (select is_chain from ms_businesses where google_place_id = 'th1') then raise exception 'listed chain not flagged'; end if;
  if (select count(*) from ms_businesses where city_id = vcity and is_chain and name_norm = 'joe s pizza') <> 3 then raise exception 'same-name chain rule (apostrophe variants)'; end if;
  if (select is_chain from ms_businesses where google_place_id = 'jp4') then raise exception 'different spelling should not match'; end if;
  if (select count(distinct block_id) from ms_businesses where city_id = vcity and plaza_id is not null) <> 1 then raise exception 'plaza businesses split across blocks'; end if;
  if exists (select 1 from ms_businesses where city_id = vcity and block_id is null) then raise exception 'a business has no block'; end if;
  select * into r from ms_cities_list() where id = vcity;
  if r.eligible_open <> 72 - 4 - 1 then raise exception 'eligible_open: %', r.eligible_open; end if;   -- 4 chains, 1 closed

  -- the campaign and its categories
  camp := ms_save_campaign(null, 'Taxifi', '#0ea5e9');
  begin perform ms_generate_zones(vcity, camp, 4); raise exception 'generated without categories';
  exception when others then if sqlerrm not like 'Pick the campaign%' then raise; end if; end;
  perform ms_set_campaign_categories(camp, array['trades','clinic','salon','restaurant','bogus']);
  if (select count(*) from ms_campaign_categories where campaign_id = camp) <> 4 then raise exception 'categories'; end if;

  -- generate 4 zones: 30 trades + 16 clinic + 10 salon + 1 open non-chain restaurant (jp4) = 57 eligible
  run := ms_generate_zones(vcity, camp, 4);
  -- the generator works in steps; a run can't be accepted until it's ready
  if (select stage from ms_zone_runs where id = run) <> 'ready' then
    begin perform ms_run_accept(run); raise exception 'accepted an unfinished run';
    exception when others then if sqlerrm <> 'This proposal is still being worked out' then raise; end if; end;
  end if;
  for i in 1..50 loop exit when ms_run_step(run)->>'stage' = 'ready'; end loop;
  if (select stage from ms_zone_runs where id = run) <> 'ready' then raise exception 'run never got ready'; end if;
  if (select count(*) from ms_zone_run_blocks where run_id = run) <> 16 then raise exception 'working map'; end if;
  if (select count(*) from ms_block_adj where city_id = vcity) = 0 then raise exception 'no neighbours'; end if;
  select * into r from ms_zone_runs where id = run;
  if (r.stats->>'eligible')::int <> 57 then raise exception 'eligible: %', r.stats; end if;
  zones := jsonb_array_length(r.proposal);
  if zones <> 4 then raise exception 'proposed zones: % %', zones, r.stats; end if;
  if (select sum((z->>'count')::int) from jsonb_array_elements(r.proposal) z) <> 57 then raise exception 'counts don’t add up'; end if;
  if (select count(*) from jsonb_array_elements(r.proposal) z cross join jsonb_array_elements(z->'blocks') b) <> 16 then raise exception 'every block must be in exactly one zone'; end if;
  if (select count(*) from jsonb_array_elements(r.proposal) z where z->>'name' like 'Testville North %' or z->>'name' like 'Testville South %') <> 4 then raise exception 'names: %', (select jsonb_agg(z->>'name') from jsonb_array_elements(r.proposal) z); end if;
  -- the plaza's 10 salons are in one zone
  if (select count(*) from jsonb_array_elements(r.proposal) z where (z->>'plazas')::int > 0) <> 1 then raise exception 'plaza split across zones'; end if;
  -- the dense SW block is its own zone: 30 trades + its clinic (31 ≥ share 15)
  if not exists (select 1 from jsonb_array_elements(r.proposal) z where (z->>'count')::int >= 31) then raise exception 'dense block zone missing: %', r.proposal; end if;

  -- merge two that touch; a non-touching pair is refused
  begin perform ms_run_merge(run, 1, 1); raise exception 'merged a zone with itself';
  exception when others then if sqlerrm <> 'Pick two different zones' then raise; end if; end;
  select (a->>'key')::int ka, (b->>'key')::int kb into r from jsonb_array_elements(r.proposal) a, jsonb_array_elements(r.proposal) b
   where a->>'key' <> b->>'key' and ST_Intersects(ST_GeomFromGeoJSON((a->'polygon')::text), ST_GeomFromGeoJSON((b->'polygon')::text)) limit 1;
  perform ms_run_merge(run, r.ka, r.kb);
  select * into r from ms_zone_runs where id = run;
  if jsonb_array_length(r.proposal) <> 3 or (select sum((z->>'count')::int) from jsonb_array_elements(r.proposal) z) <> 57 then raise exception 'merge: %', r.proposal; end if;

  -- accept: 3 frozen zones, the campaign on each, businesses attached
  n := ms_run_accept(run);
  if n <> 3 then raise exception 'accepted: %', n; end if;
  if (select count(*) from ms_zones where city_id = vcity and frozen_at is not null and status = 'active') <> 3 then raise exception 'zones not frozen'; end if;
  if (select count(*) from ms_zone_blocks zb join ms_zones z on z.id = zb.zone_id where z.city_id = vcity) <> 16 then raise exception 'zone blocks'; end if;
  if (select count(*) from ms_zone_campaigns zc join ms_zones z on z.id = zc.zone_id where z.city_id = vcity and zc.campaign_id = camp) <> 3 then raise exception 'campaign not on zones'; end if;
  if (select count(*) from ms_businesses where city_id = vcity and zone_id is null) <> 0 then raise exception 'businesses left unattached'; end if;
  if (select status from ms_zone_runs where id = run) <> 'accepted' then raise exception 'run status'; end if;
  if exists (select 1 from ms_zone_run_blocks where run_id = run) then raise exception 'working map kept after accept'; end if;
  begin perform ms_run_accept(run); raise exception 'accepted twice';
  exception when others then if sqlerrm <> 'This proposal is closed' then raise; end if; end;
  select * into r from ms_zones_list() l where l.city_id = vcity order by l.name limit 1;
  if r.frozen_at is null or r.business_count is null or r.city <> 'Testville' then raise exception 'zones_list fields: %', r; end if;

  -- frozen: can't be redrawn, can be renamed; generating again finds no free ground
  begin perform ms_save_zone(r.id, r.name, '{"type":"Polygon","coordinates":[[[0,0],[0.001,0],[0.001,0.001],[0,0]]]}'); raise exception 'redrew a frozen zone';
  exception when others then if sqlerrm not like 'This zone was generated%' then raise; end if; end;
  perform ms_save_zone(r.id, 'Renamed Zone', null);
  begin perform ms_generate_zones(vcity, camp, 2); raise exception 'generated over frozen ground';
  exception when others then if sqlerrm not like 'No free businesses%' and sqlerrm not like 'Every block%' then raise; end if; end;
  -- retiring one frees its blocks and businesses; a new run covers just that ground
  perform ms_set_zone_status(r.id, 'retired');
  if (select count(*) from ms_businesses where city_id = vcity and zone_id is null) = 0 then raise exception 'retire did not free businesses'; end if;
  run := ms_generate_zones(vcity, camp, 1);
  for i in 1..50 loop exit when ms_run_step(run)->>'stage' = 'ready'; end loop;
  select * into r from ms_zone_runs where id = run;
  if (r.stats->>'free_blocks')::int >= 16 then raise exception 'frozen blocks were regenerated'; end if;
  perform ms_run_discard(run);
  if (select status from ms_zone_runs where id = run) <> 'discarded' then raise exception 'discard'; end if;

  -- a rep assigned to a zone sees its businesses and nothing else
  select z.id into r from ms_zones z where z.city_id = vcity and z.status = 'active' limit 1;
  perform ms_assign_rep(r.id, camp, 'a0000000-0000-0000-0000-00000000ad12');
  raise notice 'cities admin: ok';
end $$;

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000ad12', true);
set local role authenticated;
do $$ declare n int; m int; begin
  select count(*) into n from ms_businesses;
  select count(*) into m from ms_businesses b where b.zone_id in (select zc.zone_id from ms_zone_campaigns zc where zc.rep_id = auth.uid());
  if n = 0 or n <> m then raise exception 'rep business rls: % vs %', n, m; end if;
  select count(*) into n from ms_blocks; if n <> 0 then raise exception 'rep reads blocks'; end if;
  select count(*) into n from ms_zone_runs; if n <> 0 then raise exception 'rep reads runs'; end if;
  select count(*) into n from ms_cities_list(); if n <> 0 then raise exception 'rep lists cities'; end if;
  begin perform ms_generate_zones((select id from ms_cities limit 1), (select id from ms_campaigns limit 1), 1); raise exception 'rep generated';
  exception when others then if sqlerrm <> 'Not allowed' then raise; end if; end;
  if has_table_privilege('anon', 'public.ms_businesses', 'select') then raise exception 'anon reads businesses'; end if;
  raise notice 'rep: ok';
end $$;
reset role;
