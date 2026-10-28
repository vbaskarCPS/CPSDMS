-- MainstreetAI reps in the field (RUN_59). Run after the migration in the same transaction; everything rolls back.
\set ON_ERROR_STOP 1
\i :mig

-- an admin, a rep, a second rep
insert into auth.users (id) values ('a0000000-0000-0000-0000-00000000ad01'), ('a0000000-0000-0000-0000-00000000e001'), ('a0000000-0000-0000-0000-00000000e002');
insert into app_users (id, username, full_name, email) values
  ('a0000000-0000-0000-0000-00000000ad01', 'rfadm', 'Field Admin', 'admin@example.test'),
  ('a0000000-0000-0000-0000-00000000e001', 'rfrep', 'Rita Rep', 'rita@example.test'),
  ('a0000000-0000-0000-0000-00000000e002', 'rfrep2', 'Ray Rep', 'ray@example.test');
insert into user_permissions values ('a0000000-0000-0000-0000-00000000ad01', 'mainstreet_admin'),
  ('a0000000-0000-0000-0000-00000000e001', 'mainstreet_rep'), ('a0000000-0000-0000-0000-00000000e002', 'mainstreet_rep');

-- reps hold no other permission
do $$ begin
  begin insert into user_permissions values ('a0000000-0000-0000-0000-00000000e001', 'bookings'); raise exception 'rep got bookings';
  exception when others then if sqlerrm not like '%rep%can’t have any other%' then raise; end if; end;
  begin insert into user_permissions values ('a0000000-0000-0000-0000-00000000ad01', 'mainstreet_rep'); raise exception 'admin became a rep';
  exception when others then if sqlerrm not like '%can’t have any other permission%' then raise; end if; end;
end $$;

-- a campaign for trades only, a city, a zone, four businesses (one a chain, one a clinic)
insert into ms_campaigns (id, name) values ('c0000000-0000-0000-0000-0000000000c1', 'Testifi');
insert into ms_campaign_categories values ('c0000000-0000-0000-0000-0000000000c1', 'trades');
insert into ms_cities (id, name) values ('c0000000-0000-0000-0000-0000000000a1', 'Fieldtown');
insert into ms_zones (id, name, polygon) values ('c0000000-0000-0000-0000-0000000000f1', 'Fieldtown North 1',
  '{"type":"Polygon","coordinates":[[[-79.70,43.40],[-79.68,43.40],[-79.68,43.42],[-79.70,43.42],[-79.70,43.40]]]}');
insert into ms_businesses (id, city_id, name, name_norm, address, lat, lng, geom, kind, status, is_chain, zone_id) values
  ('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'Ace Plumbing', 'ace plumbing', '1 Elm St', 43.41, -79.69, ST_SetSRID(ST_MakePoint(-79.69, 43.41), 4326), 'trades', 'open', false, 'c0000000-0000-0000-0000-0000000000f1'),
  ('b0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000a1', 'Best Electric', 'best electric', '2 Elm St', 43.411, -79.691, ST_SetSRID(ST_MakePoint(-79.691, 43.411), 4326), 'trades', 'open', false, 'c0000000-0000-0000-0000-0000000000f1'),
  ('b0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000a1', 'Big Chain Hardware', 'big chain hardware', '3 Elm St', 43.412, -79.692, ST_SetSRID(ST_MakePoint(-79.692, 43.412), 4326), 'trades', 'open', true, 'c0000000-0000-0000-0000-0000000000f1'),
  ('b0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-0000000000a1', 'Elm Clinic', 'elm clinic', '4 Elm St', 43.413, -79.693, ST_SetSRID(ST_MakePoint(-79.693, 43.413), 4326), 'clinic', 'open', false, 'c0000000-0000-0000-0000-0000000000f1');
insert into ms_zone_campaigns (zone_id, campaign_id, rep_id) values ('c0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-00000000e001');

-- as Rita
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000e001', true);
do $$
declare h jsonb; z jsonb; v jsonb; f jsonb; n jsonb;
  zone uuid := 'c0000000-0000-0000-0000-0000000000f1'; camp uuid := 'c0000000-0000-0000-0000-0000000000c1';
begin
  h := ms_rep_home();
  if jsonb_array_length(h->'zones') <> 1 or (h->'zones'->0->>'total')::int <> 2 or (h->'zones'->0->>'left')::int <> 2 then raise exception 'home: %', h; end if;
  z := ms_rep_zone(zone, camp);
  if jsonb_array_length(z->'businesses') <> 2 or z->'businesses'->0->>'state' <> 'new' then raise exception 'zone (chain and clinic left off): %', z->'businesses'; end if;

  -- a visit at the door: close enough, not flagged
  v := ms_rep_log_visit('b0000000-0000-0000-0000-000000000001', camp, 'come_back', 'Owner out', null, null, null, null, 43.4101, -79.6901, 10);
  if (v->>'far')::boolean then raise exception 'flagged at the door: %', v; end if;
  -- the same business later: follow up tomorrow, logged from 1 km away → flagged
  v := ms_rep_log_visit('b0000000-0000-0000-0000-000000000001', camp, 'follow_up', 'Call Tue', 'Al', '905-555-0100', null, now() + interval '1 day', 43.42, -79.69, 10);
  if not (v->>'far')::boolean or (v->>'distance_m')::int < 900 then raise exception 'far not flagged: %', v; end if;
  -- a deal at the other
  v := ms_rep_log_visit('b0000000-0000-0000-0000-000000000002', camp, 'closed', 'Signed up', null, null, null, null, 43.411, -79.691, 5);
  if v->>'state' <> 'pending' then raise exception 'deal not pending: %', v; end if;

  z := ms_rep_zone(zone, camp);
  if (select string_agg(b->>'state', ',' order by b->>'name') from jsonb_array_elements(z->'businesses') b) <> 'follow_up,pending' then raise exception 'states: %', z; end if;
  h := ms_rep_home();
  if (h->'zones'->0->>'left')::int <> 0 or (h->'zones'->0->>'deals_pending')::int <> 1 then raise exception 'home after: %', h; end if;
  f := ms_rep_followups();
  if jsonb_array_length(f) <> 1 or f->0->>'when' <> 'later' or f->0->>'contact_name' <> 'Al' then raise exception 'followups: %', f; end if;
  n := ms_rep_numbers();
  if (n->'deals'->>'pending')::int <> 1 or (n->>'visits_total')::int <> 3 or jsonb_array_length(n->'days') <> 14 then raise exception 'numbers: %', n; end if;
  if jsonb_array_length(ms_rep_business('b0000000-0000-0000-0000-000000000001', camp)->'visits') <> 2 then raise exception 'business visits'; end if;

  -- rules
  begin perform ms_rep_log_visit('b0000000-0000-0000-0000-000000000004', camp, 'come_back'); raise exception 'clinic allowed';
  exception when others then if sqlerrm not like '%isn’t on this campaign’s list%' then raise; end if; end;
  begin perform ms_rep_log_visit('b0000000-0000-0000-0000-000000000001', camp, 'follow_up'); raise exception 'follow-up without a time';
  exception when others then if sqlerrm not like 'When should you follow up%' then raise; end if; end;
  begin perform ms_rep_log_visit('b0000000-0000-0000-0000-000000000001', camp, 'cant_sell'); raise exception 'cant sell without why';
  exception when others then if sqlerrm not like 'Say why%' then raise; end if; end;
  begin perform ms_deals_list('pending'); raise exception 'rep saw the pipeline';
  exception when others then if sqlerrm <> 'Not allowed' then raise; end if; end;
  raise notice 'rep: ok';
end $$;

-- Ray isn't assigned: sees nothing of Rita's zone
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000e002', true);
do $$ begin
  if jsonb_array_length(ms_rep_home()->'zones') <> 0 then raise exception 'Ray sees a zone'; end if;
  begin perform ms_rep_zone('c0000000-0000-0000-0000-0000000000f1', 'c0000000-0000-0000-0000-0000000000c1'); raise exception 'Ray opened the zone';
  exception when others then if sqlerrm <> 'Not allowed' then raise; end if; end;
  raise notice 'other rep: ok';
end $$;

-- the admin's pipeline
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000ad01', true);
do $$
declare d jsonb; did uuid;
begin
  d := ms_deals_list('pending');
  if jsonb_array_length(d) <> 1 or d->0->>'rep' <> 'Rita Rep' then raise exception 'pipeline: %', d; end if;
  did := (d->0->>'id')::uuid;
  begin perform ms_decide_deal(did, false, null); raise exception 'rejected without a reason';
  exception when others then if sqlerrm not like 'Say why%' then raise; end if; end;
  perform ms_decide_deal(did, true, null);
  if jsonb_array_length(ms_deals_list('approved')) <> 1 then raise exception 'not approved'; end if;
  raise notice 'pipeline: ok';
end $$;

-- Rita sees it approved; then a "can't sell here" that the admin removes
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000e001', true);
do $$ begin
  if (ms_rep_numbers()->'deals'->>'approved')::int <> 1 then raise exception 'rep doesn’t see approval'; end if;
  perform ms_rep_log_visit('b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000c1', 'cant_sell', 'Shut down', null, null, null, null, 43.41, -79.69, 5);
end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000ad01', true);
do $$ declare fl jsonb; begin
  fl := ms_flags_list();
  if jsonb_array_length(fl) <> 1 then raise exception 'flags: %', fl; end if;
  perform ms_resolve_flag((fl->0->>'id')::uuid, true);
  if (select status from ms_businesses where id = 'b0000000-0000-0000-0000-000000000001') <> 'closed' then raise exception 'not removed'; end if;
  if jsonb_array_length(ms_flags_list()) <> 0 then raise exception 'flag still open'; end if;
end $$;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000e001', true);
do $$ begin
  if (ms_rep_home()->'zones'->0->>'total')::int <> 1 then raise exception 'removed business still on the list'; end if;
  raise notice 'flags: ok';
end $$;

-- sign-in helpers: only reps, only by service role
do $$ begin
  if ms_rep_login_address('RITA@example.test') <> 'rfrep@login.cpsdms.app' then raise exception 'login address'; end if;
  if ms_rep_login_address('admin@example.test') is not null then raise exception 'admin found as rep'; end if;
  if (select count(*) from ms_rep_reset_link('rita@example.test')) <> 1 then raise exception 'no reset link'; end if;
  if (select count(*) from ms_rep_reset_link('rita@example.test')) <> 0 then raise exception 'second link within 2 minutes'; end if;
  if (select count(*) from ms_rep_reset_link('nobody@example.test')) <> 0 then raise exception 'link for a stranger'; end if;
  raise notice 'sign-in helpers: ok';
end $$;
