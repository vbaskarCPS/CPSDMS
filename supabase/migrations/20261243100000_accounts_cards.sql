-- Accounts Reporting: the Inbox list fixed (an ORDER BY outside the aggregate broke it), and a Credit cards
-- section — every card charge the app attempted (bambora_idempotency), so double charges can be found and refunded.
-- Only what Bambora answered is kept there: card type and last 4, never a card number.

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
      from (select m.* from ms_messages m join ms_threads t on t.id = m.thread_id join mail_boxes b on b.id = t.mailbox_id
             where b.local = 'payments' and m.dir = 'in'
               and (q is null or m.subject ilike '%' || q || '%' or m.from_email ilike '%' || q || '%' or m.text_body ilike '%' || q || '%')
             order by m.at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) m), '[]'::jsonb);
end $$;

-- Every card charge attempted between two days (Pacific dates: the crews are in BC), newest first, with the
-- saved sale it most likely belongs to (same client name on that day; the charge is the price, or the price
-- with GST or GST+PST on it). Grouping into "tries" and spotting double charges is done in the app.
create or replace function public.app_cards_report(p_from date, p_to date, p_center uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not app_etf_allowed() then raise exception 'Accounts Reporting is for super admins'; end if;
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'key', b.idempotency_key, 'at', b.created_at, 'day', (b.created_at at time zone 'America/Vancouver')::date,
             'status', b.status, 'amount', b.amount, 'client', nullif(regexp_replace(trim(coalesce(b.client_name, '')), '\s+', ' ', 'g'), ''),
             'card_type', b.response_data->>'cardType', 'last4', b.response_data->>'last4',
             'transaction_id', b.response_data->>'transactionId', 'auth_code', b.response_data->>'authCode',
             'message', b.response_data->>'message', 'code', b.response_data->>'code',
             'sale', (select jsonb_build_object('id', s.id, 'day', s.day, 'client', s.client_name, 'price', s.price, 'route_code', s.route_code,
                                                'address', s.address, 'center', c.display_name, 'center_id', s.center_id, 'payment_type', s.payment_type)
                        from payout_sales s join command_centers c on c.id = s.center_id
                       where lower(regexp_replace(trim(coalesce(s.client_name, '')), '\s+', ' ', 'g')) = lower(regexp_replace(trim(coalesce(b.client_name, '')), '\s+', ' ', 'g'))
                         and s.day between (b.created_at at time zone 'America/Vancouver')::date - 1 and (b.created_at at time zone 'America/Vancouver')::date
                         and (p_center is null or s.center_id = p_center)
                       order by (abs(s.price - coalesce(b.amount::numeric, 0)) < 0.01) desc,
                                (abs(round(s.price * 1.05, 2) - coalesce(b.amount::numeric, 0)) < 0.01) desc,
                                (abs(round(s.price * 1.12, 2) - coalesce(b.amount::numeric, 0)) < 0.01) desc,
                                abs(s.price - coalesce(b.amount::numeric, 0))
                       limit 1)))
           order by b.created_at desc)
      from bambora_idempotency b
     where (b.created_at at time zone 'America/Vancouver')::date between p_from and p_to), '[]'::jsonb);
end $$;
revoke all on function public.app_cards_report(date, date, uuid) from public, anon;
grant execute on function public.app_cards_report(date, date, uuid) to authenticated;
