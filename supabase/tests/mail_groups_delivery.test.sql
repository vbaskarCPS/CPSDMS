-- Grouped Sent + delivery status (RUN_70). Run after the mail migrations (RUN_59–69) in the same transaction; everything rolls back.
\set ON_ERROR_STOP 1
begin;
\i :mig

do $$
declare
  ben uuid := 'a0000000-0000-0000-0000-0000000000b1'; out_ uuid := 'a0000000-0000-0000-0000-0000000000c9';
  box uuid; r jsonb; x int; t1 uuid; m1 uuid; m2 uuid; m3 uuid; s text;
begin
  insert into auth.users (id) values (ben), (out_);
  insert into app_users (id, username, full_name, email) values (ben, 'stebe', 'Ben Stewart', 'b@example.test'), (out_, 'outsi', 'Out Sider', 'o@example.test');
  insert into mail_boxes (local, kind, label, role) values ('bcclients', 'shared', 'Property Stars · BC Fall RJ', 'client') returning id into box;
  insert into mail_box_members (box_id, user_id) values (box, ben);

  -- receipts from one session, kept in the mailbox in that session's group (one customer twice)
  r := mail_log_outbound(box, 'Ann@Example.test', 'Your receipt', '<p>Thanks</p>', 'Thanks', 're_1', '<x1@resend>', 'receipts:2026-10-30', 'Receipts · Session Thu, Oct 30');
  m1 := (r->>'message_id')::uuid; t1 := (r->>'thread_id')::uuid;
  r := mail_log_outbound(box, 'bob@example.test', 'Your receipt', '<p>Thanks</p>', 'Thanks', 're_2', null, 'receipts:2026-10-30', 'Receipts · Session Thu, Oct 30');
  m2 := (r->>'message_id')::uuid;
  -- the old 7-argument call still works (no group)
  r := mail_log_outbound(box, 'cy@example.test', 'Your receipt', '<p>Thanks</p>', 'Thanks', 're_3', null);
  m3 := (r->>'message_id')::uuid;
  if (select batch_key from ms_messages where id = m3) is not null then raise exception 'old call got a group'; end if;

  -- a booking-email campaign (Ben is a member of the mailbox): Ann gets one too, in her same conversation
  insert into ms_messages (thread_id, dir, status, to_emails, subject, resend_id) values (t1, 'out', 'sent', array['ann@example.test'], 'See you tomorrow', 're_4') returning id into m3;
  insert into ms_messages (thread_id, dir, status, to_emails, subject, error)
    select id, 'out', 'failed', array['cy@example.test'], 'See you tomorrow', 'Invalid address' from ms_threads where contact_email = 'cy@example.test';
  perform set_config('request.jwt.claim.sub', ben::text, true);
  x := mail_tag_batch(box, array[m3, (select id from ms_messages where error = 'Invalid address')], 'campaign:c1', 'Day before · Fri, Oct 31');
  if x <> 2 then raise exception 'tagged %', x; end if;
  begin perform mail_tag_batch(box, array[m3], 'receipts:2026-10-30', 'x'); raise exception 'non-campaign key allowed'; exception when others then if sqlerrm not like '%campaign%' then raise; end if; end;

  -- someone without the mailbox: not allowed
  perform set_config('request.jwt.claim.sub', out_::text, true);
  begin perform mail_tag_batch(box, array[m3], 'campaign:c2', 'x'); raise exception 'outsider tagged'; exception when others then if sqlerrm <> 'Not allowed' then raise; end if; end;
  begin perform mail_batch(box, 'campaign:c1'); raise exception 'outsider read a group'; exception when others then if sqlerrm <> 'Not allowed' then raise; end if; end;
  if mail_batches() <> '[]'::jsonb then raise exception 'outsider saw groups'; end if;

  -- delivery events (and the old log, as the bounce webhook did)
  insert into email_logs (recipient_email, email_type, status, resend_message_id) values ('bob@example.test', 'receipt', 'sent', 're_2');
  r := mail_delivery('re_1', 'email.delivered', null, '2026-10-30T15:00:00Z');
  if (r->>'messages')::int <> 1 then raise exception 'delivered: %', r; end if;
  perform mail_delivery('re_2', 'email.bounced', 'Mailbox does not exist', null);
  perform mail_delivery('re_2', 'email.delivered', null, null);            -- late: doesn't undo the bounce
  perform mail_delivery('re_4', 'email.delivery_delayed', 'Greylisted', null);
  perform mail_delivery('re_4', 'email.delivered', null, null);            -- delayed → delivered
  perform mail_delivery('re_4', 'email.complained', null, null);           -- delivered → spam
  r := mail_delivery('nope', 'email.opened', null, null);
  if r->>'ignored' <> 'email.opened' then raise exception 'opened not ignored: %', r; end if;
  select delivery || '/' || delivery_reason into s from ms_messages where resend_id = 're_2';
  if s <> 'bounced/Mailbox does not exist' then raise exception 're_2: %', s; end if;
  if (select delivery from ms_messages where resend_id = 're_4') <> 'complained' then raise exception 're_4 not spam'; end if;
  select status || '/' || bounce_reason into s from email_logs where resend_message_id = 're_2';
  if s <> 'bounced/Mailbox does not exist' then raise exception 'email_logs: %', s; end if;

  -- the groups, with counts
  perform set_config('request.jwt.claim.sub', ben::text, true);
  r := mail_batches();
  if jsonb_array_length(r) <> 2 then raise exception 'groups: %', r; end if;
  if not r @> '[{"key":"receipts:2026-10-30","label":"Receipts · Session Thu, Oct 30","emails":2,"delivered":1,"bounced":1,"mailbox_label":"Property Stars · BC Fall RJ"}]'
    then raise exception 'receipts group: %', r; end if;
  if not r @> '[{"key":"campaign:c1","emails":2,"complained":1,"failed":1}]' then raise exception 'campaign group: %', r; end if;
  -- one group: problems first
  r := mail_batch(box, 'receipts:2026-10-30');
  if r->0->>'delivery' <> 'bounced' or r->1->>'delivery' <> 'delivered' or r->0->'to' <> '["bob@example.test"]' then raise exception 'group list: %', r; end if;

  -- Sent: Bob's only sent email is grouped → only in the group; Ann's and Cy's conversations hold an ungrouped one?
  --   Ann: receipt (grouped) + campaign email (grouped) → group only.  Cy: an ungrouped receipt → still a Sent row.
  r := mail_inbox(box, 'sent');
  select string_agg(e->>'contact_email', ',' order by e->>'contact_email') into s from jsonb_array_elements(r) e;
  if s <> 'cy@example.test' then raise exception 'sent rows: %', s; end if;
  r := mail_inbox(box, 'sent', 'bob');                                     -- searching still finds grouped ones
  if jsonb_array_length(r) <> 1 then raise exception 'search: %', r; end if;
  if jsonb_array_length(mail_inbox(box, 'inbox')) <> 3 then raise exception 'inbox changed'; end if;

  -- a conversation shows each email's delivery and group
  r := ms_thread(t1);
  if not r->'messages' @> '[{"delivery":"delivered","group":"Receipts · Session Thu, Oct 30"},{"delivery":"complained","group":"Day before · Fri, Oct 31"}]'
    then raise exception 'thread: %', r->'messages'; end if;

  -- who can call what
  if has_function_privilege('anon', 'public.mail_batches(uuid, int, timestamptz)', 'execute') or has_function_privilege('authenticated', 'public.mail_delivery(text, text, text, timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.mail_log_outbound(uuid, text, text, text, text, text, text, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.mail_batch(uuid, text)', 'execute') then raise exception 'grants'; end if;
  raise notice 'mail groups + delivery: all good';
end $$;
rollback;
