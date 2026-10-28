-- Staff email (RUN_65). Run after RUN_59, 61–65 in the same transaction; everything rolls back.
\set ON_ERROR_STOP 1
create table if not exists storage.objects (bucket_id text, name text);
alter table storage.objects enable row level security;
alter table storage.buckets add column if not exists file_size_limit bigint;
alter table storage.buckets add column if not exists allowed_mime_types text[];
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
\i :mig

do $$
declare
  ben uuid := 'a0000000-0000-0000-0000-0000000000b1'; ben2 uuid := 'a0000000-0000-0000-0000-0000000000b2';
  chad uuid := 'a0000000-0000-0000-0000-0000000000c1'; vic uuid := 'a0000000-0000-0000-0000-0000000000d1';
  adm uuid := 'a0000000-0000-0000-0000-0000000000e1'; rita uuid := 'a0000000-0000-0000-0000-0000000000f1';
  p jsonb; r jsonb; bt uuid; ct uuid; bmsg uuid; x int; tok text; s text;
begin
  insert into auth.users (id) values (ben), (ben2), (chad), (vic), (adm), (rita);
  insert into app_users (id, username, full_name, email, phone) values
    (ben, 'stebe', 'Ben Stewart', 'b@example.test', '(905) 555-0101'), (ben2, 'smibe', 'Ben Smith', 'b2@example.test', null),
    (chad, 'stech', 'Chad Stevens', 'c@example.test', null), (vic, 'rosvi', 'Victoria Ross', 'v@example.test', null),
    (adm, 'admad', 'Ada Admin', 'a@example.test', null), (rita, 'reprt', 'Rita Rep', 'r@example.test', null);
  insert into user_permissions values (ben, 'bookings'), (ben, 'workerbook'), (ben2, 'route_manager'), (chad, 'route_manager'),
    (vic, 'sa_users'), (adm, 'mainstreet_admin'), (rita, 'mainstreet_rep');

  -- every manager got a mailbox; the second Ben gets bens@; the rep gets none
  select string_agg(local, ',' order by local) into s from mail_boxes where owner_id in (ben, ben2, chad, vic, adm, rita);
  if s <> 'ada,ben,bens,chad,victoria' then raise exception 'boxes: %', s; end if;
  if exists (select 1 from mail_boxes where owner_id = rita) then raise exception 'rep got a mailbox'; end if;

  -- the contacts list
  perform set_config('request.jwt.claim.sub', ben::text, true);
  r := mail_directory();
  if not r @> '[{"name":"Chad Stevens","address":"chad@propertystars.app"}]' then raise exception 'directory: %', r; end if;
  perform set_config('request.jwt.claim.sub', rita::text, true);
  begin perform mail_directory(); raise exception 'rep saw the directory'; exception when others then if sqlerrm not like 'Not allowed%' then raise; end if; end;

  -- Ben writes to Chad (staff) and a customer (outside), with an attachment of his
  perform set_config('request.jwt.claim.sub', ben::text, true);
  p := mail_prepare(null, null, array['Chad@propertystars.app', 'pat@customer.test'], null, 'Thursday crew', '<p>Hi</p>', 'Hi',
                    jsonb_build_array(jsonb_build_object('name', 'map.pdf', 'path', 'out/' || ben || '/map.pdf')));
  bt := (p->>'thread_id')::uuid; bmsg := (p->>'message_id')::uuid;
  if p->'to' <> '["pat@customer.test"]' or jsonb_array_length(p->'delivered') <> 1 or p->>'from' <> 'ben@propertystars.app' then raise exception 'prepare: %', p; end if;
  if (select status from ms_messages where id = bmsg) <> 'sending' then raise exception 'not waiting for Resend'; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform ms_mail_sent(bmsg, 're_b1', null);
  perform mail_set_ext_id(bmsg, '<re-b1@email.amazonses.com>');

  -- Chad has it, unread, attachment readable; Victoria (Super Admin) and Ada (MainstreetAI admin) can't see it
  perform set_config('request.jwt.claim.sub', chad::text, true);
  r := mail_inbox();
  if jsonb_array_length(r) <> 1 or (r->0->>'unread')::int <> 1 or r->0->>'contact_email' <> 'ben@propertystars.app' then raise exception 'chad inbox: %', r; end if;
  ct := (r->0->>'id')::uuid;
  if not mail_can_attachment('out/' || ben || '/map.pdf') then raise exception 'chad can''t open the attachment'; end if;
  if (mail_counts()->>'unread')::int <> 1 then raise exception 'counts'; end if;
  perform set_config('request.jwt.claim.sub', vic::text, true);
  if ms_thread_can(bt) or ms_thread_can(ct) or mail_can_attachment('out/' || ben || '/map.pdf') then raise exception 'super admin can read'; end if;
  begin perform ms_thread(bt); raise exception 'super admin opened it'; exception when others then if sqlerrm not like 'Not allowed%' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  if ms_thread_can(bt) or jsonb_array_length(ms_inbox('inbox')) <> 0 or jsonb_array_length(ms_inbox('unsorted')) <> 0 then raise exception 'mainstreet admin sees staff mail'; end if;

  -- Chad replies inside the app: back into Ben's conversation, instantly, nothing for Resend
  perform set_config('request.jwt.claim.sub', chad::text, true);
  r := ms_thread(ct);
  p := mail_prepare(null, ct, array['ben@propertystars.app'], null, 'Re: Thursday crew', '<p>Got it</p>', 'Got it', '[]');
  if p->'to' <> '[]' or (select status from ms_messages where id = (p->>'message_id')::uuid) <> 'sent' then raise exception 'internal reply: %', p; end if;
  if (select count(*) from ms_messages where thread_id = bt) <> 2 then raise exception 'reply not in ben''s thread'; end if;

  -- the customer replies by email to Ben: matched by the Message-ID Resend gave
  perform set_config('request.jwt.claim.sub', '', true);
  r := mail_inbound('in_p1', 'pat@customer.test', 'Pat', array['ben@propertystars.app'], null, 'Re: Thursday crew', null, 'Works for me', '<pat1@customer.test>', '<re-b1@email.amazonses.com>', now());
  if (r->'deliveries'->0->>'thread_id')::uuid <> bt then raise exception 'customer reply: %', r; end if;
  if mail_inbound('in_p1', 'pat@customer.test', null, array['ben@propertystars.app'], null, 's', null, 't', null, null, now()) ? 'again' is not true then raise exception 'duplicate kept'; end if;
  -- push: Ben is told
  perform set_config('request.jwt.claim.sub', ben::text, true);
  perform push_subscribe('https://push.example.test/abc', 'pk', 'au', 'test');
  perform set_config('request.jwt.claim.sub', '', true);
  r := push_for_message((r->'deliveries'->0->>'message_id')::uuid);
  if r->'users' <> to_jsonb(array[ben]) or jsonb_array_length(r->'subs') <> 1 or r->>'url' <> '/app/email?t=' || bt then raise exception 'push: %', r; end if;
  -- Ben's answer quotes the customer's Message-ID
  perform set_config('request.jwt.claim.sub', ben::text, true);
  p := mail_prepare(null, bt, array['pat@customer.test'], null, 'Re: Thursday crew', '<p>Great</p>', 'Great', '[]');
  if p->>'in_reply_to' <> '<pat1@customer.test>' then raise exception 'in-reply-to: %', p; end if;

  -- new mail from outside to Chad: a new conversation in his box; to an unknown address: MainstreetAI unsorted
  perform set_config('request.jwt.claim.sub', '', true);
  r := mail_inbound('in_q1', 'quinn@else.test', 'Quinn', array['chad@propertystars.app', 'ben@propertystars.app'], null, 'Quote?', null, 'Hello', '<q1@else.test>', null, now());
  if jsonb_array_length(r->'deliveries') <> 2 then raise exception 'two boxes: %', r; end if;
  r := mail_inbound('in_z1', 'pat@customer.test', null, array['nobody@propertystars.app'], null, 'Hi', null, 'Hello?', '<z1@x>', null, now());
  if exists (select 1 from ms_threads where id = (r->'deliveries'->0->>'thread_id')::uuid and mailbox_id is not null) then raise exception 'unknown address went to a staff box'; end if;
  perform set_config('request.jwt.claim.sub', adm::text, true);
  if jsonb_array_length(ms_inbox('unsorted')) <> 1 then raise exception 'unsorted: %', ms_inbox('unsorted'); end if;

  -- rename Chad: the old address still delivers
  perform set_config('request.jwt.claim.sub', vic::text, true);
  perform mail_admin_rename((select id from mail_boxes where local = 'chad'), 'chadwick');
  begin perform mail_admin_rename((select id from mail_boxes where local = 'chadwick'), 'ben'); raise exception 'took ben@'; exception when others then if sqlerrm not like '%taken%' then raise; end if; end;
  perform set_config('request.jwt.claim.sub', '', true);
  r := mail_inbound('in_q2', 'quinn@else.test', null, array['chad@propertystars.app'], null, 'Again', null, 'Hi', '<q2@else.test>', null, now());
  if (select local from mail_boxes b join ms_threads t on t.mailbox_id = b.id where t.id = (r->'deliveries'->0->>'thread_id')::uuid) <> 'chadwick' then raise exception 'alias'; end if;

  -- Chad leaves: merge into Ben's mailbox; mail to either address reaches Ben
  update app_users set is_active = false where id = chad;
  perform set_config('request.jwt.claim.sub', vic::text, true);
  r := mail_admin_handover((select id from mail_boxes where local = 'chadwick'), ben, 'merge');
  if (r->>'conversations')::int < 2 then raise exception 'merge: %', r; end if;
  perform set_config('request.jwt.claim.sub', '', true);
  r := mail_inbound('in_q3', 'quinn@else.test', null, array['chad@propertystars.app'], null, 'Still there?', null, 'Hi', '<q3@else.test>', null, now());
  if (select owner_id from mail_boxes b join ms_threads t on t.mailbox_id = b.id where t.id = (r->'deliveries'->0->>'thread_id')::uuid) <> ben then raise exception 'after merge'; end if;
  perform set_config('request.jwt.claim.sub', ben::text, true);
  select count(*) into x from jsonb_array_elements(mail_inbox());
  if x < 5 then raise exception 'ben inbox after merge: %', x; end if;

  -- move: Ben Smith's whole mailbox goes to Victoria
  perform set_config('request.jwt.claim.sub', vic::text, true);
  perform mail_admin_handover((select id from mail_boxes where local = 'bens'), vic, 'move');
  perform set_config('request.jwt.claim.sub', vic::text, true);
  if jsonb_array_length(mail_my_boxes()) <> 2 then raise exception 'move: %', mail_my_boxes(); end if;

  -- AI context: own conversations only
  perform set_config('request.jwt.claim.sub', ben::text, true);
  r := mail_context(bt);
  if r->'me'->>'address' <> 'ben@propertystars.app' or jsonb_array_length(r->'thread') < 3 then raise exception 'context: %', r; end if;
  perform set_config('request.jwt.claim.sub', vic::text, true);
  begin perform mail_context(bt); raise exception 'context leak'; exception when others then if sqlerrm not like 'Not allowed%' then raise; end if; end;

  -- MainstreetAI contact-email matching never lands in a staff conversation
  perform set_config('request.jwt.claim.sub', '', true);
  r := mail_inbound('in_m1', 'quinn@else.test', null, array['mainstreetai@propertystars.app'], null, 'Hello', null, 'Hi', '<m1@else.test>', null, now());
  if exists (select 1 from ms_threads where id = (r->'deliveries'->0->>'thread_id')::uuid and mailbox_id is not null) then raise exception 'mainstreet matching leaked'; end if;

  -- a new manager gets a mailbox the moment they get a permission
  insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000a9');
  insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000a9', 'newjo', 'Jo New');
  insert into user_permissions values ('a0000000-0000-0000-0000-0000000000a9', 'dialer');
  if not exists (select 1 from mail_boxes where local = 'jo') then raise exception 'new manager has no mailbox'; end if;
  raise notice 'staff mail: OK';
end $$;
