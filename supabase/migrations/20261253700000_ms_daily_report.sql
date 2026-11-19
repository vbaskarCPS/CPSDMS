-- MainstreetAI daily report: one email a night at 9:30 PM Toronto time, from report@propertystars.app.
--
--   A report's "day" runs from 9:30 PM the night before to 9:30 PM that night (Toronto), so what a rep out west logs
--   after one report has gone is in the next one and nothing is missed or counted twice.
--
--   ms_report_settings   who gets it, from which address, at what time, and the first day it covers
--   ms_report_sends      one row a day: sending / sent / failed (failed tries again, up to 5 times)
--   ms_report_due()      the day that is ready and not sent yet (from its send time, for 6 hours)
--   ms_report_data(day)  the numbers: what each rep did, meetings, deals, the pipeline now, the week so far
--   ms_report_kick()     when a day is due, asks the ms-report edge function to send it (cron, every 5 minutes)

create table if not exists public.ms_report_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  recipients text[] not null,
  test_recipients text[] not null default '{}',      -- the edge function's 'test' action sends only here
  from_name text not null default 'MainstreetAI Reports',
  from_email text not null default 'report@propertystars.app',
  reply_to text,                                     -- replies go to a person, not the report address
  send_at time not null default time '21:30',
  tz text not null default 'America/Toronto',
  start_day date not null,
  updated_at timestamptz not null default now()
);
insert into public.ms_report_settings (id, recipients, test_recipients, reply_to, start_day)
values (1, array['vbaskaran5@gmail.com', 'ben.stewart@live.ca'], array['vbaskaran5@gmail.com'], 'v.baskaran@property-stars.com', date '2026-11-18')
on conflict (id) do nothing;
alter table public.ms_report_settings enable row level security;
revoke all on table public.ms_report_settings from public, anon, authenticated;

create table if not exists public.ms_report_sends (
  day date primary key,
  status text not null check (status in ('sending', 'sent', 'failed')),
  attempts int not null default 0,
  recipients text[] not null default '{}',
  resend_id text,
  error text,
  claimed_at timestamptz,
  sent_at timestamptz
);
alter table public.ms_report_sends enable row level security;
revoke all on table public.ms_report_sends from public, anon, authenticated;

-- ───────────── what's due ─────────────
create or replace function public.ms_report_due()
returns table (day date)
language sql stable security definer set search_path = public as $$
  select g.d::date
    from ms_report_settings s,
         generate_series(((now() at time zone s.tz)::date - 1)::timestamp, ((now() at time zone s.tz)::date)::timestamp, interval '1 day') g(d)
   where s.id = 1 and s.enabled and g.d::date >= s.start_day
     and now() >= ((g.d::date + s.send_at) at time zone s.tz)
     and now() <  ((g.d::date + s.send_at) at time zone s.tz) + interval '6 hours'
     and not exists (
       select 1 from ms_report_sends r
        where r.day = g.d::date
          and (r.status = 'sent'
               or (r.status = 'sending' and r.claimed_at > now() - interval '15 minutes')
               or (r.status = 'failed' and r.attempts >= 5)))
   order by 1
$$;
revoke all on function public.ms_report_due() from public, anon, authenticated;

-- One sender per day: true when this call got it.
create or replace function public.ms_report_claim(p_day date)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  insert into ms_report_sends as r (day, status, attempts, claimed_at)
  values (p_day, 'sending', 1, now())
  on conflict (day) do update set status = 'sending', attempts = r.attempts + 1, claimed_at = now(), error = null
   where (r.status = 'failed' and r.attempts < 5)
      or (r.status = 'sending' and r.claimed_at <= now() - interval '15 minutes')
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;
revoke all on function public.ms_report_claim(date) from public, anon, authenticated;

create or replace function public.ms_report_mark(p_day date, p_ok boolean, p_resend_id text, p_error text, p_recipients text[])
returns void language sql security definer set search_path = public as $$
  update ms_report_sends
     set status = case when p_ok then 'sent' else 'failed' end,
         resend_id = p_resend_id, error = left(p_error, 500), recipients = coalesce(p_recipients, '{}'),
         sent_at = case when p_ok then now() end
   where day = p_day
$$;
revoke all on function public.ms_report_mark(date, boolean, text, text, text[]) from public, anon, authenticated;

-- ───────────── the numbers ─────────────
create or replace function public.ms_report_data(p_day date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  s ms_report_settings; v_tz text; v_at time; v_from timestamptz; v_to timestamptz; v_week timestamptz; v_out jsonb;
begin
  select * into s from ms_report_settings where id = 1;
  v_tz := coalesce(s.tz, 'America/Toronto'); v_at := coalesce(s.send_at, time '21:30');
  v_to := (p_day + v_at) at time zone v_tz;
  v_from := ((p_day - 1) + v_at) at time zone v_tz;
  v_week := date_trunc('week', p_day::timestamp) at time zone v_tz;      -- Monday 00:00

  with v as (select * from ms_visits where at >= v_from and at < v_to),
  m as (select * from ms_meetings where created_at >= v_from and created_at < v_to and status <> 'cancelled'),
  d as (select * from ms_deals where created_at >= v_from and created_at < v_to),
  sn as (select * from ms_sends where at >= v_from and at < v_to),
  dy as (select * from ms_rep_days where started_at >= v_from and started_at < v_to),
  act as (select rep_id from v union select rep_id from m where rep_id is not null union select rep_id from d
          union select rep_id from sn union select rep_id from dy),
  by_rep as (
    select u.full_name as name,
           (select count(*) from v where v.rep_id = u.id)::int visits,
           (select count(*) from v where v.rep_id = u.id and v.outcome = 'interested')::int interested,
           (select count(*) from v where v.rep_id = u.id and v.outcome = 'follow_up')::int follow_up,
           (select count(*) from v where v.rep_id = u.id and v.outcome = 'come_back')::int come_back,
           (select count(*) from v where v.rep_id = u.id and v.outcome = 'not_interested')::int not_interested,
           (select count(*) from v where v.rep_id = u.id and v.outcome in ('closed', 'cant_sell'))::int other,
           (select count(*) from v where v.rep_id = u.id and v.far)::int far,
           (select count(*) from m where m.rep_id = u.id)::int meetings,
           (select count(*) from d where d.rep_id = u.id)::int deals,
           ms_rep_visit_goal(u.id) goal,
           (select min(started_at) from dy where dy.rep_id = u.id) started_at,
           (select max(coalesce(ended_at, last_at)) from dy where dy.rep_id = u.id) ended_at,
           (select coalesce(sum(distance_m), 0) from dy where dy.rep_id = u.id)::int distance_m
      from act a join app_users u on u.id = a.rep_id),
  pairs as (
    select business_id, campaign_id from ms_visits
    union select business_id, campaign_id from ms_business_answers
    union select business_id, campaign_id from ms_meetings
    union select business_id, campaign_id from ms_business_contacts where campaign_id is not null and active
    union select id, lead_campaign from ms_businesses where added_by is not null and lead_campaign is not null
                                                         and coalesce(lead_status, 'new') not in ('merged', 'removed')),
  stages as (
    select ms_biz_state(p.business_id, p.campaign_id) ->> 'stage' stage
      from pairs p join ms_businesses b on b.id = p.business_id
     where b.do_not_knock is null and b.status <> 'closed'),
  rz as (
    select u.id from app_users u
     where u.is_active and exists (select 1 from user_permissions up where up.user_id = u.id and up.permission = 'mainstreet_rep'))
  select jsonb_build_object(
    'day', p_day, 'from', v_from, 'to', v_to, 'tz', v_tz,
    'totals', jsonb_build_object(
      'visits', (select count(*) from v),
      'businesses', (select count(distinct business_id) from v),
      'reps_out', (select count(distinct rep_id) from v),
      'reps_total', (select count(*) from rz),
      'interested', (select count(*) from v where outcome = 'interested'),
      'follow_up', (select count(*) from v where outcome = 'follow_up'),
      'come_back', (select count(*) from v where outcome = 'come_back'),
      'not_interested', (select count(*) from v where outcome = 'not_interested'),
      'other', (select count(*) from v where outcome in ('closed', 'cant_sell')),
      'meetings_booked', (select count(*) from m),
      'deals_new', (select count(*) from d),
      'deals_approved', (select count(*) from ms_deals where status = 'approved' and decided_at >= v_from and decided_at < v_to),
      'deals_rejected', (select count(*) from ms_deals where status = 'rejected' and decided_at >= v_from and decided_at < v_to),
      'questionnaires', (select count(*) from ms_business_answers a where a.updated_at >= v_from and a.updated_at < v_to and a.data -> 'answers' is not null),
      'pitched', (select count(*) from ms_business_status t where t.pitched_at >= v_from and t.pitched_at < v_to),
      'leads_added', (select count(*) from ms_businesses b where b.added_by is not null and b.added_at >= v_from and b.added_at < v_to),
      'followups_sent', (select count(*) from ms_followup_sent f where f.sent_at >= v_from and f.sent_at < v_to and not coalesce(f.skipped, false)),
      'info_sent', (select count(*) from sn)),
    'reps', coalesce((select jsonb_agg(to_jsonb(r) order by r.visits desc, r.meetings desc, r.name) from by_rep r), '[]'::jsonb),
    'meetings_booked', coalesce((select jsonb_agg(jsonb_build_object(
        'business', (select name from ms_businesses where id = m.business_id), 'rep', (select full_name from app_users where id = m.rep_id),
        'host', (select full_name from app_users where id = m.host_id), 'starts_at', m.starts_at) order by m.starts_at) from m), '[]'::jsonb),
    'meetings_next', coalesce((select jsonb_agg(jsonb_build_object(
        'business', (select name from ms_businesses where id = x.business_id), 'rep', (select full_name from app_users where id = x.rep_id),
        'host', (select full_name from app_users where id = x.host_id), 'starts_at', x.starts_at) order by x.starts_at)
      from ms_meetings x where x.status = 'booked' and x.starts_at >= v_to and x.starts_at < v_to + interval '1 day'), '[]'::jsonb),
    'meeting_outcomes', coalesce((select jsonb_agg(jsonb_build_object(
        'business', (select name from ms_businesses where id = x.business_id), 'rep', (select full_name from app_users where id = x.rep_id),
        'status', x.status, 'note', left(x.outcome_note, 160)) order by x.outcome_at)
      from ms_meetings x where x.outcome_at >= v_from and x.outcome_at < v_to and x.status in ('closed', 'no_show', 'not_fit')), '[]'::jsonb),
    'deals_waiting', (select count(*) from ms_deals where status = 'pending'),
    'pipeline', jsonb_build_object(
      'new', (select count(*) from stages where stage = 'new'), 'pitched', (select count(*) from stages where stage = 'pitched'),
      'questionnaire', (select count(*) from stages where stage = 'questionnaire'), 'booked', (select count(*) from stages where stage = 'booked'),
      'won', (select count(*) from stages where stage = 'won'), 'lost', (select count(*) from stages where stage = 'lost')),
    'week', jsonb_build_object(
      'from', v_week,
      'visits', (select count(*) from ms_visits where at >= v_week and at < v_to),
      'reps_out', (select count(distinct rep_id) from ms_visits where at >= v_week and at < v_to),
      'meetings', (select count(*) from ms_meetings where created_at >= v_week and created_at < v_to and status <> 'cancelled'),
      'deals', (select count(*) from ms_deals where created_at >= v_week and created_at < v_to),
      'approved', (select count(*) from ms_deals where status = 'approved' and decided_at >= v_week and decided_at < v_to)),
    'zones', jsonb_build_object(
      'active', (select count(*) from ms_zones where status = 'active'),
      'no_rep', (select count(*) from ms_zones z where z.status = 'active'
                  and not exists (select 1 from ms_zone_campaigns zc where zc.zone_id = z.id and zc.rep_id is not null)),
      'reps_with_zone', (select count(*) from rz where exists (select 1 from ms_zone_campaigns zc join ms_zones z on z.id = zc.zone_id and z.status = 'active' where zc.rep_id = rz.id)),
      'quiet_reps', (select count(*) from rz where exists (select 1 from ms_zone_campaigns zc join ms_zones z on z.id = zc.zone_id and z.status = 'active' where zc.rep_id = rz.id)
                      and not exists (select 1 from ms_visits x where x.rep_id = rz.id and x.at >= v_to - interval '7 days' and x.at < v_to))),
    'flags', jsonb_build_object(
      'far_open', (select count(*) from ms_visits where far and resolved_at is null),
      'leads_waiting', (select count(*) from ms_card_leads where status = 'new')))
    into v_out;
  return v_out;
end $$;
revoke all on function public.ms_report_data(date) from public, anon, authenticated;

-- ───────────── send when due ─────────────
-- Same cron key the other scheduled functions use (planner_secrets.cron_key).
create or replace function public.ms_report_kick()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  select count(*) into v_n from ms_report_due();
  if v_n > 0 then
    perform net.http_post(
      url := 'https://mipvcafqrmwxnoqmicxh.supabase.co/functions/v1/ms-report',
      headers := jsonb_build_object('content-type', 'application/json',
                                    'x-cron-key', (select value from planner_secrets where name = 'cron_key')),
      body := '{"action":"tick"}'::jsonb,
      timeout_milliseconds := 60000);
  end if;
  return v_n;
exception when others then
  return 0;
end $$;
revoke all on function public.ms_report_kick() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'ms-report') then
    perform cron.schedule('ms-report', '*/5 * * * *', 'select public.ms_report_kick()');
  end if;
end $$;
