-- MainstreetAI mail (RUN_64). Run after RUN_59, 61, 62, 63, 64 in the same transaction; everything rolls back.
\set ON_ERROR_STOP 1
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


do $$
declare rita uuid := 'a0000000-0000-0000-0000-00000000e011'; ray uuid := 'a0000000-0000-0000-0000-00000000e012'; adm uuid := 'a0000000-0000-0000-0000-00000000ad11';
  camp uuid := 'c0000000-0000-0000-0000-0000000000c2'; biz uuid := 'b0000000-0000-0000-0000-000000000011';
  p jsonb; th uuid; tok text; r jsonb; inbox jsonb; ok boolean;
begin
  -- Rita writes to Ace Plumbing
  perform set_config('request.jwt.claim.sub', rita::text, true);
  p := ms_mail_prepare(null, biz, camp, array['Owner@Ace.test'], null, 'Hello Ace', '<p>Hi</p>', 'Hi', '[]');
  th := (p->>'thread_id')::uuid; tok := p->>'token';
  if p->>'sender_name' not like 'Rita Rep · Testifi2 via MainstreetAI' or (p->>'first_contact')::boolean is not true then raise exception 'prepare: %', p; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform ms_mail_sent((p->>'message_id')::uuid, 're_1', null);
  perform set_config('request.jwt.claim.sub', rita::text, true);
  inbox := ms_inbox('inbox');
  if jsonb_array_length(inbox) <> 1 or inbox->0->>'business' <> 'Ace Plumbing' then raise exception 'rita inbox: %', inbox; end if;
  -- an attachment that isn't hers
  begin perform ms_mail_prepare(th, null, null, array['owner@ace.test'], null, 'Re', '<p>x</p>', 'x', '[{"path":"out/someone/x.pdf"}]'); raise exception 'attachment check missed';
  exception when others then if sqlerrm not like '%isn’t yours%' then raise; end if; end;

  -- Ray can't see it
  perform set_config('request.jwt.claim.sub', ray::text, true);
  if jsonb_array_length(ms_inbox('inbox')) <> 0 then raise exception 'ray sees rita''s mail'; end if;

  -- the owner replies to the conversation's address
  perform set_config('request.jwt.claim.sub', '', true);
  r := ms_mail_inbound('in_1', 'owner@ace.test', 'Ann Owner', array['c-' || tok || '@reply.propertystars.app'], null, 'Re: Hello Ace', '<p>Tell me more</p>', 'Tell me more', '<abc@ace>', null, '[]', now());
  if (r->>'thread_id')::uuid <> th then raise exception 'reply not threaded: %', r; end if;
  if (ms_mail_inbound('in_1', 'owner@ace.test', null, array['x@y.z'], null, 's', null, 't', null, null, '[]', now())->>'again') is null then raise exception 'duplicate kept'; end if;
  perform set_config('request.jwt.claim.sub', rita::text, true);
  if (ms_inbox_counts()->>'unread')::int <> 1 then raise exception 'unread: %', ms_inbox_counts(); end if;
  r := ms_thread(th);
  if jsonb_array_length(r->'messages') <> 2 or (ms_inbox_counts()->>'unread')::int <> 0 then raise exception 'thread: %', r; end if;
  -- her reply goes back to the conversation
  p := ms_mail_prepare(th, null, null, array['owner@ace.test'], null, 'Re: Hello Ace', '<p>Sure</p>', 'Sure', '[]');
  if p->>'in_reply_to' <> '<abc@ace>' or (p->>'first_contact')::boolean then raise exception 'reply prepare: %', p; end if;

  -- mail from a stranger: unsorted, admins only
  perform set_config('request.jwt.claim.sub', '', true);
  perform ms_mail_inbound('in_2', 'who@else.test', null, array['mainstreetai@propertystars.app'], null, 'Question', null, 'Hi?', null, null, '[]', now());
  perform set_config('request.jwt.claim.sub', adm::text, true);
  if jsonb_array_length(ms_inbox('unsorted')) <> 1 or jsonb_array_length(ms_inbox('inbox')) <> 2 then raise exception 'admin: %', ms_inbox('inbox'); end if;
  perform set_config('request.jwt.claim.sub', rita::text, true);
  if jsonb_array_length(ms_inbox('inbox')) <> 1 then raise exception 'rita sees unsorted'; end if;

  -- the zone goes to Ray: the conversation goes with it
  update ms_zone_campaigns set rep_id = ray where campaign_id = camp;
  if jsonb_array_length(ms_inbox('inbox')) <> 0 then raise exception 'rita kept the mail'; end if;
  perform set_config('request.jwt.claim.sub', ray::text, true);
  if jsonb_array_length(ms_inbox('inbox')) <> 1 then raise exception 'ray didn''t get it'; end if;

  -- unsubscribe stops further mail
  if (ms_mail_unsubscribe(tok)->>'ok')::boolean is not true then raise exception 'unsubscribe'; end if;
  begin perform ms_mail_prepare(th, null, null, array['owner@ace.test'], null, 'Again', '<p>x</p>', 'x', '[]'); raise exception 'opt-out ignored';
  exception when others then if sqlerrm not like '%unsubscribed%' then raise; end if; end;

  -- the context Claude gets
  r := ms_mail_context(th, null, null);
  if r->'business'->>'name' <> 'Ace Plumbing' or jsonb_array_length(r->'thread') < 2 then raise exception 'context: %', r; end if;
  raise notice 'mail: OK';
end $$;
