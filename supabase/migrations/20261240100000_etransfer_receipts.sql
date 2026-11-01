-- Accounts Reporting: e-transfer receipts forwarded to payments@propertystars.app, matched to the e-transfer
-- sales of the saved payout days (payout_sales). Additive only.
--   etf_receipts  one row per email that landed in payments@ (Claude reads the forwarded bank notice)
--   etf_matches   a receipt ↔ a sale; confirmed = counts as received (automatic when it's clear, else a person
--                 confirms). Taking a match off sets active = false; nothing is ever removed.
-- A day's payout sales are rewritten each time the day is saved (new ids), so a match points at the sale by a
-- key made from what the sale is (centre, day, client, address, route, e-transfer amount), not by its id.
-- Read and changed only through the app_etf_* functions, for super admins and people with sa_reporting.

-- 1. the mailbox
insert into public.mail_boxes (local, kind, active, label)
values ('payments', 'shared', true, 'Payments · e-transfer receipts')
on conflict (local) do nothing;

insert into public.mail_box_members (box_id, user_id)
select b.id, u.id from public.mail_boxes b cross join public.app_users u
where b.local = 'payments' and u.is_super_admin and u.is_active
  and not exists (select 1 from public.mail_box_members m where m.box_id = b.id and m.user_id = u.id);

-- 2. tables
create table if not exists public.etf_receipts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid unique references public.ms_messages(id),
  received_at timestamptz not null default now(),
  forwarded_by text,
  subject text,
  sender_name text,
  sender_email text,
  amount numeric(12, 2),
  sent_on date,
  reference text,
  memo text,
  bank text,
  status text not null default 'new'
    check (status in ('new', 'matched', 'review', 'unmatched', 'ignored', 'not_receipt', 'not_forward', 'error')),
  note text,
  parsed jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists etf_receipts_status on public.etf_receipts (status);

create table if not exists public.etf_matches (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.etf_receipts(id),
  sale_key text not null,
  center_id uuid,
  day date,
  client text,
  amount numeric(12, 2),
  how text not null check (how in ('auto', 'claude', 'manual')),
  confidence text,
  reason text,
  confirmed boolean not null default false,
  matched_by uuid references public.app_users(id),
  matched_at timestamptz not null default now(),
  active boolean not null default true
);
create index if not exists etf_matches_receipt on public.etf_matches (receipt_id) where active;
create unique index if not exists etf_matches_one_per_sale on public.etf_matches (sale_key) where active;

alter table public.etf_receipts enable row level security;
alter table public.etf_matches enable row level security;
revoke all on public.etf_receipts, public.etf_matches from anon, authenticated;

create index if not exists payout_sales_etf on public.payout_sales (center_id, day)
  where payment_type = 'E-Transfer' or payments ? 'E-Transfer';

-- 3. helpers
create or replace function public.app_etf_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  select app_is_super_admin() or app_has_perm('sa_reporting')
$$;

-- The e-transfer part of a sale: the E-Transfer amount of a split payment, or the whole price.
create or replace function public.etf_amount(p_type text, p_payments jsonb, p_price numeric)
returns numeric language sql immutable set search_path = public as $$
  select round(coalesce(nullif(p_payments->>'E-Transfer', '')::numeric, case when p_type = 'E-Transfer' then p_price end), 2)
$$;

create or replace function public.etf_sale_key(p_center uuid, p_day date, p_client text, p_address text, p_route text, p_amount numeric)
returns text language sql immutable set search_path = public as $$
  select md5(concat_ws('|', p_center, p_day, lower(regexp_replace(coalesce(p_client, ''), '\s+', ' ', 'g')),
                        lower(regexp_replace(coalesce(p_address, ''), '\s+', ' ', 'g')), upper(coalesce(p_route, '')), round(coalesce(p_amount, 0), 2)))
$$;

-- every e-transfer sale with its key (the one place that decides what counts as an e-transfer sale)
create or replace function public.etf_sales(p_center uuid, p_from date, p_to date)
returns table (id uuid, sale_key text, day date, center_id uuid, center text, route_code text, address text, client text,
               amount numeric, price numeric, split boolean, cart text, manager text, sort int)
language sql stable security definer set search_path = public as $$
  select s.id, etf_sale_key(s.center_id, s.day, s.client_name, s.address, s.route_code, etf_amount(s.payment_type, s.payments, s.price)),
         s.day, s.center_id, cc.display_name, s.route_code, s.address, nullif(trim(s.client_name), ''),
         etf_amount(s.payment_type, s.payments, s.price), s.price, s.payment_type <> 'E-Transfer', c.label, c.manager, s.sort
  from payout_sales s
  join payout_carts c on c.id = s.cart_id
  left join command_centers cc on cc.id = s.center_id
  where (s.payment_type = 'E-Transfer' or s.payments ? 'E-Transfer')
    and coalesce(etf_amount(s.payment_type, s.payments, s.price), 0) > 0
    and (p_center is null or s.center_id = p_center)
    and s.day between coalesce(p_from, '2000-01-01') and coalesce(p_to, '2100-01-01')
$$;

-- 4. the report: the e-transfer sales in a period (one centre or all) with their match, and every receipt
create or replace function public.app_etf_report(p_center uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not app_etf_allowed() then raise exception 'Accounts Reporting is for super admins'; end if;
  select jsonb_build_object(
    'sales', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'key', s.sale_key, 'day', s.day, 'center_id', s.center_id, 'center', s.center, 'route_code', s.route_code,
        'address', s.address, 'client', s.client, 'amount', s.amount, 'price', s.price, 'split', s.split, 'cart', s.cart, 'manager', s.manager,
        'match', case when m.id is null then null else jsonb_build_object(
          'id', m.id, 'receipt_id', m.receipt_id, 'how', m.how, 'confidence', m.confidence, 'reason', m.reason,
          'confirmed', m.confirmed, 'sender', r.sender_name, 'sender_email', r.sender_email, 'amount', r.amount,
          'sent_on', r.sent_on, 'reference', r.reference, 'memo', r.memo) end
      ) order by s.day desc, s.center, s.cart, s.sort)
      from etf_sales(p_center, p_from, p_to) s
      left join etf_matches m on m.sale_key = s.sale_key and m.active
      left join etf_receipts r on r.id = m.receipt_id), '[]'::jsonb),
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'received_at', r.received_at, 'forwarded_by', r.forwarded_by, 'subject', r.subject,
        'sender', r.sender_name, 'sender_email', r.sender_email, 'amount', r.amount, 'sent_on', r.sent_on,
        'reference', r.reference, 'memo', r.memo, 'bank', r.bank, 'status', r.status, 'note', r.note,
        'thread_id', (select x.thread_id from ms_messages x where x.id = r.message_id),
        'sales', coalesce((select jsonb_agg(jsonb_build_object('match_id', m.id, 'key', m.sale_key, 'confirmed', m.confirmed, 'day', m.day,
                             'client', m.client, 'amount', m.amount, 'reason', m.reason, 'how', m.how))
                           from etf_matches m where m.receipt_id = r.id and m.active), '[]'::jsonb)
      ) order by coalesce(r.sent_on, r.received_at::date) desc, r.received_at desc)
      from etf_receipts r), '[]'::jsonb)
  ) into v;
  return v;
end $$;

-- 5. a person matching by hand: confirm a suggestion, link a receipt to a sale, take a match off, ignore a receipt
create or replace function public.etf_refresh_status(p_receipt uuid)
returns void language sql security definer set search_path = public as $$
  update etf_receipts r set updated_at = now(), status = case
      when exists (select 1 from etf_matches m where m.receipt_id = r.id and m.active and m.confirmed) then 'matched'
      when exists (select 1 from etf_matches m where m.receipt_id = r.id and m.active) then 'review'
      when r.status in ('ignored', 'not_receipt', 'not_forward', 'error') then r.status
      else 'unmatched' end
  where r.id = p_receipt
$$;

-- Link a receipt to a sale (by the sale's key). Also used by the matcher (service role) with how/confirmed.
create or replace function public.etf_link(p_receipt uuid, p_key text, p_how text, p_confidence text, p_reason text, p_confirmed boolean, p_by uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare s record; v_old uuid; v uuid;
begin
  select * into s from etf_sales(null, null, null) x where x.sale_key = p_key limit 1;
  if s.sale_key is null then raise exception 'That sale is gone'; end if;
  update etf_matches set active = false where sale_key = p_key and active returning receipt_id into v_old;
  insert into etf_matches (receipt_id, sale_key, center_id, day, client, amount, how, confidence, reason, confirmed, matched_by)
  values (p_receipt, p_key, s.center_id, s.day, s.client, s.amount, p_how, p_confidence, p_reason, p_confirmed, p_by)
  returning id into v;
  if v_old is not null and v_old <> p_receipt then perform etf_refresh_status(v_old); end if;
  perform etf_refresh_status(p_receipt);
  return v;
end $$;

create or replace function public.app_etf_match(p_receipt uuid, p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_etf_allowed() then raise exception 'Accounts Reporting is for super admins'; end if;
  if not exists (select 1 from etf_receipts where id = p_receipt) then raise exception 'That receipt is gone'; end if;
  perform etf_link(p_receipt, p_key, 'manual', 'high', 'Matched by hand', true, auth.uid());
end $$;

create or replace function public.app_etf_confirm(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not app_etf_allowed() then raise exception 'Accounts Reporting is for super admins'; end if;
  update etf_matches set confirmed = true, matched_by = auth.uid(), matched_at = now() where id = p_match and active returning receipt_id into v;
  if v is null then raise exception 'That match is gone'; end if;
  perform etf_refresh_status(v);
end $$;

create or replace function public.app_etf_unmatch(p_match uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not app_etf_allowed() then raise exception 'Accounts Reporting is for super admins'; end if;
  update etf_matches set active = false, matched_by = auth.uid(), matched_at = now() where id = p_match and active returning receipt_id into v;
  if v is not null then perform etf_refresh_status(v); end if;
end $$;

create or replace function public.app_etf_ignore(p_receipt uuid, p_ignore boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_etf_allowed() then raise exception 'Accounts Reporting is for super admins'; end if;
  update etf_receipts set status = case when p_ignore then 'ignored' else 'unmatched' end, updated_at = now() where id = p_receipt;
  if not p_ignore then perform etf_refresh_status(p_receipt); end if;
end $$;

-- 6. for Claude's matcher (service role only): the not-yet-received e-transfer sales that could fit a receipt —
-- the same amount, or a word of the sender's name in the client's name, sold up to 3 weeks before it was sent
create or replace function public.etf_candidates(p_amount numeric, p_on date, p_name text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by x->>'day' desc), '[]'::jsonb) from (
    select jsonb_build_object('key', s.sale_key, 'day', s.day, 'center', s.center, 'client', s.client, 'address', s.address,
             'route_code', s.route_code, 'amount', s.amount, 'cart', s.cart,
             'same_amount', abs(s.amount - coalesce(p_amount, -1)) < 0.005,
             'suggested', exists (select 1 from etf_matches m where m.sale_key = s.sale_key and m.active)) x
    from etf_sales(null, coalesce(p_on, current_date) - 21, coalesce(p_on, current_date) + 2) s
    where not exists (select 1 from etf_matches m where m.sale_key = s.sale_key and m.active and m.confirmed)
      and (abs(s.amount - coalesce(p_amount, -1)) < 0.005
           or (coalesce(p_name, '') <> '' and exists (
                 select 1 from regexp_split_to_table(lower(p_name), '[^a-z]+') w
                 where length(w) >= 3 and lower(coalesce(s.client, '')) ~ ('\m' || w || '\M'))))
    limit 60) q
$$;

-- receipts that may now find their sale (a day saved after the receipt came in): "Check again"
create or replace function public.etf_open_receipts()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from etf_receipts where status in ('unmatched', 'new', 'error') order by received_at
$$;

revoke all on function public.app_etf_allowed(), public.etf_sales(uuid, date, date), public.etf_refresh_status(uuid),
  public.etf_link(uuid, text, text, text, text, boolean, uuid), public.etf_candidates(numeric, date, text),
  public.etf_open_receipts() from public, anon, authenticated;
grant execute on function public.app_etf_allowed() to authenticated;
revoke all on function public.app_etf_report(uuid, date, date), public.app_etf_match(uuid, text), public.app_etf_confirm(uuid),
  public.app_etf_unmatch(uuid), public.app_etf_ignore(uuid, boolean) from public, anon;
grant execute on function public.app_etf_report(uuid, date, date), public.app_etf_match(uuid, text), public.app_etf_confirm(uuid),
  public.app_etf_unmatch(uuid), public.app_etf_ignore(uuid, boolean) to authenticated;
