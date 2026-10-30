-- AI replies with one-tap booking changes (RUN_71). Run after RUN_70 in the same transaction; everything rolls back.
\set ON_ERROR_STOP 1
begin;
\i :mig

do $$
declare
  ben uuid := 'a0000000-0000-0000-0000-0000000000b1'; may uuid := 'a0000000-0000-0000-0000-0000000000b2'; out_ uuid := 'a0000000-0000-0000-0000-0000000000c9';
  cc uuid; box uuid; mybox uuid; lst uuid; pln uuid; b1 uuid; b2 uuid; b3 uuid; b4 uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; m1 uuid; m3 uuid; m4 uuid; s1 uuid; s3 uuid; s4 uuid; r jsonb; x int; s text;
begin
  insert into auth.users (id) values (ben), (may), (out_);
  insert into app_users (id, username, full_name, email) values (ben, 'stebe', 'Ben Stewart', 'b@x.test'), (may, 'smima', 'May Smith', 'm@x.test'), (out_, 'outsi', 'Out Sider', 'o@x.test');
  insert into command_centers (username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id) values ('bcfall', 'x', 'BC Fall RJ', '', '') returning id into cc;
  insert into user_centers (user_id, center_id) values (ben, cc), (may, cc);
  insert into user_permissions values (ben, 'bookings');
  insert into mail_boxes (local, kind, label, role, center_id) values ('bcclients', 'shared', 'Property Stars · BC Fall RJ', 'client', cc) returning id into box;
  insert into mail_box_members (box_id, user_id) values (box, ben), (box, may);
  insert into mail_boxes (local, kind, owner_id) values ('benpersonal', 'person', ben) returning id into mybox;
  insert into mb_lists (region, year, part, service, name, center_id) values ('West', 2026, 'fall', 'aeration', 'BC Fall 2026', cc) returning id into lst;
  insert into mb_plans (kind, region, year, prepaid, price) values ('star_plan', 'West', 2026, true, 189) returning id into pln;
  insert into mb_bookings (list_id, plan_id, house_no, street_name, street_norm, emails, people, prepaid, route_code, map_state, job_code)
    values (lst, pln, '12', 'Elm St', 'elm st', array['Ann@Example.test'], '[{"first":"Ann","last":"Lee"}]', true, 'VAN01', 'on_map', 'AF') returning id into b1;
  insert into mb_bookings (list_id, plan_id, house_no, street_name, street_norm, emails, prepaid, route_code, map_state)
    values (lst, pln, '12', 'Elm St (spring)', 'elm st spring', array['ann@example.test'], true, 'VAN01', 'on_map') returning id into b2;
  insert into mb_bookings (list_id, house_no, street_name, street_norm, emails, people, prepaid, route_code, map_state)
    values (lst, '9', 'Oak Ave', 'oak ave', array['bob@example.test'], '[{"first":"Bob","last":"Ng"}]', false, 'VAN01', 'on_map') returning id into b3;
  insert into mb_bookings (list_id, house_no, street_name, street_norm, emails, prepaid, route_code, map_state, field_notes)
    values (lst, '3', 'Fir Rd', 'fir rd', array['cy@example.test'], false, 'VAN01', 'on_map', 'Side gate') returning id into b4;

  -- the campaign: Ann's and Bob's day-before emails (Bob's never answered); Ann answers in the same conversation
  insert into ms_threads (mailbox_id, subject, contact_email, last_dir) values (box, 'Reminder', 'ann@example.test', 'out') returning id into t1;
  insert into ms_messages (thread_id, dir, status, to_emails, subject, text_body) values (t1, 'out', 'sent', array['ann@example.test'], 'Reminder', 'We are coming Saturday.');
  update mb_bookings set sent_emails = jsonb_build_array(jsonb_build_object('kind', 'day_before:2026-10-31', 'thread_id', t1)) where id = b1;
  insert into ms_threads (mailbox_id, subject, contact_email, last_dir) values (box, 'Reminder', 'bob@example.test', 'out') returning id into t2;
  insert into ms_messages (thread_id, dir, status, to_emails, subject) values (t2, 'out', 'sent', array['bob@example.test'], 'Reminder');
  insert into ms_messages (thread_id, dir, status, from_email, from_name, subject, text_body, at)
    values (t1, 'in', 'received', 'ann@example.test', 'Ann Lee', 'Re: Reminder', 'Please cancel, we sold the house.', now()) returning id into m1;

  -- what Claude gets: the email, the conversation, and the booking that was emailed in this conversation (only that one)
  r := mail_suggest_context(m1);
  if r->'email'->>'text' <> 'Please cancel, we sold the house.' or jsonb_array_length(r->'conversation') <> 1 then raise exception 'context: %', r; end if;
  if jsonb_array_length(r->'bookings') <> 1 or r->'bookings'->0->>'id' <> b1::text or (r->'bookings'->0->>'linked')::boolean is not true
     or r->'bookings'->0->'plan'->>'open_bookings' <> '2' or r->'bookings'->0->'plan'->>'kind' <> 'Star Plan' then raise exception 'context bookings: %', r->'bookings'; end if;
  if r::text like '%189%' then raise exception 'the plan price went to Claude'; end if;

  s1 := mail_suggest_save(m1, jsonb_build_object('intent', 'cancel', 'action', 'cancel', 'booking_id', b4, 'note', 'Sold the house',
          'summary', 'Ann Lee wants to cancel', 'reply_subject', 'Re: Reminder', 'reply_html', '<p>Sorry to see you go.</p>', 'confidence', 'high'), 'test-model');
  if (select booking_id from mail_suggestions where id = s1) <> b1 then raise exception 'a booking not in the candidates was accepted'; end if;

  -- folders: Inbox = conversations someone wrote in (Bob's sent-only one isn't there); To approve; counts
  perform set_config('request.jwt.claim.sub', ben::text, true);
  select string_agg(e->>'contact_email', ',') into s from jsonb_array_elements(mail_inbox(box, 'inbox')) e;
  if s <> 'ann@example.test' then raise exception 'inbox: %', s; end if;
  if jsonb_array_length(mail_inbox(box, 'inbox', 'bob')) <> 1 then raise exception 'search no longer finds sent-only ones'; end if;
  r := mail_inbox(box, 'approve');
  if jsonb_array_length(r) <> 1 or r->0->>'suggestion' <> 'Ann Lee wants to cancel' then raise exception 'approve: %', r; end if;
  if (mail_counts()->>'approve')::int <> 1 then raise exception 'counts: %', mail_counts(); end if;

  -- May reads the mailbox but can't change bookings
  perform set_config('request.jwt.claim.sub', may::text, true);
  r := mail_suggestion(t1);
  if (r->'bookings'->0->>'can_change')::boolean is not false then raise exception 'may can change: %', r; end if;
  begin perform mail_suggestion_decide(s1, true); raise exception 'may changed a booking'; exception when others then if sqlerrm not like 'Not allowed%' then raise; end if; end;
  -- an outsider can't see it at all
  perform set_config('request.jwt.claim.sub', out_::text, true);
  begin perform mail_suggestion(t1); raise exception 'outsider saw a suggestion'; exception when others then if sqlerrm <> 'Not allowed' then raise; end if; end;
  if mail_suggest_can(m1) then raise exception 'outsider may ask Claude'; end if;

  -- Ben approves: the whole plan is cancelled, prepaid → marked for refund
  perform set_config('request.jwt.claim.sub', ben::text, true);
  if not mail_suggest_can(m1) then raise exception 'ben may not ask'; end if;
  r := mail_suggestion(t1);
  if (r->'bookings'->0->>'can_change')::boolean is not true or r->>'action' <> 'cancel' then raise exception 'ben: %', r; end if;
  r := mail_suggestion_decide(s1, true, null, null, true);
  if r->>'applied' <> 'cancel' or (r->>'bookings')::int <> 2 or (r->>'refund')::boolean is not true then raise exception 'decide: %', r; end if;
  select string_agg(status || '/' || (refund_requested_at is not null)::text, ',' order by street_name) into s from mb_bookings where plan_id = pln;
  if s <> 'cancelled/true,cancelled/true' then raise exception 'plan bookings: %', s; end if;
  if (select attempts->-1->>'reason' || ' / ' || (attempts->-1->>'note') from mb_bookings where id = b1) <> 'Customer cancelled by email / Sold the house' then raise exception 'attempt'; end if;
  if (select cancelled_at is null or refund_requested_at is null from mb_plans where id = pln) then raise exception 'plan not cancelled / refund'; end if;
  begin perform mail_suggestion_decide(s1, true); raise exception 'decided twice'; exception when others then if sqlerrm not like '%already handled%' then raise; end if; end;
  if (mail_counts()->>'approve')::int <> 0 then raise exception 'still to approve'; end if;
  -- the card still shows (for undo), then undo puts everything back
  if mail_suggestion(t1)->>'applied' <> 'cancel' then raise exception 'no undo card'; end if;
  perform mail_suggestion_undo(s1);
  select string_agg(status || '/' || (refund_requested_at is not null)::text, ',' order by street_name) into s from mb_bookings where plan_id = pln;
  if s <> 'open/false,open/false' then raise exception 'undo bookings: %', s; end if;
  if (select cancelled_at is not null from mb_plans where id = pln) or (select jsonb_array_length(attempts) from mb_bookings where id = b1) <> 0 then raise exception 'undo plan/attempts'; end if;
  if (select status from mail_suggestions where id = s1) <> 'done' then raise exception 'replied one should stay done'; end if;

  -- Bob writes a new email (not a reply): matched by his address → delay → second round, out of the first-pass feed
  insert into ms_threads (mailbox_id, subject, contact_email, last_dir) values (box, 'Saturday', 'bob@example.test', 'in') returning id into t3;
  insert into ms_messages (thread_id, dir, status, from_email, subject, text_body) values (t3, 'in', 'received', 'bob@example.test', 'Saturday', 'We are away, can you come later?') returning id into m3;
  r := mail_suggest_context(m3);
  if r->'bookings'->0->>'id' <> b3::text or (r->'bookings'->0->>'linked')::boolean then raise exception 'bob context: %', r->'bookings'; end if;
  s3 := mail_suggest_save(m3, '{"intent":"delay","action":"second_round","summary":"Bob Ng wants to delay","note":"Away this weekend","reply_html":"<p>No problem.</p>"}');
  r := mail_suggestion_decide(s3, true, null, 'Away this weekend; later is fine', false);
  if (select round from mb_bookings where id = b3) <> 2 or (select status from mb_bookings where id = b3) <> 'open'
     or (select attempts->-1->>'kind' || '/' || (attempts->-1->>'reason') from mb_bookings where id = b3) <> 'next_time/Customer asked to delay' then raise exception 'second round'; end if;
  select string_agg(e->>'Street Name', ',' order by e->>'Street Name') into s from jsonb_array_elements(app_mb_day_bookings(cc, array['VAN01'])) e;
  if s like '%Oak%' then raise exception 'second-round booking loaded into the first pass: %', s; end if;
  if s not like '%Fir%' or s not like '%Elm St%' then raise exception 'feed lost bookings: %', s; end if;
  if (select status from mail_suggestions where id = s3) <> 'done' then raise exception 'applied without a reply should be done'; end if;

  -- Cy's gate code → field notes; a "thanks" → dismissed
  insert into ms_threads (mailbox_id, subject, contact_email, last_dir) values (box, 'Gate', 'cy@example.test', 'in') returning id into t4;
  insert into ms_messages (thread_id, dir, status, from_email, subject, text_body) values (t4, 'in', 'received', 'cy@example.test', 'Gate', 'Gate code 4412') returning id into m4;
  s4 := mail_suggest_save(m4, '{"intent":"instructions","action":"field_notes","note":"Gate code 4412","summary":"Cy sent a gate code"}');
  perform mail_suggestion_decide(s4, true);
  if (select field_notes from mb_bookings where id = b4) <> 'Side gate · Gate code 4412' then raise exception 'field notes'; end if;

  -- no booking found → no action (only a reply)
  insert into ms_messages (thread_id, dir, status, from_email, subject, text_body) values (t4, 'in', 'received', 'stranger@example.test', 'Hi', 'Do you do snow?') returning id into m4;
  update ms_threads set contact_email = 'stranger@example.test' where id = t4;
  delete from mail_suggestions where thread_id = t4;
  s4 := mail_suggest_save(m4, '{"intent":"question","action":"cancel","summary":"A question about snow"}');
  if (select action from mail_suggestions where id = s4) <> 'none' then raise exception 'action without a booking'; end if;
  perform mail_suggestion_decide(s4, false, null, null, false);
  if (select status from mail_suggestions where id = s4) <> 'dismissed' then raise exception 'dismiss'; end if;

  -- a personal mailbox's email: Claude isn't asked
  insert into ms_threads (mailbox_id, subject, contact_email, last_dir) values (mybox, 'Hi', 'pal@example.test', 'in') returning id into t4;
  insert into ms_messages (thread_id, dir, status, from_email, subject, text_body) values (t4, 'in', 'received', 'pal@example.test', 'Hi', 'Hi') returning id into m4;
  if mail_suggest_context(m4) is not null then raise exception 'personal mailbox went to Claude'; end if;

  -- the booking json the app reads carries round and refund
  r := mb_booking_json((select b from mb_bookings b where id = b3));
  if (r->>'round')::int <> 2 then raise exception 'booking json: %', r; end if;
  r := mb_booking_json((select b from mb_bookings b where id = b1));
  if not (r->'plan' ? 'prepaid') then raise exception 'plan json: %', r->'plan'; end if;

  -- who can call what
  if has_function_privilege('anon', 'public.mail_suggestion(uuid)', 'execute') or has_function_privilege('authenticated', 'public.mail_suggest_context(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.mail_suggest_save(uuid, jsonb, text)', 'execute')
     or has_function_privilege('authenticated', 'public.mail_booking_brief(mb_bookings, boolean)', 'execute')
     or has_table_privilege('authenticated', 'public.mail_suggestions', 'select')
     or not has_function_privilege('authenticated', 'public.mail_suggestion_decide(uuid, boolean, uuid, text, boolean)', 'execute') then raise exception 'grants'; end if;
  raise notice 'mail AI replies: all good';
end $$;
rollback;
