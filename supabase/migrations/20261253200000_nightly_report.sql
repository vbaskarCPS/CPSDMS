-- Nightly report to Ben: one email a day, once every command center that ran a live day has closed it.
--
--   A day counts when any real center (not a demo) has it live or closed. The report goes out as soon as the
--   last of those is closed, whether that's the same night or the next morning. If one is still open when the
--   day after has ended (midnight Toronto), it goes anyway and says which ones are still open.
--
--   report_nightly_settings  who gets it, from which address, and the first day it covers
--   report_nightly_sends     one row a day: sending / sent / failed (failed tries again, up to 5 times)
--   report_nightly_due()     the days that are ready and not sent yet
--   report_nightly_data(day) the numbers: each center's sales, payments, jobs, workers, payouts, managers,
--                            and its month so far, all from the saved payouts (payout_sales / payout_lines)
--   report_nightly_kick()    when something is due, asks the nightly-report edge function to send it
--                            (on every day close, and every 10 minutes for the "day after has ended" case)

-- ───────────── settings ─────────────
create table if not exists public.report_nightly_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  recipients text[] not null,
  test_recipients text[] not null default '{}',      -- the edge function's 'test' action sends only here
  from_name text not null default 'Property Stars Reports',
  from_email text not null default 'report@propertystars.app',
  start_day date not null,
  updated_at timestamptz not null default now()
);
insert into public.report_nightly_settings (id, recipients, test_recipients, start_day)
values (1, array['ben.stewart@live.ca'], array['v.baskaran@property-stars.com'], date '2026-11-17')
on conflict (id) do nothing;
-- replies go to a person, not the report address
alter table public.report_nightly_settings add column if not exists reply_to text;
update public.report_nightly_settings set reply_to = 'v.baskaran@property-stars.com' where id = 1 and reply_to is null;
alter table public.report_nightly_settings enable row level security;
revoke all on table public.report_nightly_settings from public, anon, authenticated;

create table if not exists public.report_nightly_sends (
  day date primary key,
  status text not null check (status in ('sending', 'sent', 'failed')),
  attempts int not null default 0,
  forced boolean not null default false,          -- went before every center had closed (the day after had ended)
  open_centers text[] not null default '{}',
  recipients text[] not null default '{}',
  resend_id text,
  error text,
  claimed_at timestamptz,
  sent_at timestamptz
);
alter table public.report_nightly_sends enable row level security;
revoke all on table public.report_nightly_sends from public, anon, authenticated;

-- ───────────── what's due ─────────────
create or replace function public.report_nightly_due()
returns table (day date, forced boolean, open_centers text[])
language sql stable security definer set search_path = public as $$
  with s as (
    select start_day from report_nightly_settings where id = 1 and enabled
  ), cand as (
    select d.day,
           array_agg(cc.display_name order by cc.display_name) filter (where d.state = 'live') as open_list,
           count(*) filter (where d.state = 'live') as open_n
      from days d
      join command_centers cc on cc.id = d.center_id
     where not coalesce(cc.is_demo, false)
       and d.state in ('live', 'closed')
       and d.day >= (select start_day from s)
       and d.day between (now() at time zone 'America/Toronto')::date - 3 and (now() at time zone 'America/Toronto')::date
     group by d.day
  )
  select c.day, c.open_n > 0, coalesce(c.open_list, '{}')
    from cand c
   where (c.open_n = 0 or now() >= ((c.day + 2)::timestamp at time zone 'America/Toronto'))
     and not exists (
       select 1 from report_nightly_sends r
        where r.day = c.day
          and (r.status = 'sent'
               or (r.status = 'sending' and r.claimed_at > now() - interval '15 minutes')
               or (r.status = 'failed' and r.attempts >= 5)))
   order by c.day
$$;
revoke all on function public.report_nightly_due() from public, anon, authenticated;

-- One sender per day: true when this call got it.
create or replace function public.report_nightly_claim(p_day date)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  insert into report_nightly_sends as r (day, status, attempts, claimed_at)
  values (p_day, 'sending', 1, now())
  on conflict (day) do update set status = 'sending', attempts = r.attempts + 1, claimed_at = now(), error = null
   where (r.status = 'failed' and r.attempts < 5)
      or (r.status = 'sending' and r.claimed_at <= now() - interval '15 minutes')
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;
revoke all on function public.report_nightly_claim(date) from public, anon, authenticated;

create or replace function public.report_nightly_mark(p_day date, p_ok boolean, p_resend_id text, p_error text,
                                                      p_recipients text[], p_forced boolean, p_open text[])
returns void language sql security definer set search_path = public as $$
  update report_nightly_sends
     set status = case when p_ok then 'sent' else 'failed' end,
         resend_id = p_resend_id, error = left(p_error, 500), recipients = coalesce(p_recipients, '{}'),
         forced = coalesce(p_forced, false), open_centers = coalesce(p_open, '{}'),
         sent_at = case when p_ok then now() end
   where day = p_day
$$;
revoke all on function public.report_nightly_mark(date, boolean, text, text, text[], boolean, text[]) from public, anon, authenticated;

-- ───────────── the numbers ─────────────
-- A sale's money by how it was paid: its payments breakdown when that adds up to the price, else all of it
-- under its payment type.
create or replace function public.report_sale_payments(p_price numeric, p_type text, p_payments jsonb)
returns table (method text, amount numeric) language sql immutable set search_path = public as $$
  with b as (
    select e.key as method, (e.value #>> '{}')::numeric as amount
      from jsonb_each(case when jsonb_typeof(p_payments) = 'object' then p_payments else '{}'::jsonb end) e
     where jsonb_typeof(e.value) = 'number'
  ), ok as (
    select exists (select 1 from b) and abs(coalesce((select sum(amount) from b), 0) - coalesce(p_price, 0)) < 0.01 as v
  )
  select b.method, b.amount from b, ok where ok.v and b.amount <> 0
  union all
  select coalesce(nullif(p_type, ''), 'Other'), coalesce(p_price, 0) from ok where not ok.v and coalesce(p_price, 0) <> 0
$$;
revoke all on function public.report_sale_payments(numeric, text, jsonb) from public, anon, authenticated;

create or replace function public.report_nightly_data(p_day date)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'day', p_day,
    'centers', coalesce(jsonb_agg(x.c order by x.c->>'name'), '[]'::jsonb))
  from (
    select jsonb_build_object(
      'id', cc.id,
      'name', cc.display_name,
      'region', cc.region,
      'state', d.state,
      'closed_at', d.closed_at,
      'booked', (select count(*) from day_roster r where r.day_id = d.id),
      'showed', (select count(*) from day_roster r where r.day_id = d.id and r.attendance = 'showed'),
      'no_shows', (select count(*) from day_roster r where r.day_id = d.id and r.attendance = 'no_show'),
      'gross', coalesce(s.gross, 0),
      'new_sales', coalesce(s.new_sales, 0),
      'prepaid_work', coalesce(s.prepaid_work, 0),
      'jobs', coalesce(s.jobs, 0),
      'addons', coalesce(s.addons, 0),
      'payments', coalesce((
        select jsonb_object_agg(p.method, p.amount order by p.method)
          from (select sp.method, sum(sp.amount) as amount
                  from payout_sales ps cross join lateral report_sale_payments(ps.price, ps.payment_type, ps.payments) sp
                 where ps.center_id = d.center_id and ps.day = d.day
                 group by sp.method) p), '{}'::jsonb),
      'workers', coalesce(l.workers, 0),
      'payout', coalesce(l.payout, 0),
      'managers', coalesce((
        select jsonb_agg(jsonb_build_object('name', m.manager, 'workers', m.workers, 'gross', m.gross, 'payout', m.payout)
                         order by m.gross desc, m.manager)
          from (select coalesce(nullif(trim(pl.manager), ''), 'No manager') as manager, count(*) as workers,
                       coalesce(sum(pl.indiv_gross), 0) as gross, coalesce(sum(pl.total_payout), 0) as payout
                  from payout_lines pl
                 where pl.center_id = d.center_id and pl.day = d.day
                 group by 1) m), '[]'::jsonb),
      'month', (
        select jsonb_build_object('days', count(distinct ps.day), 'gross', coalesce(sum(ps.price), 0),
                                  'jobs', count(*) filter (where ps.type in ('Sale', 'Production', 'Upgrade')))
          from payout_sales ps
          join days d2 on d2.center_id = ps.center_id and d2.day = ps.day
         where ps.center_id = d.center_id
           and ps.day between date_trunc('month', p_day)::date and p_day
           and (d2.state = 'closed' or d2.day = p_day))
    ) as c
    from days d
    join command_centers cc on cc.id = d.center_id
    left join lateral (
      select sum(ps.price) as gross,
             sum(ps.price) filter (where ps.type is distinct from 'Production') as new_sales,
             sum(ps.price) filter (where ps.type = 'Production') as prepaid_work,
             count(*) filter (where ps.type in ('Sale', 'Production', 'Upgrade')) as jobs,
             count(*) filter (where ps.type = 'Add-On') as addons
        from payout_sales ps where ps.center_id = d.center_id and ps.day = d.day
    ) s on true
    left join lateral (
      select count(*) as workers, sum(pl.total_payout) as payout
        from payout_lines pl where pl.center_id = d.center_id and pl.day = d.day
    ) l on true
    where d.day = p_day and d.state in ('live', 'closed') and not coalesce(cc.is_demo, false)
  ) x
$$;
revoke all on function public.report_nightly_data(date) from public, anon, authenticated;

-- ───────────── send when due ─────────────
-- Same cron key the other scheduled functions use (planner_secrets.cron_key). pg_net sends the request after
-- the transaction commits, so the edge function sees the day closed.
create or replace function public.report_nightly_kick()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  select count(*) into v_n from report_nightly_due();
  if v_n > 0 then
    perform net.http_post(
      url := 'https://mipvcafqrmwxnoqmicxh.supabase.co/functions/v1/nightly-report',
      headers := jsonb_build_object('content-type', 'application/json',
                                    'x-cron-key', (select value from planner_secrets where name = 'cron_key')),
      body := '{"action":"tick"}'::jsonb,
      timeout_milliseconds := 60000);
  end if;
  return v_n;
exception when others then
  return 0;   -- closing a day never fails because of the report
end $$;
revoke all on function public.report_nightly_kick() from public, anon, authenticated;

create or replace function public.report_nightly_on_close()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform report_nightly_kick();
  return null;
end $$;
revoke all on function public.report_nightly_on_close() from public, anon, authenticated;
drop trigger if exists report_nightly on public.days;
create trigger report_nightly after update of state on public.days
  for each row when (new.state = 'closed' and old.state is distinct from 'closed')
  execute function public.report_nightly_on_close();

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'report-nightly') then
    perform cron.schedule('report-nightly', '*/10 * * * *', 'select public.report_nightly_kick()');
  end if;
end $$;
