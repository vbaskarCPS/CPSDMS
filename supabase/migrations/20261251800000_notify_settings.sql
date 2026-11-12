-- Notifications: who gets told what, on their phone, and how they set it (Settings › Notifications).
--
--   notify_catalog   every kind of notification: its group (who can have it), what it says, the "about whom" choices
--                    (mine / my team / every center I can see) and its default.
--   notify_prefs     each person's own choice per kind (on or off, about whom, and for "nothing entered for a while"
--                    how long). No row = the default.
--   notify_settings  each person's quiet hours (nothing is sent in them) and time zone.
--   notify_events    what happened (one row per thing, ref keeps it to once), and notify_out who it goes to.
-- Things that happen in the app call notify_emit (from triggers on the tables, or every 5 minutes from notify_scan for
-- "nothing entered" and the reminders). It works out who gets it right then, from their group, the centers and team
-- they can see, their choice and their quiet hours, and wakes the push function (action 'events'), which asks the
-- database what is due (notify_due) and sends it, several of the same kind for one person as one notification.
-- A trigger never holds up or fails the change that fired it: everything here is wrapped so a problem only skips the
-- notification. The person who made the change is never told about their own change.
-- New email and the Benny's "it's live" notices keep their own sending, and now listen to the same switches.
-- Additive only.

create extension if not exists pg_net with schema extensions;

-- ───────────── the kinds ─────────────
create table if not exists public.notify_catalog (
  key text primary key,
  grp text not null,              -- rm | wb | bk | sa | ms | msr | all
  grp_label text not null,
  label text not null,
  help text,
  scopes text[] not null,         -- of: mine, team, center
  default_on boolean not null,
  default_scope text not null,
  minutes boolean not null default false,
  sort int not null default 0
);
alter table public.notify_catalog enable row level security;
revoke all on table public.notify_catalog from anon, authenticated;

insert into public.notify_catalog (key, grp, grp_label, label, help, scopes, default_on, default_scope, minutes, sort) values
  ('rm.pending_job',   'rm',  'Route managing', 'A job goes in as pending', 'A worker saves a job as pending.', array['team','center'], true, 'team', false, 10),
  ('rm.job_logged',    'rm',  'Route managing', 'A sale or a prebook is logged', null, array['team','center'], false, 'team', false, 11),
  ('rm.quiet_worker',  'rm',  'Route managing', 'A worker has entered nothing for a while', 'Only after their first entry of the day, between 8 am and 7 pm.', array['team','center'], false, 'team', true, 12),
  ('rm.team_changed',  'rm',  'Route managing', 'Someone else changes my team''s routes or carts', null, array['team'], true, 'team', false, 13),
  ('rm.paid_out',      'rm',  'Route managing', 'A cart is paid out', null, array['team','center'], false, 'team', false, 14),
  ('wb.day_started',   'wb',  'Workerbook', 'The day is started', 'With who showed and who didn''t.', array['center'], true, 'center', false, 20),
  ('wb.day_closed',    'wb',  'Workerbook', 'The day is closed', null, array['center'], false, 'center', false, 21),
  ('wb.next_day',      'wb',  'Workerbook', 'Someone answers about tomorrow', null, array['center'], false, 'center', false, 22),
  ('bk.new',           'bk',  'Master Bookings', 'A booking is added', 'Added by hand or from a sale; not the ones imported from a list.', array['center'], true, 'center', false, 30),
  ('bk.cancelled',     'bk',  'Master Bookings', 'A booking is cancelled', null, array['center'], true, 'center', false, 31),
  ('sa.benny_logged',  'sa',  'Super admin', 'Someone logs a bug or a request with the Benny', null, array['center'], true, 'center', false, 40),
  ('sa.import_done',   'sa',  'Super admin', 'A client import finishes', null, array['center'], true, 'center', false, 41),
  ('ms.deal_submitted','ms',  'MainstreetAI', 'A rep submits a deal', null, array['center'], true, 'center', false, 50),
  ('ms.meeting_booked','ms',  'MainstreetAI', 'A meeting is booked', null, array['center'], true, 'center', false, 51),
  ('ms.rep_far',       'ms',  'MainstreetAI', 'A rep logs a visit far from the business', null, array['center'], false, 'center', false, 52),
  ('msr.deal_decided', 'msr', 'MainstreetAI', 'My deal is approved or turned down', null, array['mine'], true, 'mine', false, 60),
  ('msr.zone_assigned','msr', 'MainstreetAI', 'I''m given a new zone', null, array['mine'], true, 'mine', false, 61),
  ('msr.followup_due', 'msr', 'MainstreetAI', 'A follow-up I set is due', null, array['mine'], true, 'mine', false, 62),
  ('msr.meeting_soon', 'msr', 'MainstreetAI', 'A meeting of mine starts in 30 minutes', null, array['mine'], true, 'mine', false, 63),
  ('all.mail',         'all', 'Everyone', 'New email', null, array['mine'], true, 'mine', false, 90),
  ('all.benny_live',   'all', 'Everyone', 'Something I asked the Benny for is live', null, array['mine'], true, 'mine', false, 91)
on conflict (key) do update set grp = excluded.grp, grp_label = excluded.grp_label, label = excluded.label, help = excluded.help,
  scopes = excluded.scopes, default_on = excluded.default_on, default_scope = excluded.default_scope, minutes = excluded.minutes, sort = excluded.sort;

create table if not exists public.notify_prefs (
  user_id uuid not null references public.app_users(id) on delete cascade,
  event text not null references public.notify_catalog(key) on delete cascade,
  enabled boolean not null,
  scope text,
  minutes int check (minutes in (30, 60, 90, 120)),
  updated_at timestamptz not null default now(),
  primary key (user_id, event)
);
alter table public.notify_prefs enable row level security;
revoke all on table public.notify_prefs from anon, authenticated;

create table if not exists public.notify_settings (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  quiet_on boolean not null default false,
  quiet_from time not null default '21:00',
  quiet_to time not null default '07:00',
  tz text not null default 'America/Toronto',
  updated_at timestamptz not null default now()
);
alter table public.notify_settings enable row level security;
revoke all on table public.notify_settings from anon, authenticated;

create table if not exists public.notify_events (
  id bigserial primary key,
  event text not null,
  center_id uuid,
  team text,
  target_user uuid,
  actor uuid,
  minutes int,
  title text not null,
  body text,
  url text,
  ref text unique,
  created_at timestamptz not null default now()
);
alter table public.notify_events enable row level security;
revoke all on table public.notify_events from anon, authenticated;
create index if not exists notify_events_at on public.notify_events (created_at);

create table if not exists public.notify_out (
  event_id bigint not null references public.notify_events(id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (event_id, user_id)
);
alter table public.notify_out enable row level security;
revoke all on table public.notify_out from anon, authenticated;
create index if not exists notify_out_due on public.notify_out (created_at) where sent_at is null;

-- ───────────── who is who ─────────────
create or replace function public.notify_perm(p_user uuid, p_perm text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from user_permissions up join app_users a on a.id = up.user_id where up.user_id = p_user and up.permission = p_perm and a.is_active)
$$;
create or replace function public.notify_super(p_user uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select is_super_admin and is_active from app_users where id = p_user), false)
$$;
create or replace function public.notify_sees(p_user uuid, p_center uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_center is null or notify_super(p_user)
      or exists (select 1 from user_centers uc join app_users a on a.id = uc.user_id where uc.user_id = p_user and uc.center_id = p_center and a.is_active)
$$;
-- the route-manager teams a person runs: their own (rm_ + their name, as the old app makes it) and the ones they float for
create or replace function public.notify_teams(p_user uuid)
returns text[] language sql stable security definer set search_path to 'public' as $$
  with me as (select 'rm_' || regexp_replace(lower(full_name), '[^a-z0-9]', '', 'g') rm from app_users where id = p_user)
  select coalesce(array_agg(distinct x), '{}') from (
    select me.rm x from me
    union all
    select f from me, users u, jsonb_array_elements_text(case when jsonb_typeof(u.metadata->'floatingFor') = 'array' then u.metadata->'floatingFor' else '[]' end) f
     where u.user_id = me.rm) y where x is not null
$$;
create or replace function public.notify_in_group(p_user uuid, p_grp text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select case p_grp
    when 'rm'  then notify_super(p_user) or notify_perm(p_user, 'route_manager') or notify_perm(p_user, 'rm_floater')
    when 'wb'  then notify_super(p_user) or notify_perm(p_user, 'workerbook')
    when 'bk'  then notify_super(p_user) or notify_perm(p_user, 'bookings')
    when 'sa'  then notify_super(p_user)
    when 'ms'  then notify_super(p_user) or notify_perm(p_user, 'mainstreet_admin')
    when 'msr' then notify_perm(p_user, 'mainstreet_rep')
    when 'all' then true
    else false end
$$;
create or replace function public.notify_quiet(p_user uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select case when not s.quiet_on then false
                               when s.quiet_from <= s.quiet_to then (now() at time zone s.tz)::time >= s.quiet_from and (now() at time zone s.tz)::time < s.quiet_to
                               else (now() at time zone s.tz)::time >= s.quiet_from or (now() at time zone s.tz)::time < s.quiet_to end
                     from notify_settings s where s.user_id = p_user), false)
$$;
-- is this kind on for this person? (used by the older senders: new email and the Benny's notices)
create or replace function public.notify_wants(p_user uuid, p_event text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select p.enabled from notify_prefs p where p.user_id = p_user and p.event = p_event),
                  (select c.default_on from notify_catalog c where c.key = p_event), true)
$$;

-- ───────────── something happened ─────────────
create or replace function public.notify_emit(p_event text, p_center uuid, p_team text, p_target uuid, p_title text, p_body text, p_url text, p_ref text,
                                              p_minutes int default null, p_actor uuid default null)
returns int language plpgsql volatile security definer set search_path to 'public' as $$
declare c notify_catalog; v_id bigint; v_n int := 0; v_actor uuid := coalesce(p_actor, auth.uid());
begin
  select * into c from notify_catalog where key = p_event;
  if c.key is null then return 0; end if;
  insert into notify_events (event, center_id, team, target_user, actor, minutes, title, body, url, ref)
  values (p_event, p_center, p_team, p_target, v_actor, p_minutes, left(coalesce(p_title, ''), 120), left(p_body, 300),
          case when p_url ~ '^/app(/[A-Za-z0-9_./?=&%-]*)?$' and p_url !~ '\.\.' then p_url else '/app' end, p_ref)
  on conflict (ref) do nothing returning id into v_id;
  if v_id is null then return 0; end if;
  insert into notify_out (event_id, user_id)
  select v_id, a.id from app_users a
    left join notify_prefs p on p.user_id = a.id and p.event = p_event
   where a.is_active and a.id is distinct from v_actor
     and exists (select 1 from push_subscriptions s where s.user_id = a.id)
     and coalesce(p.enabled, c.default_on)
     and notify_in_group(a.id, c.grp)
     and notify_sees(a.id, p_center)
     and case coalesce(p.scope, c.default_scope)
           when 'mine' then a.id = p_target
           when 'team' then p_team is not null and p_team = any (notify_teams(a.id))
           else 'center' = any (c.scopes) end
     and (p_minutes is null or coalesce(p.minutes, 60) = p_minutes)
     and not notify_quiet(a.id);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform net.http_post(url := 'https://mipvcafqrmwxnoqmicxh.supabase.co/functions/v1/push',
      headers := jsonb_build_object('content-type', 'application/json'), body := jsonb_build_object('action', 'events'));
  end if;
  return v_n;
exception when others then
  return 0;
end $$;
revoke all on function public.notify_emit(text, uuid, text, uuid, text, text, text, text, int, uuid) from public, anon, authenticated;

-- The push function (service role): what is due, claimed once. Several of one kind for one person become one
-- notification ("3 pending jobs"), the newest first.
create or replace function public.notify_due()
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare v jsonb;
begin
  with claimed as (
    update notify_out o set sent_at = now()
     where o.sent_at is null and o.created_at > now() - interval '6 hours'
    returning o.event_id, o.user_id),
  rows as (
    select c.user_id, e.event, e.title, e.body, e.url, e.created_at, cat.label
      from claimed c join notify_events e on e.id = c.event_id join notify_catalog cat on cat.key = e.event),
  grouped as (
    select user_id, event, count(*) n, max(label) label,
           (array_agg(title order by created_at desc))[1] title1, (array_agg(body order by created_at desc))[1] body1,
           (array_agg(url order by created_at desc))[1] url1,
           array_to_string((array_agg(title order by created_at desc))[1:3], ' · ') titles
      from rows group by user_id, event)
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', g.user_id, 'event', g.event, 'count', g.n,
           'title', case when g.n = 1 then g.title1 else g.n || ' × ' || g.label end,
           'body', case when g.n = 1 then coalesce(g.body1, '') else g.titles end,
           'url', g.url1, 'tag', 'n-' || g.event,
           'icon', case when g.event like 'ms%' then '/mainstreetai/icon-192.png' end,
           'subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                               from push_subscriptions s where s.user_id = g.user_id), '[]'::jsonb))), '[]'::jsonb)
    into v from grouped g;
  return v;
end $$;
revoke all on function public.notify_due() from public, anon, authenticated;
grant execute on function public.notify_due() to service_role;

-- ───────────── settings, for the person signed in ─────────────
create or replace function public.notify_get()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'devices', (select count(*) from push_subscriptions where user_id = u),
    'quiet', coalesce((select jsonb_build_object('on', s.quiet_on, 'from', to_char(s.quiet_from, 'HH24:MI'), 'to', to_char(s.quiet_to, 'HH24:MI'), 'tz', s.tz)
                         from notify_settings s where s.user_id = u),
                      jsonb_build_object('on', false, 'from', '21:00', 'to', '07:00', 'tz', 'America/Toronto')),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'group', c.grp, 'group_label', c.grp_label, 'label', c.label, 'help', c.help,
                  'scopes', to_jsonb(c.scopes), 'on', coalesce(p.enabled, c.default_on), 'scope', coalesce(p.scope, c.default_scope),
                  'minutes', case when c.minutes then coalesce(p.minutes, 60) end) order by c.sort), '[]'::jsonb)
                 from notify_catalog c left join notify_prefs p on p.user_id = u and p.event = c.key
                where notify_in_group(u, c.grp)));
end $$;
revoke all on function public.notify_get() from public, anon;
grant execute on function public.notify_get() to authenticated;

create or replace function public.notify_set(p_event text, p_on boolean, p_scope text default null, p_minutes int default null)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare u uuid := auth.uid(); c notify_catalog;
begin
  if u is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  select * into c from notify_catalog where key = p_event;
  if c.key is null or not notify_in_group(u, c.grp) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_scope is not null and not (p_scope = any (c.scopes)) then raise exception 'That choice isn''t available for this one'; end if;
  if p_minutes is not null and (not c.minutes or p_minutes not in (30, 60, 90, 120)) then raise exception 'Pick 30, 60, 90 or 120 minutes'; end if;
  insert into notify_prefs (user_id, event, enabled, scope, minutes) values (u, p_event, coalesce(p_on, c.default_on), p_scope, p_minutes)
  on conflict (user_id, event) do update set enabled = coalesce(p_on, notify_prefs.enabled), scope = coalesce(p_scope, notify_prefs.scope),
    minutes = coalesce(p_minutes, notify_prefs.minutes), updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.notify_set(text, boolean, text, int) from public, anon;
grant execute on function public.notify_set(text, boolean, text, int) to authenticated;

create or replace function public.notify_quiet_set(p_on boolean, p_from text, p_to text, p_tz text default null)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare u uuid := auth.uid(); v_tz text := nullif(trim(coalesce(p_tz, '')), '');
begin
  if u is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  if coalesce(p_from, '') !~ '^([01]\d|2[0-3]):[0-5]\d$' or coalesce(p_to, '') !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Times are HH:MM'; end if;
  if v_tz is not null and not exists (select 1 from pg_timezone_names where name = v_tz) then v_tz := null; end if;
  insert into notify_settings (user_id, quiet_on, quiet_from, quiet_to, tz) values (u, coalesce(p_on, false), p_from::time, p_to::time, coalesce(v_tz, 'America/Toronto'))
  on conflict (user_id) do update set quiet_on = excluded.quiet_on, quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to,
    tz = coalesce(v_tz, notify_settings.tz), updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.notify_quiet_set(boolean, text, text, text) from public, anon;
grant execute on function public.notify_quiet_set(boolean, text, text, text) to authenticated;

-- "Send a test": one notification to the person's own devices, now (quiet hours or not)
create or replace function public.notify_test()
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare u uuid := auth.uid(); v_id bigint; v_subs int;
begin
  if u is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  select count(*) into v_subs from push_subscriptions where user_id = u;
  if v_subs = 0 then return jsonb_build_object('ok', false, 'devices', 0); end if;
  insert into notify_events (event, target_user, title, body, url, ref)
  values ('all.mail', u, 'Test notification', 'Notifications are working on this device.', '/app/account/notifications', 'test:' || u || ':' || extract(epoch from now())::bigint)
  returning id into v_id;
  insert into notify_out (event_id, user_id) values (v_id, u);
  perform net.http_post(url := 'https://mipvcafqrmwxnoqmicxh.supabase.co/functions/v1/push',
    headers := jsonb_build_object('content-type', 'application/json'), body := jsonb_build_object('action', 'events'));
  return jsonb_build_object('ok', true, 'devices', v_subs);
end $$;
revoke all on function public.notify_test() from public, anon;
grant execute on function public.notify_test() to authenticated;

-- ───────────── the things that happen ─────────────
-- a worker's name and their route manager, on a center
create or replace function public.notify_worker(p_center uuid, p_cn text, out name text, out team text)
language sql stable security definer set search_path to 'public' as $$
  select coalesce(u.name, p_cn), nullif(u.metadata->>'assignedManagerId', '') from users u
   where u.user_id = p_cn and (p_center is null or u.command_center_id = p_center) limit 1
$$;
create or replace function public.notify_money(p numeric) returns text language sql immutable as $$
  select case when p is null then null when p = round(p) then '$' || to_char(p, 'FM999,999') else '$' || to_char(p, 'FM999,999.00') end
$$;

create or replace function public.notify_on_pending() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare w record;
begin
  begin
    select * into w from notify_worker(new.command_center_id, new.worker_id);
    perform notify_emit('rm.pending_job', new.command_center_id, w.team, null, 'Pending job: ' || coalesce(w.name, new.worker_id),
      concat_ws(' · ', nullif(trim(coalesce(new.house_number, '') || ' ' || coalesce(new.street_name, '')), ''), new.route_code, notify_money(new.price)),
      '/app/rm', 'pending:' || new.id);
  exception when others then null; end;
  return null;
end $$;
drop trigger if exists notify_pending on public.pending_sales;
create trigger notify_pending after insert on public.pending_sales for each row execute function public.notify_on_pending();

create or replace function public.notify_on_job() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare w record;
begin
  begin
    if new.type in ('Sale', 'Production') then
      select * into w from notify_worker(new.command_center_id, new.worker_id);
      perform notify_emit('rm.job_logged', new.command_center_id, w.team, null,
        case new.type when 'Sale' then 'Sale: ' else 'Prebook done: ' end || coalesce(w.name, new.worker_id),
        concat_ws(' · ', nullif(new.customer_snapshot->>'address', ''), coalesce(nullif(new.customer_snapshot->>'routeCode', ''), new.route_code), notify_money(new.price)),
        '/app/rm', 'job:' || new.id);
    end if;
  exception when others then null; end;
  return null;
end $$;
drop trigger if exists notify_job on public.transactions;
create trigger notify_job after insert on public.transactions for each row execute function public.notify_on_job();

create or replace function public.notify_on_logsheet() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare w record; v_me text;
begin
  begin
    select * into w from notify_worker(new.command_center_id, new.worker_id);
    if new.status = 'PAID' and old.status is distinct from 'PAID' then
      perform notify_emit('rm.paid_out', new.command_center_id, w.team, null, 'Paid out: ' || coalesce(w.name, new.worker_id),
        null, '/app/workerbook/payouts', 'paid:' || new.id);
    elsif new.team_worker_ids is distinct from old.team_worker_ids and w.team is not null then
      v_me := (select 'rm_' || regexp_replace(lower(full_name), '[^a-z0-9]', '', 'g') from app_users where id = auth.uid());
      if v_me is distinct from w.team and auth.uid() is not null then
        perform notify_emit('rm.team_changed', new.command_center_id, w.team, null, 'Your team''s carts changed',
          coalesce((select full_name from app_users where id = auth.uid()), 'Someone') || ' changed ' || coalesce(w.name, new.worker_id) || '''s cart',
          '/app/rm', 'cart:' || new.id || ':' || floor(extract(epoch from now()) / 300));
      end if;
    end if;
  exception when others then null; end;
  return null;
end $$;
drop trigger if exists notify_logsheet on public.logsheet_sessions;
create trigger notify_logsheet after update on public.logsheet_sessions for each row execute function public.notify_on_logsheet();

create or replace function public.notify_on_routes() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_me text; v_team text;
begin
  begin
    if auth.uid() is null then return null; end if;
    if new.assigned_worker_ids is not distinct from old.assigned_worker_ids and new.manager_id is not distinct from old.manager_id then return null; end if;
    v_me := (select 'rm_' || regexp_replace(lower(full_name), '[^a-z0-9]', '', 'g') from app_users where id = auth.uid());
    foreach v_team in array array_remove(array[new.manager_id, case when old.manager_id is distinct from new.manager_id then old.manager_id end], null) loop
      if v_team is distinct from v_me then
        perform notify_emit('rm.team_changed', new.command_center_id, v_team, null, 'Your team''s routes changed',
          coalesce((select full_name from app_users where id = auth.uid()), 'Someone') || ' changed ' || new.route_code,
          '/app/rm', 'route:' || v_team || ':' || new.route_code || ':' || floor(extract(epoch from now()) / 300));
      end if;
    end loop;
  exception when others then null; end;
  return null;
end $$;
drop trigger if exists notify_routes on public.routes;
create trigger notify_routes after update on public.routes for each row execute function public.notify_on_routes();

create or replace function public.notify_on_day() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_center text;
begin
  begin
    v_center := (select display_name from command_centers where id = new.center_id);
    if new.state = 'live' and old.state is distinct from 'live' then
      perform notify_emit('wb.day_started', new.center_id, null, null, 'The day is started · ' || coalesce(v_center, ''),
        (select count(*) filter (where attendance = 'showed') || ' showed, ' || count(*) filter (where attendance is distinct from 'showed') || ' didn''t'
           from day_roster where day_id = new.id),
        '/app/workerbook/days/' || new.day, 'day-live:' || new.id);
    elsif new.state = 'closed' and old.state is distinct from 'closed' then
      perform notify_emit('wb.day_closed', new.center_id, null, null, 'The day is closed · ' || coalesce(v_center, ''),
        concat_ws(' · ', (new.summary->>'steps') || ' steps', notify_money(nullif(new.summary->>'gross', '')::numeric)),
        '/app/workerbook/days/' || new.day, 'day-closed:' || new.id);
    end if;
  exception when others then null; end;
  return null;
end $$;
drop trigger if exists notify_day on public.days;
create trigger notify_day after update on public.days for each row execute function public.notify_on_day();

create or replace function public.notify_on_roster() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare d days;
begin
  begin
    if new.next_day is not null and old.next_day is null then
      select * into d from days where id = new.day_id;
      perform notify_emit('wb.next_day', d.center_id, null, null,
        coalesce((select p.first_name || ' ' || p.last_name from hires h join people p on p.id = h.person_id where h.id = new.hire_id), 'Someone') || ' answered about tomorrow',
        null, '/app/workerbook/days/' || d.day, 'nextday:' || new.id);
    end if;
  exception when others then null; end;
  return null;
end $$;
drop trigger if exists notify_roster on public.day_roster;
create trigger notify_roster after update on public.day_roster for each row execute function public.notify_on_roster();

create or replace function public.notify_on_booking() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_center uuid; v_where text;
begin
  begin
    v_center := (select center_id from mb_lists where id = new.list_id);
    v_where := concat_ws(', ', nullif(trim(coalesce(new.house_no, '') || ' ' || coalesce(new.street_name, '')), ''), new.city);
    if tg_op = 'INSERT' then
      if coalesce(new.source->>'how', '') <> 'import' then
        perform notify_emit('bk.new', v_center, null, null, 'New booking', concat_ws(' · ', v_where, new.route_code), '/app/bookings/list', 'bk-new:' || new.id);
      end if;
    elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
      perform notify_emit('bk.cancelled', v_center, null, null, 'Booking cancelled', concat_ws(' · ', v_where, new.route_code), '/app/bookings/list', 'bk-cancel:' || new.id || ':' || extract(epoch from now())::bigint);
    end if;
  exception when others then null; end;
  return null;
end $$;
drop trigger if exists notify_booking on public.mb_bookings;
create trigger notify_booking after insert or update on public.mb_bookings for each row execute function public.notify_on_booking();

create or replace function public.notify_on_bug() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  begin
    perform notify_emit('sa.benny_logged', new.center_id, null, null,
      case when new.kind = 'bug' then 'Bug logged' else 'Request logged' end || ' · ' || coalesce((select full_name from app_users where id = new.created_by), 'someone'),
      new.title, '/app/admin/bugs', 'bug:' || new.id, null, new.created_by);
  exception when others then null; end;
  return null;
end $$;
drop trigger if exists notify_bug on public.benny_bugs;
create trigger notify_bug after insert on public.benny_bugs for each row execute function public.notify_on_bug();

create or replace function public.notify_on_import() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  begin
    if new.status = 'done' and old.status is distinct from 'done' then
      perform notify_emit('sa.import_done', null, null, null, 'Import finished', coalesce(new.file_name, new.recipe_name, 'Client import'),
        '/app/admin/territory', 'import:' || new.id, null, new.created_by);
    end if;
  exception when others then null; end;
  return null;
end $$;
drop trigger if exists notify_import on public.client_imports;
create trigger notify_import after update on public.client_imports for each row execute function public.notify_on_import();

-- MainstreetAI
create or replace function public.notify_ms_biz(p_visit uuid) returns text language sql stable security definer set search_path to 'public' as $$
  select b.name from ms_visits v join ms_businesses b on b.id = v.business_id where v.id = p_visit
$$;
create or replace function public.notify_on_deal() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_rep text := (select full_name from app_users where id = new.rep_id); v_biz text := notify_ms_biz(new.visit_id);
begin
  begin
    if tg_op = 'INSERT' then
      perform notify_emit('ms.deal_submitted', null, null, null, 'Deal to approve · ' || coalesce(v_rep, 'a rep'), v_biz, '/app/mainstreet/deals', 'deal:' || new.id, null, new.rep_id);
    elsif new.status is distinct from old.status and new.status in ('approved', 'rejected') then
      perform notify_emit('msr.deal_decided', null, null, new.rep_id, case when new.status = 'approved' then 'Deal approved' else 'Deal turned down' end,
        concat_ws(' · ', v_biz, nullif(new.decision_note, '')), '/app/rep', 'deal-' || new.status || ':' || new.id);
    end if;
  exception when others then null; end;
  return null;
end $$;
drop trigger if exists notify_deal on public.ms_deals;
create trigger notify_deal after insert or update on public.ms_deals for each row execute function public.notify_on_deal();

create or replace function public.notify_on_meeting() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  begin
    perform notify_emit('ms.meeting_booked', null, null, null, 'Meeting booked · ' || coalesce((select full_name from app_users where id = new.rep_id), 'a rep'),
      concat_ws(' · ', coalesce(notify_ms_biz(new.visit_id), new.owner_name), to_char(new.starts_at at time zone 'America/Toronto', 'Dy Mon DD, HH12:MI am')),
      '/app/mainstreet/meetings', 'meet:' || new.id);
  exception when others then null; end;
  return null;
end $$;
drop trigger if exists notify_meeting on public.ms_meetings;
create trigger notify_meeting after insert on public.ms_meetings for each row execute function public.notify_on_meeting();

create or replace function public.notify_on_visit() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  begin
    if coalesce(new.far, false) then
      perform notify_emit('ms.rep_far', null, null, null, 'Visit far from the business · ' || coalesce((select full_name from app_users where id = new.rep_id), 'a rep'),
        concat_ws(' · ', notify_ms_biz(new.id), case when new.distance_m is not null then round(new.distance_m) || ' m away' end),
        '/app/mainstreet/pipeline', 'far:' || new.id, null, new.rep_id);
    end if;
  exception when others then null; end;
  return null;
end $$;
drop trigger if exists notify_visit on public.ms_visits;
create trigger notify_visit after insert on public.ms_visits for each row execute function public.notify_on_visit();

create or replace function public.notify_on_zone() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  begin
    if new.rep_id is not null and (tg_op = 'INSERT' or new.rep_id is distinct from old.rep_id) then
      perform notify_emit('msr.zone_assigned', null, null, new.rep_id, 'New zone: ' || coalesce((select name from ms_zones where id = new.zone_id), 'a zone'),
        (select name from ms_campaigns where id = new.campaign_id), '/app/rep', 'zone:' || new.zone_id || ':' || new.campaign_id || ':' || new.rep_id);
    end if;
  exception when others then null; end;
  return null;
end $$;
drop trigger if exists notify_zone on public.ms_zone_campaigns;
create trigger notify_zone after insert or update on public.ms_zone_campaigns for each row execute function public.notify_on_zone();

-- ───────────── every 5 minutes: nothing entered for a while, and the reminders ─────────────
create or replace function public.notify_scan()
returns int language plpgsql volatile security definer set search_path to 'public' as $$
declare r record; v_n int := 0; v_mark int;
begin
  -- workers on a running day who entered something today and then nothing for 30, 60, 90 or 120 minutes
  for r in
    with live as (
      select d.command_center_id center, d.date as lday,
             case when c.region = 'West' then 'America/Vancouver' else 'America/Toronto' end tz
        from daily_sessions d join command_centers c on c.id = d.command_center_id and not coalesce(c.is_demo, false) where d.is_active),
    last as (
      select l.center, l.lday, l.tz, x.cn, max(x.at) last_at from live l
        cross join lateral (
          select v.worker_id cn, v.at from client_visits v where v.center_id = l.center::text and v.day = l.lday
          union all select t.worker_id, t.timestamp::timestamptz from transactions t where t.command_center_id = l.center
          union all select p.worker_id, p.created_at from pending_sales p where p.command_center_id = l.center and p.session_date = l.lday) x
       where x.cn is not null group by 1, 2, 3, 4)
    select * from last
     where extract(hour from now() at time zone tz) between 8 and 18
       and now() - last_at >= interval '30 minutes' and now() - last_at < interval '125 minutes'
  loop
    v_mark := (floor(extract(epoch from now() - r.last_at) / 1800) * 30)::int;
    if v_mark in (30, 60, 90, 120) then
      v_n := v_n + notify_emit('rm.quiet_worker', r.center, (select team from notify_worker(r.center, r.cn)), null,
        'Nothing entered for ' || v_mark || ' min: ' || (select name from notify_worker(r.center, r.cn)),
        'Last entry at ' || to_char(r.last_at at time zone r.tz, 'HH12:MI am'), '/app/rm', 'quiet:' || r.cn || ':' || r.lday || ':' || v_mark, v_mark, null);
    end if;
  end loop;
  -- MainstreetAI: a follow-up that just came due, and a meeting 30 minutes away
  for r in select v.id, v.rep_id, v.follow_up_at from ms_visits v
            where v.follow_up_at between now() - interval '10 minutes' and now() and v.resolved_at is null and v.rep_id is not null loop
    v_n := v_n + notify_emit('msr.followup_due', null, null, r.rep_id, 'Follow-up due', notify_ms_biz(r.id), '/app/rep', 'fu:' || r.id || ':' || r.follow_up_at, null, null);
  end loop;
  for r in select m.id, m.rep_id, m.starts_at, m.visit_id, m.owner_name from ms_meetings m
            where m.starts_at - interval '30 minutes' between now() - interval '10 minutes' and now() and m.rep_id is not null
              and coalesce(m.status, '') not in ('cancelled', 'canceled', 'done', 'no_show') loop
    v_n := v_n + notify_emit('msr.meeting_soon', null, null, r.rep_id, 'Meeting in 30 minutes',
      concat_ws(' · ', coalesce(notify_ms_biz(r.visit_id), r.owner_name), to_char(r.starts_at at time zone 'America/Toronto', 'HH12:MI am')),
      '/app/rep', 'meet-soon:' || r.id || ':' || r.starts_at, null, null);
  end loop;
  return v_n;
end $$;
revoke all on function public.notify_scan() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'notify-scan') then
    perform cron.schedule('notify-scan', '*/5 * * * *', 'select public.notify_scan()');
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['notify_perm(uuid, text)', 'notify_super(uuid)', 'notify_sees(uuid, uuid)', 'notify_teams(uuid)', 'notify_in_group(uuid, text)',
                           'notify_quiet(uuid)', 'notify_wants(uuid, text)', 'notify_worker(uuid, text)', 'notify_ms_biz(uuid)', 'notify_money(numeric)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- New email and the Benny's notices listen to the same switches (Everyone › New email, … is live)
do $do$
declare src text; was text;
begin
  src := replace(pg_get_functiondef('public.push_for_message(uuid)'::regprocedure), E'\r', '');
  was := src;
  src := replace(src, $a$  return jsonb_build_object('users', to_jsonb(users),$a$, $b$  users := array(select x from unnest(users) x where notify_wants(x, 'all.mail'));
  return jsonb_build_object('users', to_jsonb(users),$b$);
  if src = was then raise exception 'push_for_message: change did not apply'; end if;
  execute src;
  src := replace(pg_get_functiondef('public.benny_live_due()'::regprocedure), E'\r', '');
  was := src;
  src := replace(src, $a$and b.live_at > now() - interval '2 days'$a$, $b$and b.live_at > now() - interval '2 days' and notify_wants(b.created_by, 'all.benny_live')$b$);
  if src = was then raise exception 'benny_live_due: change did not apply'; end if;
  execute src;
end $do$;

-- several of one kind at once: "3 pending jobs"
alter table public.notify_catalog add column if not exists many text;
update public.notify_catalog c set many = v.many from (values
  ('rm.pending_job', 'pending jobs'), ('rm.job_logged', 'sales and prebooks logged'), ('rm.quiet_worker', 'workers with nothing entered'),
  ('rm.team_changed', 'changes to your team'), ('rm.paid_out', 'carts paid out'), ('wb.day_started', 'days started'), ('wb.day_closed', 'days closed'),
  ('wb.next_day', 'answers about tomorrow'), ('bk.new', 'new bookings'), ('bk.cancelled', 'bookings cancelled'), ('sa.benny_logged', 'things logged with the Benny'),
  ('sa.import_done', 'imports finished'), ('ms.deal_submitted', 'deals to approve'), ('ms.meeting_booked', 'meetings booked'), ('ms.rep_far', 'visits far from the business'),
  ('msr.deal_decided', 'deals decided'), ('msr.zone_assigned', 'new zones'), ('msr.followup_due', 'follow-ups due'), ('msr.meeting_soon', 'meetings coming up'),
  ('all.mail', 'new emails'), ('all.benny_live', 'things now live')) v(key, many) where c.key = v.key;
do $do$
declare src text; was text;
begin
  src := replace(pg_get_functiondef('public.notify_due()'::regprocedure), E'\r', '');
  was := src;
  src := replace(src, $a$select c.user_id, e.event, e.title, e.body, e.url, e.created_at, cat.label$a$, $b$select c.user_id, e.event, e.title, e.body, e.url, e.created_at, coalesce(cat.many, cat.label) label$b$);
  src := replace(src, $a$else g.n || ' × ' || g.label end$a$, $b$else g.n || ' ' || g.label end$b$);
  if src = was then raise exception 'notify_due: change did not apply'; end if;
  execute src;
end $do$;

-- trigger functions run as triggers only; nobody calls them
do $$
declare f text;
begin
  foreach f in array array['notify_on_pending()', 'notify_on_job()', 'notify_on_logsheet()', 'notify_on_routes()', 'notify_on_day()', 'notify_on_roster()',
                           'notify_on_booking()', 'notify_on_bug()', 'notify_on_import()', 'notify_on_deal()', 'notify_on_meeting()', 'notify_on_visit()', 'notify_on_zone()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
alter function public.notify_money(numeric) set search_path to 'public';

-- a pending sale's price is text
do $do$
declare src text; was text;
begin
  src := replace(pg_get_functiondef('public.notify_on_pending()'::regprocedure), E'\r', '');
  was := src;
  src := replace(src, $a$new.route_code, notify_money(new.price))$a$, $b$new.route_code, notify_money(case when new.price ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then trim(new.price)::numeric end))$b$);
  if src = was then raise exception 'notify_on_pending: change did not apply'; end if;
  execute src;
end $do$;
revoke all on function public.notify_on_pending() from public, anon, authenticated;

-- the Benny's "it's live" switch only for people who have the Benny (super admins and route managers)
do $do$
declare src text; was text;
begin
  src := replace(pg_get_functiondef('public.notify_get()'::regprocedure), E'\r', '');
  was := src;
  src := replace(src, $a$where notify_in_group(u, c.grp)));$a$, $b$where notify_in_group(u, c.grp)
                  and (c.key <> 'all.benny_live' or notify_super(u) or notify_perm(u, 'route_manager') or notify_perm(u, 'rm_floater'))));$b$);
  if src = was then raise exception 'notify_get: change did not apply'; end if;
  execute src;
end $do$;
