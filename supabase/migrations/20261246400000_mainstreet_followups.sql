-- MainstreetAI › follow-ups. After a visit with nothing booked, the campaign's follow-up emails come due on a
-- schedule (by default day 1, 4 and 10 after the first visit). Each one shows in the rep's Follow-ups with an
-- email Claude has drafted from the visit, the deck answers and the proposal; the rep checks it and sends it from
-- their own address (with the usual unsubscribe link). A business stops getting them when the owner books,
-- replies or unsubscribes, a rep marks it lost or do not knock, or every step has gone.
-- Only to people who handed over a card or said it's OK to email them (the deck asks); anyone can be marked not OK.
-- Additive only.

alter table public.ms_business_contacts add column if not exists email_ok boolean;   -- null: not asked; card: implied OK

create table if not exists public.ms_followup_steps (
  campaign_id uuid not null references public.ms_campaigns(id),
  day int not null check (day between 0 and 60),
  purpose text not null,
  active boolean not null default true,
  primary key (campaign_id, day)
);
create table if not exists public.ms_followup_settings (
  campaign_id uuid primary key references public.ms_campaigns(id),
  enabled boolean not null default true,
  updated_by uuid references public.app_users(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.ms_followup_sent (
  business_id uuid not null references public.ms_businesses(id),
  campaign_id uuid not null references public.ms_campaigns(id),
  day int not null,
  sent_at timestamptz not null default now(),
  sent_by uuid references public.app_users(id),
  thread_id uuid,
  skipped boolean not null default false,
  primary key (business_id, campaign_id, day)
);
alter table public.ms_followup_steps enable row level security;
alter table public.ms_followup_settings enable row level security;
alter table public.ms_followup_sent enable row level security;

-- a campaign's steps (the defaults until an admin saves their own)
create or replace function public.ms_followup_steps_of(p_campaign uuid)
returns table (day int, purpose text) language sql stable security definer set search_path = public as $$
  select s.day, s.purpose from ms_followup_steps s where s.campaign_id = p_campaign and s.active
  union all
  select d.day, d.purpose from (values (1, 'Thank them for their time and recap their proposal; offer to book the onboarding call.'),
                                       (4, 'A short check-in: answer what they hesitated on, from the visit notes; offer two times for the onboarding call.'),
                                       (10, 'A last short note: no pressure, the door is open; how to book when they''re ready.')) d(day, purpose)
   where not exists (select 1 from ms_followup_steps s where s.campaign_id = p_campaign and s.active)
  order by 1
$$;

-- every business with a follow-up email due now (one at a time: the earliest step not yet sent)
create or replace function public.ms_followups_due_all()
returns table (business_id uuid, campaign_id uuid, rep_id uuid, day int, purpose text, due_at timestamptz,
               contact_name text, contact_email text, step int, steps int)
language sql stable security definer set search_path = public as $$
  with worked as (
    select v.business_id, v.campaign_id, min(v.at) first_at,
           (array_agg(v.rep_id order by v.at desc))[1] rep_id
      from ms_visits v group by 1, 2),
  live as (
    select w.* from worked w
      join ms_businesses b on b.id = w.business_id and b.do_not_knock is null and b.status <> 'closed'
      join ms_campaigns c on c.id = w.campaign_id and c.is_active
     where coalesce((select s.enabled from ms_followup_settings s where s.campaign_id = w.campaign_id), true)
       and (ms_biz_state(w.business_id, w.campaign_id) ->> 'stage') in ('talked', 'pitched')
       -- no reply from them since the first visit
       and not exists (select 1 from ms_threads t join ms_messages m on m.thread_id = t.id
                        where t.business_id = w.business_id and m.dir = 'in' and m.at > w.first_at)),
  who as (
    select l.*, x.name contact_name, x.email contact_email from live l
      cross join lateral (
        select k.name, k.email from ms_business_contacts k
         where k.business_id = l.business_id and k.active and k.email is not null
           and coalesce(k.email_ok, k.source = 'card') and not exists (select 1 from ms_mail_optouts o where o.email = lower(k.email))
         order by k.decides desc, k.updated_at desc limit 1) x)
  select w.business_id, w.campaign_id, w.rep_id, st.day, st.purpose, w.first_at + make_interval(days => st.day), w.contact_name, w.contact_email,
         st.n::int, (select count(*) from ms_followup_steps_of(w.campaign_id))::int
    from who w
    cross join lateral (
      select s.day, s.purpose, row_number() over (order by s.day) n from ms_followup_steps_of(w.campaign_id) s) st
   where w.first_at + make_interval(days => st.day) <= now()
     and not exists (select 1 from ms_followup_sent f where f.business_id = w.business_id and f.campaign_id = w.campaign_id and f.day = st.day)
     and st.day = (select min(s2.day) from ms_followup_steps_of(w.campaign_id) s2
                    where not exists (select 1 from ms_followup_sent f where f.business_id = w.business_id and f.campaign_id = w.campaign_id and f.day = s2.day))
$$;

-- the rep's emails to send today
create or replace function public.ms_rep_followups_due()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('business_id', d.business_id, 'campaign_id', d.campaign_id, 'name', b.name, 'address', b.address,
           'day', d.day, 'purpose', d.purpose, 'due_at', d.due_at, 'contact_name', d.contact_name, 'contact_email', d.contact_email,
           'step', d.step, 'steps', d.steps, 'heat', ms_biz_state(d.business_id, d.campaign_id) ->> 'heat', 'campaign', c.name) order by d.due_at)
      from ms_followups_due_all() d join ms_businesses b on b.id = d.business_id join ms_campaigns c on c.id = d.campaign_id
     where d.rep_id = auth.uid() and ms_rep_can(d.business_id, d.campaign_id)), '[]'::jsonb);
end $$;

-- the rep sent it (or skipped it)
create or replace function public.ms_followup_done(p_business uuid, p_campaign uuid, p_day int, p_thread uuid, p_skipped boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (ms_is_admin() or ms_rep_can(p_business, p_campaign)) then raise exception 'Not allowed'; end if;
  insert into ms_followup_sent (business_id, campaign_id, day, sent_by, thread_id, skipped)
  values (p_business, p_campaign, p_day, auth.uid(), p_thread, coalesce(p_skipped, false))
  on conflict (business_id, campaign_id, day) do nothing;
end $$;

-- OK to email this person, or not
create or replace function public.ms_contact_email_ok(p_id uuid, p_campaign uuid, p_ok boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_biz uuid;
begin
  select business_id into v_biz from ms_business_contacts where id = p_id;
  if v_biz is null then raise exception 'That person is gone'; end if;
  if not (ms_is_admin() or ms_rep_can(v_biz, p_campaign)) then raise exception 'Not allowed'; end if;
  update ms_business_contacts set email_ok = p_ok, updated_at = now() where id = p_id;
end $$;

-- ── admins: the steps, on/off, and how it's going ──
create or replace function public.ms_followup_admin(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'enabled', coalesce((select s.enabled from ms_followup_settings s where s.campaign_id = p_campaign), true),
    'custom', exists (select 1 from ms_followup_steps s where s.campaign_id = p_campaign and s.active),
    'steps', coalesce((select jsonb_agg(jsonb_build_object('day', s.day, 'purpose', s.purpose) order by s.day) from ms_followup_steps_of(p_campaign) s), '[]'::jsonb),
    'sent', (select count(*) from ms_followup_sent f where f.campaign_id = p_campaign and not f.skipped),
    'businesses', (select count(distinct f.business_id) from ms_followup_sent f where f.campaign_id = p_campaign and not f.skipped),
    'replied', (select count(distinct f.business_id) from ms_followup_sent f
                 where f.campaign_id = p_campaign and not f.skipped and exists (
                   select 1 from ms_threads t join ms_messages m on m.thread_id = t.id where t.business_id = f.business_id and m.dir = 'in' and m.at > f.sent_at)),
    'booked', (select count(distinct f.business_id) from ms_followup_sent f
                where f.campaign_id = p_campaign and not f.skipped and exists (
                  select 1 from ms_meetings m where m.business_id = f.business_id and m.campaign_id = f.campaign_id and m.created_at > f.sent_at)),
    'due', coalesce((select jsonb_agg(jsonb_build_object('name', b.name, 'day', d.day, 'step', d.step, 'steps', d.steps, 'due_at', d.due_at,
                       'rep', (select full_name from app_users where id = d.rep_id), 'to', d.contact_name) order by d.due_at)
                     from ms_followups_due_all() d join ms_businesses b on b.id = d.business_id where d.campaign_id = p_campaign), '[]'::jsonb));
end $$;

create or replace function public.ms_followup_save(p_campaign uuid, p_enabled boolean, p_steps jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  insert into ms_followup_settings (campaign_id, enabled, updated_by) values (p_campaign, coalesce(p_enabled, true), auth.uid())
  on conflict (campaign_id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();
  if p_steps is not null then
    if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) = 0 or jsonb_array_length(p_steps) > 8 then raise exception 'Between one and eight steps'; end if;
    -- the steps are replaced: days no longer listed are turned off (kept)
    update ms_followup_steps set active = false where campaign_id = p_campaign
       and day not in (select (x ->> 'day')::int from jsonb_array_elements(p_steps) x);
    for s in select * from jsonb_array_elements(p_steps) loop
      if (s ->> 'day')::int not between 0 and 60 or nullif(trim(coalesce(s ->> 'purpose', '')), '') is null then raise exception 'Each step needs a day (0 to 60) and what it says'; end if;
      insert into ms_followup_steps (campaign_id, day, purpose) values (p_campaign, (s ->> 'day')::int, left(trim(s ->> 'purpose'), 400))
      on conflict (campaign_id, day) do update set purpose = excluded.purpose, active = true;
    end loop;
  end if;
  return ms_followup_admin(p_campaign);
end $$;

-- whether each person said OK to email
create or replace function public.ms_business_contacts_list(p_business uuid, p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (ms_is_admin() or ms_rep_can(p_business, p_campaign)) then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', k.id, 'name', k.name, 'role', k.role, 'title', k.title,
           'phone', k.phone, 'email', k.email, 'decides', case when k.decides then true end, 'best_time', k.best_time,
           'card_photo', k.card_photo, 'source', k.source, 'email_ok', k.email_ok, 'updated_at', k.updated_at))
           order by k.decides desc, k.updated_at desc)
      from ms_business_contacts k where k.business_id = p_business and k.active), '[]'::jsonb);
end $$;

-- the deck's "OK to email you?" goes on the person
create or replace function public.ms_save_deck_answers(p_business uuid, p_campaign uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare a jsonb := p_data -> 'answers'; c jsonb := p_data -> 'contact';
  v_name text; v_role text; v_phone text; v_email text; v_digits text; v_id uuid; v_ok boolean;
begin
  if not (ms_is_admin() or ms_rep_can(p_business, p_campaign)) then raise exception 'Not allowed'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(a) is distinct from 'object' then raise exception 'Those answers aren’t right'; end if;
  if length(p_data::text) > 8000 then raise exception 'Those answers are too long'; end if;
  if not exists (select 1 from ms_businesses where id = p_business) then raise exception 'That business is gone'; end if;
  if a <> '{}'::jsonb then
    insert into ms_business_answers (business_id, campaign_id, data, find, admin_hours, expenses, updated_by)
    values (p_business, p_campaign, p_data,
            coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(a -> 'find') = 'array' then a -> 'find' else '[]'::jsonb end) x), '{}'),
            a ->> 'admin_hours', a ->> 'expenses', auth.uid())
    on conflict (business_id, campaign_id) do update set data = excluded.data, find = excluded.find, admin_hours = excluded.admin_hours,
      expenses = excluded.expenses, updated_by = excluded.updated_by, updated_at = now();
  end if;
  -- the person they're talking to
  if jsonb_typeof(c) = 'object' then
    v_name := left(nullif(trim(coalesce(c ->> 'name', '')), ''), 120);
    v_role := left(nullif(trim(coalesce(c ->> 'role', '')), ''), 40);
    v_phone := left(nullif(trim(coalesce(c ->> 'phone', '')), ''), 40);
    v_email := left(nullif(lower(trim(coalesce(c ->> 'email', ''))), ''), 200);
    v_ok := case when jsonb_typeof(c -> 'email_ok') = 'boolean' then (c ->> 'email_ok')::boolean end;
    v_digits := nullif(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), '');
    if v_name is not null or v_phone is not null or v_email is not null then
      select id into v_id from ms_business_contacts k
       where k.business_id = p_business and k.active
         and ((v_email is not null and lower(k.email) = v_email)
           or (v_digits is not null and length(v_digits) >= 7 and right(regexp_replace(coalesce(k.phone, ''), '[^0-9]', '', 'g'), 10) = right(v_digits, 10))
           or (v_name is not null and lower(k.name) = lower(v_name)))
       order by k.updated_at desc limit 1;
      if v_id is null then
        insert into ms_business_contacts (business_id, campaign_id, name, role, phone, email, email_ok, source, added_by)
        values (p_business, p_campaign, v_name, v_role, v_phone, v_email, v_ok, 'deck', auth.uid());
      else
        update ms_business_contacts set name = coalesce(v_name, name), role = coalesce(v_role, role), phone = coalesce(v_phone, phone),
               email = coalesce(v_email, email), email_ok = coalesce(v_ok, email_ok), updated_at = now() where id = v_id;
      end if;
    end if;
  end if;
end $$;

-- Claude's context for an email gets the deck answers, the proposal, the people and where the business stands
create or replace function public.ms_mail_context(p_thread uuid, p_business uuid, p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_b uuid := p_business; v_c uuid := p_campaign; me app_users;
begin
  if not (ms_is_rep() or ms_is_admin()) then raise exception 'Not allowed'; end if;
  if p_thread is not null then
    if not ms_thread_can(p_thread) then raise exception 'Not allowed'; end if;
    select business_id, campaign_id into v_b, v_c from ms_threads where id = p_thread;
  elsif v_b is not null and not (ms_is_admin() or ms_rep_can(v_b, v_c)) then raise exception 'Not allowed';
  end if;
  select * into me from app_users where id = auth.uid();
  return jsonb_build_object(
    'me', jsonb_build_object('name', me.full_name, 'phone', me.phone, 'code', coalesce(me.rep_code, upper(me.username))),
    'business', (select jsonb_build_object('name', b.name, 'kind', b.kind, 'address', b.address, 'website', b.website) from ms_businesses b where b.id = v_b),
    -- the deck: what the owner answered and the proposal they saw (MainstreetAI › deck questions)
    'deck', (select jsonb_strip_nulls(jsonb_build_object('answers', a.data -> 'summary', 'proposal', a.data -> 'proposal'))
               from ms_business_answers a where a.business_id = v_b and a.campaign_id = v_c),
    'people', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', k.name, 'role', k.role, 'title', k.title,
                 'decides', case when k.decides then true end, 'best_time', k.best_time)) order by k.decides desc, k.updated_at desc)
               from ms_business_contacts k where k.business_id = v_b and k.active), '[]'::jsonb),
    'stage', case when v_b is not null and v_c is not null then ms_biz_state(v_b, v_c) end,
    'campaign', (select jsonb_build_object('name', c.name, 'pitch', c.pitch, 'objections', c.objections, 'info_url', c.info_url, 'notes', c.notes) from ms_campaigns c where c.id = v_c),
    'visits', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('at', v.at, 'outcome', v.outcome, 'notes', v.notes, 'contact', v.contact_name, 'follow_up', v.follow_up_at)) order by v.at desc)
                         from (select * from ms_visits v where v.business_id = v_b and v.campaign_id = v_c order by v.at desc limit 5) v), '[]'::jsonb),
    'thread', case when p_thread is null then null else coalesce((select jsonb_agg(jsonb_build_object('dir', m.dir, 'from', coalesce(m.from_name, m.from_email), 'at', m.at, 'subject', m.subject,
                         'text', left(coalesce(m.text_body, regexp_replace(coalesce(m.html, ''), '<[^>]+>', ' ', 'g')), 4000)) order by m.at)
                         from (select * from ms_messages m where m.thread_id = p_thread order by m.at desc limit 12) m), '[]'::jsonb) end);
end $$;

revoke all on function public.ms_followup_steps_of(uuid), public.ms_followups_due_all() from public, anon, authenticated;
revoke all on function public.ms_rep_followups_due(), public.ms_followup_done(uuid, uuid, int, uuid, boolean), public.ms_contact_email_ok(uuid, uuid, boolean),
  public.ms_followup_admin(uuid), public.ms_followup_save(uuid, boolean, jsonb) from public, anon;
grant execute on function public.ms_rep_followups_due(), public.ms_followup_done(uuid, uuid, int, uuid, boolean), public.ms_contact_email_ok(uuid, uuid, boolean),
  public.ms_followup_admin(uuid), public.ms_followup_save(uuid, boolean, jsonb) to authenticated;
