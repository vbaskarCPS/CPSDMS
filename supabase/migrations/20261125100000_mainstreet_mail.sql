-- RUN_64 — MainstreetAI mail: an inbox in the rep app, sent and received through Resend.
--
--   Conversations belong to the business, not the rep. A rep sees the conversations of the businesses
--   they're assigned (zone + campaign) and the ones they started for their own leads. Reassign the
--   zone and the conversations go with it. Admins see everything, including mail that couldn't be
--   matched to a business ("unsorted").
--   Sending: from mainstreetai@propertystars.app, with a reply address made for the conversation
--   (c-<token>@reply.propertystars.app), so a reply lands in the right place. The ms-mail function
--   sends (ms_mail_prepare checks, ms_mail_sent records); ms-mail-inbound receives Resend's webhook
--   (ms_mail_inbound files it). Unsubscribes (CASL) are kept in ms_mail_optouts and stop further mail.
-- Additive: new tables and functions only.

create table if not exists public.ms_threads (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default lower(encode(extensions.gen_random_bytes(9), 'hex')),
  business_id uuid references public.ms_businesses(id) on delete set null,
  campaign_id uuid references public.ms_campaigns(id),
  subject text not null default '',
  contact_email text,
  contact_name text,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  last_dir text not null default 'out' check (last_dir in ('in', 'out')),
  last_snippet text,
  messages int not null default 0,
  unread int not null default 0,          -- received messages not opened yet
  starred boolean not null default false,
  archived boolean not null default false
);
create index if not exists ms_threads_business on public.ms_threads (business_id, last_at desc);
create index if not exists ms_threads_last on public.ms_threads (last_at desc);
create index if not exists ms_threads_contact on public.ms_threads (lower(contact_email));

create table if not exists public.ms_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.ms_threads(id) on delete cascade,
  dir text not null check (dir in ('in', 'out')),
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'received')),
  from_email text, from_name text,
  to_emails text[] not null default '{}', cc_emails text[] not null default '{}',
  subject text, html text, text_body text, snippet text,
  attachments jsonb not null default '[]'::jsonb,   -- [{name, type, size, path}] in the ms-mail bucket
  sent_by uuid references public.app_users(id),
  resend_id text, message_id text, in_reply_to text,
  error text,
  at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists ms_messages_thread on public.ms_messages (thread_id, at);
create unique index if not exists ms_messages_resend on public.ms_messages (resend_id) where resend_id is not null;

create table if not exists public.ms_mail_optouts (
  email text primary key,
  at timestamptz not null default now(),
  source text
);

alter table public.ms_threads enable row level security;
alter table public.ms_messages enable row level security;
alter table public.ms_mail_optouts enable row level security;
revoke all on public.ms_threads, public.ms_messages, public.ms_mail_optouts from anon, authenticated;

-- attachments: a private bucket; the functions write, the app reads through signed links
insert into storage.buckets (id, name, public, file_size_limit)
values ('ms-mail', 'ms-mail', false, 26214400)
on conflict (id) do nothing;
-- may this person see this conversation
create or replace function public.ms_thread_can(p_thread uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select ms_is_admin() or exists (
    select 1 from ms_threads t
     where t.id = p_thread and ms_is_rep()
       and ((t.business_id is not null and t.campaign_id is not null and ms_rep_can(t.business_id, t.campaign_id))
            or (t.business_id is null and t.created_by = auth.uid())))
$$;
revoke all on function public.ms_thread_can(uuid) from public, anon, authenticated;

-- received attachments live at in/<thread>/<message>/<file>
create or replace function public.ms_mail_can_path(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select ms_thread_can(((storage.foldername(p_name))[2])::uuid)
                    where (storage.foldername(p_name))[2] ~ '^[0-9a-f-]{36}$'), false)
$$;
revoke all on function public.ms_mail_can_path(text) from public, anon;
grant execute on function public.ms_mail_can_path(text) to authenticated;

-- storage policies (after ms_mail_can_path exists)
drop policy if exists ms_mail_upload on storage.objects;
create policy ms_mail_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'ms-mail' and (storage.foldername(name))[1] = 'out' and (storage.foldername(name))[2] = auth.uid()::text
              and (public.ms_is_rep() or public.ms_is_admin()));
drop policy if exists ms_mail_read on storage.objects;
create policy ms_mail_read on storage.objects for select to authenticated
  using (bucket_id = 'ms-mail' and (public.ms_is_admin()
         or ((storage.foldername(name))[1] = 'out' and (storage.foldername(name))[2] = auth.uid()::text)
         or ((storage.foldername(name))[1] = 'in' and public.ms_mail_can_path(name))));

create or replace function public.ms_mail_snippet(p text)
returns text language sql immutable set search_path = public as $$
  select left(regexp_replace(regexp_replace(coalesce(p, ''), '<[^>]+>', ' ', 'g'), '\s+', ' ', 'g'), 160)
$$;

-- ───────────── the inbox ─────────────
-- p_box: 'inbox' (not archived), 'unread', 'starred', 'sent' (last from us), 'archived', 'unsorted' (admins)
create or replace function public.ms_inbox(p_box text default 'inbox', p_search text default null, p_business uuid default null, p_limit int default 60, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not (ms_is_rep() or ms_is_admin()) then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', t.id, 'subject', t.subject, 'snippet', t.last_snippet, 'last_at', t.last_at, 'last_dir', t.last_dir,
             'messages', t.messages, 'unread', t.unread, 'starred', t.starred, 'archived', t.archived,
             'contact_email', t.contact_email, 'contact_name', t.contact_name,
             'business_id', t.business_id, 'business', b.name, 'campaign_id', t.campaign_id, 'campaign', c.name, 'color', c.color,
             'zone', z.name, 'rep', (select u.full_name from ms_zone_campaigns zc join app_users u on u.id = zc.rep_id
                                      where zc.zone_id = b.zone_id and zc.campaign_id = t.campaign_id limit 1)))
           order by t.last_at desc)
      from (select t.* from ms_threads t
             where ms_thread_can(t.id)
               and (p_business is null or t.business_id = p_business)
               and (p_before is null or t.last_at < p_before)
               and case coalesce(p_box, 'inbox')
                     when 'inbox' then not t.archived
                     when 'unread' then t.unread > 0 and not t.archived
                     when 'starred' then t.starred
                     when 'sent' then exists (select 1 from ms_messages m where m.thread_id = t.id and m.dir = 'out')
                     when 'archived' then t.archived
                     when 'unsorted' then t.business_id is null and ms_is_admin()
                     else true end
               and (q is null or t.subject ilike '%' || q || '%' or t.contact_email ilike '%' || q || '%' or t.contact_name ilike '%' || q || '%'
                    or exists (select 1 from ms_businesses bb where bb.id = t.business_id and bb.name ilike '%' || q || '%')
                    or exists (select 1 from ms_messages m where m.thread_id = t.id and (m.text_body ilike '%' || q || '%' or m.snippet ilike '%' || q || '%')))
             order by t.last_at desc
             limit least(greatest(coalesce(p_limit, 60), 1), 200)) t
      left join ms_businesses b on b.id = t.business_id
      left join ms_campaigns c on c.id = t.campaign_id
      left join ms_zones z on z.id = b.zone_id), '[]'::jsonb);
end $$;

create or replace function public.ms_inbox_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'unread', (select count(*) from ms_threads t where t.unread > 0 and not t.archived and ms_thread_can(t.id)),
    'unsorted', case when ms_is_admin() then (select count(*) from ms_threads t where t.business_id is null) else 0 end)
  where ms_is_rep() or ms_is_admin()
$$;

-- one conversation; opening it marks it read
create or replace function public.ms_thread(p_thread uuid, p_mark_read boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t ms_threads;
begin
  if not ms_thread_can(p_thread) then raise exception 'Not allowed'; end if;
  if p_mark_read then
    update ms_messages set read_at = now() where thread_id = p_thread and dir = 'in' and read_at is null;
    update ms_threads set unread = 0 where id = p_thread and unread > 0;
  end if;
  select * into t from ms_threads where id = p_thread;
  return jsonb_build_object(
    'id', t.id, 'subject', t.subject, 'contact_email', t.contact_email, 'contact_name', t.contact_name, 'starred', t.starred, 'archived', t.archived,
    'business', (select jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address, 'kind', b.kind, 'phone', b.phone) from ms_businesses b where b.id = t.business_id),
    'campaign', (select jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color) from ms_campaigns c where c.id = t.campaign_id),
    'opted_out', exists (select 1 from ms_mail_optouts o where o.email = lower(t.contact_email)),
    'messages', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', m.id, 'dir', m.dir, 'status', m.status, 'from_email', m.from_email, 'from_name', m.from_name, 'to', to_jsonb(m.to_emails),
        'cc', case when cardinality(m.cc_emails) > 0 then to_jsonb(m.cc_emails) end, 'subject', m.subject, 'html', m.html, 'text', m.text_body,
        'attachments', case when jsonb_array_length(m.attachments) > 0 then m.attachments end, 'at', m.at, 'error', m.error,
        'by', (select u.full_name from app_users u where u.id = m.sent_by))) order by m.at)
      from ms_messages m where m.thread_id = t.id), '[]'::jsonb));
end $$;

create or replace function public.ms_thread_flag(p_thread uuid, p_starred boolean default null, p_archived boolean default null, p_unread boolean default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_thread_can(p_thread) then raise exception 'Not allowed'; end if;
  update ms_threads set starred = coalesce(p_starred, starred), archived = coalesce(p_archived, archived),
         unread = case when p_unread is true then greatest(unread, 1) when p_unread is false then 0 else unread end
   where id = p_thread;
end $$;

-- admins file an unsorted conversation under a business
create or replace function public.ms_thread_file(p_thread uuid, p_business uuid, p_campaign uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from ms_businesses where id = p_business) or not exists (select 1 from ms_campaigns where id = p_campaign) then raise exception 'Pick the business and campaign'; end if;
  update ms_threads set business_id = p_business, campaign_id = p_campaign where id = p_thread;
end $$;

-- ───────────── sending (the ms-mail function calls these) ─────────────
-- as the rep: checks, writes the message as "sending", returns what the function needs to send it
create or replace function public.ms_mail_prepare(
  p_thread uuid, p_business uuid, p_campaign uuid, p_to text[], p_cc text[], p_subject text, p_html text, p_text text, p_attachments jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t ms_threads; v_id uuid; me app_users; e text; v_to text[]; v_cc text[]; last_in ms_messages; c ms_campaigns; a jsonb;
begin
  if not (ms_is_rep() or ms_is_admin()) then raise exception 'Not allowed'; end if;
  select * into me from app_users where id = auth.uid();
  v_to := array(select distinct lower(trim(x)) from unnest(coalesce(p_to, '{}')) x where trim(x) <> '');
  v_cc := array(select distinct lower(trim(x)) from unnest(coalesce(p_cc, '{}')) x where trim(x) <> '' and lower(trim(x)) <> all (v_to));
  if cardinality(v_to) = 0 then raise exception 'Who is it to?'; end if;
  if cardinality(v_to) + cardinality(v_cc) > 10 then raise exception 'Up to 10 people per email'; end if;
  foreach e in array v_to || v_cc loop
    if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception '% isn’t an email address', e; end if;
    if exists (select 1 from ms_mail_optouts o where o.email = e) then raise exception '% unsubscribed, so they can’t be emailed', e; end if;
  end loop;
  if nullif(trim(coalesce(p_subject, '')), '') is null then raise exception 'Add a subject'; end if;
  if nullif(trim(coalesce(p_text, '')), '') is null and nullif(trim(coalesce(p_html, '')), '') is null then raise exception 'The email is empty'; end if;
  for a in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    if coalesce(a->>'path', '') !~ ('^out/' || auth.uid()::text || '/') then raise exception 'An attachment isn’t yours'; end if;
  end loop;

  if p_thread is not null then
    if not ms_thread_can(p_thread) then raise exception 'Not allowed'; end if;
    select * into t from ms_threads where id = p_thread;
  else
    if p_business is not null then
      if p_campaign is null then raise exception 'Which campaign?'; end if;
      if not (ms_is_admin() or ms_rep_can(p_business, p_campaign)) then raise exception 'Not allowed'; end if;
    end if;
    insert into ms_threads (business_id, campaign_id, subject, contact_email, created_by)
    values (p_business, p_campaign, trim(p_subject), v_to[1], auth.uid()) returning * into t;
  end if;
  select * into c from ms_campaigns where id = t.campaign_id;
  select * into last_in from ms_messages where thread_id = t.id and dir = 'in' order by at desc limit 1;

  insert into ms_messages (thread_id, dir, status, from_email, from_name, to_emails, cc_emails, subject, html, text_body, snippet, attachments, sent_by, in_reply_to)
  values (t.id, 'out', 'sending', 'mainstreetai@propertystars.app', me.full_name, v_to, v_cc, trim(p_subject), p_html, p_text,
          ms_mail_snippet(coalesce(p_text, p_html)), coalesce(p_attachments, '[]'::jsonb), auth.uid(), last_in.message_id)
  returning id into v_id;

  return jsonb_build_object('message_id', v_id, 'thread_id', t.id, 'token', t.token, 'to', to_jsonb(v_to), 'cc', to_jsonb(v_cc),
    'subject', trim(p_subject), 'html', p_html, 'text', p_text, 'attachments', coalesce(p_attachments, '[]'::jsonb),
    'sender_name', trim(me.full_name || coalesce(' · ' || c.name, '') || ' via MainstreetAI'),
    'sender_first', split_part(me.full_name, ' ', 1), 'sender_phone', me.phone, 'campaign', c.name,
    'in_reply_to', last_in.message_id,
    'first_contact', not exists (select 1 from ms_messages m where m.thread_id = t.id and m.id <> v_id));
end $$;

-- service role: what Resend said
create or replace function public.ms_mail_sent(p_message uuid, p_resend_id text, p_error text)
returns void language plpgsql security definer set search_path = public as $$
declare m ms_messages;
begin
  update ms_messages set status = case when p_error is null then 'sent' else 'failed' end, resend_id = p_resend_id, error = p_error, at = now()
   where id = p_message returning * into m;
  if p_error is null then
    update ms_threads set last_at = now(), last_dir = 'out', last_snippet = m.snippet, messages = messages + 1, archived = false
     where id = m.thread_id;
  end if;
end $$;
revoke all on function public.ms_mail_sent(uuid, text, text) from public, anon, authenticated;

-- ───────────── receiving (service role, from ms-mail-inbound) ─────────────
create or replace function public.ms_mail_inbound(
  p_resend_id text, p_from text, p_from_name text, p_to text[], p_cc text[], p_subject text, p_html text, p_text text,
  p_message_id text, p_in_reply_to text, p_attachments jsonb, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_token text; t ms_threads; v_id uuid; v_from text := lower(trim(coalesce(p_from, ''))); b ms_businesses; zc record; v_sub text;
begin
  if exists (select 1 from ms_messages where resend_id = p_resend_id) then
    return jsonb_build_object('again', true);
  end if;
  -- 1. the conversation's own reply address
  select substring(lower(x) from '^c-([0-9a-f]+)@') into v_token from unnest(coalesce(p_to, '{}') || coalesce(p_cc, '{}')) x
   where lower(x) ~ '^c-[0-9a-f]+@' limit 1;
  if v_token is not null then select * into t from ms_threads where token = v_token; end if;
  -- 2. an answer to one of our messages
  if t.id is null and p_in_reply_to is not null then
    select th.* into t from ms_messages m join ms_threads th on th.id = m.thread_id where m.message_id = p_in_reply_to or m.resend_id = p_in_reply_to limit 1;
  end if;
  -- 3. the latest conversation with this person
  if t.id is null and v_from <> '' then
    select * into t from ms_threads where lower(contact_email) = v_from order by last_at desc limit 1;
  end if;
  -- 4. unsubscribe by email
  if lower(coalesce(p_subject, '') || ' ' || left(coalesce(p_text, ''), 200)) ~ '\m(unsubscribe|stop emailing|remove me)\M' and v_from <> '' then
    insert into ms_mail_optouts (email, source) values (v_from, 'reply') on conflict (email) do nothing;
  end if;
  -- 5. otherwise a new conversation: a business with this email, or unsorted for admins
  if t.id is null then
    v_sub := coalesce(nullif(trim(p_subject), ''), '(no subject)');
    insert into ms_threads (subject, contact_email, contact_name, last_dir) values (v_sub, v_from, nullif(trim(p_from_name), ''), 'in') returning * into t;
    select bb.* into b from ms_businesses bb
     where exists (select 1 from ms_visits v where v.business_id = bb.id and lower(v.contact_email) = v_from) limit 1;
    if b.id is not null then
      select zc2.campaign_id into zc from ms_zone_campaigns zc2 where zc2.zone_id = b.zone_id limit 1;
      update ms_threads set business_id = b.id, campaign_id = zc.campaign_id where id = t.id;
    end if;
  end if;

  insert into ms_messages (thread_id, dir, status, from_email, from_name, to_emails, cc_emails, subject, html, text_body, snippet, attachments, resend_id, message_id, in_reply_to, at)
  values (t.id, 'in', 'received', v_from, nullif(trim(p_from_name), ''), coalesce(p_to, '{}'), coalesce(p_cc, '{}'), p_subject, p_html, p_text,
          ms_mail_snippet(coalesce(nullif(p_text, ''), p_html)), coalesce(p_attachments, '[]'::jsonb), p_resend_id, p_message_id, p_in_reply_to, coalesce(p_at, now()))
  returning id into v_id;
  update ms_threads set last_at = greatest(last_at, coalesce(p_at, now())), last_dir = 'in', last_snippet = ms_mail_snippet(coalesce(nullif(p_text, ''), p_html)),
         messages = messages + 1, unread = unread + 1, archived = false,
         contact_name = coalesce(contact_name, nullif(trim(p_from_name), ''))
   where id = t.id;
  return jsonb_build_object('thread_id', t.id, 'message_id', v_id);
end $$;
revoke all on function public.ms_mail_inbound(text, text, text, text[], text[], text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;

-- service role: attachments saved after the message is filed
create or replace function public.ms_mail_set_attachments(p_message uuid, p_attachments jsonb)
returns void language sql security definer set search_path = public as $$
  update ms_messages set attachments = coalesce(p_attachments, '[]'::jsonb) where id = p_message
$$;
revoke all on function public.ms_mail_set_attachments(uuid, jsonb) from public, anon, authenticated;

-- ───────────── unsubscribe (the link in the email; no sign-in) ─────────────
create or replace function public.ms_mail_unsubscribe(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t ms_threads;
begin
  select * into t from ms_threads where token = lower(coalesce(p_token, ''));
  if t.id is null or t.contact_email is null then return jsonb_build_object('ok', false); end if;
  insert into ms_mail_optouts (email, source) values (lower(t.contact_email), 'link') on conflict (email) do nothing;
  return jsonb_build_object('ok', true, 'email', regexp_replace(t.contact_email, '^(.).*(@.*)$', '\1•••\2'));
end $$;
revoke all on function public.ms_mail_unsubscribe(text) from public;
grant execute on function public.ms_mail_unsubscribe(text) to anon, authenticated;

-- ───────────── what Claude needs to write a good email (the ms-mail-ai function, as the rep) ─────────────
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
    'campaign', (select jsonb_build_object('name', c.name, 'pitch', c.pitch, 'objections', c.objections, 'info_url', c.info_url, 'notes', c.notes) from ms_campaigns c where c.id = v_c),
    'visits', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('at', v.at, 'outcome', v.outcome, 'notes', v.notes, 'contact', v.contact_name, 'follow_up', v.follow_up_at)) order by v.at desc)
                         from (select * from ms_visits v where v.business_id = v_b and v.campaign_id = v_c order by v.at desc limit 5) v), '[]'::jsonb),
    'thread', case when p_thread is null then null else coalesce((select jsonb_agg(jsonb_build_object('dir', m.dir, 'from', coalesce(m.from_name, m.from_email), 'at', m.at, 'subject', m.subject,
                         'text', left(coalesce(m.text_body, regexp_replace(coalesce(m.html, ''), '<[^>]+>', ' ', 'g')), 4000)) order by m.at)
                         from (select * from ms_messages m where m.thread_id = p_thread order by m.at desc limit 12) m), '[]'::jsonb) end);
end $$;

-- ───────────── access ─────────────
do $$
declare f text;
begin
  foreach f in array array[
    'ms_inbox(text,text,uuid,int,timestamptz)', 'ms_inbox_counts()', 'ms_thread(uuid,boolean)', 'ms_thread_flag(uuid,boolean,boolean,boolean)',
    'ms_thread_file(uuid,uuid,uuid)', 'ms_mail_prepare(uuid,uuid,uuid,text[],text[],text,text,text,jsonb)', 'ms_mail_context(uuid,uuid,uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.ms_mail_snippet(text) from public, anon;
