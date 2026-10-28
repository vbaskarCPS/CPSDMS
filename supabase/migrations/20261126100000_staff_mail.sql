-- RUN_65 — Staff email: every manager gets firstname@propertystars.app, a private mailbox, plus push
-- notifications for new mail.
--
--   Mailboxes. Every active manager (anyone with a permission other than "MainstreetAI rep") gets a
--   mailbox, firstname@propertystars.app; on a clash, first name + last initial, then first + last.
--   Created now for today's managers, and from now on when someone is first given a manager permission.
--   A mailbox is private: only its owner can read it (Super Admins included: they can rename or hand a
--   mailbox over, never open it). Built on the MainstreetAI mail engine: a conversation belongs to a
--   business (MainstreetAI) or to a mailbox (staff), never both.
--   Mail between two staff mailboxes is delivered in the database, instantly; anything else goes out
--   through Resend (the ms-mail function). Mail arriving at propertystars.app for a staff address (or an
--   old address kept as an alias) lands in that mailbox; replies find their conversation by the
--   Message-ID they quote back.
--   Someone leaves: an admin hands the mailbox over. "Move" gives the whole mailbox (address and all)
--   to someone else; "merge" moves its conversations into their mailbox and keeps the old address as an
--   alias of theirs, so mail to it still arrives. Nothing is deleted.
--
--   Push. Phones and computers that turned notifications on are kept in push_subscriptions; the push
--   function sends a notification for each new message (mailbox owner, or the rep of the business).
--   Its VAPID keys are made by the function and kept in push_keys, which nobody but it can read.
-- Additive: new tables, one new column, new functions. ms_thread_can, ms_inbox and ms_inbox_counts are
-- replaced (same signatures) so staff mail never shows in the MainstreetAI inbox or to its admins.

create table if not exists public.mail_boxes (
  id uuid primary key default gen_random_uuid(),
  local text not null unique check (local ~ '^[a-z0-9][a-z0-9._-]{0,40}$'),
  owner_id uuid references public.app_users(id) on delete set null,
  kind text not null default 'person' check (kind in ('person', 'shared')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists mail_boxes_owner on public.mail_boxes (owner_id) where active;

create table if not exists public.mail_aliases (
  local text primary key check (local ~ '^[a-z0-9][a-z0-9._-]{0,40}$'),
  box_id uuid not null references public.mail_boxes(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.ms_threads add column if not exists mailbox_id uuid references public.mail_boxes(id);
create index if not exists ms_threads_mailbox on public.ms_threads (mailbox_id, last_at desc) where mailbox_id is not null;
alter table public.ms_messages add column if not exists ext_message_id text;   -- the Message-ID Resend gave a staff email
create index if not exists ms_messages_mid on public.ms_messages (message_id) where message_id is not null;
create index if not exists ms_messages_extmid on public.ms_messages (ext_message_id) where ext_message_id is not null;
create index if not exists ms_messages_atts on public.ms_messages using gin (attachments jsonb_path_ops);

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references public.app_users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  agent text,
  created_at timestamptz not null default now(),
  last_ok timestamptz
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
create table if not exists public.push_keys (
  id int primary key default 1 check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.mail_boxes enable row level security;
alter table public.mail_aliases enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_keys enable row level security;
revoke all on public.mail_boxes, public.mail_aliases, public.push_subscriptions, public.push_keys from anon, authenticated;

-- ───────────── addresses ─────────────
create or replace function public.mail_reserved(p text)
returns boolean language sql immutable set search_path = public as $$
  select lower(coalesce(p, '')) in ('mainstreetai', 'info', 'bookings', 'admin', 'administrator', 'support', 'noreply', 'no-reply',
           'postmaster', 'abuse', 'hostmaster', 'webmaster', 'hello', 'team', 'office', 'sales', 'billing', 'accounts', 'security',
           'mail', 'root', 'help', 'contact', 'jobs', 'careers', 'hr', 'payroll', 'propertystars')
      or lower(coalesce(p, '')) ~ '^c-[0-9a-f]+$'
$$;

create or replace function public.mail_local_taken(p text, p_except uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select mail_reserved(p)
      or exists (select 1 from mail_boxes where local = lower(p) and id is distinct from p_except)
      or exists (select 1 from mail_aliases where local = lower(p) and box_id is distinct from p_except)
$$;
revoke all on function public.mail_local_taken(text, uuid) from public, anon, authenticated;

-- the mailbox an address (the part before @) delivers to: a live mailbox, else an alias
create or replace function public.mail_box_for(p_local text)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from mail_boxes where local = lower(p_local) and active),
    (select a.box_id from mail_aliases a join mail_boxes b on b.id = a.box_id where a.local = lower(p_local) and b.active))
$$;
revoke all on function public.mail_box_for(text) from public, anon, authenticated;

create or replace function public.mail_is_manager(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_users u where u.id = p_user and u.is_active
                   and (u.is_super_admin or exists (select 1 from user_permissions p where p.user_id = u.id and p.permission <> 'mainstreet_rep')))
$$;
revoke all on function public.mail_is_manager(uuid) from public, anon, authenticated;

/** "Ben Stewart" → ben; taken → bens; → benstewart; → ben2, ben3, … */
create or replace function public.mail_pick_local(p_name text)
returns text language plpgsql stable security definer set search_path = public as $$
declare parts text[]; f text; l text; c text; n int := 2;
begin
  parts := regexp_split_to_array(lower(trim(coalesce(p_name, ''))), '\s+');
  f := regexp_replace(coalesce(parts[1], ''), '[^a-z0-9]', '', 'g');
  l := regexp_replace(coalesce(array_to_string(parts[2:], ''), ''), '[^a-z0-9]', '', 'g');
  if f = '' then f := 'staff'; end if;
  foreach c in array array[f, f || left(l, 1), f || l] loop
    if c <> '' and c ~ '^[a-z0-9][a-z0-9._-]{0,40}$' and not mail_local_taken(c) then return c; end if;
  end loop;
  loop
    c := f || n;
    if not mail_local_taken(c) then return c; end if;
    n := n + 1;
  end loop;
end $$;
revoke all on function public.mail_pick_local(text) from public, anon, authenticated;

-- a manager's own mailbox, made the first time it's needed
create or replace function public.mail_box_ensure(p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; nm text;
begin
  select id into v from mail_boxes where owner_id = p_user and kind = 'person' and active order by created_at limit 1;
  if v is not null then return v; end if;
  if not mail_is_manager(p_user) then return null; end if;
  select full_name into nm from app_users where id = p_user;
  insert into mail_boxes (local, owner_id) values (mail_pick_local(nm), p_user) returning id into v;
  return v;
end $$;
revoke all on function public.mail_box_ensure(uuid) from public, anon, authenticated;

create or replace function public.mail_box_on_permission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.permission <> 'mainstreet_rep' then perform mail_box_ensure(new.user_id); end if;
  return new;
end $$;
revoke all on function public.mail_box_on_permission() from public, anon, authenticated;
drop trigger if exists mail_box_on_permission on public.user_permissions;
create trigger mail_box_on_permission after insert on public.user_permissions
  for each row execute function public.mail_box_on_permission();

-- today's managers, oldest account first
do $$
declare r record;
begin
  for r in select u.id from app_users u where mail_is_manager(u.id) order by u.created_at, u.full_name loop
    perform mail_box_ensure(r.id);
  end loop;
end $$;

create or replace function public.mail_has_box()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from mail_boxes where owner_id = auth.uid() and active)
$$;

-- ───────────── who may see a conversation (replaces RUN_64's) ─────────────
-- staff mail: only the mailbox's owner. MainstreetAI mail: as before (admins, and the business's rep).
create or replace function public.ms_thread_can(p_thread uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when t.mailbox_id is not null
             then exists (select 1 from mail_boxes b where b.id = t.mailbox_id and b.owner_id = auth.uid())
           else ms_is_admin() or (ms_is_rep() and (
                  (t.business_id is not null and t.campaign_id is not null and ms_rep_can(t.business_id, t.campaign_id))
                  or (t.business_id is null and t.created_by = auth.uid())))
           end
      from ms_threads t where t.id = p_thread), false)
$$;
revoke all on function public.ms_thread_can(uuid) from public, anon, authenticated;

-- a file in the ms-mail bucket that's attached to a message this person can see (internal mail)
create or replace function public.mail_can_attachment(p_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ms_messages m where m.attachments @> jsonb_build_array(jsonb_build_object('path', p_name)) and ms_thread_can(m.thread_id))
$$;
grant execute on function public.mail_can_attachment(text) to authenticated;
revoke all on function public.mail_can_attachment(text) from public, anon;

drop policy if exists ms_mail_upload on storage.objects;
create policy ms_mail_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'ms-mail' and (storage.foldername(name))[1] = 'out' and (storage.foldername(name))[2] = auth.uid()::text
              and (public.ms_is_rep() or public.ms_is_admin() or public.mail_has_box()));
drop policy if exists ms_mail_read on storage.objects;
create policy ms_mail_read on storage.objects for select to authenticated
  using (bucket_id = 'ms-mail' and (
         ((storage.foldername(name))[1] = 'out' and (storage.foldername(name))[2] = auth.uid()::text)
         or ((storage.foldername(name))[1] = 'in' and public.ms_mail_can_path(name))
         or public.mail_can_attachment(name)
         or (public.ms_is_admin() and not exists (
               select 1 from public.ms_messages m join public.ms_threads t on t.id = m.thread_id
                where t.mailbox_id is not null and m.attachments @> jsonb_build_array(jsonb_build_object('path', name))))));

-- ───────────── the MainstreetAI inbox never shows staff mail (replaces RUN_64's) ─────────────
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
             where t.mailbox_id is null and ms_thread_can(t.id)
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
    'unread', (select count(*) from ms_threads t where t.mailbox_id is null and t.unread > 0 and not t.archived and ms_thread_can(t.id)),
    'unsorted', case when ms_is_admin() then (select count(*) from ms_threads t where t.mailbox_id is null and t.business_id is null) else 0 end)
  where ms_is_rep() or ms_is_admin()
$$;

-- ───────────── staff: my mailboxes, the directory, the inbox ─────────────
create or replace function public.mail_my_boxes()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'address', b.local || '@propertystars.app', 'kind', b.kind,
           'unread', (select count(*) from ms_threads t where t.mailbox_id = b.id and t.unread > 0 and not t.archived))
         order by b.kind, b.created_at), '[]'::jsonb)
    from mail_boxes b where b.owner_id = auth.uid() and b.active
$$;

-- everyone with a mailbox, for the To field's contacts list
create or replace function public.mail_directory()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not mail_has_box() then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(u.full_name, b.local), 'address', b.local || '@propertystars.app', 'me', b.owner_id = auth.uid())
                     order by coalesce(u.full_name, b.local))
                     from mail_boxes b left join app_users u on u.id = b.owner_id
                    where b.active and b.kind = 'person' and (u.id is null or u.is_active)), '[]'::jsonb);
end $$;

-- p_box: one of my mailboxes (null = all of mine); folders as in the MainstreetAI inbox, minus unsorted
create or replace function public.mail_inbox(p_box uuid default null, p_folder text default 'inbox', p_search text default null, p_limit int default 60, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(coalesce(p_search, '')), '');
begin
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', t.id, 'subject', t.subject, 'snippet', t.last_snippet, 'last_at', t.last_at, 'last_dir', t.last_dir,
             'messages', t.messages, 'unread', t.unread, 'starred', t.starred, 'archived', t.archived,
             'contact_email', t.contact_email, 'contact_name', t.contact_name, 'mailbox', b.local || '@propertystars.app'))
           order by t.last_at desc)
      from (select t.* from ms_threads t
             where t.mailbox_id in (select id from mail_boxes where owner_id = auth.uid() and active and (p_box is null or id = p_box))
               and (p_before is null or t.last_at < p_before)
               and case coalesce(p_folder, 'inbox')
                     when 'inbox' then not t.archived
                     when 'unread' then t.unread > 0 and not t.archived
                     when 'starred' then t.starred
                     when 'sent' then exists (select 1 from ms_messages m where m.thread_id = t.id and m.dir = 'out')
                     when 'archived' then t.archived
                     else true end
               and (q is null or t.subject ilike '%' || q || '%' or t.contact_email ilike '%' || q || '%' or t.contact_name ilike '%' || q || '%'
                    or exists (select 1 from ms_messages m where m.thread_id = t.id and (m.text_body ilike '%' || q || '%' or m.snippet ilike '%' || q || '%')))
             order by t.last_at desc
             limit least(greatest(coalesce(p_limit, 60), 1), 200)) t
      join mail_boxes b on b.id = t.mailbox_id), '[]'::jsonb);
end $$;

create or replace function public.mail_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('unread', (select count(*) from ms_threads t join mail_boxes b on b.id = t.mailbox_id
                                        where b.owner_id = auth.uid() and b.active and t.unread > 0 and not t.archived))
$$;

-- ───────────── delivery ─────────────
-- a staff message delivered to another staff mailbox: into the conversation it answers there, else a new one
create or replace function public.mail_deliver_copy(p_msg uuid, p_box uuid, p_resend_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m ms_messages; t ms_threads; v uuid;
begin
  select * into m from ms_messages where id = p_msg;
  if m.in_reply_to is not null then
    select th.* into t from ms_messages x join ms_threads th on th.id = x.thread_id
     where th.mailbox_id = p_box and (x.message_id = m.in_reply_to or x.ext_message_id = m.in_reply_to)
     order by x.at desc limit 1;
  end if;
  if t.id is null then
    insert into ms_threads (mailbox_id, subject, contact_email, contact_name, last_dir)
    values (p_box, coalesce(nullif(trim(m.subject), ''), '(no subject)'), m.from_email, m.from_name, 'in') returning * into t;
  end if;
  insert into ms_messages (thread_id, dir, status, from_email, from_name, to_emails, cc_emails, subject, html, text_body, snippet, attachments,
                           message_id, ext_message_id, in_reply_to, resend_id, at)
  values (t.id, 'in', 'received', m.from_email, m.from_name, m.to_emails, m.cc_emails, m.subject, m.html, m.text_body, m.snippet, m.attachments,
          m.message_id, m.ext_message_id, m.in_reply_to, p_resend_id, now())
  returning id into v;
  update ms_threads set last_at = now(), last_dir = 'in', last_snippet = m.snippet, messages = messages + 1, unread = unread + 1, archived = false,
         contact_email = coalesce(contact_email, m.from_email), contact_name = coalesce(contact_name, m.from_name)
   where id = t.id;
  return jsonb_build_object('thread_id', t.id, 'message_id', v);
end $$;
revoke all on function public.mail_deliver_copy(uuid, uuid, text) from public, anon, authenticated;

-- as the manager: check, keep the message, deliver it to staff mailboxes now; say what's left for Resend
create or replace function public.mail_prepare(
  p_box uuid, p_thread uuid, p_to text[], p_cc text[], p_subject text, p_html text, p_text text, p_attachments jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me app_users; b mail_boxes; t ms_threads; e text; a jsonb; v_to text[]; v_cc text[]; v_id uuid := gen_random_uuid();
        v_mid text; v_reply text; ext_to text[] := '{}'; ext_cc text[] := '{}'; v_target uuid; seen uuid[] := '{}'; d jsonb; delivered jsonb := '[]'::jsonb;
        v_from text;
begin
  select * into me from app_users where id = auth.uid() and is_active;
  if me.id is null then raise exception 'Not allowed'; end if;
  if p_thread is not null then
    select * into t from ms_threads where id = p_thread;
    if t.id is null or t.mailbox_id is null or not ms_thread_can(t.id) then raise exception 'Not allowed'; end if;
    select * into b from mail_boxes where id = t.mailbox_id;
  else
    select * into b from mail_boxes where owner_id = auth.uid() and active and (p_box is null or id = p_box) order by kind, created_at limit 1;
    if b.id is null then raise exception 'You don’t have a mailbox yet'; end if;
  end if;
  v_from := b.local || '@propertystars.app';

  v_to := array(select distinct lower(trim(x)) from unnest(coalesce(p_to, '{}')) x where trim(x) <> '');
  v_cc := array(select distinct lower(trim(x)) from unnest(coalesce(p_cc, '{}')) x where trim(x) <> '' and lower(trim(x)) <> all (v_to));
  if cardinality(v_to) = 0 then raise exception 'Who is it to?'; end if;
  if cardinality(v_to) + cardinality(v_cc) > 25 then raise exception 'Up to 25 people per email'; end if;
  foreach e in array v_to || v_cc loop
    if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception '% isn’t an email address', e; end if;
  end loop;
  if nullif(trim(coalesce(p_subject, '')), '') is null then raise exception 'Add a subject'; end if;
  if nullif(trim(coalesce(p_text, '')), '') is null and nullif(trim(coalesce(p_html, '')), '') is null then raise exception 'The email is empty'; end if;
  for a in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    if coalesce(a->>'path', '') !~ ('^out/' || auth.uid()::text || '/') and not mail_can_attachment(a->>'path') then raise exception 'An attachment isn’t yours'; end if;
  end loop;

  if t.id is null then
    insert into ms_threads (mailbox_id, subject, contact_email, created_by)
    values (b.id, trim(p_subject), v_to[1], auth.uid()) returning * into t;
  end if;
  select coalesce(x.ext_message_id, x.message_id) into v_reply from ms_messages x
   where x.thread_id = t.id and coalesce(x.ext_message_id, x.message_id) is not null order by x.at desc limit 1;
  v_mid := '<' || v_id || '@propertystars.app>';

  insert into ms_messages (id, thread_id, dir, status, from_email, from_name, to_emails, cc_emails, subject, html, text_body, snippet, attachments, sent_by, message_id, in_reply_to)
  values (v_id, t.id, 'out', 'sending', v_from, me.full_name, v_to, v_cc, trim(p_subject), p_html, p_text,
          ms_mail_snippet(coalesce(p_text, p_html)), coalesce(p_attachments, '[]'::jsonb), auth.uid(), v_mid, v_reply);

  -- staff addresses: delivered here and now; the rest go out through Resend
  foreach e in array v_to || v_cc loop
    v_target := case when split_part(e, '@', 2) = 'propertystars.app' then mail_box_for(split_part(e, '@', 1)) end;
    if v_target is not null then
      if v_target <> b.id and not v_target = any (seen) then
        d := mail_deliver_copy(v_id, v_target);
        delivered := delivered || jsonb_build_array(d);
        seen := seen || v_target;
      end if;
    elsif e = any (v_to) then ext_to := ext_to || e;
    else ext_cc := ext_cc || e;
    end if;
  end loop;
  if cardinality(ext_to) = 0 and cardinality(ext_cc) > 0 then ext_to := ext_cc; ext_cc := '{}'; end if;
  if cardinality(ext_to) = 0 then perform ms_mail_sent(v_id, null, null); end if;

  return jsonb_build_object('message_id', v_id, 'thread_id', t.id, 'from', v_from, 'sender_name', me.full_name,
    'sender_phone', me.phone, 'to', to_jsonb(ext_to), 'cc', to_jsonb(ext_cc), 'subject', trim(p_subject),
    'html', p_html, 'text', p_text, 'attachments', coalesce(p_attachments, '[]'::jsonb), 'in_reply_to', v_reply,
    'delivered', delivered);
end $$;

-- service role: the Message-ID Resend gave a staff email
create or replace function public.mail_set_ext_id(p_message uuid, p_ext text)
returns void language sql security definer set search_path = public as $$
  update ms_messages set ext_message_id = p_ext where id = p_message
$$;
revoke all on function public.mail_set_ext_id(uuid, text) from public, anon, authenticated;

-- RUN_64's MainstreetAI rules, now never matching a staff conversation (replaced, same signature)
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
  if v_token is not null then select * into t from ms_threads where token = v_token and mailbox_id is null; end if;
  -- 2. an answer to one of our messages
  if t.id is null and p_in_reply_to is not null then
    select th.* into t from ms_messages m join ms_threads th on th.id = m.thread_id where th.mailbox_id is null and (m.message_id = p_in_reply_to or m.resend_id = p_in_reply_to) limit 1;
  end if;
  -- 3. the latest conversation with this person
  if t.id is null and v_from <> '' then
    select * into t from ms_threads where lower(contact_email) = v_from and mailbox_id is null order by last_at desc limit 1;
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

-- service role, from ms-mail-inbound: staff addresses first, else the MainstreetAI rules (RUN_64)
create or replace function public.mail_inbound(
  p_resend_id text, p_from text, p_from_name text, p_to text[], p_cc text[], p_subject text, p_html text, p_text text,
  p_message_id text, p_in_reply_to text, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare boxes uuid[]; bx uuid; t ms_threads; v uuid; r jsonb; v_out jsonb := '[]'::jsonb; v_first boolean := true;
        v_from text := lower(trim(coalesce(p_from, ''))); v_snip text := ms_mail_snippet(coalesce(nullif(p_text, ''), p_html));
begin
  if p_resend_id is not null and exists (select 1 from ms_messages where resend_id = p_resend_id) then return jsonb_build_object('again', true); end if;
  select array_agg(distinct mail_box_for(split_part(lower(x), '@', 1))) filter (where mail_box_for(split_part(lower(x), '@', 1)) is not null)
    into boxes from unnest(coalesce(p_to, '{}') || coalesce(p_cc, '{}')) x where split_part(lower(x), '@', 2) = 'propertystars.app';
  if coalesce(cardinality(boxes), 0) = 0 then
    r := ms_mail_inbound(p_resend_id, p_from, p_from_name, p_to, p_cc, p_subject, p_html, p_text, p_message_id, p_in_reply_to, '[]'::jsonb, p_at);
    if r ? 'again' then return r; end if;
    return jsonb_build_object('deliveries', jsonb_build_array(r));
  end if;
  foreach bx in array boxes loop
    t := null;
    if p_in_reply_to is not null then
      select th.* into t from ms_messages x join ms_threads th on th.id = x.thread_id
       where th.mailbox_id = bx and (x.message_id = p_in_reply_to or x.ext_message_id = p_in_reply_to) order by x.at desc limit 1;
    end if;
    if t.id is null then
      insert into ms_threads (mailbox_id, subject, contact_email, contact_name, last_dir)
      values (bx, coalesce(nullif(trim(p_subject), ''), '(no subject)'), v_from, nullif(trim(p_from_name), ''), 'in') returning * into t;
    end if;
    insert into ms_messages (thread_id, dir, status, from_email, from_name, to_emails, cc_emails, subject, html, text_body, snippet, attachments,
                             resend_id, message_id, in_reply_to, at)
    values (t.id, 'in', 'received', v_from, nullif(trim(p_from_name), ''), coalesce(p_to, '{}'), coalesce(p_cc, '{}'), p_subject, p_html, p_text,
            v_snip, '[]'::jsonb, case when v_first then p_resend_id end, p_message_id, p_in_reply_to, coalesce(p_at, now()))
    returning id into v;
    update ms_threads set last_at = greatest(last_at, coalesce(p_at, now())), last_dir = 'in', last_snippet = v_snip,
           messages = messages + 1, unread = unread + 1, archived = false, contact_name = coalesce(contact_name, nullif(trim(p_from_name), ''))
     where id = t.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('thread_id', t.id, 'message_id', v));
    v_first := false;
  end loop;
  return jsonb_build_object('deliveries', v_out);
end $$;
revoke all on function public.mail_inbound(text, text, text, text[], text[], text, text, text, text, text, timestamptz) from public, anon, authenticated;

-- what Claude gets when a manager asks it to write (the ms-mail-ai function, as the manager)
create or replace function public.mail_context(p_thread uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me app_users;
begin
  if not mail_has_box() then raise exception 'Not allowed'; end if;
  if p_thread is not null and not exists (select 1 from ms_threads where id = p_thread and mailbox_id is not null and ms_thread_can(id)) then
    raise exception 'Not allowed';
  end if;
  select * into me from app_users where id = auth.uid();
  return jsonb_build_object(
    'me', jsonb_build_object('name', me.full_name, 'phone', me.phone,
            'address', (select local || '@propertystars.app' from mail_boxes where owner_id = me.id and active order by kind, created_at limit 1)),
    'company', 'Canadian Property Stars (home services: lawn aeration, lawn rejuvenation, driveway sealing, window cleaning)',
    'thread', case when p_thread is null then null else coalesce((select jsonb_agg(jsonb_build_object('dir', m.dir, 'from', coalesce(m.from_name, m.from_email), 'at', m.at, 'subject', m.subject,
                     'text', left(coalesce(m.text_body, regexp_replace(coalesce(m.html, ''), '<[^>]+>', ' ', 'g')), 4000)) order by m.at)
                     from (select * from ms_messages m where m.thread_id = p_thread order by m.at desc limit 12) m), '[]'::jsonb) end);
end $$;

-- ───────────── admins (User management): rename, hand over. Never read. ─────────────
create or replace function public.mail_admin_boxes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not app_has_perm('sa_users') then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
             'id', b.id, 'address', b.local || '@propertystars.app', 'local', b.local, 'kind', b.kind, 'active', b.active,
             'owner_id', b.owner_id, 'owner', u.full_name, 'owner_active', coalesce(u.is_active, false),
             'aliases', coalesce((select jsonb_agg(a.local || '@propertystars.app' order by a.local) from mail_aliases a where a.box_id = b.id), '[]'::jsonb),
             'conversations', (select count(*) from ms_threads t where t.mailbox_id = b.id))
           order by b.active desc, u.full_name nulls last, b.local)
           from mail_boxes b left join app_users u on u.id = b.owner_id), '[]'::jsonb);
end $$;

create or replace function public.mail_admin_rename(p_box uuid, p_local text)
returns void language plpgsql security definer set search_path = public as $$
declare old text; v text := lower(trim(coalesce(p_local, '')));
begin
  if not app_has_perm('sa_users') then raise exception 'Not allowed'; end if;
  v := regexp_replace(v, '@.*$', '');
  if v !~ '^[a-z0-9][a-z0-9._-]{0,40}$' then raise exception 'Use letters, numbers, dots or dashes'; end if;
  select local into old from mail_boxes where id = p_box;
  if old is null then raise exception 'No such mailbox'; end if;
  if v = old then return; end if;
  if mail_reserved(v) or exists (select 1 from mail_boxes where local = v) or exists (select 1 from mail_aliases where local = v and box_id <> p_box) then
    raise exception '%@propertystars.app is taken', v;
  end if;
  delete from mail_aliases where local = v and box_id = p_box;
  update mail_boxes set local = v where id = p_box;
  insert into mail_aliases (local, box_id) values (old, p_box) on conflict (local) do nothing;   -- the old address keeps working
end $$;

-- p_mode 'move': the mailbox (address and all) becomes theirs. 'merge': its conversations join their
-- mailbox and its addresses become aliases of theirs.
create or replace function public.mail_admin_handover(p_box uuid, p_to_user uuid, p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b mail_boxes; target uuid; n int;
begin
  if not app_has_perm('sa_users') then raise exception 'Not allowed'; end if;
  select * into b from mail_boxes where id = p_box;
  if b.id is null then raise exception 'No such mailbox'; end if;
  if not exists (select 1 from app_users where id = p_to_user and is_active) then raise exception 'Pick an active person'; end if;
  if p_mode = 'move' then
    if b.owner_id = p_to_user then raise exception 'It’s already theirs'; end if;
    update mail_boxes set owner_id = p_to_user, active = true where id = b.id;
    return jsonb_build_object('mode', 'move', 'box_id', b.id);
  elsif p_mode = 'merge' then
    target := mail_box_ensure(p_to_user);
    if target is null then raise exception 'They need to be a manager to have a mailbox'; end if;
    if target = b.id then raise exception 'That’s the same mailbox'; end if;
    update ms_threads set mailbox_id = target where mailbox_id = b.id;
    get diagnostics n = row_count;
    update mail_aliases set box_id = target where box_id = b.id;
    insert into mail_aliases (local, box_id) values (b.local, target) on conflict (local) do update set box_id = excluded.box_id;
    update mail_boxes set active = false where id = b.id;
    return jsonb_build_object('mode', 'merge', 'box_id', target, 'conversations', n);
  end if;
  raise exception 'Choose move or merge';
end $$;

-- ───────────── push ─────────────
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_agent text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not allowed'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'Bad subscription'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth, agent) values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_agent, 200))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, agent = excluded.agent;
end $$;
create or replace function public.push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;
create or replace function public.push_mine()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from push_subscriptions where user_id = auth.uid()
$$;

-- service role: who to tell about a new message, and what to say
create or replace function public.push_for_message(p_message uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m ms_messages; t ms_threads; users uuid[]; url text; b ms_businesses;
begin
  select * into m from ms_messages where id = p_message;
  select * into t from ms_threads where id = m.thread_id;
  if t.id is null or m.dir <> 'in' then return null; end if;
  if t.mailbox_id is not null then
    users := array(select owner_id from mail_boxes where id = t.mailbox_id and owner_id is not null);
    url := '/app/email?t=' || t.id;
  elsif t.business_id is not null then
    select * into b from ms_businesses where id = t.business_id;
    users := array(select zc.rep_id from ms_zone_campaigns zc where zc.zone_id = b.zone_id and zc.campaign_id = t.campaign_id and zc.rep_id is not null);
    url := '/app/rep/inbox?t=' || t.id;
  elsif t.created_by is not null and ms_is_rep(t.created_by) then
    users := array[t.created_by];
    url := '/app/rep/inbox?t=' || t.id;
  else
    return null;
  end if;
  return jsonb_build_object('users', to_jsonb(users), 'title', coalesce(m.from_name, m.from_email, 'New email'),
    'body', coalesce(nullif(m.subject, ''), '(no subject)') || coalesce(' — ' || nullif(left(m.snippet, 120), ''), ''),
    'url', url, 'tag', 'mail-' || t.id,
    'subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                        from push_subscriptions s where s.user_id = any (users)), '[]'::jsonb));
end $$;
revoke all on function public.push_for_message(uuid) from public, anon, authenticated;

create or replace function public.push_gone(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint
$$;
revoke all on function public.push_gone(text) from public, anon, authenticated;

-- ───────────── access ─────────────
do $$
declare f text;
begin
  foreach f in array array[
    'mail_has_box()', 'mail_my_boxes()', 'mail_directory()', 'mail_inbox(uuid,text,text,int,timestamptz)', 'mail_counts()',
    'mail_prepare(uuid,uuid,text[],text[],text,text,text,jsonb)', 'mail_context(uuid)',
    'mail_admin_boxes()', 'mail_admin_rename(uuid,text)', 'mail_admin_handover(uuid,uuid,text)',
    'push_subscribe(text,text,text,text)', 'push_unsubscribe(text)', 'push_mine()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.mail_reserved(text) from public, anon;
