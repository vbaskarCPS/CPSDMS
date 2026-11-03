-- MainstreetAI › Meetings: a host's own calendar blocks booking times. ADDITIVE ONLY.
--
-- A host pastes their calendar's private link (Google: "Secret address in iCal format"; Outlook: a published ICS
-- link). The link opens their whole calendar, so it's kept in Vault and only the ms-calendar edge function reads it.
-- ms-calendar reads the feed and keeps just the busy times (no titles, places or people) as one range set per
-- host (ms_host_calendars.busy, replaced on each read); the booking checks (ms_host_free) leave those times out. The app asks ms-calendar to refresh right before it shows
-- open times and right before it books, so the busy times are a minute old at most.
-- A host with no link works exactly as before (their weekly hours and booked calls only).

create table if not exists public.ms_host_calendars (
  host_id uuid primary key references public.app_users(id),
  secret_id uuid,                       -- vault.secrets: the private link
  fetched_at timestamptz,
  ok boolean,
  error text,
  busy_count int not null default 0,
  busy tstzmultirange not null default '{}',   -- the busy times, nothing else
  updated_at timestamptz not null default now()
);
alter table public.ms_host_calendars enable row level security;
revoke all on table public.ms_host_calendars from anon, authenticated;

-- set (or, with an empty link, remove) a host's calendar link: the host themselves, or an admin for any host
create or replace function public.ms_host_set_calendar(p_url text, p_host uuid default null)
returns jsonb language plpgsql volatile security definer set search_path = public, vault as $$
declare v_host uuid := coalesce(p_host, auth.uid()); v_url text := trim(coalesce(p_url, '')); c ms_host_calendars;
begin
  if v_host is distinct from auth.uid() and not ms_is_admin() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from ms_hosts where user_id = v_host) then raise exception 'Not a host'; end if;
  v_url := regexp_replace(v_url, '^webcals?://', 'https://', 'i');
  select * into c from ms_host_calendars where host_id = v_host;
  if v_url = '' then
    if c.secret_id is not null then perform vault.update_secret(c.secret_id, 'removed'); end if;
    update ms_host_calendars set ok = null, error = null, fetched_at = null, busy_count = 0, busy = '{}', updated_at = now() where host_id = v_host;
    return ms_host_calendar_status(v_host);
  end if;
  if v_url !~* '^https://[^/\s]+\.[^/\s]+/\S*$' or length(v_url) > 2000 then raise exception 'That doesn’t look like a calendar link (it starts with https:// or webcal://)'; end if;
  if c.secret_id is not null then perform vault.update_secret(c.secret_id, v_url);
  else c.secret_id := vault.create_secret(v_url, 'ms-calendar:' || v_host::text, 'A MainstreetAI host’s private calendar link'); end if;
  insert into ms_host_calendars (host_id, secret_id, ok, error, fetched_at, busy_count, busy, updated_at)
  values (v_host, c.secret_id, null, null, null, 0, '{}', now())
  on conflict (host_id) do update set secret_id = excluded.secret_id, ok = null, error = null, fetched_at = null, busy_count = 0, busy = '{}', updated_at = now();
  return ms_host_calendar_status(v_host);
end $$;

-- what the host (or an admin) sees: connected or not, when it was last read, and any problem. Never the link.
create or replace function public.ms_host_calendar_status(p_host uuid default null)
returns jsonb language sql stable security definer set search_path = public, vault as $$
  select jsonb_build_object(
    'connected', c.secret_id is not null and coalesce((select s.decrypted_secret from vault.decrypted_secrets s where s.id = c.secret_id), 'removed') <> 'removed',
    'fetched_at', c.fetched_at, 'ok', c.ok, 'error', c.error, 'busy_count', coalesce(c.busy_count, 0))
  from (select coalesce(p_host, auth.uid()) h) x
  left join ms_host_calendars c on c.host_id = x.h
  where coalesce(p_host, auth.uid()) = auth.uid() or ms_is_admin()
$$;

-- for ms-calendar (service role): the links to read, and storing what it found
create or replace function public.ms_calendar_links(p_campaign uuid default null, p_host uuid default null)
returns table (host_id uuid, url text, timezone text, fetched_at timestamptz)
language sql stable security definer set search_path = public, vault as $$
  select c.host_id, s.decrypted_secret, h.timezone, c.fetched_at
    from ms_host_calendars c join ms_hosts h on h.user_id = c.host_id and h.active
    join vault.decrypted_secrets s on s.id = c.secret_id
   where s.decrypted_secret <> 'removed'
     and (p_campaign is null or h.campaign_id = p_campaign) and (p_host is null or c.host_id = p_host)
$$;

create or replace function public.ms_calendar_store(p_host uuid, p_busy jsonb, p_error text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if p_error is not null then   -- keep the last good busy times; just say it couldn't be read
    update ms_host_calendars set ok = false, error = left(p_error, 300), fetched_at = now(), updated_at = now() where host_id = p_host;
    return;
  end if;
  update ms_host_calendars set ok = true, error = null, fetched_at = now(), busy_count = jsonb_array_length(coalesce(p_busy, '[]'::jsonb)),
         busy = coalesce((select range_agg(tstzrange((b->>'start')::timestamptz, (b->>'end')::timestamptz))
                            from jsonb_array_elements(coalesce(p_busy, '[]'::jsonb)) b
                           where (b->>'end')::timestamptz > (b->>'start')::timestamptz), '{}'),
         updated_at = now()
   where host_id = p_host;
end $$;

do $$
declare f text;
begin
  foreach f in array array['ms_calendar_links(uuid, uuid)', 'ms_calendar_store(uuid, jsonb, text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['ms_host_set_calendar(text, uuid)', 'ms_host_calendar_status(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- the booking check: as before, plus not during a busy time in the host's own calendar
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
  if exists (select 1 from ms_host_calendars c where c.host_id = p_host and c.busy && tstzrange(p_start, p_start + make_interval(mins => p_len)))
    then return false; end if;
  if p_max is not null and (select count(*) from ms_meetings x where x.host_id = p_host and x.status <> 'cancelled' and x.id is distinct from p_ignore
                              and (x.starts_at at time zone h.timezone)::date = loc::date) >= p_max then return false; end if;
  return true;
end $$;
