-- MainstreetAI rep app round 2 (RUN_61). Run after RUN_59 + RUN_61 in the same transaction; everything rolls back.
\set ON_ERROR_STOP 1
-- local copies lack Supabase Storage's tables (the live database has them)
create table if not exists storage.objects (bucket_id text, name text);
alter table storage.objects enable row level security;
alter table storage.buckets add column if not exists file_size_limit bigint;
alter table storage.buckets add column if not exists allowed_mime_types text[];
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
\i :mig

insert into auth.users (id) values ('a0000000-0000-0000-0000-00000000ad11'), ('a0000000-0000-0000-0000-00000000e011'), ('a0000000-0000-0000-0000-00000000e012');
insert into app_users (id, username, full_name, email) values
  ('a0000000-0000-0000-0000-00000000ad11', 'rradm', 'Rr Admin', 'rradm@example.test'),
  ('a0000000-0000-0000-0000-00000000e011', 'rrrit', 'Rita Rep', 'rita2@example.test'),
  ('a0000000-0000-0000-0000-00000000e012', 'rrray', 'Ray Rep', 'ray2@example.test');
insert into user_permissions values ('a0000000-0000-0000-0000-00000000ad11', 'mainstreet_admin'),
  ('a0000000-0000-0000-0000-00000000e011', 'mainstreet_rep'), ('a0000000-0000-0000-0000-00000000e012', 'mainstreet_rep');

insert into ms_campaigns (id, name, pay_per_deal, retry_days, info_url, info_sms) values
  ('c0000000-0000-0000-0000-0000000000c2', 'Testifi2', 50, 30, 'https://example.test/sign', 'Hi {business}, here''s the link: {link}');
insert into ms_campaign_categories values ('c0000000-0000-0000-0000-0000000000c2', 'trades');
insert into ms_cities (id, name, geom) values ('c0000000-0000-0000-0000-0000000000a2', 'Leadtown',
  ST_GeomFromText('POLYGON((-79.80 43.30,-79.60 43.30,-79.60 43.50,-79.80 43.50,-79.80 43.30))', 4326));
insert into ms_zones (id, name, polygon, city_id) values ('c0000000-0000-0000-0000-0000000000f2', 'Leadtown North 1',
  '{"type":"Polygon","coordinates":[[[-79.70,43.40],[-79.68,43.40],[-79.68,43.42],[-79.70,43.42],[-79.70,43.40]]]}', 'c0000000-0000-0000-0000-0000000000a2');
insert into ms_businesses (id, city_id, name, name_norm, address, lat, lng, geom, kind, status, zone_id, hours) values
  ('b0000000-0000-0000-0000-000000000011', 'c0000000-0000-0000-0000-0000000000a2', 'Ace Plumbing', 'ace plumbing', '1 Elm St', 43.41, -79.69, ST_SetSRID(ST_MakePoint(-79.69, 43.41), 4326), 'trades', 'open', 'c0000000-0000-0000-0000-0000000000f2', '["Monday: 8:00 AM – 5:00 PM"]'),
  ('b0000000-0000-0000-0000-000000000012', 'c0000000-0000-0000-0000-0000000000a2', 'Best Electric', 'best electric', '2 Elm St', 43.411, -79.691, ST_SetSRID(ST_MakePoint(-79.691, 43.411), 4326), 'trades', 'open', 'c0000000-0000-0000-0000-0000000000f2', null);
insert into ms_zone_campaigns (zone_id, campaign_id, rep_id) values ('c0000000-0000-0000-0000-0000000000f2', 'c0000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-00000000e011');

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000e011', true);
do $$
declare m jsonb; l jsonb; v jsonb; v2 jsonb; cid uuid := gen_random_uuid(); camp uuid := 'c0000000-0000-0000-0000-0000000000c2'; t jsonb; b jsonb; k jsonb;
begin
  -- the home map: the zone and both businesses
  m := ms_rep_map();
  if jsonb_array_length(m->'pairs') <> 1 or jsonb_array_length(m->'businesses') <> 2 then raise exception 'map: %', m; end if;
  if (select count(*) from jsonb_array_elements(m->'businesses') x where x->'h' is not null and jsonb_typeof(x->'h') = 'array') <> 1 then raise exception 'hours missing'; end if;

  -- a custom lead in my zone (any kind counts), one outside every zone, and a duplicate
  l := ms_rep_add_lead('Corner Bakery', 'restaurant', '2B Elm St', 43.4112, -79.6912, '905-555-0177');
  if not (l->>'in_my_zone')::boolean then raise exception 'lead not in my zone: %', l; end if;
  l := ms_rep_add_lead('Far Away Cafe', 'restaurant', '99 Out Rd', 43.35, -79.75);
  if l->>'zone_id' is not null or (l->>'in_my_zone')::boolean then raise exception 'outside lead: %', l; end if;
  begin perform ms_rep_add_lead('ACE Plumbing', 'trades', '1 Elm St', 43.4101, -79.6901); raise exception 'duplicate allowed';
  exception when others then if sqlerrm not like 'It’s already on the map%' then raise; end if; end;
  m := ms_rep_map();
  if jsonb_array_length(m->'businesses') <> 4 or (select count(*) from jsonb_array_elements(m->'businesses') x where (x->>'lead')::boolean) <> 2 then raise exception 'map with leads: %', m->'businesses'; end if;
  -- the outside lead can be worked
  perform ms_rep_log_visit((l->>'id')::uuid, camp, 'interested', 'Owner keen', null, null, null, null, 43.35, -79.75, 5);

  -- offline: the same visit sent twice is kept once; an old time is kept as it happened
  v := ms_rep_log_visit('b0000000-0000-0000-0000-000000000011', camp, 'not_interested', null, null, null, null, null, 43.41, -79.69, 5,
                        now() - interval '40 days' + interval '38 days', cid);
  v2 := ms_rep_log_visit('b0000000-0000-0000-0000-000000000011', camp, 'not_interested', null, null, null, null, null, 43.41, -79.69, 5, now(), cid);
  if v->>'id' <> v2->>'id' or not (v2->>'again')::boolean then raise exception 'sent twice: % %', v, v2; end if;
  if (select count(*) from ms_visits where client_id = cid) <> 1 then raise exception 'kept twice'; end if;
  begin perform ms_rep_log_visit('b0000000-0000-0000-0000-000000000012', camp, 'come_back', null, null, null, null, null, null, null, null, now() - interval '5 days');
    raise exception 'old visit allowed';
  exception when others then if sqlerrm not like 'That visit time%' then raise; end if; end;
  -- photos must be in my own folder
  begin perform ms_rep_log_visit('b0000000-0000-0000-0000-000000000012', camp, 'come_back', null, null, null, null, null, null, null, null, null, null, array['someone-else/x.jpg']);
    raise exception 'foreign photo allowed';
  exception when others then if sqlerrm <> 'A photo isn’t yours' then raise; end if; end;
  perform ms_rep_log_visit('b0000000-0000-0000-0000-000000000012', camp, 'closed', 'Signed', null, null, null, null, 43.411, -79.691, 5, null, null,
                           array['a0000000-0000-0000-0000-00000000e011/v1.jpg']);

  -- retry: a "not interested" older than the campaign's retry days comes back
  update ms_visits set at = now() - interval '31 days' where client_id = cid;
  if (select x->>'s' from jsonb_array_elements(ms_rep_map()->'businesses') x where x->>'id' = 'b0000000-0000-0000-0000-000000000011') <> 'retry' then raise exception 'no retry'; end if;

  -- send info is logged; the kit has my code
  perform ms_rep_log_send('b0000000-0000-0000-0000-000000000011', camp, 'sms', '905-555-0100');
  if jsonb_array_length(ms_rep_business('b0000000-0000-0000-0000-000000000011', camp)->'sends') <> 1 then raise exception 'send not logged'; end if;
  k := ms_rep_kit(camp);
  if k->>'ref' <> 'RRRIT' or k->>'info_url' <> 'https://example.test/sign' then raise exception 'kit: %', k; end if;

  -- the day: start, walk, end
  t := ms_rep_day_start(43.41, -79.69);
  update ms_rep_days set last_at = now() - interval '5 minutes' where rep_id = auth.uid();
  perform ms_rep_day_ping(43.412, -79.69, 10);      -- ~220 m in 5 minutes: walked
  update ms_rep_days set last_at = now() - interval '1 minute' where rep_id = auth.uid();
  perform ms_rep_day_ping(43.43, -79.69, 10);       -- 2 km in a minute: driving, not counted
  perform ms_rep_day_ping(43.43, -79.69, 500);      -- a poor fix: ignored
  t := ms_rep_day_end(43.43, -79.69);
  if (t->>'distance_m')::int not between 200 and 240 or t->>'ended_at' is null then raise exception 'day: %', t; end if;

  -- the board: my week, earnings once a deal is approved
  b := ms_rep_board();
  if jsonb_array_length(b->'board') < 1 or not (b->'board'->0->>'me')::boolean then raise exception 'board: %', b; end if;
  raise notice 'rep refactor (rep): ok';
end $$;

-- admins: who's working, the lead list (merge), deal photos and earnings
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000ad11', true);
do $$
declare w jsonb; ls jsonb; lead uuid; d uuid;
begin
  w := ms_reps_today();
  if (select x->>'distance_m' from jsonb_array_elements(w) x where x->>'name' = 'Rita Rep')::int < 200 then raise exception 'today: %', w; end if;
  ls := ms_leads_list();
  if jsonb_array_length(ls) <> 2 then raise exception 'leads: %', ls; end if;
  lead := (select (x->>'id')::uuid from jsonb_array_elements(ls) x where x->>'name' = 'Corner Bakery');
  if jsonb_array_length((select x->'nearby' from jsonb_array_elements(ls) x where x->>'name' = 'Corner Bakery')) < 1 then raise exception 'nearby missing'; end if;
  perform ms_resolve_lead(lead, 'merge', 'b0000000-0000-0000-0000-000000000012');
  if (select lead_status from ms_businesses where id = lead) <> 'merged' then raise exception 'not merged'; end if;
  perform ms_resolve_lead((select (x->>'id')::uuid from jsonb_array_elements(ls) x where x->>'name' = 'Far Away Cafe'), 'keep');
  if jsonb_array_length(ms_leads_list()) <> 0 then raise exception 'leads left'; end if;
  d := (select id from ms_deals where rep_id = 'a0000000-0000-0000-0000-00000000e011' limit 1);
  if (ms_deal_photos(d))[1] <> 'a0000000-0000-0000-0000-00000000e011/v1.jpg' then raise exception 'photos'; end if;
  perform ms_decide_deal(d, true, null);
  perform ms_save_campaign_kit('c0000000-0000-0000-0000-0000000000c2', '{"pay_per_deal": "75", "retry_days": "60", "pitch": "Hello", "objections": [{"q":"Too pricey","a":"Pays for itself"}]}');
  if (select pay_per_deal from ms_campaigns where id = 'c0000000-0000-0000-0000-0000000000c2') <> 75 then raise exception 'kit not saved'; end if;
  begin perform ms_save_campaign_kit('c0000000-0000-0000-0000-0000000000c2', '{"info_url": "javascript:alert(1)"}'); raise exception 'bad link allowed';
  exception when others then if sqlerrm not like 'The info link%' then raise; end if; end;
  perform ms_save_goals(30, 1);
  raise notice 'rep refactor (admin): ok';
end $$;

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000e011', true);
do $$ declare b jsonb; begin
  b := ms_rep_board();
  if (b->'earnings'->>'total')::numeric <> 75 or (b->>'goal_visits')::int <> 30 then raise exception 'earnings/goals: %', b; end if;
  raise notice 'rep refactor (earnings): ok';
end $$;

-- Ray: not on the campaign, sees none of it
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000e012', true);
do $$ begin
  if jsonb_array_length(ms_rep_map()->'businesses') <> 0 then raise exception 'Ray sees businesses'; end if;
  begin perform ms_rep_add_lead('Ray Shop', 'trades', 'x', 43.41, -79.69); raise exception 'Ray added a lead';
  exception when others then if sqlerrm <> 'You aren’t on that campaign' then raise; end if; end;
  begin perform ms_rep_kit('c0000000-0000-0000-0000-0000000000c2'); raise exception 'Ray read the kit';
  exception when others then if sqlerrm <> 'Not allowed' then raise; end if; end;
  raise notice 'rep refactor (other rep): ok';
end $$;
