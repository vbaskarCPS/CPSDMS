-- MainstreetAI › Meetings: the rep books the owner's onboarding call from the deck's last slide (Calendly-style).
-- Additive only.
--   ms_hosts          who takes the video calls ("onboarding hosts": e.g. taxifi's own people, or an admin), per
--                     campaign, with their Zoom link, time zone, weekly hours (jsonb) and days off
--   ms_meeting_rules  per campaign: call length (30–60 min), gap between calls, notice, how far ahead, cap a day
--   ms_meetings       the booked calls; the host marks each Closed / No-show / Not a fit
-- A host with no other access signs in at /app/login with the username from their setup email and gets only the
-- host screen (/app/host). Booking from the deck also logs the rep's visit as a closed deal (ms_rep_log_visit),
-- so the deal shows in Deals as before; rep pay is unchanged.

-- ───────────── tables ─────────────
create table if not exists public.ms_hosts (
  user_id uuid primary key references public.app_users(id),
  campaign_id uuid references public.ms_campaigns(id),
  zoom_url text,
  timezone text not null default 'America/Toronto',
  hours jsonb not null default '{"1":[[540,1020]],"2":[[540,1020]],"3":[[540,1020]],"4":[[540,1020]],"5":[[540,1020]]}'::jsonb,
  days_off date[] not null default '{}',
  active boolean not null default true,
  added_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ms_meeting_rules (
  campaign_id uuid primary key references public.ms_campaigns(id),
  length_min int not null default 30 check (length_min between 30 and 60),
  buffer_min int not null default 0 check (buffer_min between 0 and 60),
  notice_min int not null default 120 check (notice_min between 0 and 10080),
  days_ahead int not null default 14 check (days_ahead between 1 and 90),
  max_per_day int check (max_per_day is null or max_per_day between 1 and 30),
  timezone text not null default 'America/Toronto',
  updated_by uuid references public.app_users(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.ms_meetings (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.ms_campaigns(id),
  host_id uuid not null references public.app_users(id),
  business_id uuid not null references public.ms_businesses(id),
  rep_id uuid references public.app_users(id),
  visit_id uuid references public.ms_visits(id),
  deal_id uuid references public.ms_deals(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  owner_name text not null,
  owner_phone text,
  owner_email text,
  notes text,
  status text not null default 'booked' check (status in ('booked', 'closed', 'no_show', 'not_fit', 'cancelled')),
  outcome_note text,
  outcome_by uuid references public.app_users(id),
  outcome_at timestamptz,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists ms_meetings_host on public.ms_meetings (host_id, starts_at) where status <> 'cancelled';
create index if not exists ms_meetings_when on public.ms_meetings (starts_at);
create index if not exists ms_meetings_deal on public.ms_meetings (deal_id);

alter table public.ms_hosts enable row level security;
alter table public.ms_meeting_rules enable row level security;
alter table public.ms_meetings enable row level security;
revoke all on public.ms_hosts, public.ms_meeting_rules, public.ms_meetings from anon, authenticated;

-- ───────────── who's who ─────────────
create or replace function public.ms_is_host(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from ms_hosts h join app_users u on u.id = h.user_id where h.user_id = p_user and h.active and u.is_active)
$$;

-- the rules for a campaign, with the defaults when none are saved
create or replace function public.ms_rules(p_campaign uuid)
returns ms_meeting_rules language sql stable security definer set search_path = public as $$
  select coalesce((select r from ms_meeting_rules r where r.campaign_id = p_campaign),
                  row(p_campaign, 30, 0, 120, 14, null, 'America/Toronto', null, now())::ms_meeting_rules)
$$;

-- Is this host free for a call starting at p_start (their hours, days off, other calls with the gap, the daily cap)?
create or replace function public.ms_host_free(p_host uuid, p_start timestamptz, p_len int, p_buffer int, p_max int, p_ignore uuid default null)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare h ms_hosts; loc timestamp; m int; ok boolean := false; r jsonb;
begin
  select * into h from ms_hosts where user_id = p_host and active;
  if h.user_id is null then return false; end if;
  loc := p_start at time zone h.timezone;
  if loc::date = any(h.days_off) then return false; end if;
  m := extract(hour from loc)::int * 60 + extract(minute from loc)::int;
  for r in select * from jsonb_array_elements(coalesce(h.hours -> extract(dow from loc)::int::text, '[]'::jsonb)) loop
    if (r->>0)::int <= m and m + p_len <= (r->>1)::int then ok := true; end if;
  end loop;
  if not ok then return false; end if;
  if exists (select 1 from ms_meetings x where x.host_id = p_host and x.status <> 'cancelled' and x.id is distinct from p_ignore
               and tstzrange(x.starts_at - make_interval(mins => p_buffer), x.ends_at + make_interval(mins => p_buffer))
                   && tstzrange(p_start, p_start + make_interval(mins => p_len))) then return false; end if;
  if p_max is not null and (select count(*) from ms_meetings x where x.host_id = p_host and x.status <> 'cancelled' and x.id is distinct from p_ignore
                              and (x.starts_at at time zone h.timezone)::date = loc::date) >= p_max then return false; end if;
  return true;
end $$;

-- the hosts of a campaign free at p_start, the one with the fewest calls lately first (calls rotate evenly)
create or replace function public.ms_free_hosts(p_campaign uuid, p_start timestamptz, p_ignore uuid default null)
returns setof uuid language sql stable security definer set search_path = public as $$
  with r as (select * from ms_rules(p_campaign))
  select h.user_id from ms_hosts h cross join r
    join app_users u on u.id = h.user_id and u.is_active
   where h.active and h.campaign_id = p_campaign
     and ms_host_free(h.user_id, p_start, r.length_min, r.buffer_min, r.max_per_day, p_ignore)
   order by (select count(*) from ms_meetings x where x.host_id = h.user_id and x.status <> 'cancelled' and x.starts_at > now() - interval '30 days'),
            (select max(x.created_at) from ms_meetings x where x.host_id = h.user_id) nulls first, h.created_at
$$;

-- ───────────── booking (reps from the deck; admins too) ─────────────
create or replace function public.ms_can_book(p_campaign uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select ms_is_admin() or ms_rep_has_campaign(p_campaign)
$$;

-- The open times between p_from and p_from + p_days (days in the campaign's time zone): every half hour that at
-- least one host can take, from the notice onwards and within how far ahead people may book.
create or replace function public.ms_meeting_slots(p_campaign uuid, p_from date default null, p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r ms_meeting_rules; v_from timestamptz; v_to timestamptz; v_first timestamptz; v_out jsonb;
begin
  if not ms_can_book(p_campaign) then raise exception 'Not allowed'; end if;
  r := ms_rules(p_campaign);
  v_from := greatest((coalesce(p_from, (now() at time zone r.timezone)::date))::timestamp at time zone r.timezone,
                     now() + make_interval(mins => r.notice_min));
  v_to := least((coalesce(p_from, (now() at time zone r.timezone)::date) + least(greatest(p_days, 1), 31))::timestamp at time zone r.timezone,
                now() + make_interval(days => r.days_ahead));
  -- the first half hour on or after v_from
  v_first := to_timestamp(ceil(extract(epoch from v_from) / 1800) * 1800);
  select coalesce(jsonb_agg(jsonb_build_object('start', s, 'hosts', n) order by s), '[]'::jsonb) into v_out from (
    select s, (select count(*) from ms_free_hosts(p_campaign, s)) n
      from generate_series(v_first, v_to - make_interval(mins => r.length_min), interval '30 minutes') s
  ) q where n > 0;
  return jsonb_build_object('length_min', r.length_min, 'timezone', r.timezone, 'days_ahead', r.days_ahead, 'slots', v_out,
                            'hosts', (select count(*) from ms_hosts h where h.active and h.campaign_id = p_campaign));
end $$;

create or replace function public.ms_book_meeting(p_campaign uuid, p_business uuid, p_start timestamptz, p_name text, p_phone text,
  p_email text, p_notes text default null, p_lat double precision default null, p_lng double precision default null, p_accuracy numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r ms_meeting_rules; v_host uuid; v_visit jsonb; v_visit_id uuid; v_deal uuid; m ms_meetings;
begin
  if not ms_can_book(p_campaign) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from ms_businesses where id = p_business) then raise exception 'That business is gone'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'The owner’s name is needed'; end if;
  if nullif(trim(coalesce(p_email, '')), '') is null and nullif(trim(coalesce(p_phone, '')), '') is null then
    raise exception 'An email or a phone number for the owner is needed'; end if;
  if p_email is not null and trim(p_email) <> '' and trim(p_email) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email doesn’t look right'; end if;
  r := ms_rules(p_campaign);
  if p_start < now() + make_interval(mins => r.notice_min) - interval '1 minute' then raise exception 'That time is too soon now: pick a later one'; end if;
  if p_start > now() + make_interval(days => r.days_ahead) then raise exception 'That’s further ahead than calls can be booked'; end if;
  perform pg_advisory_xact_lock(hashtext('ms_meetings:' || p_campaign::text));
  select h into v_host from ms_free_hosts(p_campaign, p_start) h limit 1;
  if v_host is null then raise exception 'That time was just taken: pick another'; end if;
  -- the rep's visit, as a closed deal (the same as logging "Closed deal"): the deal goes to Deals as before
  if ms_rep_has_campaign(p_campaign) and ms_is_rep() then
    v_visit := ms_rep_log_visit(p_business, p_campaign, 'closed',
      'Onboarding booked: ' || to_char(p_start at time zone r.timezone, 'Dy Mon DD, HH12:MI AM') || coalesce(E'\n' || nullif(trim(coalesce(p_notes, '')), ''), ''),
      p_name, p_phone, p_email, null, p_lat, p_lng, p_accuracy, null, gen_random_uuid(), null);
    v_visit_id := (v_visit->>'id')::uuid;
    select d.id into v_deal from ms_deals d where d.visit_id = v_visit_id;
  end if;
  insert into ms_meetings (campaign_id, host_id, business_id, rep_id, visit_id, deal_id, starts_at, ends_at, owner_name, owner_phone, owner_email, notes, created_by)
  values (p_campaign, v_host, p_business, case when ms_is_rep() then auth.uid() end, v_visit_id, v_deal, p_start,
          p_start + make_interval(mins => r.length_min), trim(p_name), nullif(trim(coalesce(p_phone, '')), ''),
          nullif(lower(trim(coalesce(p_email, ''))), ''), nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
  returning * into m;
  return ms_meeting_json(m.id);
end $$;

-- one call, as the screens and the emails show it
create or replace function public.ms_meeting_json(p_meeting uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'status', m.status, 'starts_at', m.starts_at, 'ends_at', m.ends_at, 'length_min', round(extract(epoch from m.ends_at - m.starts_at) / 60),
    'owner_name', m.owner_name, 'owner_phone', m.owner_phone, 'owner_email', m.owner_email, 'notes', m.notes,
    'outcome_note', m.outcome_note, 'outcome_at', m.outcome_at, 'outcome_by', (select full_name from app_users where id = m.outcome_by),
    'campaign', jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color),
    'business', jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address, 'phone', b.phone),
    'host', jsonb_build_object('id', hu.id, 'name', hu.full_name, 'email', hu.email, 'zoom_url', h.zoom_url, 'timezone', coalesce(h.timezone, 'America/Toronto')),
    'rep', case when ru.id is null then null else jsonb_build_object('id', ru.id, 'name', ru.full_name, 'phone', ru.phone, 'email', ru.email) end,
    'deal_id', m.deal_id, 'deal_status', (select d.status from ms_deals d where d.id = m.deal_id),
    'timezone', (select x.timezone from ms_rules(m.campaign_id) x), 'created_at', m.created_at)
  from ms_meetings m
  join ms_campaigns c on c.id = m.campaign_id
  join ms_businesses b on b.id = m.business_id
  join app_users hu on hu.id = m.host_id
  left join ms_hosts h on h.user_id = m.host_id
  left join app_users ru on ru.id = m.rep_id
  where m.id = p_meeting
$$;

-- for the emails (ms-meetings function, as the person who booked or changed it)
create or replace function public.ms_meeting_notice(p_meeting uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m ms_meetings;
begin
  select * into m from ms_meetings where id = p_meeting;
  if m.id is null then raise exception 'That call is gone'; end if;
  if not (ms_is_admin() or m.rep_id = auth.uid() or m.host_id = auth.uid() or m.created_by = auth.uid()) then raise exception 'Not allowed'; end if;
  return ms_meeting_json(p_meeting);
end $$;

-- ───────────── the host's own screen ─────────────
create or replace function public.ms_host_me()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when h.user_id is null then null else jsonb_build_object(
    'id', u.id, 'name', u.full_name, 'email', u.email, 'zoom_url', h.zoom_url, 'timezone', h.timezone, 'hours', h.hours,
    'days_off', to_jsonb(h.days_off), 'active', h.active,
    'campaign', (select jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color) from ms_campaigns c where c.id = h.campaign_id),
    'rules', (select to_jsonb(x) from ms_rules(h.campaign_id) x)) end
  from app_users u left join ms_hosts h on h.user_id = u.id
  where u.id = auth.uid()
$$;

create or replace function public.ms_host_check_hours(p_hours jsonb)
returns void language plpgsql immutable set search_path = public as $$
declare k text; r jsonb;
begin
  if jsonb_typeof(coalesce(p_hours, '{}'::jsonb)) <> 'object' then raise exception 'Hours aren’t right'; end if;
  for k in select jsonb_object_keys(coalesce(p_hours, '{}'::jsonb)) loop
    if k !~ '^[0-6]$' then raise exception 'Hours aren’t right'; end if;
    for r in select * from jsonb_array_elements(p_hours -> k) loop
      if jsonb_array_length(r) <> 2 or (r->>0)::int < 0 or (r->>1)::int > 1440 or (r->>1)::int <= (r->>0)::int then
        raise exception 'Each block of hours needs a start before its end'; end if;
    end loop;
  end loop;
end $$;

create or replace function public.ms_host_save(p_zoom text, p_timezone text, p_hours jsonb, p_days_off date[])
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from ms_hosts where user_id = auth.uid()) then raise exception 'Not allowed'; end if;
  perform ms_host_check_hours(p_hours);
  if p_zoom is not null and trim(p_zoom) <> '' and trim(p_zoom) !~* '^https://' then raise exception 'The Zoom link should start with https://'; end if;
  if not exists (select 1 from pg_timezone_names where name = coalesce(p_timezone, '')) then raise exception 'Pick a time zone'; end if;
  update ms_hosts set zoom_url = nullif(trim(coalesce(p_zoom, '')), ''), timezone = p_timezone, hours = coalesce(p_hours, '{}'::jsonb),
         days_off = coalesce(p_days_off, '{}'), updated_at = now() where user_id = auth.uid();
  return ms_host_me();
end $$;

-- calls between two times: a host gets their own; an admin gets everyone's (or one host's, or one campaign's)
create or replace function public.ms_meetings_list(p_from timestamptz, p_to timestamptz, p_host uuid default null, p_campaign uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_admin boolean := ms_is_admin();
begin
  if not v_admin and not exists (select 1 from ms_hosts where user_id = auth.uid()) then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(ms_meeting_json(m.id) order by m.starts_at)
      from ms_meetings m
     where m.starts_at >= p_from and m.starts_at < p_to
       and (case when v_admin then (p_host is null or m.host_id = p_host) else m.host_id = auth.uid() end)
       and (p_campaign is null or m.campaign_id = p_campaign)), '[]'::jsonb);
end $$;

-- the host (or an admin) says how the call went: Closed, No-show, Not a fit (or back to Booked)
create or replace function public.ms_meeting_outcome(p_meeting uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m ms_meetings;
begin
  select * into m from ms_meetings where id = p_meeting;
  if m.id is null then raise exception 'That call is gone'; end if;
  if not (ms_is_admin() or m.host_id = auth.uid()) then raise exception 'Not allowed'; end if;
  if p_status not in ('booked', 'closed', 'no_show', 'not_fit') then raise exception 'Pick Closed, No-show or Not a fit'; end if;
  if m.status = 'cancelled' then raise exception 'That call was cancelled'; end if;
  update ms_meetings set status = p_status, outcome_note = nullif(trim(coalesce(p_note, '')), ''),
         outcome_by = case when p_status = 'booked' then null else auth.uid() end,
         outcome_at = case when p_status = 'booked' then null else now() end, updated_at = now()
   where id = p_meeting;
  return ms_meeting_json(p_meeting);
end $$;

-- ───────────── admins: hosts, rules, changing a call ─────────────
create or replace function public.ms_hosts_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'name', u.full_name, 'username', u.username, 'email', u.email, 'phone', u.phone, 'user_active', u.is_active,
      'active', h.active, 'zoom_url', h.zoom_url, 'timezone', h.timezone, 'hours', h.hours, 'days_off', to_jsonb(h.days_off),
      'campaign_id', h.campaign_id, 'campaign', c.name,
      'staff', exists (select 1 from user_permissions p where p.user_id = u.id),
      'setup_sent_at', (select max(t.sent_at) from app_setup_tokens t where t.user_id = u.id),
      'setup_used_at', (select max(t.used_at) from app_setup_tokens t where t.user_id = u.id),
      'upcoming', (select count(*) from ms_meetings m where m.host_id = u.id and m.status = 'booked' and m.starts_at > now()))
      order by h.active desc, u.full_name)
      from ms_hosts h join app_users u on u.id = h.user_id left join ms_campaigns c on c.id = h.campaign_id), '[]'::jsonb);
end $$;

-- Add a host: an existing person (an admin, say) by p_user, or a new person by name and email (they get a setup
-- email from the app, then sign in with their username and see only their calls).
create or replace function public.ms_admin_add_host(p_user uuid, p_full_name text, p_email text, p_phone text, p_campaign uuid, p_zoom text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid := p_user; v_username text;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if p_campaign is null or not exists (select 1 from ms_campaigns where id = p_campaign) then raise exception 'Pick the campaign they take calls for'; end if;
  if p_zoom is not null and trim(p_zoom) <> '' and trim(p_zoom) !~* '^https://' then raise exception 'The Zoom link should start with https://'; end if;
  if v_id is null then
    if nullif(trim(coalesce(p_full_name, '')), '') is null then raise exception 'Their name is needed'; end if;
    if nullif(trim(coalesce(p_email, '')), '') is null then raise exception 'Their email is needed: that’s how they set up their account'; end if;
    select id into v_id from app_users where lower(email) = lower(trim(p_email)) limit 1;
    if v_id is not null and exists (select 1 from user_permissions where user_id = v_id and permission = 'mainstreet_rep') then
      raise exception 'That email belongs to a rep: a rep can’t also be a host'; end if;
    if v_id is null then
      v_username := app_make_username(p_full_name);
      v_id := app_create_auth_user(v_username, encode(gen_random_bytes(32), 'hex'));
      insert into app_users (id, username, full_name, phone, email) values (v_id, v_username, trim(p_full_name), nullif(trim(coalesce(p_phone, '')), ''), trim(p_email));
    end if;
  elsif exists (select 1 from user_permissions where user_id = v_id and permission = 'mainstreet_rep') then
    raise exception 'A rep can’t also be a host';
  end if;
  insert into ms_hosts (user_id, campaign_id, zoom_url, added_by) values (v_id, p_campaign, nullif(trim(coalesce(p_zoom, '')), ''), auth.uid())
  on conflict (user_id) do update set campaign_id = excluded.campaign_id, zoom_url = coalesce(excluded.zoom_url, ms_hosts.zoom_url), active = true, updated_at = now();
  return jsonb_build_object('id', v_id, 'new_account', v_username is not null);
end $$;

create or replace function public.ms_admin_save_host(p_user uuid, p_campaign uuid, p_zoom text, p_timezone text, p_hours jsonb, p_days_off date[], p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  perform ms_host_check_hours(p_hours);
  if p_zoom is not null and trim(p_zoom) <> '' and trim(p_zoom) !~* '^https://' then raise exception 'The Zoom link should start with https://'; end if;
  if not exists (select 1 from pg_timezone_names where name = coalesce(p_timezone, '')) then raise exception 'Pick a time zone'; end if;
  update ms_hosts set campaign_id = p_campaign, zoom_url = nullif(trim(coalesce(p_zoom, '')), ''), timezone = p_timezone,
         hours = coalesce(p_hours, '{}'::jsonb), days_off = coalesce(p_days_off, '{}'), active = coalesce(p_active, true), updated_at = now()
   where user_id = p_user;
  if not found then raise exception 'That host is gone'; end if;
end $$;

create or replace function public.ms_get_meeting_rules(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  return (select to_jsonb(x) from ms_rules(p_campaign) x);
end $$;

create or replace function public.ms_save_meeting_rules(p_campaign uuid, p_length int, p_buffer int, p_notice int, p_days_ahead int, p_max_per_day int, p_timezone text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from pg_timezone_names where name = coalesce(p_timezone, '')) then raise exception 'Pick a time zone'; end if;
  insert into ms_meeting_rules (campaign_id, length_min, buffer_min, notice_min, days_ahead, max_per_day, timezone, updated_by, updated_at)
  values (p_campaign, p_length, p_buffer, p_notice, p_days_ahead, p_max_per_day, p_timezone, auth.uid(), now())
  on conflict (campaign_id) do update set length_min = excluded.length_min, buffer_min = excluded.buffer_min, notice_min = excluded.notice_min,
    days_ahead = excluded.days_ahead, max_per_day = excluded.max_per_day, timezone = excluded.timezone, updated_by = auth.uid(), updated_at = now();
  return ms_get_meeting_rules(p_campaign);
end $$;

-- move a call (a new time, and/or another host), or cancel it. A new time keeps the host if they're free then,
-- else goes to whoever is.
create or replace function public.ms_admin_change_meeting(p_meeting uuid, p_start timestamptz, p_host uuid, p_cancel boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m ms_meetings; r ms_meeting_rules; v_start timestamptz; v_host uuid;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select * into m from ms_meetings where id = p_meeting;
  if m.id is null then raise exception 'That call is gone'; end if;
  if coalesce(p_cancel, false) then
    update ms_meetings set status = 'cancelled', outcome_by = auth.uid(), outcome_at = now(), updated_at = now() where id = p_meeting;
    return ms_meeting_json(p_meeting);
  end if;
  r := ms_rules(m.campaign_id);
  v_start := coalesce(p_start, m.starts_at);
  perform pg_advisory_xact_lock(hashtext('ms_meetings:' || m.campaign_id::text));
  if p_host is not null then
    if not exists (select 1 from ms_hosts where user_id = p_host and active and campaign_id = m.campaign_id) then raise exception 'That person doesn’t take this campaign’s calls'; end if;
    if not ms_host_free(p_host, v_start, r.length_min, r.buffer_min, r.max_per_day, m.id) then raise exception 'They aren’t free then'; end if;
    v_host := p_host;
  elsif ms_host_free(m.host_id, v_start, r.length_min, r.buffer_min, r.max_per_day, m.id) then
    v_host := m.host_id;
  else
    select h into v_host from ms_free_hosts(m.campaign_id, v_start, m.id) h limit 1;
    if v_host is null then raise exception 'No one is free then'; end if;
  end if;
  update ms_meetings set starts_at = v_start, ends_at = v_start + make_interval(mins => r.length_min), host_id = v_host,
         status = case when status = 'cancelled' then 'booked' else status end, updated_at = now()
   where id = p_meeting;
  return ms_meeting_json(p_meeting);
end $$;

-- a MainstreetAI admin may send a host their setup email too (Super Admin › Users still can, as before)
create or replace function public.app_admin_issue_setup(p_user uuid)
returns table(code text, email text, full_name text, username text, expires_at timestamp with time zone, reply_to text, invited_by text)
language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare
  u app_users;
  v_code text := encode(gen_random_bytes(32), 'hex');
  v_exp timestamptz := now() + interval '7 days';
  me app_users;
  v_rep boolean;
  v_host boolean;
begin
  select * into u from app_users where app_users.id = p_user;
  if u.id is null then raise exception 'No such user'; end if;
  v_rep := exists (select 1 from user_permissions where user_id = p_user and permission = 'mainstreet_rep');
  v_host := exists (select 1 from ms_hosts where user_id = p_user) and not exists (select 1 from user_permissions where user_id = p_user);
  if not (app_has_perm('sa_users') or ((v_rep or v_host) and ms_is_admin())) then raise exception 'Not allowed'; end if;
  if u.is_super_admin and not app_is_super_admin() then raise exception 'Only the Super Admin can send this account a setup link'; end if;
  if not u.is_active then raise exception '% is disabled. Turn the account on first.', u.full_name; end if;
  if nullif(trim(coalesce(u.email, '')), '') is null then raise exception '% has no email address', u.full_name; end if;
  select * into me from app_users where app_users.id = auth.uid();
  update app_setup_tokens t set cancelled_at = now() where t.user_id = u.id and t.used_at is null and t.cancelled_at is null;
  insert into app_setup_tokens (user_id, token_hash, email, created_by, expires_at)
  values (u.id, encode(digest(v_code, 'sha256'), 'hex'), trim(u.email), auth.uid(), v_exp);
  return query select v_code, trim(u.email), u.full_name, u.username, v_exp, nullif(trim(coalesce(me.email, '')), ''), me.full_name;
end $function$;

-- Deals: each deal shows its onboarding call (when, host, how it went)
create or replace function public.ms_deals_list(p_status text default 'pending')
returns jsonb language plpgsql stable security definer set search_path = public as $function$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if p_status not in ('pending', 'approved', 'rejected') then raise exception 'Pick pending, approved or rejected'; end if;
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', d.id, 'status', d.status, 'at', d.created_at, 'decided_at', d.decided_at, 'decision_note', d.decision_note,
             'decided_by', (select full_name from app_users where id = d.decided_by),
             'business', jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address, 'kind', b.kind, 'phone', b.phone),
             'campaign', c.name, 'color', c.color, 'zone', z.name, 'rep', u.full_name, 'rep_id', u.id,
             'notes', v.notes, 'contact_name', v.contact_name, 'contact_phone', v.contact_phone, 'contact_email', v.contact_email,
             'far', v.far, 'distance_m', v.distance_m,
             'meeting', (select jsonb_build_object('id', m.id, 'starts_at', m.starts_at, 'status', m.status, 'host', hu.full_name, 'outcome_note', m.outcome_note)
                           from ms_meetings m join app_users hu on hu.id = m.host_id where m.deal_id = d.id order by m.created_at desc limit 1)))
           order by d.created_at desc)
      from ms_deals d
      join ms_visits v on v.id = d.visit_id
      join ms_businesses b on b.id = d.business_id
      join ms_campaigns c on c.id = d.campaign_id
      left join ms_zones z on z.id = d.zone_id
      join app_users u on u.id = d.rep_id
     where d.status = p_status), '[]'::jsonb);
end $function$;

-- grants: the app_*/ms_* functions people call; the helpers stay internal
revoke all on function public.ms_rules(uuid), public.ms_host_free(uuid, timestamptz, int, int, int, uuid),
  public.ms_free_hosts(uuid, timestamptz, uuid), public.ms_meeting_json(uuid), public.ms_host_check_hours(jsonb) from public, anon, authenticated;
revoke all on function public.ms_is_host(uuid), public.ms_can_book(uuid), public.ms_meeting_slots(uuid, date, int),
  public.ms_book_meeting(uuid, uuid, timestamptz, text, text, text, text, double precision, double precision, numeric),
  public.ms_meeting_notice(uuid), public.ms_host_me(), public.ms_host_save(text, text, jsonb, date[]),
  public.ms_meetings_list(timestamptz, timestamptz, uuid, uuid), public.ms_meeting_outcome(uuid, text, text), public.ms_hosts_list(),
  public.ms_admin_add_host(uuid, text, text, text, uuid, text), public.ms_admin_save_host(uuid, uuid, text, text, jsonb, date[], boolean),
  public.ms_get_meeting_rules(uuid), public.ms_save_meeting_rules(uuid, int, int, int, int, int, text),
  public.ms_admin_change_meeting(uuid, timestamptz, uuid, boolean) from public, anon;
grant execute on function public.ms_is_host(uuid), public.ms_can_book(uuid), public.ms_meeting_slots(uuid, date, int),
  public.ms_book_meeting(uuid, uuid, timestamptz, text, text, text, text, double precision, double precision, numeric),
  public.ms_meeting_notice(uuid), public.ms_host_me(), public.ms_host_save(text, text, jsonb, date[]),
  public.ms_meetings_list(timestamptz, timestamptz, uuid, uuid), public.ms_meeting_outcome(uuid, text, text), public.ms_hosts_list(),
  public.ms_admin_add_host(uuid, text, text, text, uuid, text), public.ms_admin_save_host(uuid, uuid, text, text, jsonb, date[], boolean),
  public.ms_get_meeting_rules(uuid), public.ms_save_meeting_rules(uuid, int, int, int, int, int, text),
  public.ms_admin_change_meeting(uuid, timestamptz, uuid, boolean) to authenticated;
