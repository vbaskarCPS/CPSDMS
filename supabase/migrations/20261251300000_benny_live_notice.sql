-- The Benny tells the person who logged something (a bug, or a request it couldn't do) when it is live.
--   In the app: the next time they open it, the Benny opens with "It's live", what they asked, and what to say to use it
--   (benny_news / benny_news_seen: their own entries only).
--   On their phone or computer: a push notification, when they turned notifications on for that device (push_subscriptions,
--   the same switch as new-mail notifications). The push function asks the database what is due (benny_live_due) and
--   takes nothing from its caller, so there is no key to keep: calling it can only send what was already ordered, once.
-- An entry goes live with benny_log_live(id, note): it is marked done and the note is what the person is told.
-- Additive only.

create extension if not exists pg_net with schema extensions;

alter table public.benny_bugs add column if not exists live_note text;
alter table public.benny_bugs add column if not exists live_at timestamptz;
alter table public.benny_bugs add column if not exists live_by uuid;
alter table public.benny_bugs add column if not exists live_seen_at timestamptz;
alter table public.benny_bugs add column if not exists live_pushed_at timestamptz;
alter table public.benny_bugs add column if not exists live_push_sent int;
create index if not exists benny_bugs_news on public.benny_bugs (created_by) where live_at is not null and live_seen_at is null;

-- Mark an entry done and tell the person who logged it. p_note = what they are told: what they can do now and what to say.
-- From the Bug log (super admins and people who manage users), or by the database owner when a build ships it.
create or replace function public.benny_log_live(p_id uuid, p_note text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare b benny_bugs; v_note text := trim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')); v_subs int;
begin
  if auth.uid() is not null then perform benny_bugs_ok();
  elsif session_user <> 'postgres' then raise exception 'Not allowed' using errcode = '42501'; end if;
  if length(v_note) < 5 then raise exception 'Say what they can do now, in a line or two'; end if;
  if length(v_note) > 600 then raise exception 'Keep it under 600 characters'; end if;
  select * into b from benny_bugs where id = p_id for update;
  if b.id is null then raise exception 'No such log entry'; end if;
  if b.created_by is null then raise exception 'There is nobody to tell: this entry has no person on it'; end if;
  update benny_bugs set status = 'done', resolved_at = coalesce(resolved_at, now()), resolved_by = coalesce(resolved_by, auth.uid()),
         live_note = v_note, live_at = now(), live_by = auth.uid(), live_seen_at = null, live_pushed_at = null, live_push_sent = null
   where id = p_id;
  select count(*) into v_subs from push_subscriptions where user_id = b.created_by;
  -- the notification goes out from the push function once this is saved; it asks the database what is due
  if v_subs > 0 then
    perform net.http_post(url := 'https://mipvcafqrmwxnoqmicxh.supabase.co/functions/v1/push',
      headers := jsonb_build_object('content-type', 'application/json'), body := jsonb_build_object('action', 'benny_live'));
  end if;
  return jsonb_build_object('ok', true, 'to', (select u.full_name from app_users u where u.id = b.created_by), 'devices', v_subs);
end $$;
revoke all on function public.benny_log_live(uuid, text) from public, anon;
grant execute on function public.benny_log_live(uuid, text) to authenticated;

-- The push function (service role): the notices that are due, each handed over once. Not one already seen in the app,
-- and not an old one.
create or replace function public.benny_live_due()
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare v jsonb;
begin
  with due as (
    update benny_bugs b set live_pushed_at = now()
     where b.live_at is not null and b.live_pushed_at is null and b.live_seen_at is null and b.created_by is not null
       and b.live_at > now() - interval '2 days'
    returning b.id, b.created_by, b.kind, b.live_note, b.path)
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id,
           'title', case when d.kind = 'bug' then 'The Benny: it’s fixed' else 'The Benny: it’s live' end,
           'body', left(d.live_note, 180),
           'url', case when d.path ~ '^/app(/[A-Za-z0-9_./-]*)?$' and d.path !~ '\.\.' then d.path else '/app' end,
           'tag', 'benny-live-' || d.id,
           'subs', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                               from push_subscriptions s where s.user_id = d.created_by), '[]'::jsonb))), '[]'::jsonb)
    into v from due d;
  return v;
end $$;
revoke all on function public.benny_live_due() from public, anon, authenticated;
grant execute on function public.benny_live_due() to service_role;

create or replace function public.benny_live_sent(p_id uuid, p_sent int)
returns void language sql volatile security definer set search_path to 'public' as $$
  update benny_bugs set live_push_sent = greatest(0, coalesce(p_sent, 0)) where id = p_id and live_pushed_at is not null
$$;
revoke all on function public.benny_live_sent(uuid, int) from public, anon, authenticated;
grant execute on function public.benny_live_sent(uuid, int) to service_role;

-- What is new for the person asking: their own entries that went live and that they haven't been shown yet.
create or replace function public.benny_news()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'kind', b.kind, 'title', b.title,
           'asked', left(coalesce(nullif(b.report->>'asked', ''), b.report->>'what_happened', ''), 300),
           'note', b.live_note, 'live_at', b.live_at) order by b.live_at), '[]'::jsonb)
    from benny_bugs b
   where auth.uid() is not null and b.created_by = auth.uid() and b.live_at is not null and b.live_seen_at is null
     and b.live_at > now() - interval '60 days'
$$;
create or replace function public.benny_news_seen(p_ids uuid[])
returns void language sql volatile security definer set search_path to 'public' as $$
  update benny_bugs set live_seen_at = now()
   where id = any (p_ids) and created_by = auth.uid() and live_at is not null and live_seen_at is null
$$;
do $g$ declare f text; begin
  foreach f in array array['benny_news()', 'benny_news_seen(uuid[])'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $g$;

-- The log also says what each person was told, whether they have seen it, and whether they can be notified.
create or replace function public.benny_bugs_list(p_status text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform benny_bugs_ok();
  return jsonb_build_object(
    'open', (select count(*) from benny_bugs where status = 'open'),
    'done', (select count(*) from benny_bugs where status = 'done'),
    'open_bugs', (select count(*) from benny_bugs where status = 'open' and kind = 'bug'),
    'open_requests', (select count(*) from benny_bugs where status = 'open' and kind = 'request'),
    'bugs', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', b.id, 'created_at', b.created_at, 'kind', b.kind, 'title', b.title, 'status', b.status, 'resolved_at', b.resolved_at,
               'resolved_by', (select u.full_name from app_users u where u.id = b.resolved_by),
               'by', coalesce((select u.full_name from app_users u where u.id = b.created_by), b.report->>'user'),
               'center', (select c.display_name from command_centers c where c.id = b.center_id),
               'path', b.path, 'report', b.report, 'findings', b.findings, 'investigated_at', b.investigated_at,
               'can_tell', b.created_by is not null,
               'devices', (select count(*) from push_subscriptions s where s.user_id = b.created_by),
               'live', case when b.live_at is not null then jsonb_strip_nulls(jsonb_build_object('note', b.live_note, 'at', b.live_at,
                         'seen_at', b.live_seen_at, 'pushed_at', b.live_pushed_at, 'sent', b.live_push_sent)) end)) order by b.created_at desc), '[]')
               from (select * from benny_bugs x where p_status is null or x.status = p_status order by x.created_at desc limit 400) b));
end $$;
