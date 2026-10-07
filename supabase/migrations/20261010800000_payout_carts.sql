-- Editable payouts for closed days: each cart and its sales. ADDITIVE ONLY.
--
--   payout_carts   one cart (or ramp crew) on a day: who was on it (with splits, machine rental and
--                  deductions per person), the EQ if it was overridden at payout, crackfiller, bonuses,
--                  and the day's tax / product-cost settings
--   payout_sales   the cart's sales: route, address, client, price, how it was paid, service, notes.
--                  No card numbers, expiry dates or CVCs (none of those columns exist).
--
-- A day's carts, sales and payout lines are saved together by app_save_payout_day, so the lines are
-- always what the carts work out to. Generating a payslip locks the day: while any of its lines is on
-- a payslip that isn't void, it can't be changed (void the payslip to unlock it).

create table if not exists public.payout_carts (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.command_centers(id) on delete restrict,
  day date not null,
  sort int not null default 0,
  label text not null default '',
  manager text,
  members jsonb not null default '[]',      -- [{hire_id, cn, first_name, last_name, equiv_split, upsell_split, machine_rental, deductions}]
  eq_override numeric,                      -- the team EQ if it was set at payout (else worked out from the sales)
  crackfill_lbs numeric not null default 0,
  bonuses jsonb not null default '[]',      -- [{label, amount, split: {cn: percent}}]
  settings jsonb not null default '{}',     -- {taxRate, productCostPercent, noTaxOnCash}
  notes text,
  source text,                              -- close_day | payout_stats_sheet | edited
  created_by uuid, created_at timestamptz not null default now(),
  updated_by uuid, updated_at timestamptz not null default now()
);
create index if not exists payout_carts_center_day on public.payout_carts (center_id, day);

create table if not exists public.payout_sales (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.payout_carts(id) on delete cascade,
  center_id uuid not null references public.command_centers(id) on delete restrict,
  day date not null,
  sort int not null default 0,
  route_code text,
  address text,
  client_name text,
  price numeric not null default 0,
  payment_type text not null default 'Cash',   -- Cash | Cheque | Credit Card | E-Transfer | Prepaid | Billed | IOS
  payments jsonb,                              -- a split payment: {"Cash": 100, "E-Transfer": 50}
  type text not null default 'Sale' check (type in ('Sale', 'Production', 'Upgrade', 'Add-On')),
  display_price text,
  service text,
  notes text check (notes is null or notes !~ '(\d[ -]?){13,19}'),   -- never a card number (even with spaces or dashes)
  meta jsonb not null default '{}'             -- asphalt / ramp-crew details carried from the payout
);
create index if not exists payout_sales_cart on public.payout_sales (cart_id, sort);
create index if not exists payout_sales_center_day on public.payout_sales (center_id, day);

alter table public.payout_carts enable row level security;
alter table public.payout_sales enable row level security;
drop policy if exists payout_carts_read on public.payout_carts;
create policy payout_carts_read on public.payout_carts for select to authenticated
  using (app_has_perm('workerbook') and app_can_see_center(center_id));
drop policy if exists payout_sales_read on public.payout_sales;
create policy payout_sales_read on public.payout_sales for select to authenticated
  using (app_has_perm('workerbook') and app_can_see_center(center_id));
revoke all on public.payout_carts, public.payout_sales from anon, authenticated;
grant select on public.payout_carts, public.payout_sales to authenticated;

-- Save a day's carts, their sales and the payout lines they work out to, all or nothing.
create or replace function public.app_save_payout_day(p_center uuid, p_day date, p_carts jsonb, p_lines jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  ci bigint;
  cart_id uuid;
  n int;
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  if exists (select 1 from payout_lines l join payslips s on s.id = l.payslip_id
              where l.center_id = p_center and l.day = p_day and s.status <> 'void') then
    raise exception '% is on a generated payslip, so it''s locked. Void that payslip to change the day.', p_day;
  end if;
  if not exists (select 1 from days where center_id = p_center and day = p_day and state in ('live', 'closed')) then
    raise exception 'There''s no session on % to save payouts for', p_day;
  end if;

  delete from payout_carts where center_id = p_center and day = p_day;   -- sales go with them
  for c, ci in select x, o from jsonb_array_elements(coalesce(p_carts, '[]'::jsonb)) with ordinality t(x, o) loop
    insert into payout_carts (center_id, day, sort, label, manager, members, eq_override, crackfill_lbs, bonuses, settings, notes, source, created_by, updated_by)
    values (p_center, p_day, ci, coalesce(c->>'label', ''), nullif(c->>'manager', ''), coalesce(c->'members', '[]'::jsonb),
            nullif(c->>'eq_override', '')::numeric, coalesce(nullif(c->>'crackfill_lbs', '')::numeric, 0),
            coalesce(c->'bonuses', '[]'::jsonb), coalesce(c->'settings', '{}'::jsonb), nullif(c->>'notes', ''),
            coalesce(c->>'source', 'edited'), auth.uid(), auth.uid())
    returning id into cart_id;
    insert into payout_sales (cart_id, center_id, day, sort, route_code, address, client_name, price, payment_type, payments, type, display_price, service, notes, meta)
    select cart_id, p_center, p_day, so, nullif(s->>'route_code', ''), nullif(s->>'address', ''), nullif(s->>'client_name', ''),
           coalesce(nullif(s->>'price', '')::numeric, 0), coalesce(nullif(s->>'payment_type', ''), 'Cash'),
           case when jsonb_typeof(s->'payments') = 'object' then s->'payments' end,
           coalesce(nullif(s->>'type', ''), 'Sale'), nullif(s->>'display_price', ''), nullif(s->>'service', ''), nullif(s->>'notes', ''),
           coalesce(s->'meta', '{}'::jsonb)
      from jsonb_array_elements(coalesce(c->'sales', '[]'::jsonb)) with ordinality u(s, so);
  end loop;

  n := app_save_payout_lines(p_center, p_day, p_lines);
  return n;
end $$;

revoke all on function public.app_save_payout_day(uuid, date, jsonb, jsonb) from public, anon;
grant execute on function public.app_save_payout_day(uuid, date, jsonb, jsonb) to authenticated;
