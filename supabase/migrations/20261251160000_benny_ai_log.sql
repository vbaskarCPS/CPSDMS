-- The Benny's AI log: every question asked, who asked it, what it answered, the tools it used (and on which model),
-- and roughly what it cost. Shown in Super Admin › Bug log › AI logs, by day and by person (same people as the Bug log).
-- benny-assist saves one row per question as the person who asked (benny_ai_log_save), after it has answered.
-- Additive: a table, two functions.

create table if not exists public.benny_ai_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  user_name text,
  role text,
  center_id uuid,
  path text,
  spoken boolean not null default false,
  question text,
  reply text,
  tools jsonb not null default '[]'::jsonb,   -- [{ name, model: 'fast' | 'main', ok, ms }] in the order they ran
  card text,                                  -- the change card it showed, if any
  answered_by text,                           -- 'fast' (the small model) or 'main'
  why text,                                   -- why the main model took it, in fast-first mode
  fast_model text,
  main_model text,
  tokens jsonb,                               -- { fast: { steps, input, cache_write, cache_read, output }, main: { … } }
  cost_usd numeric(10, 5),                    -- roughly, from the tokens and the models' prices (benny-assist/cost.ts)
  ms integer,                                 -- how long the answer took
  error text
);
alter table public.benny_ai_log enable row level security;
revoke all on public.benny_ai_log from anon, authenticated;
create index if not exists benny_ai_log_at on public.benny_ai_log (at desc);
create index if not exists benny_ai_log_user_at on public.benny_ai_log (user_id, at desc);

/** One question, saved by benny-assist as the person who asked it (only someone the Benny is for). */
create or replace function public.benny_ai_log_save(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_center uuid;
begin
  if auth.uid() is null then raise exception 'signed_out'; end if;
  v_center := case when coalesce(p->>'center_id', '') ~ '^[0-9a-f-]{36}$' then (p->>'center_id')::uuid end;
  if coalesce(benny_ok_any(v_center), '') not in ('admin', 'rm') then raise exception 'not allowed'; end if;
  insert into benny_ai_log (user_id, user_name, role, center_id, path, spoken, question, reply, tools, card, answered_by, why,
                            fast_model, main_model, tokens, cost_usd, ms, error)
  values (auth.uid(), (select u.full_name from app_users u where u.id = auth.uid()), left(p->>'role', 20), v_center,
          left(p->>'path', 200), coalesce((p->>'spoken')::boolean, false), left(p->>'question', 4000), left(p->>'reply', 4000),
          case when jsonb_typeof(p->'tools') = 'array' then p->'tools' else '[]'::jsonb end,
          left(p->>'card', 40), left(p->>'answered_by', 10), left(p->>'why', 80), left(p->>'fast_model', 80), left(p->>'main_model', 80),
          case when jsonb_typeof(p->'tokens') = 'object' then p->'tokens' end,
          case when coalesce(p->>'cost_usd', '') ~ '^[0-9.eE+-]+$' then round((p->>'cost_usd')::numeric, 5) end,
          case when coalesce(p->>'ms', '') ~ '^\d{1,9}$' then (p->>'ms')::int end,
          left(p->>'error', 1000))
  returning id into v_id;
  return v_id;
end $$;

/** A day's questions (Toronto time), newest first, with each person's count and rough cost, and the last 30 days'. */
create or replace function public.benny_ai_log_list(p_day date default null, p_user uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_day date := coalesce(p_day, (now() at time zone 'America/Toronto')::date);
  v_from timestamptz := (v_day::timestamp at time zone 'America/Toronto');
  v_to timestamptz := ((v_day + 1)::timestamp at time zone 'America/Toronto');
begin
  perform benny_bugs_ok();
  return jsonb_build_object(
    'day', v_day,
    'totals', (select jsonb_build_object('questions', count(*), 'tools', coalesce(sum(jsonb_array_length(l.tools)), 0),
                 'cost', coalesce(sum(l.cost_usd), 0), 'errors', count(*) filter (where l.error is not null))
                 from benny_ai_log l where l.at >= v_from and l.at < v_to),
    'last30', (select jsonb_build_object('questions', count(*), 'cost', coalesce(sum(l.cost_usd), 0), 'since', min(l.at))
                 from benny_ai_log l where l.at >= v_to - interval '30 days' and l.at < v_to),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'name', x.name, 'questions', x.q, 'tools', x.t, 'cost', x.c)
                 order by x.q desc, x.name), '[]'::jsonb)
                 from (select l.user_id, coalesce(max(l.user_name), 'Someone') name, count(*) q,
                              coalesce(sum(jsonb_array_length(l.tools)), 0) t, coalesce(sum(l.cost_usd), 0) c
                         from benny_ai_log l where l.at >= v_from and l.at < v_to group by l.user_id) x),
    'rows', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', l.id, 'at', l.at, 'user_id', l.user_id, 'name', l.user_name, 'role', l.role,
               'center', (select c.display_name from command_centers c where c.id = l.center_id), 'path', l.path, 'spoken', l.spoken,
               'question', l.question, 'reply', l.reply, 'tools', l.tools, 'card', l.card, 'answered_by', l.answered_by, 'why', l.why,
               'cost', l.cost_usd, 'ms', l.ms, 'error', l.error)) order by l.at desc), '[]'::jsonb)
             from (select * from benny_ai_log where at >= v_from and at < v_to and (p_user is null or user_id = p_user)
                    order by at desc limit 500) l));
end $$;

do $g$
declare f text;
begin
  foreach f in array array['benny_ai_log_save(jsonb)', 'benny_ai_log_list(date,uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $g$;
