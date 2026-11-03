-- MainstreetAI rep app › Settings: follow-up emails. ADDITIVE ONLY.
--
-- A rep can turn on, each on its own:
--   * "Email me when I set a follow-up": one email per follow-up, a couple of minutes after it's saved (or after it
--     syncs, when it was saved with no signal), with Add to calendar links.
--   * "Morning reminder": one email at 8 AM in the rep's own time zone listing that day's follow-ups. A follow-up that
--     was changed or settled since (a later visit to that business) isn't listed.
-- Both go to the rep's login email. Off until the rep turns them on. Turning "when set" on doesn't email follow-ups
-- set before that.
-- The ms-rep-notify edge function sends them; pg_cron calls it every 2 minutes (same cron key as planner-push).

create table if not exists public.ms_rep_notify (
  rep_id uuid primary key references public.app_users(id),
  followup_set boolean not null default false,
  followup_morning boolean not null default false,
  timezone text not null default 'America/Toronto',
  set_on_at timestamptz,                 -- when "when set" was last turned on: nothing older is emailed
  updated_at timestamptz not null default now()
);
alter table public.ms_rep_notify enable row level security;
revoke all on table public.ms_rep_notify from anon, authenticated;

-- what was sent (or tried), so nothing goes twice: ('set', visit id) and ('morning', rep id:local date)
create table if not exists public.ms_rep_notify_sent (
  kind text not null,
  ref text not null,
  rep_id uuid,
  ok boolean not null default true,
  error text,
  sent_at timestamptz not null default now(),
  primary key (kind, ref)
);
alter table public.ms_rep_notify_sent enable row level security;
revoke all on table public.ms_rep_notify_sent from anon, authenticated;

-- the rep's settings, and the email they go to
create or replace function public.ms_rep_notify_get()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('email', u.email,
                            'followup_set', coalesce(n.followup_set, false),
                            'followup_morning', coalesce(n.followup_morning, false),
                            'timezone', coalesce(n.timezone, 'America/Toronto'))
    from app_users u left join ms_rep_notify n on n.rep_id = u.id
   where u.id = auth.uid() and ms_is_rep()
$$;

create or replace function public.ms_rep_notify_set(p_set boolean, p_morning boolean, p_tz text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_tz text := nullif(trim(coalesce(p_tz, '')), ''); was boolean;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  if v_tz is not null and not exists (select 1 from pg_timezone_names where name = v_tz) then v_tz := null; end if;
  select followup_set into was from ms_rep_notify where rep_id = auth.uid();
  insert into ms_rep_notify (rep_id, followup_set, followup_morning, timezone, set_on_at, updated_at)
  values (auth.uid(), coalesce(p_set, false), coalesce(p_morning, false), coalesce(v_tz, 'America/Toronto'),
          case when coalesce(p_set, false) then now() end, now())
  on conflict (rep_id) do update set
    followup_set = excluded.followup_set, followup_morning = excluded.followup_morning,
    timezone = coalesce(v_tz, ms_rep_notify.timezone),
    set_on_at = case when excluded.followup_set and not coalesce(was, false) then now() else ms_rep_notify.set_on_at end,
    updated_at = now();
  return ms_rep_notify_get();
end $$;

-- for ms-rep-notify (service role): what to send now
create or replace function public.ms_notify_pending()
returns jsonb language sql stable security definer set search_path = public as $$
  with reps as (
    select n.*, u.email, u.full_name from ms_rep_notify n join app_users u on u.id = n.rep_id and u.is_active
     where u.email is not null and (n.followup_set or n.followup_morning)
  ),
  item as (   -- one follow-up, as the emails show it
    select v.id visit_id, v.rep_id, v.follow_up_at, v.contact_name, v.contact_phone, v.contact_email, v.notes,
           b.id business_id, b.name business, b.address, c.name campaign
      from ms_visits v join ms_businesses b on b.id = v.business_id left join ms_campaigns c on c.id = v.campaign_id
  ),
  set_now as (
    select jsonb_agg(jsonb_build_object('visit_id', i.visit_id, 'rep_id', r.rep_id, 'email', r.email, 'rep_name', r.full_name,
             'timezone', r.timezone, 'business_id', i.business_id, 'business', i.business, 'address', i.address, 'campaign', i.campaign,
             'follow_up_at', i.follow_up_at, 'contact_name', i.contact_name, 'contact_phone', i.contact_phone,
             'contact_email', i.contact_email, 'notes', i.notes) order by v.created_at) j
      from reps r join ms_visits v on v.rep_id = r.rep_id join item i on i.visit_id = v.id
     where r.followup_set and v.outcome = 'follow_up' and v.follow_up_at is not null
       and v.created_at >= greatest(coalesce(r.set_on_at, now()), now() - interval '2 days')
       and v.follow_up_at > now() - interval '12 hours'
       and not exists (select 1 from ms_rep_notify_sent s where s.kind = 'set' and s.ref = v.id::text)
  ),
  morning as (
    select jsonb_agg(m.j) j from (
      select jsonb_build_object('rep_id', r.rep_id, 'email', r.email, 'rep_name', r.full_name, 'timezone', r.timezone,
               'day', (now() at time zone r.timezone)::date,
               'items', jsonb_agg(jsonb_build_object('visit_id', i.visit_id, 'business_id', i.business_id, 'business', i.business,
                          'address', i.address, 'campaign', i.campaign, 'follow_up_at', i.follow_up_at, 'contact_name', i.contact_name,
                          'contact_phone', i.contact_phone, 'contact_email', i.contact_email, 'notes', i.notes) order by i.follow_up_at)) j
        from reps r
        join ms_visits v on v.rep_id = r.rep_id and v.outcome = 'follow_up' and v.follow_up_at is not null
             and (v.follow_up_at at time zone r.timezone)::date = (now() at time zone r.timezone)::date
        join item i on i.visit_id = v.id
       where r.followup_morning
         and extract(hour from now() at time zone r.timezone) = 8
         and not exists (select 1 from ms_rep_notify_sent s where s.kind = 'morning' and s.ref = r.rep_id::text || ':' || ((now() at time zone r.timezone)::date)::text)
         -- still the latest word on that business (not changed or settled since)
         and not exists (select 1 from ms_visits w where w.business_id = v.business_id and w.campaign_id is not distinct from v.campaign_id and w.at > v.at)
       group by r.rep_id, r.email, r.full_name, r.timezone) m
  )
  select jsonb_build_object('set', coalesce((select j from set_now), '[]'::jsonb), 'morning', coalesce((select j from morning), '[]'::jsonb))
$$;

create or replace function public.ms_notify_mark(p_kind text, p_ref text, p_rep uuid, p_ok boolean, p_error text default null)
returns void language sql volatile security definer set search_path = public as $$
  insert into ms_rep_notify_sent (kind, ref, rep_id, ok, error) values (p_kind, p_ref, p_rep, p_ok, left(p_error, 300))
  on conflict (kind, ref) do nothing
$$;

do $$
declare f text;
begin
  foreach f in array array['ms_notify_pending()', 'ms_notify_mark(text, text, uuid, boolean, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['ms_rep_notify_get()', 'ms_rep_notify_set(boolean, boolean, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- every 2 minutes: send what's due
select cron.schedule('ms-rep-notify-tick', '*/2 * * * *', $cron$
  select net.http_post(
    url := 'https://mipvcafqrmwxnoqmicxh.supabase.co/functions/v1/ms-rep-notify',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-cron-key', (select value from public.planner_secrets where name = 'cron_key')),
    body := '{"action":"tick"}'::jsonb)
$cron$);
