-- RUN_70 — grouped Sent and delivery status for the mailboxes.
--
-- ADDITIVE ONLY (new columns, new functions, a new overload; mail_inbox and ms_thread replaced with
-- the same signatures).
--
--   ms_messages.batch_key / batch_label    a sent email that belongs to a group: a booking-email
--                                          campaign ('campaign:<id>', "Day before · Thu, Oct 31") or a
--                                          session's receipts ('receipts:<session date>', "Receipts · Session Thu, Oct 30")
--   ms_messages.delivery / delivery_at / delivery_reason
--                                          what Resend said after sending: delivered, delayed, bounced, complained (spam)
--   mail_log_outbound(…, p_batch_key, p_batch_label)   (service role) a receipt kept in the mailbox, in its session's group
--   mail_tag_batch(box, messages, key, label)           as staff: put sent emails of a mailbox they use into a campaign group
--   mail_batches(box, limit, before)                    the groups in the mailboxes they use, newest first, with counts
--   mail_batch(box, key)                                one group's emails, problems first
--   mail_delivery(resend_id, type, reason, at)          (service role) a Resend delivery event; never steps back
--                                                       (a late "delivered" doesn't undo a bounce); bounces and spam
--                                                       complaints are also written to email_logs, as before
--   mail_inbox  replaced: the Sent folder leaves out conversations whose only sent emails are in groups
--               (they show in their group instead) — unless searching
--   ms_thread   replaced: each message also says its delivery status and group

alter table public.ms_messages add column if not exists batch_key text;
alter table public.ms_messages add column if not exists batch_label text;
alter table public.ms_messages add column if not exists delivery text;
alter table public.ms_messages add column if not exists delivery_at timestamptz;
alter table public.ms_messages add column if not exists delivery_reason text;
do $$ begin
  alter table public.ms_messages add constraint ms_messages_delivery_check check (delivery in ('delivered', 'delayed', 'bounced', 'complained'));
exception when duplicate_object then null; end $$;
create index if not exists ms_messages_batch on public.ms_messages (batch_key, at) where batch_key is not null;
create index if not exists email_logs_resend_message_id on public.email_logs (resend_message_id) where resend_message_id is not null;

-- ───────────── receipts: kept in the mailbox, in their session's group ─────────────
create or replace function public.mail_log_outbound(p_box uuid, p_to text, p_subject text, p_html text, p_text text, p_resend_id text, p_ext_id text,
                                                    p_batch_key text, p_batch_label text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; k text := left(nullif(trim(coalesce(p_batch_key, '')), ''), 120);
begin
  r := mail_log_outbound(p_box, p_to, p_subject, p_html, p_text, p_resend_id, p_ext_id);
  if r is not null and k is not null then
    update ms_messages set batch_key = k, batch_label = left(nullif(trim(coalesce(p_batch_label, '')), ''), 120)
     where id = (r->>'message_id')::uuid;
  end if;
  return r;
end $$;
revoke all on function public.mail_log_outbound(uuid, text, text, text, text, text, text, text, text) from public, anon, authenticated;

-- ───────────── booking-email campaigns ─────────────
create or replace function public.mail_tag_batch(p_box uuid, p_messages uuid[], p_key text, p_label text)
returns int language plpgsql security definer set search_path = public as $$
declare k text := left(nullif(trim(coalesce(p_key, '')), ''), 120); n int;
begin
  if p_box is null or not mail_box_can(p_box) then raise exception 'Not allowed'; end if;
  if k is null or k not like 'campaign:%' then raise exception 'A campaign group needs a campaign: key'; end if;
  update ms_messages m set batch_key = k, batch_label = left(nullif(trim(coalesce(p_label, '')), ''), 120)
    from ms_threads t
   where t.id = m.thread_id and t.mailbox_id = p_box and m.dir = 'out' and m.id = any (coalesce(p_messages, '{}'));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mail_tag_batch(uuid, uuid[], text, text) from public, anon;
grant execute on function public.mail_tag_batch(uuid, uuid[], text, text) to authenticated;

-- ───────────── the groups, and one group ─────────────
create or replace function public.mail_batches(p_box uuid default null, p_limit int default 60, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare mine uuid[] := mail_my_box_ids();
begin
  return coalesce((
    select jsonb_agg(g.j order by g.last_at desc)
      from (select max(m.at) as last_at, jsonb_build_object(
                     'key', m.batch_key, 'label', max(m.batch_label), 'mailbox_id', t.mailbox_id,
                     'mailbox', b.local || '@propertystars.app', 'mailbox_label', b.label,
                     'emails', count(*), 'first_at', min(m.at), 'last_at', max(m.at),
                     'delivered', count(*) filter (where m.delivery = 'delivered'),
                     'delayed', count(*) filter (where m.delivery = 'delayed'),
                     'bounced', count(*) filter (where m.delivery = 'bounced'),
                     'complained', count(*) filter (where m.delivery = 'complained'),
                     'failed', count(*) filter (where m.status = 'failed'),
                     'sending', count(*) filter (where m.status = 'sending')) as j
              from ms_messages m join ms_threads t on t.id = m.thread_id join mail_boxes b on b.id = t.mailbox_id
             where m.batch_key is not null and m.dir = 'out' and t.mailbox_id = any (mine) and (p_box is null or t.mailbox_id = p_box)
             group by m.batch_key, t.mailbox_id, b.local, b.label
            having p_before is null or max(m.at) < p_before
             order by max(m.at) desc
             limit least(greatest(coalesce(p_limit, 60), 1), 200)) g), '[]'::jsonb);
end $$;
revoke all on function public.mail_batches(uuid, int, timestamptz) from public, anon;
grant execute on function public.mail_batches(uuid, int, timestamptz) to authenticated;

create or replace function public.mail_batch(p_box uuid, p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_box is null or not mail_box_can(p_box) then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', m.id, 'thread_id', m.thread_id, 'to', to_jsonb(m.to_emails), 'contact_name', t.contact_name, 'subject', m.subject,
             'status', m.status, 'error', m.error, 'delivery', m.delivery, 'delivery_reason', m.delivery_reason, 'delivery_at', m.delivery_at,
             'at', m.at, 'label', m.batch_label))
           order by case when m.status = 'failed' or m.delivery in ('bounced', 'complained') then 0
                         when m.status = 'sending' or m.delivery = 'delayed' then 1 else 2 end, m.at, m.id)
      from ms_messages m join ms_threads t on t.id = m.thread_id
     where t.mailbox_id = p_box and m.dir = 'out' and m.batch_key = p_key), '[]'::jsonb);
end $$;
revoke all on function public.mail_batch(uuid, text) from public, anon;
grant execute on function public.mail_batch(uuid, text) to authenticated;

-- ───────────── delivery events from Resend ─────────────
create or replace function public.mail_delivery(p_resend_id text, p_type text, p_reason text default null, p_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v text := case p_type when 'email.delivered' then 'delivered' when 'email.delivery_delayed' then 'delayed'
                        when 'email.bounced' then 'bounced' when 'email.complained' then 'complained' end;
  rk int; why text := left(nullif(trim(coalesce(p_reason, '')), ''), 300); w timestamptz := coalesce(p_at, now()); n int := 0; l int := 0;
begin
  if v is null or nullif(trim(coalesce(p_resend_id, '')), '') is null then return jsonb_build_object('ignored', coalesce(p_type, 'unknown')); end if;
  rk := case v when 'delayed' then 1 when 'delivered' then 2 else 3 end;
  -- never step back: a late "delayed" or "delivered" doesn't undo a bounce
  update ms_messages set delivery = v, delivery_at = w, delivery_reason = case when v = 'delivered' then null else why end
   where resend_id = p_resend_id and dir = 'out'
     and case delivery when 'delayed' then 1 when 'delivered' then 2 when 'bounced' then 3 when 'complained' then 3 else 0 end <= rk;
  get diagnostics n = row_count;
  if v in ('bounced', 'complained') then
    update email_logs set status = 'bounced', bounce_reason = coalesce(why, case v when 'complained' then 'Marked as spam' else 'Email bounced' end), bounced_at = w
     where resend_message_id = p_resend_id;
    get diagnostics l = row_count;
  end if;
  return jsonb_build_object('delivery', v, 'messages', n, 'logs', l);
end $$;
revoke all on function public.mail_delivery(text, text, text, timestamptz) from public, anon, authenticated;

-- ───────────── the Sent folder: grouped emails show in their group ─────────────
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
                     when 'sent' then exists (select 1 from ms_messages m where m.thread_id = t.id and m.dir = 'out'
                                                and (q is not null or m.batch_key is null))
                     when 'archived' then t.archived
                     else true end
               and (q is null or t.subject ilike '%' || q || '%' or t.contact_email ilike '%' || q || '%' or t.contact_name ilike '%' || q || '%'
                    or exists (select 1 from ms_messages m where m.thread_id = t.id and (m.text_body ilike '%' || q || '%' or m.snippet ilike '%' || q || '%')))
             order by t.last_at desc
             limit least(greatest(coalesce(p_limit, 60), 1), 200)) t
      join mail_boxes b on b.id = t.mailbox_id), '[]'::jsonb);
end $$;

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
        'by', (select u.full_name from app_users u where u.id = m.sent_by),
        'delivery', m.delivery, 'delivery_reason', m.delivery_reason, 'group', m.batch_label)) order by m.at)
      from ms_messages m where m.thread_id = t.id), '[]'::jsonb));
end $$;
