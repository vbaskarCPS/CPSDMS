-- MainstreetAI zones, campaigns and reps (RUN_50). Run after the migration in one transaction; everything rolls back.
\set ON_ERROR_STOP 1
\i :mig

-- an admin, a rep-to-be, and a manager with no MainstreetAI permission at all
insert into auth.users (id) values ('a0000000-0000-0000-0000-00000000ad01'), ('a0000000-0000-0000-0000-00000000ad02'), ('a0000000-0000-0000-0000-00000000ad03');
insert into app_users (id, username, full_name) values
  ('a0000000-0000-0000-0000-00000000ad01', 'msadm', 'Mainstreet Admin'),
  ('a0000000-0000-0000-0000-00000000ad02', 'repon', 'Rep One'),
  ('a0000000-0000-0000-0000-00000000ad03', 'manag', 'Plain Manager');
insert into user_permissions values ('a0000000-0000-0000-0000-00000000ad01', 'mainstreet_admin'), ('a0000000-0000-0000-0000-00000000ad02', 'mainstreet_rep'),
  ('a0000000-0000-0000-0000-00000000ad03', 'workerbook');

select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000ad01', true);
do $$
declare z1 uuid; z2 uuid; c1 uuid; c2 uuid; r record; n int;
  sq jsonb := '{"type":"Polygon","coordinates":[[[-79.80,43.50],[-79.79,43.50],[-79.79,43.51],[-79.80,43.51],[-79.80,43.50]]]}';
  nearby jsonb := '{"type":"Polygon","coordinates":[[[-79.79,43.50],[-79.78,43.50],[-79.78,43.51],[-79.79,43.51],[-79.79,43.50]]]}';   -- shares an edge only
  overlap jsonb := '{"type":"Polygon","coordinates":[[[-79.798,43.502],[-79.792,43.502],[-79.792,43.508],[-79.798,43.508],[-79.798,43.502]]]}';   -- inside Plaza North only
begin
  -- campaigns
  c1 := ms_save_campaign(null, 'Taxifi', '#0ea5e9');
  c2 := ms_save_campaign(null, 'Second', '#e11d48', 'notes');
  begin perform ms_save_campaign(null, 'taxifi', '#000000'); raise exception 'duplicate campaign name allowed';
  exception when others then if sqlerrm not like 'There’s already a campaign%' then raise; end if; end;
  begin perform ms_save_campaign(null, 'Bad', 'blue'); raise exception 'bad colour allowed';
  exception when check_violation then null; end;

  -- zones: drawn, centred, no overlap
  z1 := ms_save_zone(null, 'Plaza North', sq, 'Oakville', 'Bronte');
  select * into r from ms_zones where id = z1;
  if r.geom is null or r.center_lat not between 43.50 and 43.51 or r.center_lng not between -79.80 and -79.79 then raise exception 'zone not prepared: %', r; end if;
  if r.city <> 'Oakville' or r.area <> 'Bronte' or r.status <> 'active' then raise exception 'zone fields: %', r; end if;
  z2 := ms_save_zone(null, 'Plaza East', nearby);   -- touching is fine
  begin perform ms_save_zone(null, 'Overlapper', overlap); raise exception 'overlap allowed';
  exception when others then if sqlerrm not like 'This zone overlaps%' then raise; end if; end;
  begin perform ms_save_zone(null, 'plaza north', '{"type":"Polygon","coordinates":[[[-79.70,43.40],[-79.69,43.40],[-79.69,43.41],[-79.70,43.41],[-79.70,43.40]]]}'); raise exception 'duplicate zone name allowed';
  exception when others then if sqlerrm not like 'There’s already a zone%' then raise; end if; end;
  begin perform ms_save_zone(null, 'Line', '{"type":"LineString","coordinates":[[0,0],[1,1]]}'); raise exception 'non-polygon allowed';
  exception when others then if sqlerrm <> 'Draw the zone as a polygon' then raise; end if; end;
  -- rename + redraw keeps city when none given
  perform ms_save_zone(z2, 'Plaza East 2', nearby, null, null);
  if (select name from ms_zones where id = z2) <> 'Plaza East 2' then raise exception 'rename failed'; end if;
  -- a retired zone frees its ground; bringing it back re-checks
  perform ms_set_zone_status(z1, 'retired');
  if (select retired_at from ms_zones where id = z1) is null then raise exception 'retired_at not set'; end if;
  perform ms_save_zone(null, 'Overlapper', overlap);
  begin perform ms_set_zone_status(z1, 'active'); raise exception 'reactivated over another zone';
  exception when others then if sqlerrm not like 'This zone overlaps%' then raise; end if; end;
  perform ms_delete_zone((select id from ms_zones where name = 'Overlapper'));
  perform ms_set_zone_status(z1, 'active');
  if (select retired_at from ms_zones where id = z1) is not null then raise exception 'retired_at not cleared'; end if;

  -- campaigns on a zone, and reps
  perform ms_set_zone_campaigns(z1, array[c1, c2]);
  if (select count(*) from ms_zone_campaigns where zone_id = z1) <> 2 then raise exception 'campaigns not attached'; end if;
  begin perform ms_assign_rep(z1, c1, 'a0000000-0000-0000-0000-00000000ad03'); raise exception 'a non-rep was assigned';
  exception when others then if sqlerrm <> 'That person isn’t a MainstreetAI rep' then raise; end if; end;
  perform ms_assign_rep(z1, c1, 'a0000000-0000-0000-0000-00000000ad02');
  select * into r from ms_zone_campaigns where zone_id = z1 and campaign_id = c1;
  if r.rep_id is null or r.assigned_at is null or r.assigned_by <> 'a0000000-0000-0000-0000-00000000ad01' then raise exception 'assignment not recorded: %', r; end if;
  begin perform ms_assign_rep(z2, c1, 'a0000000-0000-0000-0000-00000000ad02'); raise exception 'assigned a campaign that is not on the zone';
  exception when others then if sqlerrm <> 'That campaign isn’t on this zone yet' then raise; end if; end;
  -- taking a campaign off drops its rep with it
  perform ms_set_zone_campaigns(z1, array[c1]);
  if exists (select 1 from ms_zone_campaigns where zone_id = z1 and campaign_id = c2) then raise exception 'campaign not removed'; end if;
  -- a zone with campaigns can't be deleted
  begin perform ms_delete_zone(z1); raise exception 'deleted a zone with campaigns';
  exception when others then if sqlerrm not like 'This zone has campaigns%' then raise; end if; end;

  -- the list: admin sees both zones, the first with Taxifi + rep name
  select count(*) into n from ms_zones_list(); if n <> 2 then raise exception 'admin list: %', n; end if;
  select * into r from ms_zones_list() l where l.id = z1;
  if r.campaigns->0->>'name' <> 'Taxifi' or r.campaigns->0->>'rep_name' <> 'Rep One' then raise exception 'list campaigns: %', r.campaigns; end if;

  -- reps: the list, adding one, changing one
  select count(*) into n from ms_reps(); if n <> 1 then raise exception 'reps: %', n; end if;
  if (select zones from ms_reps() where full_name = 'Rep One') <> 1 then raise exception 'rep zone count wrong'; end if;
  select * into r from ms_admin_create_rep('Dana Walker', 'dana@example.com', '613-555-0101');
  if r.username <> 'walda' then raise exception 'rep username: %', r.username; end if;
  if not ms_is_rep(r.id) then raise exception 'new rep has no rep permission'; end if;
  if (select count(*) from user_permissions where user_id = r.id) <> 1 then raise exception 'rep got extra permissions'; end if;
  begin perform ms_admin_create_rep('Dana Again', 'DANA@example.com'); raise exception 'duplicate email allowed';
  exception when others then if sqlerrm not like 'Someone already has the email%' then raise; end if; end;
  begin perform ms_admin_create_rep('No Email', ''); raise exception 'rep without email allowed';
  exception when others then if sqlerrm not like 'Their email is needed%' then raise; end if; end;
  begin perform ms_admin_update_rep('a0000000-0000-0000-0000-00000000ad03', 'X', null, null, true); raise exception 'updated a non-rep';
  exception when others then if sqlerrm <> 'That person isn’t a MainstreetAI rep' then raise; end if; end;
  -- an admin without User Management can still send a rep's setup email, not a manager's
  select * into r from app_admin_issue_setup((select id from app_users where username = 'walda'));
  if r.code is null then raise exception 'no setup code'; end if;
  if (select setup_sent_at from ms_reps() where username = 'walda') is not null then raise exception 'sent_at before send'; end if;
  begin perform app_admin_issue_setup('a0000000-0000-0000-0000-00000000ad03'); raise exception 'admin issued a manager setup';
  exception when others then if sqlerrm <> 'Not allowed' then raise; end if; end;
  perform ms_admin_update_rep((select id from app_users where username = 'walda'), 'Dana Walker-Lee', 'dana@example.com', null, false);
  if (select is_active from app_users where username = 'walda') then raise exception 'rep not deactivated'; end if;

  -- audit
  if (select count(*) from audit_log where entity in ('ms_zones','ms_campaigns','ms_zone_campaigns')) < 8 then raise exception 'audit not written'; end if;
  raise notice 'mainstreet admin: ok';
end $$;

-- the rep: sees only their zone and pair, can't write
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000ad02', true);
set local role authenticated;
do $$ declare n int; r record; begin
  select count(*) into n from ms_zones_list(); if n <> 1 then raise exception 'rep list: %', n; end if;
  select * into r from ms_zones_list();
  if r.name <> 'Plaza North' or jsonb_array_length(r.campaigns) <> 1 then raise exception 'rep sees wrong zone: %', r; end if;
  select count(*) into n from ms_zones; if n <> 1 then raise exception 'rep rls zones: %', n; end if;
  select count(*) into n from ms_campaigns; if n < 1 then raise exception 'rep cannot read campaigns'; end if;
  begin perform ms_save_zone(null, 'Mine', '{"type":"Polygon","coordinates":[[[0,0],[0.01,0],[0.01,0.01],[0,0.01],[0,0]]]}'); raise exception 'rep drew a zone';
  exception when others then if sqlerrm <> 'Not allowed' then raise; end if; end;
  begin perform ms_reps(); if found then raise exception 'rep listed reps'; end if; exception when others then null; end;
  begin insert into ms_zones (name, polygon) values ('x', '{}'); raise exception 'rep inserted directly';
  exception when insufficient_privilege then null; end;
  raise notice 'rep: ok';
end $$;
reset role;

-- a plain manager: nothing
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000ad03', true);
set local role authenticated;
do $$ declare n int; begin
  select count(*) into n from ms_zones_list(); if n <> 0 then raise exception 'manager sees zones'; end if;
  select count(*) into n from ms_zones; if n <> 0 then raise exception 'manager rls zones'; end if;
  select count(*) into n from ms_campaigns; if n <> 0 then raise exception 'manager reads campaigns'; end if;
  begin perform ms_save_campaign(null, 'Nope', '#000000'); raise exception 'manager made a campaign';
  exception when others then if sqlerrm <> 'Not allowed' then raise; end if; end;
  if has_table_privilege('anon', 'public.ms_zones', 'select') then raise exception 'anon can read zones'; end if;
  raise notice 'refused: ok';
end $$;
reset role;
