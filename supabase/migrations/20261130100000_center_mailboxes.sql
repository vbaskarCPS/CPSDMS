-- RUN_69 — command centre mailboxes: a client slug and a staff slug per centre, shared by the managers
-- given access; receipts and booking emails go out from (and are answered to) the client slug.
--
-- ADDITIVE ONLY.
--   mail_boxes.center_id / role / label   a shared mailbox can belong to a centre as its 'client' or
--                                         'staff' mailbox; label is the name it sends as
--   mail_box_members                      who besides the owner reads and writes a mailbox (set in
--                                         Super Admin › Users); everyone with access gets push alerts
--   mail_box_can(box)                     owner or member, mailbox active
--   ms_thread_can / mail_has_box / mail_my_boxes / mail_inbox / mail_counts / mail_prepare /
--   mail_context / push_for_message / mail_admin_boxes   replaced: "mine" now means owner OR member
--   mail_admin_center_boxes / mail_admin_set_center_box / mail_admin_box_member   Super Admin
--   mail_center_box (service role)         the centre's mailbox, for receipts
--   mail_log_outbound (service role)       an email sent by a system (a receipt) kept in the mailbox,
--                                          so a customer's reply joins its conversation
--   mb_bookings.sent_emails                booking emails sent ({kind, at, thread_id}); app_mb_booking_emailed
--   app_email_templates / app_email_template_save   a centre's email templates (receipts and booking emails)

alter table public.mail_boxes add column if not exists center_id uuid references public.command_centers(id) on delete set null;
alter table public.mail_boxes add column if not exists role text check (role in ('client', 'staff'));
alter table public.mail_boxes add column if not exists label text;
create unique index if not exists mail_boxes_center_role on public.mail_boxes (center_id, role) where center_id is not null and role is not null and active;

create table if not exists public.mail_box_members (
  box_id uuid not null references public.mail_boxes(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  added_by uuid, added_at timestamptz not null default now(),
  primary key (box_id, user_id)
);
create index if not exists mail_box_members_user on public.mail_box_members (user_id);
alter table public.mail_box_members enable row level security;
revoke all on public.mail_box_members from anon, authenticated;

alter table public.mb_bookings add column if not exists sent_emails jsonb not null default '[]';

-- ───────────── access ─────────────
create or replace function public.mail_box_can(p_box uuid, p_user uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from mail_boxes b where b.id = p_box and b.active
                   and (b.owner_id = coalesce(p_user, auth.uid())
                        or exists (select 1 from mail_box_members m join app_users u on u.id = m.user_id
                                    where m.box_id = b.id and m.user_id = coalesce(p_user, auth.uid()) and u.is_active)))
$$;
revoke all on function public.mail_box_can(uuid, uuid) from public, anon, authenticated;

create or replace function public.mail_my_box_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(b.id), '{}') from mail_boxes b where b.active and mail_box_can(b.id)
$$;
revoke all on function public.mail_my_box_ids() from public, anon, authenticated;

create or replace function public.ms_thread_can(p_thread uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when t.mailbox_id is not null
             then mail_box_can(t.mailbox_id)
           else ms_is_admin() or (ms_is_rep() and (
                  (t.business_id is not null and t.campaign_id is not null and ms_rep_can(t.business_id, t.campaign_id))
                  or (t.business_id is null and t.created_by = auth.uid())))
           end
      from ms_threads t where t.id = p_thread), false)
$$;
revoke all on function public.ms_thread_can(uuid) from public, anon, authenticated;

create or replace function public.mail_has_box()
returns boolean language sql stable security definer set search_path = public as $$
  select cardinality(mail_my_box_ids()) > 0
$$;

create or replace function public.mail_my_boxes()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'address', b.local || '@propertystars.app', 'kind', b.kind,
           'label', b.label, 'role', b.role, 'center_id', b.center_id, 'mine', b.owner_id = auth.uid(),
           'unread', (select count(*) from ms_threads t where t.mailbox_id = b.id and t.unread > 0 and not t.archived))
         order by (b.owner_id = auth.uid()) desc nulls last, b.kind, b.label nulls last, b.created_at), '[]'::jsonb)
    from mail_boxes b where b.id = any (mail_my_box_ids())
$$;

create or replace function public.mail_inbox(p_box uuid default null, p_folder text default 'inbox', p_search text default null, p_limit int default 60, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(coalesce(p_search, '')), ''); mine uuid[] := mail_my_box_ids();
begin
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', t.id, 'subject', t.subject, 'snippet', t.last_snippet, 'last_at', t.last_at, 'last_dir', t.last_dir,
             'messages', t.messages, 'unread', t.unread, 'starred', t.starred, 'archived', t.archived,
             'contact_email', t.contact_email, 'contact_name', t.contact_name, 'mailbox', b.local || '@propertystars.app', 'mailbox_label', b.label))
           order by t.last_at desc)
      from (select t.* from ms_threads t
             where t.mailbox_id = any (mine) and (p_box is null or t.mailbox_id = p_box)
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
  select jsonb_build_object('unread', (select count(*) from ms_threads t
                                        where t.mailbox_id = any (mail_my_box_ids()) and t.unread > 0 and not t.archived))
$$;

-- as the manager: check, keep the message, deliver it to staff mailboxes now; say what's left for Resend.
-- p_box: any mailbox they can use (their own, or a shared one they were given); default their own.
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
  elsif p_box is not null then
    if not mail_box_can(p_box) then raise exception 'Not allowed'; end if;
    select * into b from mail_boxes where id = p_box;
  else
    select * into b from mail_boxes where owner_id = auth.uid() and active order by kind, created_at limit 1;
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
  values (v_id, t.id, 'out', 'sending', v_from, coalesce(b.label, me.full_name), v_to, v_cc, trim(p_subject), p_html, p_text,
          ms_mail_snippet(coalesce(p_text, p_html)), coalesce(p_attachments, '[]'::jsonb), auth.uid(), v_mid, v_reply);

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
    'sender_phone', me.phone, 'box_label', b.label, 'box_role', b.role,
    'to', to_jsonb(ext_to), 'cc', to_jsonb(ext_cc), 'subject', trim(p_subject),
    'html', p_html, 'text', p_text, 'attachments', coalesce(p_attachments, '[]'::jsonb), 'in_reply_to', v_reply,
    'delivered', delivered);
end $$;

-- what Claude gets when a manager asks it to write: the manager, the mailbox, the conversation, and
-- the customer's bookings (Master Bookings) when the other person is a booked customer
create or replace function public.mail_context(p_thread uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me app_users; t ms_threads; b mail_boxes;
begin
  if not mail_has_box() then raise exception 'Not allowed'; end if;
  if p_thread is not null then
    select * into t from ms_threads where id = p_thread and mailbox_id is not null;
    if t.id is null or not ms_thread_can(t.id) then raise exception 'Not allowed'; end if;
    select * into b from mail_boxes where id = t.mailbox_id;
  end if;
  select * into me from app_users where id = auth.uid();
  return jsonb_build_object(
    'me', jsonb_build_object('name', me.full_name, 'phone', me.phone,
            'address', coalesce(b.local, (select local from mail_boxes where owner_id = me.id and active order by kind, created_at limit 1)) || '@propertystars.app',
            'writing_for', b.label),
    'company', 'Canadian Property Stars (home services: lawn aeration, lawn rejuvenation, driveway sealing, window cleaning)',
    'thread', case when p_thread is null then null else coalesce((select jsonb_agg(jsonb_build_object('dir', m.dir, 'from', coalesce(m.from_name, m.from_email), 'at', m.at, 'subject', m.subject,
                     'text', left(coalesce(m.text_body, regexp_replace(coalesce(m.html, ''), '<[^>]+>', ' ', 'g')), 4000)) order by m.at)
                     from (select * from ms_messages m where m.thread_id = p_thread order by m.at desc limit 12) m), '[]'::jsonb) end,
    'bookings', case when t.contact_email is null then null else (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'list', l.name || ' ' || l.year, 'address', trim(bk.house_no || ' ' || bk.street_name) || coalesce(', ' || bk.city, ''),
               'job', bk.job_code, 'prepaid', bk.prepaid, 'status', bk.status, 'done_on', bk.done_on,
               'tries', (select jsonb_agg(jsonb_build_object('day', a->>'day', 'reason', a->>'reason', 'note', a->>'note')) from jsonb_array_elements(bk.attempts) a),
               'field_notes', bk.field_notes, 'route', bk.route_code,
               'plan', (select p.kind from mb_plans p where p.id = bk.plan_id))))
        from mb_bookings bk join mb_lists l on l.id = bk.list_id
       where lower(t.contact_email) = any (select lower(x) from unnest(bk.emails) x)) end);
end $$;

-- service role: who to tell about a new message (owner and members), and what to say
create or replace function public.push_for_message(p_message uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m ms_messages; t ms_threads; users uuid[]; url text; b ms_businesses;
begin
  select * into m from ms_messages where id = p_message;
  select * into t from ms_threads where id = m.thread_id;
  if t.id is null or m.dir <> 'in' then return null; end if;
  if t.mailbox_id is not null then
    users := array(select owner_id from mail_boxes where id = t.mailbox_id and owner_id is not null
                   union select mm.user_id from mail_box_members mm join app_users u on u.id = mm.user_id where mm.box_id = t.mailbox_id and u.is_active);
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

-- ───────────── Super Admin ─────────────
create or replace function public.mail_admin_boxes()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not app_has_perm('sa_users') then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
             'id', b.id, 'address', b.local || '@propertystars.app', 'local', b.local, 'kind', b.kind, 'active', b.active,
             'owner_id', b.owner_id, 'owner', u.full_name, 'owner_active', coalesce(u.is_active, false),
             'label', b.label, 'role', b.role, 'center_id', b.center_id, 'center', (select c.display_name from command_centers c where c.id = b.center_id),
             'members', coalesce((select jsonb_agg(jsonb_build_object('id', mu.id, 'name', mu.full_name) order by mu.full_name)
                                    from mail_box_members mm join app_users mu on mu.id = mm.user_id where mm.box_id = b.id), '[]'::jsonb),
             'aliases', coalesce((select jsonb_agg(a.local || '@propertystars.app' order by a.local) from mail_aliases a where a.box_id = b.id), '[]'::jsonb),
             'conversations', (select count(*) from ms_threads t where t.mailbox_id = b.id))
           order by b.active desc, (b.kind = 'shared') desc, u.full_name nulls last, b.local)
           from mail_boxes b left join app_users u on u.id = b.owner_id), '[]'::jsonb);
end $$;

-- a centre's client / staff mailbox: made (or renamed) to this address; it sends as the centre
create or replace function public.mail_admin_set_center_box(p_center uuid, p_role text, p_local text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c command_centers; b mail_boxes; v text := regexp_replace(lower(trim(coalesce(p_local, ''))), '@.*$', ''); v_label text;
begin
  if not (app_has_perm('sa_users') or coalesce(app_is_super_admin(), false)) then raise exception 'Not allowed'; end if;
  if p_role not in ('client', 'staff') then raise exception 'Pick client or staff'; end if;
  select * into c from command_centers where id = p_center;
  if c.id is null then raise exception 'No such centre'; end if;
  if v !~ '^[a-z0-9][a-z0-9._-]{0,40}$' then raise exception 'Use letters, numbers, dots or dashes'; end if;
  v_label := 'Property Stars · ' || c.display_name || case when p_role = 'staff' then ' (staff)' else '' end;
  select * into b from mail_boxes where center_id = p_center and role = p_role and active;
  if b.id is null then
    if mail_local_taken(v) then raise exception '%@propertystars.app is taken', v; end if;
    insert into mail_boxes (local, owner_id, kind, center_id, role, label) values (v, null, 'shared', p_center, p_role, v_label) returning * into b;
  elsif b.local <> v then
    perform mail_admin_rename(b.id, v);
    update mail_boxes set label = v_label where id = b.id;
    select * into b from mail_boxes where id = b.id;
  end if;
  return jsonb_build_object('id', b.id, 'address', b.local || '@propertystars.app', 'label', b.label);
end $$;

create or replace function public.mail_admin_center_boxes(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (app_has_perm('sa_users') or coalesce(app_is_super_admin(), false)) then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_object_agg(b.role, jsonb_build_object('id', b.id, 'address', b.local || '@propertystars.app', 'label', b.label,
           'members', coalesce((select jsonb_agg(jsonb_build_object('id', mu.id, 'name', mu.full_name) order by mu.full_name)
                                  from mail_box_members mm join app_users mu on mu.id = mm.user_id where mm.box_id = b.id), '[]'::jsonb)))
           from mail_boxes b where b.center_id = p_center and b.role is not null and b.active), '{}'::jsonb);
end $$;

-- give or take a person's access to a shared mailbox
create or replace function public.mail_admin_box_member(p_box uuid, p_user uuid, p_on boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_has_perm('sa_users') then raise exception 'Not allowed'; end if;
  if not exists (select 1 from mail_boxes where id = p_box and kind = 'shared') then raise exception 'Only shared mailboxes have members'; end if;
  if p_on then
    if not exists (select 1 from app_users where id = p_user and is_active) then raise exception 'Pick an active person'; end if;
    insert into mail_box_members (box_id, user_id, added_by) values (p_box, p_user, auth.uid()) on conflict do nothing;
  else
    delete from mail_box_members where box_id = p_box and user_id = p_user;
  end if;
end $$;

-- the shared mailboxes a person has, for the Users page
create or replace function public.mail_admin_user_boxes(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not app_has_perm('sa_users') then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'address', b.local || '@propertystars.app', 'label', b.label,
           'center', (select c.display_name from command_centers c where c.id = b.center_id), 'role', b.role,
           'on', exists (select 1 from mail_box_members m where m.box_id = b.id and m.user_id = p_user))
           order by b.label nulls last, b.local)
           from mail_boxes b where b.kind = 'shared' and b.active), '[]'::jsonb);
end $$;

-- ───────────── system email (receipts) ─────────────
-- service role: a centre's mailbox
create or replace function public.mail_center_box(p_center uuid, p_role text default 'client')
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', b.id, 'address', b.local || '@propertystars.app', 'label', b.label)
    from mail_boxes b where b.center_id = p_center and b.role = p_role and b.active limit 1
$$;
revoke all on function public.mail_center_box(uuid, text) from public, anon, authenticated;

-- service role: an email a system sent from a mailbox (a receipt), kept as a sent conversation there
create or replace function public.mail_log_outbound(p_box uuid, p_to text, p_subject text, p_html text, p_text text, p_resend_id text, p_ext_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b mail_boxes; t ms_threads; v uuid := gen_random_uuid(); v_to text := lower(trim(coalesce(p_to, '')));
begin
  select * into b from mail_boxes where id = p_box and active;
  if b.id is null or v_to = '' then return null; end if;
  select * into t from ms_threads where mailbox_id = b.id and lower(contact_email) = v_to order by last_at desc limit 1;
  if t.id is null then
    insert into ms_threads (mailbox_id, subject, contact_email, last_dir) values (b.id, coalesce(nullif(trim(p_subject), ''), '(no subject)'), v_to, 'out') returning * into t;
  end if;
  insert into ms_messages (id, thread_id, dir, status, from_email, from_name, to_emails, subject, html, text_body, snippet, message_id, ext_message_id, resend_id, at)
  values (v, t.id, 'out', 'sent', b.local || '@propertystars.app', b.label, array[v_to], p_subject, p_html, p_text,
          ms_mail_snippet(coalesce(nullif(p_text, ''), p_html)), '<' || v || '@propertystars.app>', p_ext_id, p_resend_id, now());
  update ms_threads set last_at = now(), last_dir = 'out', last_snippet = ms_mail_snippet(coalesce(nullif(p_text, ''), p_html)), messages = messages + 1
   where id = t.id;
  return jsonb_build_object('thread_id', t.id, 'message_id', v);
end $$;
revoke all on function public.mail_log_outbound(uuid, text, text, text, text, text, text) from public, anon, authenticated;

-- ───────────── booking emails ─────────────
create or replace function public.app_mb_booking_emailed(p_id uuid, p_kind text, p_thread uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b mb_bookings;
begin
  select * into b from mb_bookings where id = p_id;
  if b.id is null then raise exception 'That booking doesn''t exist'; end if;
  perform mb_list_ok(b.list_id, true);
  update mb_bookings set sent_emails = sent_emails || jsonb_build_array(jsonb_build_object('kind', p_kind, 'at', now(), 'thread_id', p_thread, 'by', auth.uid()))
   where id = p_id;
end $$;
revoke all on function public.app_mb_booking_emailed(uuid, text, uuid) from public, anon;
grant execute on function public.app_mb_booking_emailed(uuid, text, uuid) to authenticated;

-- a centre's email templates (receipts and booking emails)
create or replace function public.app_email_templates(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (app_has_perm('bookings') or app_has_perm('sa_users') or coalesce(app_is_super_admin(), false)) or not app_can_see_center(p_center) then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'type', e.template_type, 'name', e.template_name, 'subject', e.subject,
           'html', e.html_content, 'active', e.is_active, 'updated_at', e.updated_at) order by e.template_type)
           from email_templates e where e.command_center_id = p_center), '[]'::jsonb);
end $$;
revoke all on function public.app_email_templates(uuid) from public, anon;
grant execute on function public.app_email_templates(uuid) to authenticated;

create or replace function public.app_email_template_save(p_center uuid, p_type text, p_name text, p_subject text, p_html text, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v email_templates;
begin
  if not (app_has_perm('bookings') or app_has_perm('sa_users') or coalesce(app_is_super_admin(), false)) or not app_can_see_center(p_center) then raise exception 'Not allowed'; end if;
  if coalesce(p_type, '') !~ '^[a-z_]{2,60}$' then raise exception 'Unknown template'; end if;
  if nullif(trim(coalesce(p_subject, '')), '') is null or nullif(trim(coalesce(p_html, '')), '') is null then raise exception 'A template needs a subject and a body'; end if;
  insert into email_templates (command_center_id, template_type, template_name, subject, html_content, is_active, updated_at)
  values (p_center, p_type, coalesce(nullif(trim(p_name), ''), p_type), trim(p_subject), p_html, coalesce(p_active, true), now())
  on conflict (command_center_id, template_type) do update
     set template_name = excluded.template_name, subject = excluded.subject, html_content = excluded.html_content,
         is_active = excluded.is_active, updated_at = now()
  returning * into v;
  return jsonb_build_object('id', v.id, 'type', v.template_type);
end $$;
revoke all on function public.app_email_template_save(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.app_email_template_save(uuid, text, text, text, text, boolean) to authenticated;

do $$
declare f text;
begin
  foreach f in array array['mail_admin_set_center_box(uuid,text,text)', 'mail_admin_center_boxes(uuid)', 'mail_admin_box_member(uuid,uuid,boolean)', 'mail_admin_user_boxes(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- a booking as the office sees it: now with the booking emails it was sent
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
    'plan', (select jsonb_build_object('id', p.id, 'kind', p.kind, 'year', p.year, 'price', p.price, 'prepaid', p.prepaid) from mb_plans p where p.id = b.plan_id))
$$;
revoke all on function public.mb_booking_json(mb_bookings) from public, anon, authenticated;
