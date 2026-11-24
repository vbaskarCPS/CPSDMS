-- Card Processing: managers take a card over the phone for a spring or fall booking (first use: abandoned-cart
-- calls from the Shopify campaign). Its own permission, so it can be given to a few managers.
--
--   card_sales             one row per charge attempt: who the customer is, where the work is (address, city and
--                          province only: the regions these belong to don't all exist yet), what was sold, the
--                          tax-included total and the tax inside it, who processed it, and what Bambora answered
--                          (card type, last 4, approval code, transaction id). Never a card number or CVC: the card
--                          is typed into Bambora's own fields and only a one-time token reaches the card-sale function.
--   card_receipt_template  the one receipt email everyone's customers get
--   card_can()             has the Card Processing permission
--   card_sales_list / card_sales_stats / card_receipt_template_get / _save   what the screen reads and saves
-- Charging and the receipt email: supabase/functions/card-sale. Nothing here touches Master Bookings yet.

alter table public.user_permissions
  drop constraint user_permissions_permission_check,
  add constraint user_permissions_permission_check check (permission = any (array[
    'route_manager', 'rm_floater', 'workerbook', 'bookings', 'dialer', 'sa_users', 'sa_territory', 'sa_reporting',
    'mainstreet_admin', 'mainstreet_rep', 'card_processing']));

-- the super admin has it from the start, to try it and hand it out
insert into public.user_permissions (user_id, permission)
select id, 'card_processing' from public.app_users where is_super_admin and is_active
on conflict do nothing;

create or replace function public.card_can()
returns boolean language sql stable security definer set search_path = public as $$
  select app_has_perm('card_processing')
$$;
revoke all on function public.card_can() from public, anon;
grant execute on function public.card_can() to authenticated;

create table if not exists public.card_sales (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  processed_by uuid references public.app_users(id) on delete set null,
  processed_by_name text not null,                 -- who sold it: whoever processed the card
  first_name text not null,
  last_name text not null,
  phone text,
  email text,
  address text not null,
  city text not null,
  province text not null,
  postal_code text,
  items jsonb not null,                            -- [{ service, label, season, year, price }]
  total numeric(10,2) not null check (total > 0),  -- what the card is charged: tax included
  subtotal numeric(10,2) not null,
  tax_amount numeric(10,2) not null,
  tax_name text not null,
  tax_rate numeric(6,5) not null,
  notes text,
  status text not null default 'processing' check (status in ('processing', 'approved', 'declined', 'error')),
  idempotency_key text not null unique,            -- one per press of Charge: a second request with it never charges again
  transaction_id text,
  auth_code text,
  card_type text,
  last4 text,
  message text,
  code text,
  receipt_to text,
  receipt_sent_at timestamptz,
  receipt_error text
);
create index if not exists card_sales_created on public.card_sales (created_at desc);
alter table public.card_sales enable row level security;
revoke all on table public.card_sales from public, anon, authenticated;

create table if not exists public.card_receipt_template (
  id int primary key default 1 check (id = 1),
  subject text not null,
  greeting text not null,
  closing text not null,
  footer text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.app_users(id) on delete set null
);
insert into public.card_receipt_template (id, subject, greeting, closing, footer)
values (1, 'Your Property Stars receipt',
        E'Hi {first_name},\n\nThank you for booking with Property Stars. Here is your receipt.',
        E'We’ll be in touch before your service to confirm your date.\n\nQuestions? Reply to this email.',
        'Property Stars')
on conflict (id) do nothing;
alter table public.card_receipt_template enable row level security;
revoke all on table public.card_receipt_template from public, anon, authenticated;

-- ───────────── what the screen reads ─────────────
create or replace function public.card_sales_list(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not card_can() then raise exception 'Card Processing isn’t turned on for your account'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (select s.id, s.created_at, s.processed_by_name, s.first_name, s.last_name, s.phone, s.email, s.address, s.city, s.province,
                   s.postal_code, s.items, s.total, s.subtotal, s.tax_amount, s.tax_name, s.tax_rate, s.notes, s.status, s.transaction_id,
                   s.auth_code, s.card_type, s.last4, s.message, s.receipt_to, s.receipt_sent_at, s.receipt_error
              from card_sales s
             where s.created_at >= (p_from::timestamp at time zone 'America/Toronto')
               and s.created_at < ((p_to + 1)::timestamp at time zone 'America/Toronto')
             order by s.created_at desc limit 3000) x), '[]'::jsonb);
end $$;
revoke all on function public.card_sales_list(date, date) from public, anon;
grant execute on function public.card_sales_list(date, date) to authenticated;

create or replace function public.card_sales_stats()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_day timestamptz := date_trunc('day', now() at time zone 'America/Toronto') at time zone 'America/Toronto';
        v_month timestamptz := date_trunc('month', now() at time zone 'America/Toronto') at time zone 'America/Toronto';
begin
  if not card_can() then raise exception 'Card Processing isn’t turned on for your account'; end if;
  return jsonb_build_object(
    'today_n', (select count(*) from card_sales where status = 'approved' and created_at >= v_day),
    'today_total', (select coalesce(sum(total), 0) from card_sales where status = 'approved' and created_at >= v_day),
    'month_n', (select count(*) from card_sales where status = 'approved' and created_at >= v_month),
    'month_total', (select coalesce(sum(total), 0) from card_sales where status = 'approved' and created_at >= v_month),
    'today_declined', (select count(*) from card_sales where status in ('declined', 'error') and created_at >= v_day));
end $$;
revoke all on function public.card_sales_stats() from public, anon;
grant execute on function public.card_sales_stats() to authenticated;

create or replace function public.card_receipt_template_get()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not card_can() then raise exception 'Card Processing isn’t turned on for your account'; end if;
  return (select jsonb_build_object('subject', t.subject, 'greeting', t.greeting, 'closing', t.closing, 'footer', t.footer,
                                    'updated_at', t.updated_at, 'updated_by', (select full_name from app_users where id = t.updated_by),
                                    'can_edit', app_is_super_admin())
            from card_receipt_template t where t.id = 1);
end $$;
revoke all on function public.card_receipt_template_get() from public, anon;
grant execute on function public.card_receipt_template_get() to authenticated;

create or replace function public.card_receipt_template_save(p_subject text, p_greeting text, p_closing text, p_footer text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_is_super_admin() then raise exception 'Only a super admin can change the receipt email'; end if;
  if nullif(trim(coalesce(p_subject, '')), '') is null then raise exception 'The receipt needs a subject'; end if;
  update card_receipt_template
     set subject = left(trim(p_subject), 150), greeting = left(coalesce(p_greeting, ''), 2000), closing = left(coalesce(p_closing, ''), 2000),
         footer = left(coalesce(p_footer, ''), 500), updated_at = now(), updated_by = auth.uid()
   where id = 1;
end $$;
revoke all on function public.card_receipt_template_save(text, text, text, text) from public, anon;
grant execute on function public.card_receipt_template_save(text, text, text, text) to authenticated;
