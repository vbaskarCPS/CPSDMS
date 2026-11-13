-- The Benny's morning report. At the time each person picks (7:30 by default, Settings › Notifications) the people who
-- have the Benny get one notification, and the Benny opens with: what it has learned since they last looked (with a
-- "See what's new" button), any day from before today that is still open (last night not closed), and, for people who
-- run the workerbook, "Want help starting the day?". Additive only.

-- what the Benny has learned to do, newest first. Shown once to each person (benny_updates_seen keeps where they are).
create table if not exists public.benny_updates (
  id text primary key,
  added_on date not null,
  title text not null,
  how text not null,            -- one line on what it does
  ask text,                     -- a question to try it with
  sort int not null default 0,
  added_at timestamptz not null default now()
);
alter table public.benny_updates enable row level security;
revoke all on table public.benny_updates from anon, authenticated;

insert into public.benny_updates (id, added_on, title, how, ask, sort) values
  ('2026-11-12-pace', '2026-11-12', 'Pace, with a range', 'Where the day is against the usual for this time, and the lowest and highest it can end at.', 'How are we pacing today?', 10),
  ('2026-11-12-areas', '2026-11-12', 'Closing rate by area', 'Which maps close best, the routes on each and the ones not knocked yet.', 'Which maps close best this season?', 20),
  ('2026-11-12-add-job', '2026-11-12', 'Add a job to a logsheet', 'A sale and its add-ons on a worker’s logsheet. Only the address and price are needed; I ask for the rest once.', 'Add a job to a logsheet', 30),
  ('2026-11-12-notifications', '2026-11-12', 'Phone notifications', 'Choose what you’re told on your phone, about whom, and quiet hours, in Settings › Notifications.', null, 40),
  ('2026-11-13-crew', '2026-11-13', 'Road-trip crews load themselves', 'Today and tomorrow get the whole active crew on the roster, ticked, every hour, without anyone opening the day.', 'Who’s on tomorrow’s crew?', 50)
on conflict (id) do update set added_on = excluded.added_on, title = excluded.title, how = excluded.how, ask = excluded.ask, sort = excluded.sort;
update public.benny_updates set added_at = (added_on + time '18:00') at time zone 'America/Toronto'
 where id in ('2026-11-12-pace', '2026-11-12-areas', '2026-11-12-add-job', '2026-11-12-notifications', '2026-11-13-crew');

create table if not exists public.benny_updates_seen (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  seen_at timestamptz,          -- when they last looked at what's new
  morning_on date               -- the last day the morning report was shown in the app
);
alter table public.benny_updates_seen enable row level security;
revoke all on table public.benny_updates_seen from anon, authenticated;

-- the time of the report
alter table public.notify_settings add column if not exists morning_at time not null default '07:30';

insert into public.notify_catalog (key, grp, grp_label, label, help, scopes, default_on, default_scope, minutes, sort, many) values
  ('all.morning', 'all', 'Everyone', 'The Benny’s morning report', 'What I’ve learned, a day left open, and help starting the day.', array['mine'], true, 'mine', false, 92, 'morning reports')
on conflict (key) do update set grp = excluded.grp, grp_label = excluded.grp_label, label = excluded.label, help = excluded.help,
  scopes = excluded.scopes, default_on = excluded.default_on, default_scope = excluded.default_scope, sort = excluded.sort, many = excluded.many;

create or replace function public.benny_has(p_user uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select notify_super(p_user) or notify_perm(p_user, 'route_manager') or notify_perm(p_user, 'rm_floater')
$$;
revoke all on function public.benny_has(uuid) from public, anon, authenticated;

-- the report for one person (used by the notification and by the app)
create or replace function public.benny_morning_of(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_seen timestamptz; v_new jsonb; v_open jsonb; v_start boolean;
begin
  select seen_at into v_seen from benny_updates_seen where user_id = p_user;
  -- added since they last looked (someone who never has: the last three days)
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'how', b.how, 'ask', b.ask, 'on', b.added_on) order by b.added_at desc, b.sort), '[]'::jsonb)
    into v_new from benny_updates b
   where b.added_at > coalesce(v_seen, now() - interval '3 days');
  -- a day from before today (the center's own date) that is still running
  select coalesce(jsonb_agg(jsonb_build_object('center_id', c.id, 'center', c.display_name, 'day', d.day) order by d.day, c.display_name), '[]'::jsonb)
    into v_open from days d join command_centers c on c.id = d.center_id and not coalesce(c.is_demo, false)
   where d.state = 'live'
     and d.day < (now() at time zone case when c.region = 'West' then 'America/Vancouver' else 'America/Toronto' end)::date
     and notify_sees(p_user, c.id);
  v_start := notify_super(p_user) or notify_perm(p_user, 'workerbook');
  return jsonb_build_object('new', v_new, 'open', v_open, 'can_start', v_start);
end $$;
revoke all on function public.benny_morning_of(uuid) from public, anon, authenticated;

-- the words of the notification and of the Benny's first line
create or replace function public.benny_morning_line(p jsonb)
returns text language sql immutable as $$
  select concat_ws(' ',
    case jsonb_array_length(p->'new') when 0 then null when 1 then 'I learned how to do 1 new thing.' else 'I learned how to do ' || jsonb_array_length(p->'new') || ' new things.' end,
    case when jsonb_array_length(p->'open') > 0 then
      case when jsonb_array_length(p->'open') = 1
        then (p->'open'->0->>'center') || ' ' || to_char((p->'open'->0->>'day')::date, 'Dy Mon FMDD') || ' hasn’t been closed.'
        else jsonb_array_length(p->'open') || ' days haven’t been closed.' end end,
    case when (p->>'can_start')::boolean then 'Want help starting the day?' end)
$$;
revoke all on function public.benny_morning_line(jsonb) from public, anon, authenticated;

-- the app: the report, and whether to show it now (it was sent today and hasn't been shown yet, or they asked for it)
create or replace function public.benny_morning(p_force boolean default false)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare u uuid := auth.uid(); v_tz text; v_today date; v_sent boolean; v_shown date; r jsonb;
begin
  if u is null or not benny_has(u) then raise exception 'Not allowed' using errcode = '42501'; end if;
  select coalesce((select tz from notify_settings where user_id = u), 'America/Toronto') into v_tz;
  v_today := (now() at time zone v_tz)::date;
  select morning_on into v_shown from benny_updates_seen where user_id = u;
  v_sent := exists (select 1 from notify_events e where e.ref = 'morning:' || u || ':' || v_today);
  r := benny_morning_of(u);
  return r || jsonb_build_object('due', p_force or (v_sent and v_shown is distinct from v_today), 'today', v_today, 'line', benny_morning_line(r));
end $$;
revoke all on function public.benny_morning(boolean) from public, anon;
grant execute on function public.benny_morning(boolean) to authenticated;

-- the app showed it (and, with p_new, that the person has seen what's new)
create or replace function public.benny_morning_seen(p_new boolean default false)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare u uuid := auth.uid(); v_today date;
begin
  if u is null or not benny_has(u) then raise exception 'Not allowed' using errcode = '42501'; end if;
  v_today := (now() at time zone coalesce((select tz from notify_settings where user_id = u), 'America/Toronto'))::date;
  insert into benny_updates_seen (user_id, seen_at, morning_on) values (u, case when p_new then now() end, v_today)
  on conflict (user_id) do update set morning_on = v_today, seen_at = case when p_new then now() else benny_updates_seen.seen_at end;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.benny_morning_seen(boolean) from public, anon;
grant execute on function public.benny_morning_seen(boolean) to authenticated;

-- the time, from Settings › Notifications
create or replace function public.notify_morning_set(p_at text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  if coalesce(p_at, '') !~ '^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Times are HH:MM'; end if;
  insert into notify_settings (user_id, morning_at) values (u, p_at::time)
  on conflict (user_id) do update set morning_at = excluded.morning_at, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.notify_morning_set(text) from public, anon;
grant execute on function public.notify_morning_set(text) to authenticated;

-- every 5 minutes: whoever's time has come (within 15 minutes of it), once a day
create or replace function public.benny_morning_scan()
returns int language plpgsql volatile security definer set search_path to 'public' as $$
declare r record; v_n int := 0; p jsonb;
begin
  for r in
    select a.id, coalesce(s.tz, 'America/Toronto') tz, coalesce(s.morning_at, '07:30'::time) at_
      from app_users a left join notify_settings s on s.user_id = a.id
     where a.is_active and benny_has(a.id) and notify_wants(a.id, 'all.morning')
       and exists (select 1 from push_subscriptions ps where ps.user_id = a.id)
  loop
    if (now() at time zone r.tz)::time >= r.at_ and (now() at time zone r.tz)::time < r.at_ + interval '15 minutes' then
      p := benny_morning_of(r.id);
      v_n := v_n + notify_emit('all.morning', null, null, r.id, 'Good morning from the Benny',
        coalesce(nullif(benny_morning_line(p), ''), 'Here’s your morning.'), '/app?benny=morning',
        'morning:' || r.id || ':' || (now() at time zone r.tz)::date, null, null);
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.benny_morning_scan() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'benny-morning') then
    perform cron.schedule('benny-morning', '*/5 * * * *', 'select public.benny_morning_scan()');
  end if;
end $$;

-- Settings › Notifications: the report's time, and its switch only for people who have the Benny
do $do$
declare src text; was text;
begin
  src := replace(pg_get_functiondef('public.notify_get()'::regprocedure), E'\r', '');
  was := src;
  src := replace(src, $a$and (c.key <> 'all.benny_live' or$a$, $b$and (c.key not in ('all.benny_live', 'all.morning') or$b$);
  src := replace(src, $a$    'devices', (select count(*) from push_subscriptions where user_id = u),$a$,
                      $b$    'devices', (select count(*) from push_subscriptions where user_id = u),
    'morning', coalesce((select to_char(s.morning_at, 'HH24:MI') from notify_settings s where s.user_id = u), '07:30'),$b$);
  if src = was or src !~ 'all.morning' or src !~ '''morning''' then raise exception 'notify_get: change did not apply'; end if;
  execute src;
end $do$;

alter function public.benny_morning_line(jsonb) set search_path to 'public';
