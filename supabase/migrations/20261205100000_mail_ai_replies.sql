-- RUN_71 — AI replies to customer emails, with one-tap booking changes.
--
-- When a customer answers an email from a centre's customer mailbox (Day before, Next try, a receipt…),
-- Claude reads it with the booking it's about and suggests: a reply, and what to do with the booking.
-- Nothing is sent or changed until someone with the mailbox approves it.
--
--   Delay / not now      → second round: the booking stays open but isn't loaded into first-pass sessions
--                          (sessions are all first round for now); their words are kept as a "next time" note
--   Cancel               → the whole plan and its open bookings are cancelled; prepaid → marked for refund
--   Gate code, dog, …    → added to the booking's field notes (the crew sees them on the map)
--   Thanks / question    → a reply only (or nothing to do)
--
-- ADDITIVE ONLY (new columns, a new table, new functions; mb_booking_json, app_mb_day_bookings, mail_inbox
-- and mail_counts replaced with the same signatures).
--   mb_bookings.round                    1 = first round (default), 2 = second round
--   mb_bookings.refund_requested_at/_note/_by     a prepaid booking cancelled: the office refunds it
--   mb_plans.cancelled_at/_by/cancel_reason, refund_requested_at/_note    the plan itself
--   mail_suggestions                     one per received email: intent, action, the drafted reply, its state
--   mail_suggest_context(message)        (service role) what Claude needs: the email, the conversation, the bookings
--   mail_suggest_save(message, p)        (service role) keep Claude's suggestion
--   mail_suggest_can(message)            may this person ask for a suggestion on this email
--   mail_suggestion(thread)              the latest suggestion in a conversation, with its bookings
--   mail_suggestion_decide(id, apply, booking, note, replied)   approve (do the action), reply only, or dismiss
--   mail_suggestion_undo(id)             undo the booking change (within 15 minutes)
--   mail_inbox: the Inbox shows conversations the customer has written in (just-sent ones stay in Sent);
--               new 'approve' folder: conversations with a suggestion waiting
--   mail_counts: + approve

-- ───────────── bookings and plans ─────────────
alter table public.mb_bookings add column if not exists round int not null default 1;
do $$ begin
  alter table public.mb_bookings add constraint mb_bookings_round_check check (round between 1 and 9);
exception when duplicate_object then null; end $$;
alter table public.mb_bookings add column if not exists refund_requested_at timestamptz;
alter table public.mb_bookings add column if not exists refund_note text;
alter table public.mb_bookings add column if not exists refund_by uuid;
alter table public.mb_plans add column if not exists cancelled_at timestamptz;
alter table public.mb_plans add column if not exists cancelled_by uuid;
alter table public.mb_plans add column if not exists cancel_reason text;
alter table public.mb_plans add column if not exists refund_requested_at timestamptz;
alter table public.mb_plans add column if not exists refund_note text;
create index if not exists mb_bookings_refund on public.mb_bookings (refund_requested_at) where refund_requested_at is not null;

create or replace function public.mb_booking_json(b mb_bookings)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', b.id, 'list_id', b.list_id, 'plan_id', b.plan_id, 'client_id', b.client_id,
    'house_no', b.house_no, 'street_name', b.street_name, 'unit', b.unit, 'city', b.city, 'province', b.province, 'postal_code', b.postal_code,
    'lat', b.lat, 'lng', b.lng, 'sheet_route', b.sheet_route, 'route_code', b.route_code, 'area_name', b.area_name,
    'map_state', b.map_state, 'map_how', b.map_how, 'moved_from', b.moved_from,
    'job_code', b.job_code, 'services', b.services, 'property_type', b.property_type, 'prepaid', b.prepaid,
    'people', b.people, 'phones', to_jsonb(b.phones), 'emails', to_jsonb(b.emails),
    'field_notes', b.field_notes, 'office_notes', b.office_notes, 'status', b.status, 'attempts', b.attempts,
    'done_on', b.done_on, 'done_by', b.done_by, 'done_by_name', b.done_by_name, 'done_services', b.done_services,
    'this_year', b.this_year, 'booked_by', b.booked_by, 'booked_at', b.booked_at, 'source', b.source,
    'created_at', b.created_at, 'updated_at', b.updated_at, 'sent_emails', b.sent_emails,
    'round', b.round, 'refund_requested_at', b.refund_requested_at, 'refund_note', b.refund_note,
    'plan', (select jsonb_build_object('id', p.id, 'kind', p.kind, 'year', p.year, 'price', p.price, 'prepaid', p.prepaid,
                                       'cancelled_at', p.cancelled_at, 'refund_requested_at', p.refund_requested_at) from mb_plans p where p.id = b.plan_id))
$$;
revoke all on function public.mb_booking_json(mb_bookings) from public, anon, authenticated;

-- the day's feed (Start session): first-round bookings only — sessions are all first round for now
create or replace function public.app_mb_day_bookings(p_center uuid, p_routes text[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (coalesce(app_is_super_admin(), false) or coalesce(app_has_perm('workerbook'), false) or coalesce(app_has_perm('bookings'), false))
     or not app_can_see_center(p_center) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'Booking ID', 'mb:' || b.id,
      'Route Number', b.route_code,
      'First Name', coalesce(b.people->0->>'first', ''),
      'Last Name', coalesce(b.people->0->>'last', ''),
      'House Number', b.house_no || coalesce('-' || nullif(b.unit, ''), ''),
      'Street Name', b.street_name,
      'Full Address', trim(b.house_no || ' ' || b.street_name),
      'Home Phone', b.phones[1], 'Cell Phone', b.phones[2], 'Email Address', b.emails[1],
      'Price', nullif(b.job_code, ''),
      'FO/BO/FP', b.property_type,
      'Prepaid', case when b.prepaid then 'x' end,
      'Log Sheet Notes', coalesce(b.field_notes, ''),
      'Status', 'pending',
      'isPrebooked', true,
      'commandCenterId', p_center::text,
      'services', b.services,
      'mb', jsonb_build_object(
        'id', b.id, 'list', l.name, 'jobCode', b.job_code, 'prepaid', b.prepaid,
        'plan', (select case p.kind when 'sp_pro' then 'SP Pro' when 'star_plan' then 'Star Plan' when 'grub' then 'Grub Control'
                                    when 'chafer' then 'Chafer Beetle' when 'sppp' then 'SP Protection Plus' else 'Plan' end from mb_plans p where p.id = b.plan_id),
        'fieldNotes', b.field_notes,
        'attempts', (select coalesce(jsonb_agg(a order by a->>'at' desc), '[]'::jsonb) from (select a from jsonb_array_elements(b.attempts) a order by a->>'at' desc limit 5) z),
        'thisYear', b.this_year,
        'history', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('year', h->>'year', 'service', h->>'service', 'line', h->>'line',
                                                'price', h->>'price', 'contractor', h->>'contractor', 'product', h->>'product'))), '[]'::jsonb)
                      from (select h from clients c, jsonb_array_elements(c.history) h where c.id = b.client_id
                             order by (h->>'year') desc nulls last limit 8) hh),
        'lat', b.lat, 'lng', b.lng))) order by b.route_code, b.street_name, b.house_no)
      from mb_bookings b join mb_lists l on l.id = b.list_id
     where l.center_id = p_center and b.status = 'open' and b.map_state in ('on_map', 'moved') and b.round <= 1
       and upper(b.route_code) = any (select upper(x) from unnest(p_routes) x)), '[]'::jsonb);
end $$;
revoke all on function public.app_mb_day_bookings(uuid, text[]) from public, anon;
grant execute on function public.app_mb_day_bookings(uuid, text[]) to authenticated;

-- ───────────── suggestions ─────────────
create table if not exists public.mail_suggestions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique references public.ms_messages(id) on delete cascade,
  thread_id uuid not null references public.ms_threads(id) on delete cascade,
  booking_id uuid references public.mb_bookings(id) on delete set null,     -- the booking it's about (Claude's pick)
  candidates uuid[] not null default '{}',                                  -- the bookings it could be about
  intent text not null check (intent in ('delay', 'cancel', 'instructions', 'thanks', 'question', 'other')),
  action text not null default 'none' check (action in ('none', 'second_round', 'cancel', 'field_notes')),
  note text,                    -- kept with the action: their words, or the field note
  summary text,                 -- "Ann Lee wants to delay"
  reply_subject text, reply_html text,
  needs_reply boolean not null default true,
  confidence text check (confidence in ('high', 'medium', 'low')),
  status text not null default 'pending' check (status in ('pending', 'done', 'dismissed')),
  model text,
  created_at timestamptz not null default now(),
  decided_at timestamptz, decided_by uuid references public.app_users(id),
  applied text,                 -- the action that was done, if any
  replied boolean,
  undo jsonb,                   -- what the bookings and plan were before
  undone_at timestamptz
);
create index if not exists mail_suggestions_thread on public.mail_suggestions (thread_id, created_at desc);
create index if not exists mail_suggestions_pending on public.mail_suggestions (thread_id) where status = 'pending';
alter table public.mail_suggestions enable row level security;
revoke all on public.mail_suggestions from anon, authenticated;

-- a booking, as the card and Claude see it
create or replace function public.mail_booking_brief(b mb_bookings, p_linked boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', b.id, 'linked', p_linked,
    'name', nullif(trim(concat_ws(' ', b.people->0->>'first', b.people->0->>'last')), ''),
    'address', trim(b.house_no || coalesce('-' || nullif(b.unit, ''), '') || ' ' || b.street_name) || coalesce(', ' || nullif(b.city, ''), ''),
    'list', l.name, 'year', l.year, 'job', nullif(b.job_code, ''), 'services', b.services,
    'status', b.status, 'round', b.round, 'done_on', b.done_on, 'prepaid', b.prepaid,
    'refund_requested', b.refund_requested_at is not null, 'field_notes', b.field_notes,
    'tries', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('day', a->>'day', 'kind', a->>'kind', 'reason', a->>'reason', 'note', a->>'note')))
                from (select a from jsonb_array_elements(b.attempts) a order by a->>'at' desc limit 3) z),
    'emailed', (select jsonb_agg(e->>'kind') from (select e from jsonb_array_elements(b.sent_emails) e order by e->>'at' desc limit 3) z),
    'plan', (select jsonb_strip_nulls(jsonb_build_object(
               'kind', case p.kind when 'sp_pro' then 'SP Pro' when 'star_plan' then 'Star Plan' when 'grub' then 'Grub Control'
                                   when 'chafer' then 'Chafer Beetle' when 'sppp' then 'SP Protection Plus' else 'Plan' end,
               'prepaid', p.prepaid, 'cancelled', p.cancelled_at is not null,
               'open_bookings', (select count(*) from mb_bookings o where o.plan_id = p.id and o.status = 'open')))
             from mb_plans p where p.id = b.plan_id)))
    from mb_lists l where l.id = b.list_id
$$;
revoke all on function public.mail_booking_brief(mb_bookings, boolean) from public, anon, authenticated;

-- the bookings an email could be about: the ones that were emailed in this conversation; else the
-- centre's bookings with the sender's email address (open first, newest list first)
create or replace function public.mail_suggest_bookings(p_thread uuid, p_from text, p_center uuid)
returns table (booking mb_bookings, linked boolean) language sql stable security definer set search_path = public as $$
  with linked as (
    select b from mb_bookings b where b.sent_emails @> jsonb_build_array(jsonb_build_object('thread_id', p_thread))
  )
  select l.b, true from linked l
  union all
  select b, false from (
    select b from mb_bookings b join mb_lists ls on ls.id = b.list_id
     where not exists (select 1 from linked) and p_center is not null and ls.center_id = p_center
       and nullif(lower(trim(p_from)), '') is not null and lower(trim(p_from)) = any (select lower(trim(x)) from unnest(b.emails) x)
     order by (b.status = 'open') desc, ls.year desc, b.updated_at desc
     limit 5) x
$$;
revoke all on function public.mail_suggest_bookings(uuid, text, uuid) from public, anon, authenticated;

-- (service role) what Claude needs for one received email; null when it isn't a customer's email to a centre's mailbox
create or replace function public.mail_suggest_context(p_message uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m ms_messages; t ms_threads; bx mail_boxes; cc command_centers;
begin
  select * into m from ms_messages where id = p_message;
  if m.id is null or m.dir <> 'in' then return null; end if;
  select * into t from ms_threads where id = m.thread_id;
  select * into bx from mail_boxes where id = t.mailbox_id and active;
  if bx.id is null or bx.role is distinct from 'client' then return null; end if;
  select * into cc from command_centers where id = bx.center_id;
  return jsonb_build_object(
    'message_id', m.id, 'thread_id', t.id,
    'mailbox', bx.label, 'centre', cc.display_name,
    'email', jsonb_build_object('from', m.from_email, 'name', m.from_name, 'subject', m.subject, 'at', m.at,
               'text', left(coalesce(nullif(m.text_body, ''), regexp_replace(coalesce(m.html, ''), '<[^>]+>', ' ', 'g')), 6000)),
    'conversation', coalesce((select jsonb_agg(jsonb_build_object('dir', x.dir, 'at', x.at, 'subject', x.subject,
                       'text', left(coalesce(nullif(x.text_body, ''), regexp_replace(coalesce(x.html, ''), '<[^>]+>', ' ', 'g')), 2500)) order by x.at)
                     from (select * from ms_messages x where x.thread_id = t.id and x.id <> m.id and x.at <= m.at order by x.at desc limit 6) x), '[]'::jsonb),
    'bookings', coalesce((select jsonb_agg(mail_booking_brief(s.booking, s.linked)) from mail_suggest_bookings(t.id, m.from_email, bx.center_id) s), '[]'::jsonb));
end $$;
revoke all on function public.mail_suggest_context(uuid) from public, anon, authenticated;

-- (service role) keep Claude's suggestion (replacing a pending one for the same email)
create or replace function public.mail_suggest_save(p_message uuid, p jsonb, p_model text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare m ms_messages; t ms_threads; bx mail_boxes; cands uuid[]; pick uuid; v_intent text; v_action text; v_id uuid;
begin
  select * into m from ms_messages where id = p_message and dir = 'in';
  if m.id is null then raise exception 'No such email'; end if;
  select * into t from ms_threads where id = m.thread_id;
  select * into bx from mail_boxes where id = t.mailbox_id;
  select coalesce(array_agg((s.booking).id), '{}') into cands from mail_suggest_bookings(t.id, m.from_email, bx.center_id) s;
  begin pick := nullif(p->>'booking_id', '')::uuid; exception when others then pick := null; end;
  if pick is null or not (pick = any (cands)) then pick := case when cardinality(cands) = 1 then cands[1] end; end if;
  v_intent := case when p->>'intent' in ('delay', 'cancel', 'instructions', 'thanks', 'question', 'other') then p->>'intent' else 'other' end;
  v_action := case when p->>'action' in ('second_round', 'cancel', 'field_notes') and cardinality(cands) > 0 then p->>'action' else 'none' end;
  insert into mail_suggestions (message_id, thread_id, booking_id, candidates, intent, action, note, summary, reply_subject, reply_html,
                                needs_reply, confidence, model)
  values (m.id, t.id, pick, cands, v_intent, v_action, left(nullif(trim(p->>'note'), ''), 1000), left(nullif(trim(p->>'summary'), ''), 200),
          left(nullif(trim(p->>'reply_subject'), ''), 200), left(nullif(p->>'reply_html', ''), 20000),
          coalesce((p->>'needs_reply')::boolean, true),
          case when p->>'confidence' in ('high', 'medium', 'low') then p->>'confidence' end, left(p_model, 80))
  on conflict (message_id) do update set
    booking_id = excluded.booking_id, candidates = excluded.candidates, intent = excluded.intent, action = excluded.action, note = excluded.note,
    summary = excluded.summary, reply_subject = excluded.reply_subject, reply_html = excluded.reply_html, needs_reply = excluded.needs_reply,
    confidence = excluded.confidence, model = excluded.model, created_at = now()
    where mail_suggestions.status = 'pending'
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.mail_suggest_save(uuid, jsonb, text) from public, anon, authenticated;

-- may this person ask Claude about this email ("Suggest again")
create or replace function public.mail_suggest_can(p_message uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ms_messages m join ms_threads t on t.id = m.thread_id join mail_boxes b on b.id = t.mailbox_id
                  where m.id = p_message and m.dir = 'in' and b.role = 'client' and ms_thread_can(t.id))
$$;
revoke all on function public.mail_suggest_can(uuid) from public, anon;
grant execute on function public.mail_suggest_can(uuid) to authenticated;

-- may this person change this booking (Master Bookings write access)
create or replace function public.mail_booking_can_write(p_booking uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select list_id into v from mb_bookings where id = p_booking;
  if v is null then return false; end if;
  perform mb_list_ok(v, true);
  return true;
exception when others then return false;
end $$;
revoke all on function public.mail_booking_can_write(uuid) from public, anon, authenticated;

-- the latest suggestion in a conversation (pending, or decided in the last 15 minutes so it can be undone)
create or replace function public.mail_suggestion(p_thread uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s mail_suggestions;
begin
  if not ms_thread_can(p_thread) then raise exception 'Not allowed'; end if;
  select * into s from mail_suggestions
   where thread_id = p_thread and (status = 'pending' or (decided_at > now() - interval '15 minutes' and undo is not null and undone_at is null))
   order by created_at desc limit 1;
  if s.id is null then return null; end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'id', s.id, 'message_id', s.message_id, 'intent', s.intent, 'action', s.action, 'note', s.note, 'summary', s.summary,
    'reply_subject', s.reply_subject, 'reply_html', s.reply_html, 'needs_reply', s.needs_reply, 'confidence', s.confidence,
    'status', s.status, 'applied', s.applied, 'replied', s.replied, 'decided_at', s.decided_at, 'booking_id', s.booking_id,
    'bookings', (select jsonb_agg(mail_booking_brief(b, b.sent_emails @> jsonb_build_array(jsonb_build_object('thread_id', s.thread_id)))
                                  || jsonb_build_object('can_change', mail_booking_can_write(b.id)) order by b.id = s.booking_id desc)
                   from mb_bookings b where b.id = any (s.candidates))));
end $$;
revoke all on function public.mail_suggestion(uuid) from public, anon;
grant execute on function public.mail_suggestion(uuid) to authenticated;

-- approve (apply the action), reply only, or dismiss. The reply itself is sent by the app (ms-mail) first.
create or replace function public.mail_suggestion_decide(p_id uuid, p_apply boolean, p_booking uuid default null, p_note text default null, p_replied boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s mail_suggestions; b mb_bookings; pl mb_plans; me text; v_note text; v_day text; v_try jsonb; v_undo jsonb := null;
        v_ids uuid[] := '{}'; v_refund boolean := false; v_n int := 0;
begin
  select * into s from mail_suggestions where id = p_id for update;
  if s.id is null or not ms_thread_can(s.thread_id) then raise exception 'Not allowed'; end if;
  if s.status <> 'pending' then raise exception 'This one was already handled'; end if;
  select coalesce(nullif(full_name, ''), username) into me from app_users where id = auth.uid();
  v_note := left(nullif(trim(coalesce(p_note, s.note, '')), ''), 1000);

  if p_apply and s.action <> 'none' then
    select * into b from mb_bookings where id = coalesce(p_booking, s.booking_id) and id = any (s.candidates) for update;
    if b.id is null then raise exception 'Pick which booking this is about'; end if;
    perform mb_list_ok(b.list_id, true);
    if s.action in ('second_round', 'cancel') and b.status <> 'open' then
      raise exception 'That booking is already %', case b.status when 'done' then 'done' else 'cancelled' end;
    end if;
    if b.plan_id is not null then select * into pl from mb_plans where id = b.plan_id for update; end if;
    v_day := (now() at time zone 'America/Vancouver')::date::text;

    if s.action = 'cancel' then
      -- the whole plan: this booking and the plan's other open bookings
      select array_agg(id) into v_ids from mb_bookings
       where id = b.id or (b.plan_id is not null and plan_id = b.plan_id and status = 'open');
    else
      v_ids := array[b.id];
    end if;
    v_undo := jsonb_build_object(
      'bookings', (select jsonb_agg(jsonb_build_object('id', x.id, 'status', x.status, 'round', x.round, 'attempts', x.attempts, 'field_notes', x.field_notes,
                                    'refund_requested_at', x.refund_requested_at, 'refund_note', x.refund_note, 'refund_by', x.refund_by, 'updated_at', x.updated_at))
                     from mb_bookings x where x.id = any (v_ids)),
      'plan', case when pl.id is not null then jsonb_build_object('id', pl.id, 'cancelled_at', pl.cancelled_at, 'cancelled_by', pl.cancelled_by,
                    'cancel_reason', pl.cancel_reason, 'refund_requested_at', pl.refund_requested_at, 'refund_note', pl.refund_note) end);

    if s.action = 'second_round' then
      v_try := jsonb_strip_nulls(jsonb_build_object('day', v_day, 'kind', 'next_time', 'by', 'Email reply', 'reason', 'Customer asked to delay', 'note', v_note, 'at', now()));
      update mb_bookings set round = greatest(round, 2), attempts = attempts || v_try, updated_at = now(), updated_by = auth.uid() where id = b.id;
      v_n := 1;
    elsif s.action = 'cancel' then
      v_try := jsonb_strip_nulls(jsonb_build_object('day', v_day, 'kind', 'cancelled', 'by', 'Email reply', 'reason', 'Customer cancelled by email', 'note', v_note, 'at', now()));
      v_refund := b.prepaid or coalesce(pl.prepaid, false);
      update mb_bookings set status = 'cancelled', attempts = attempts || v_try, updated_at = now(), updated_by = auth.uid(),
             refund_requested_at = case when prepaid or coalesce(pl.prepaid, false) then coalesce(refund_requested_at, now()) else refund_requested_at end,
             refund_note = case when prepaid or coalesce(pl.prepaid, false) then coalesce(refund_note, 'Prepaid; cancelled by email') else refund_note end,
             refund_by = case when prepaid or coalesce(pl.prepaid, false) then coalesce(refund_by, auth.uid()) else refund_by end
       where id = any (v_ids);
      get diagnostics v_n = row_count;
      if pl.id is not null then
        update mb_plans set cancelled_at = coalesce(cancelled_at, now()), cancelled_by = coalesce(cancelled_by, auth.uid()),
               cancel_reason = coalesce(cancel_reason, 'Customer cancelled by email' || coalesce(': ' || v_note, '')),
               refund_requested_at = case when prepaid then coalesce(refund_requested_at, now()) else refund_requested_at end,
               refund_note = case when prepaid then coalesce(refund_note, 'Prepaid; cancelled by email') else refund_note end
         where id = pl.id;
      end if;
    elsif s.action = 'field_notes' then
      if v_note is null then raise exception 'There''s no note to add'; end if;
      update mb_bookings set field_notes = concat_ws(' · ', nullif(trim(field_notes), ''), v_note), updated_at = now(), updated_by = auth.uid() where id = b.id;
      v_n := 1;
    end if;
  end if;

  update mail_suggestions set
    status = case when (p_apply and s.action <> 'none') or p_replied then 'done' else 'dismissed' end,
    decided_at = now(), decided_by = auth.uid(), replied = p_replied,
    applied = case when p_apply and s.action <> 'none' then s.action end,
    booking_id = coalesce(b.id, booking_id), note = coalesce(v_note, note), undo = v_undo
   where id = s.id;
  return jsonb_strip_nulls(jsonb_build_object('applied', case when p_apply and s.action <> 'none' then s.action end,
    'bookings', v_n, 'refund', v_refund, 'by', me));
end $$;
revoke all on function public.mail_suggestion_decide(uuid, boolean, uuid, text, boolean) from public, anon;
grant execute on function public.mail_suggestion_decide(uuid, boolean, uuid, text, boolean) to authenticated;

-- undo the booking change (within 15 minutes; a reply that was sent stays sent)
create or replace function public.mail_suggestion_undo(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s mail_suggestions; x jsonb; p jsonb; v_list uuid;
begin
  select * into s from mail_suggestions where id = p_id for update;
  if s.id is null or not ms_thread_can(s.thread_id) then raise exception 'Not allowed'; end if;
  if s.undo is null or s.undone_at is not null then raise exception 'There''s nothing to undo'; end if;
  if s.decided_at < now() - interval '15 minutes' then raise exception 'It''s too late to undo this here; change the booking in Master Bookings'; end if;
  for x in select * from jsonb_array_elements(coalesce(s.undo->'bookings', '[]'::jsonb)) loop
    select list_id into v_list from mb_bookings where id = (x->>'id')::uuid;
    if v_list is not null then perform mb_list_ok(v_list, true); end if;
    update mb_bookings set status = x->>'status', round = (x->>'round')::int, attempts = x->'attempts', field_notes = x->>'field_notes',
           refund_requested_at = (x->>'refund_requested_at')::timestamptz, refund_note = x->>'refund_note', refund_by = (x->>'refund_by')::uuid,
           updated_at = now(), updated_by = auth.uid()
     where id = (x->>'id')::uuid;
  end loop;
  p := s.undo->'plan';
  if p is not null and jsonb_typeof(p) = 'object' then
    update mb_plans set cancelled_at = (p->>'cancelled_at')::timestamptz, cancelled_by = (p->>'cancelled_by')::uuid, cancel_reason = p->>'cancel_reason',
           refund_requested_at = (p->>'refund_requested_at')::timestamptz, refund_note = p->>'refund_note'
     where id = (p->>'id')::uuid;
  end if;
  update mail_suggestions set undone_at = now(), applied = null,
         status = case when coalesce(replied, false) then 'done' else 'pending' end,
         decided_at = case when coalesce(replied, false) then decided_at end, decided_by = case when coalesce(replied, false) then decided_by end
   where id = s.id;
  return jsonb_build_object('undone', true);
end $$;
revoke all on function public.mail_suggestion_undo(uuid) from public, anon;
grant execute on function public.mail_suggestion_undo(uuid) to authenticated;

-- ───────────── the folders ─────────────
-- Inbox: conversations the customer (or a colleague) has written in. Sent-only conversations (a campaign,
-- receipts) stay in Sent until someone answers. To approve: a suggestion is waiting.
create or replace function public.mail_inbox(p_box uuid default null, p_folder text default 'inbox', p_search text default null, p_limit int default 60, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(coalesce(p_search, '')), ''); mine uuid[] := mail_my_box_ids();
begin
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', t.id, 'subject', t.subject, 'snippet', t.last_snippet, 'last_at', t.last_at, 'last_dir', t.last_dir,
             'messages', t.messages, 'unread', t.unread, 'starred', t.starred, 'archived', t.archived,
             'contact_email', t.contact_email, 'contact_name', t.contact_name, 'mailbox', b.local || '@propertystars.app', 'mailbox_label', b.label,
             'suggestion', (select s.summary from mail_suggestions s where s.thread_id = t.id and s.status = 'pending' order by s.created_at desc limit 1)))
           order by t.last_at desc)
      from (select t.* from ms_threads t
             where t.mailbox_id = any (mine) and (p_box is null or t.mailbox_id = p_box)
               and (p_before is null or t.last_at < p_before)
               and case coalesce(p_folder, 'inbox')
                     when 'inbox' then not t.archived and (q is not null or exists (select 1 from ms_messages m where m.thread_id = t.id and m.dir = 'in'))
                     when 'unread' then t.unread > 0 and not t.archived
                     when 'starred' then t.starred
                     when 'sent' then exists (select 1 from ms_messages m where m.thread_id = t.id and m.dir = 'out'
                                                and (q is not null or m.batch_key is null))
                     when 'archived' then t.archived
                     when 'approve' then exists (select 1 from mail_suggestions s where s.thread_id = t.id and s.status = 'pending')
                     else true end
               and (q is null or t.subject ilike '%' || q || '%' or t.contact_email ilike '%' || q || '%' or t.contact_name ilike '%' || q || '%'
                    or exists (select 1 from ms_messages m where m.thread_id = t.id and (m.text_body ilike '%' || q || '%' or m.snippet ilike '%' || q || '%')))
             order by t.last_at desc
             limit least(greatest(coalesce(p_limit, 60), 1), 200)) t
      join mail_boxes b on b.id = t.mailbox_id), '[]'::jsonb);
end $$;

create or replace function public.mail_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'unread', (select count(*) from ms_threads t where t.mailbox_id = any (mail_my_box_ids()) and t.unread > 0 and not t.archived),
    'approve', (select count(distinct s.thread_id) from mail_suggestions s join ms_threads t on t.id = s.thread_id
                 where s.status = 'pending' and t.mailbox_id = any (mail_my_box_ids())))
$$;
