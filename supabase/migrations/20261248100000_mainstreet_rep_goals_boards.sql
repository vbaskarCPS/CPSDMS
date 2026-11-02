-- MainstreetAI rep app: "Visits & Onboardings" (was "Me"). ADDITIVE ONLY.
--
--   * Each rep can set their own daily goal for businesses to visit. The admin's number (ms_rep_goals) stays the
--     default for any rep who hasn't set one; clearing it goes back to the default.
--   * Two leaderboards, Onboardings booked and Visits, for today, this week (from Monday) or this month.
--   * Earnings are no longer worked out for reps (the campaigns' pay_per_deal values are kept for later).

create table if not exists public.ms_rep_own_goals (
  rep_id uuid primary key references public.app_users(id),
  visits_per_day int not null check (visits_per_day between 1 and 500),
  updated_at timestamptz not null default now()
);
alter table public.ms_rep_own_goals enable row level security;
revoke all on table public.ms_rep_own_goals from anon, authenticated;
-- no policies: read and written only through the functions below

-- the rep's daily visits goal: their own, else the team's
create or replace function public.ms_rep_visit_goal(p_rep uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce((select visits_per_day from ms_rep_own_goals where rep_id = p_rep),
                  (select visits_per_day from ms_rep_goals where id = 1), 40)
$$;
revoke all on function public.ms_rep_visit_goal(uuid) from public, anon, authenticated;

-- set (or, with null, clear) my own daily visits goal
create or replace function public.ms_rep_set_visit_goal(p_visits int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  if p_visits is null then
    delete from ms_rep_own_goals where rep_id = auth.uid();
  else
    if p_visits < 1 or p_visits > 500 then raise exception 'Pick a goal between 1 and 500'; end if;
    insert into ms_rep_own_goals (rep_id, visits_per_day) values (auth.uid(), p_visits)
    on conflict (rep_id) do update set visits_per_day = excluded.visits_per_day, updated_at = now();
  end if;
  return jsonb_build_object('goal_visits', ms_rep_visit_goal(auth.uid()),
                            'own', exists (select 1 from ms_rep_own_goals where rep_id = auth.uid()),
                            'team_goal_visits', (select visits_per_day from ms_rep_goals where id = 1));
end $$;
revoke all on function public.ms_rep_set_visit_goal(int) from public, anon;
grant execute on function public.ms_rep_set_visit_goal(int) to authenticated;

-- today: the visits goal is the rep's own (if set)
create or replace function public.ms_rep_today()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d ms_rep_days; v_today date := (now() at time zone 'America/Toronto')::date; g ms_rep_goals;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  select * into d from ms_rep_days where rep_id = auth.uid() and day = v_today;
  select * into g from ms_rep_goals where id = 1;
  return jsonb_build_object(
    'day', v_today, 'started_at', d.started_at, 'ended_at', d.ended_at, 'distance_m', coalesce(d.distance_m, 0),
    'minutes', case when d.id is null then 0 else round(extract(epoch from coalesce(d.ended_at, now()) - d.started_at) / 60) end,
    'visits', (select count(*) from ms_visits v where v.rep_id = auth.uid() and (v.at at time zone 'America/Toronto')::date = v_today),
    'deals', (select count(*) from ms_visits v where v.rep_id = auth.uid() and v.outcome = 'closed' and (v.at at time zone 'America/Toronto')::date = v_today),
    'followups', (select count(*) from ms_visits v where v.rep_id = auth.uid() and v.outcome = 'follow_up' and (v.at at time zone 'America/Toronto')::date = v_today),
    'goal_visits', ms_rep_visit_goal(auth.uid()), 'goal_deals', g.deals_per_day,
    'goal_own', exists (select 1 from ms_rep_own_goals where rep_id = auth.uid()),
    'team_goal_visits', g.visits_per_day);
end $$;

-- the leaderboards: p_period 'today' | 'week' | 'month' (Toronto time)
create or replace function public.ms_rep_leaderboard(p_period text default 'week')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_now timestamp := now() at time zone 'America/Toronto';
  v_from date;
  v_since timestamptz;
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_goal int; v_streak int := 0; r record; v_first boolean := true;
  v_rows jsonb;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  v_from := case p_period when 'today' then v_now::date when 'month' then date_trunc('month', v_now)::date
                          else date_trunc('week', v_now)::date end;
  v_since := v_from::timestamp at time zone 'America/Toronto';

  -- streak: days in a row the rep met their own visits goal (today counts once it's met)
  v_goal := ms_rep_visit_goal(auth.uid());
  for r in
    select (v.at at time zone 'America/Toronto')::date d, count(*) n
      from ms_visits v where v.rep_id = auth.uid() and v.at > now() - interval '120 days'
     group by 1 order by 1 desc
  loop
    if v_first and r.d = v_today and r.n < v_goal then v_first := false; continue; end if;
    v_first := false;
    exit when r.n < v_goal;
    v_streak := v_streak + 1;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('me', x.id = auth.uid(), 'name', x.short, 'visits', x.visits,
                                               'approved', x.approved, 'pending', x.pending)), '[]'::jsonb)
    into v_rows
    from (select u.id,
                 split_part(u.full_name, ' ', 1) || coalesce(' ' || left(nullif(split_part(u.full_name, ' ', 2), ''), 1) || '.', '') short,
                 (select count(*) from ms_visits v where v.rep_id = u.id and v.at >= v_since)::int visits,
                 (select count(*) from ms_deals d where d.rep_id = u.id and d.status = 'approved' and d.created_at >= v_since)::int approved,
                 (select count(*) from ms_deals d where d.rep_id = u.id and d.status = 'pending' and d.created_at >= v_since)::int pending
            from app_users u join user_permissions up on up.user_id = u.id and up.permission = 'mainstreet_rep'
           where u.is_active) x
   where x.visits > 0 or x.approved + x.pending > 0 or x.id = auth.uid();

  return jsonb_build_object('period', coalesce(nullif(p_period, ''), 'week'), 'from', v_from, 'streak', v_streak,
                            'goal_visits', v_goal, 'reps', v_rows);
end $$;
revoke all on function public.ms_rep_leaderboard(text) from public, anon;
grant execute on function public.ms_rep_leaderboard(text) to authenticated;

-- the old board (kept for app versions still open on phones), without earnings
create or replace function public.ms_rep_board()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; g ms_rep_goals;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  select * into g from ms_rep_goals where id = 1;
  v := ms_rep_leaderboard('week');
  return jsonb_build_object('week_of', v->'from', 'goal_visits', v->'goal_visits', 'goal_deals', g.deals_per_day, 'streak', v->'streak',
    'board', coalesce((select jsonb_agg(e order by (e->>'approved')::int desc, (e->>'visits')::int desc) from jsonb_array_elements(v->'reps') e), '[]'::jsonb),
    'earnings', jsonb_build_object('week', 0, 'total', 0, 'unpriced', 0));
end $$;
