-- payments@propertystars.app is a working mailbox for the e-transfer matcher, not a place to read mail.
-- It leaves the personal Mail app (the mailbox list, the combined inbox, the unread count) and is read from
-- Super Admin › Accounts Reporting instead (app_etf_inbox / app_etf_message, for anyone app_etf_allowed()).

-- the mailboxes that stay out of the Mail app
create or replace function public.mail_hidden_box_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(b.id), '{}') from mail_boxes b where b.local = 'payments'
$$;
revoke all on function public.mail_hidden_box_ids() from public, anon, authenticated;

create or replace function public.mail_my_boxes()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'address', b.local || '@propertystars.app', 'kind', b.kind,
           'label', b.label, 'role', b.role, 'center_id', b.center_id, 'mine', b.owner_id = auth.uid(),
           'unread', (select count(*) from ms_threads t where t.mailbox_id = b.id and t.unread > 0 and not t.archived))
         order by (b.owner_id = auth.uid()) desc nulls last, b.kind, b.label nulls last, b.created_at), '[]'::jsonb)
    from mail_boxes b where b.id = any (mail_my_box_ids()) and not (b.id = any (mail_hidden_box_ids()))
$$;

create or replace function public.mail_counts()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'unread', (select count(*) from ms_threads t where t.mailbox_id = any (mail_my_box_ids()) and not (t.mailbox_id = any (mail_hidden_box_ids()))
                 and t.unread > 0 and not t.archived),
    'approve', (select count(distinct s.thread_id) from mail_suggestions s join ms_threads t on t.id = s.thread_id
                 where s.status = 'pending' and t.mailbox_id = any (mail_my_box_ids()) and not (t.mailbox_id = any (mail_hidden_box_ids()))))
$$;

-- the combined inbox (no mailbox chosen) leaves hidden mailboxes out; asking for one by id still works
create or replace function public.mail_inbox(p_box uuid default null, p_folder text default 'inbox', p_search text default null, p_limit int default 60, p_before timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(coalesce(p_search, '')), ''); mine uuid[] := mail_my_box_ids(); hidden uuid[] := mail_hidden_box_ids();
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
               and (p_box is not null or not (t.mailbox_id = any (hidden)))
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

-- Accounts Reporting › Inbox: every email that reached payments@, newest first, with what the matcher made of it
create or replace function public.app_etf_inbox(p_search text default null, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not app_etf_allowed() then raise exception 'Accounts Reporting is for super admins'; end if;
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'message_id', m.id, 'thread_id', m.thread_id, 'at', m.at, 'from_email', m.from_email, 'from_name', m.from_name,
             'subject', m.subject, 'snippet', m.snippet, 'read', m.read_at is not null,
             'receipt', (select jsonb_build_object('id', r.id, 'status', r.status, 'note', r.note, 'sender', r.sender_name, 'amount', r.amount,
                                                   'sent_on', r.sent_on, 'bank', r.bank, 'memo', r.memo,
                                                   'sales', (select coalesce(jsonb_agg(jsonb_build_object('client', x.client, 'day', x.day, 'amount', x.amount, 'confirmed', x.confirmed)), '[]'::jsonb)
                                                               from etf_matches x where x.receipt_id = r.id and x.active))
                           from etf_receipts r where r.message_id = m.id)))
           order by m.at desc)
      from ms_messages m join ms_threads t on t.id = m.thread_id join mail_boxes b on b.id = t.mailbox_id
     where b.local = 'payments' and m.dir = 'in'
       and (q is null or m.subject ilike '%' || q || '%' or m.from_email ilike '%' || q || '%' or m.text_body ilike '%' || q || '%')
     order by m.at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)), '[]'::jsonb);
end $$;
revoke all on function public.app_etf_inbox(text, int) from public, anon;
grant execute on function public.app_etf_inbox(text, int) to authenticated;

-- one email from payments@, to read it
create or replace function public.app_etf_message(p_message uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not app_etf_allowed() then raise exception 'Accounts Reporting is for super admins'; end if;
  return (select jsonb_build_object('id', m.id, 'at', m.at, 'from_email', m.from_email, 'from_name', m.from_name, 'to', m.to_emails,
                                    'subject', m.subject, 'html', m.html, 'text', m.text_body)
            from ms_messages m join ms_threads t on t.id = m.thread_id join mail_boxes b on b.id = t.mailbox_id
           where m.id = p_message and b.local = 'payments');
end $$;
revoke all on function public.app_etf_message(uuid) from public, anon;
grant execute on function public.app_etf_message(uuid) to authenticated;
