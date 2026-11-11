-- The Benny: pace. Knocks and jobs by time of day, a day against the earlier days of the same center, so the Benny can
-- answer "is this a good start", "where will we finish", "who has stopped", "when do sales come in" from what was
-- actually entered, for the whole crew, one manager's team or one worker. Read-only.
--
-- Where the times come from, and what they are worth:
--   jobs    transactions.timestamp (today: the live table; closed days: archive.session_rows, read by named fields only,
--           never the whole row, because an archived transaction still carries its card fields)
--   knocks  client_visits.at = when the house was tapped in the app (one row per house per day: its last answer that day)
-- Both are when something was ENTERED, not when it happened: crews often enter a street at once. Entries stamped in
-- bulk (more than 45 by one worker in one minute: a route being moved re-stamps its houses) are left out of the knock
-- counts and reported apart. A house marked invalid is not a knock.
-- Steps and gross are counted from the jobs logged, the same way on every day (they are what the payouts add up to).
-- Additive only.

-- The center's wall clock. West = Pacific, everything else Eastern (the two regions the company works in).
create or replace function public.benny_center_tz(p_center uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select case when (select c.region from command_centers c where c.id = p_center) = 'West' then 'America/Vancouver' else 'America/Toronto' end
$$;
revoke all on function public.benny_center_tz(uuid) from public, anon, authenticated;

-- Every job of the live day and of the closed days since p_from: the day it belongs to, when it was entered (the
-- center's wall clock), what it was, and what it counts for.
create or replace function public.benny_pace_jobs(p_center uuid, p_from date, p_live date, p_tz text)
returns table (day date, lt timestamp, kind text, steps int, gross numeric, cn text)
language sql stable security definer set search_path to 'public' as $$
  with j as (
    select p_live as day, t.timestamp as ts, t.type, coalesce(t.price, 0) as price, t.worker_id as cn,
           case when jsonb_typeof(t.asphalt_meta) = 'object' then t.asphalt_meta end as am
      from transactions t
     where p_live is not null and t.command_center_id = p_center
    union all
    select a.day, case when a.row_data->>'timestamp' ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}' then (a.row_data->>'timestamp')::timestamptz end,
           a.row_data->>'type',
           case when a.row_data->>'price' ~ '^-?[0-9]+(\.[0-9]+)?$' then (a.row_data->>'price')::numeric else 0 end,
           a.row_data->>'worker_id',
           case when jsonb_typeof(a.row_data->'asphalt_meta') = 'object' then a.row_data->'asphalt_meta' end
      from archive.session_rows a
     where a.center_id = p_center and a.source_table = 'transactions' and a.day >= p_from and (p_live is null or a.day <> p_live))
  select j.day, (j.ts at time zone p_tz),
         case j.type when 'Sale' then 'sale' when 'Production' then 'production' when 'Upgrade' then 'upgrade' else 'addon' end,
         (case when j.am is not null then
                case j.am->>'role' when 'driveway-seller' then 1
                                   when 'asphalt-executor' then case when coalesce((j.am->>'did_upsell')::boolean, false) then 1 else 0 end
                                   when 'self-both' then (case when coalesce((j.am->>'driveway_amount')::numeric, 0) > 0 then 1 else 0 end)
                                                       + (case when coalesce((j.am->>'asphalt_amount')::numeric, 0) > 0 then 1 else 0 end)
                                   else 0 end
               when j.type in ('Production', 'Sale', 'Upgrade') then 1 else 0 end)::int,
         case when j.type in ('Production', 'Sale') then j.price when j.type = 'Upgrade' then j.price * 0.2 else 0 end,
         j.cn
    from j
$$;
revoke all on function public.benny_pace_jobs(uuid, date, date, text) from public, anon, authenticated;

-- Every house tapped between two days: when (the center's wall clock), the answer, who, which route, and whether it
-- was stamped in bulk.
create or replace function public.benny_pace_knocks(p_center uuid, p_from date, p_to date, p_tz text)
returns table (day date, lt timestamp, status text, cn text, route text, bulk boolean)
language sql stable security definer set search_path to 'public' as $$
  with k as (
    select (v.at at time zone p_tz) as lt, v.status, v.worker_id as cn, v.route_code as route
      from client_visits v
     where v.center_id = p_center::text and v.day between p_from - 1 and p_to + 1),
  b as (select k.*, count(*) filter (where k.status <> 'invalid') over (partition by k.cn, date_trunc('minute', k.lt)) as in_minute from k)
  select b.lt::date, b.lt, b.status, b.cn, b.route, b.in_minute > 45
    from b where b.lt::date between p_from and p_to
$$;
revoke all on function public.benny_pace_knocks(uuid, date, date, text) from public, anon, authenticated;

-- p_manager: the map that is open ("rm_a" or "floater_x,rm_a,rm_b"); an admin with none gets the whole center, a route
--            manager always their own teams. p_worker: one worker (name or CN). p_date: another day (default the live
--            day, else the last closed one). p_at: "HH:MM" to stand at another time of day (default now).
create or replace function public.benny_pace(p_center uuid, p_manager text default null, p_worker text default null, p_date date default null, p_at text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_role text := benny_ok_any(p_center);
  v_tz text := benny_center_tz(p_center);
  v_now timestamp := now() at time zone benny_center_tz(p_center);
  v_live date := benny_live_date(p_center);
  v_day date; v_is_live boolean; v_clock time; v_end boolean := false; v_asked_at boolean := false;
  v_reach text[] := benny_my_reach(p_center);   -- null for an admin
  v_req text[]; v_mgrs text[]; v_cns text[]; v_scope text := 'center'; v_who jsonb := '[]'::jsonb;
  v_w jsonb; v_from date; v_days date[]; v_all date[];
  v_d jsonb; v_today jsonb; v_prev jsonb; v_n int := 0;
  v_typ jsonb; v_hours jsonb; v_usual jsonb; v_workers jsonb; v_proj jsonb; v_bulk jsonb; v_notes jsonb;
  t_steps numeric; t_gross numeric; t_knocks numeric;
  m_share_steps numeric; m_share_gross numeric; m_rest_steps numeric; m_rest_gross numeric;
begin
  if p_center is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Pick a center first.')); end if;
  v_day := coalesce(p_date, v_live, (select max(d.day) from days d where d.center_id = p_center and d.state = 'closed'));
  if v_day is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('No day has been worked at this center yet.')); end if;
  if v_day > coalesce(v_live, v_now::date) then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('That day hasn’t happened yet.')); end if;
  v_is_live := v_live is not null and v_day = v_live;

  -- the time of day to stand at: the one asked for, else now on a day that is running, else the whole day
  if coalesce(p_at, '') ~ '^\s*([01]?\d|2[0-3]):[0-5]\d\s*$' then v_clock := trim(p_at)::time; v_asked_at := true;
  elsif v_is_live and v_now::date = v_day then v_clock := v_now::time;
  elsif v_is_live and v_now::date < v_day then v_clock := time '00:00';
  else v_clock := time '23:59:59'; v_end := true; end if;

  -- whose workers: an admin sees the whole center, or one manager's team when that map is open; a route manager their own
  v_req := (select array_agg(x) from unnest(string_to_array(coalesce(p_manager, ''), ',')) x where trim(x) ~ '^rm_');
  if v_reach is not null then v_mgrs := coalesce((select array_agg(x) from unnest(v_req) x where x = any (v_reach)), v_reach);
  else v_mgrs := v_req; end if;
  if v_mgrs is not null then
    v_scope := 'team';
    v_cns := coalesce((select array_agg(u.user_id) from users u where u.command_center_id = p_center and u.role = 'Worker'
                          and u.metadata->>'assignedManagerId' = any (v_mgrs)), '{}');
    v_who := coalesce((select jsonb_agg(u.name order by u.name) from users u where u.command_center_id = p_center and u.role = 'RouteManager' and u.user_id = any (v_mgrs)), '[]'::jsonb);
    if cardinality(v_cns) = 0 then
      return jsonb_build_object('ok', false, 'problems', jsonb_build_array(case when v_live is null then 'There is no live day right now, so there is no team to look at.' else 'Nobody is on that team on the live day.' end));
    end if;
  end if;
  if nullif(trim(coalesce(p_worker, '')), '') is not null then
    if v_live is not null then
      v_w := benny_live_worker(p_center, p_worker);
      if not coalesce((v_w->>'found')::boolean, false) then
        return jsonb_build_object('ok', false, 'problems', jsonb_build_array(case when v_w ? 'which' then 'More than one worker fits “' || trim(p_worker) || '”.' else 'Nobody on the live day is called “' || trim(p_worker) || '”.' end)) || (v_w - 'found');
      end if;
      if v_reach is not null and not (coalesce(v_w->>'manager', '') = any (v_reach)) then
        return jsonb_build_object('ok', false, 'problems', jsonb_build_array((v_w->>'name') || ' isn’t on your team.'));
      end if;
      v_cns := array[v_w->>'cn']; v_who := jsonb_build_array(v_w->>'name');
    elsif v_role = 'admin' and upper(trim(p_worker)) ~ '^[A-Z]{1,3}[0-9]{2,6}$' then
      v_cns := array[upper(trim(p_worker))]; v_who := jsonb_build_array(upper(trim(p_worker)));
    else
      return jsonb_build_object('ok', false, 'problems', jsonb_build_array('There is no live day right now. Give me the worker’s CN and the day.'));
    end if;
    v_scope := 'worker';
  end if;

  -- the earlier days to hold it against: the last 14 closed days before it
  v_days := array(select d.day from days d where d.center_id = p_center and d.state = 'closed' and d.day < v_day order by d.day desc limit 14);
  v_from := coalesce((select min(x) from unnest(v_days) x), v_day);
  v_all := v_days || v_day;

  -- one row per day: where it stood at that time of day, and where it ended
  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_d from (
    with jj as (select * from benny_pace_jobs(p_center, v_from, v_live, v_tz) j where j.day = any (v_all) and (v_cns is null or j.cn = any (v_cns))),
         kk as (select * from benny_pace_knocks(p_center, v_from, v_day, v_tz) k where k.day = any (v_all) and (v_cns is null or k.cn = any (v_cns))),
         dj as (select jj.day,
                       coalesce(sum(jj.steps) filter (where v_end or jj.lt <= jj.day + v_clock), 0) steps,
                       coalesce(sum(jj.gross) filter (where v_end or jj.lt <= jj.day + v_clock), 0) gross,
                       count(*) filter (where jj.kind = 'sale' and (v_end or jj.lt <= jj.day + v_clock)) sales,
                       count(*) filter (where jj.kind = 'production' and (v_end or jj.lt <= jj.day + v_clock)) production,
                       max(jj.lt) filter (where v_end or jj.lt <= jj.day + v_clock) last_job,
                       coalesce(sum(jj.steps), 0) end_steps, coalesce(sum(jj.gross), 0) end_gross, count(*) filter (where jj.kind = 'sale') end_sales
                  from jj group by jj.day),
         dk as (select kk.day,
                       count(*) filter (where not kk.bulk and kk.status <> 'invalid' and (v_end or kk.lt <= kk.day + v_clock)) knocks,
                       count(*) filter (where not kk.bulk and kk.status = 'not_home' and (v_end or kk.lt <= kk.day + v_clock)) not_home,
                       count(*) filter (where not kk.bulk and kk.status = 'no' and (v_end or kk.lt <= kk.day + v_clock)) said_no,
                       count(*) filter (where not kk.bulk and kk.status = 'go_back' and (v_end or kk.lt <= kk.day + v_clock)) go_back,
                       count(distinct kk.cn) filter (where not kk.bulk and kk.status <> 'invalid' and (v_end or kk.lt <= kk.day + v_clock)) workers,
                       min(kk.lt) filter (where not kk.bulk and kk.status <> 'invalid' and (v_end or kk.lt <= kk.day + v_clock)) first_knock,
                       max(kk.lt) filter (where not kk.bulk and kk.status <> 'invalid' and (v_end or kk.lt <= kk.day + v_clock)) last_knock,
                       count(*) filter (where not kk.bulk and kk.status <> 'invalid') end_knocks,
                       count(*) filter (where kk.bulk and kk.status <> 'invalid') bulk,
                       count(*) filter (where not kk.bulk and kk.status = 'invalid' and (v_end or kk.lt <= kk.day + v_clock)) invalid
                  from kk group by kk.day)
    select x.day, trim(to_char(x.day, 'Dy')) dow,
           coalesce(dk.knocks, 0) knocks, coalesce(dk.not_home, 0) not_home, coalesce(dk.said_no, 0) said_no, coalesce(dk.go_back, 0) go_back,
           coalesce(dj.sales, 0) sales, coalesce(dj.production, 0) production, coalesce(dj.steps, 0) steps, round(coalesce(dj.gross, 0), 2) gross,
           coalesce(dk.workers, 0) workers_knocking,
           to_char(dk.first_knock, 'HH24:MI') first_knock, to_char(dk.last_knock, 'HH24:MI') last_knock, to_char(dj.last_job, 'HH24:MI') last_job,
           extract(epoch from dk.first_knock::time)::int first_knock_s,
           coalesce(dk.end_knocks, 0) end_knocks, coalesce(dj.end_steps, 0) end_steps, round(coalesce(dj.end_gross, 0), 2) end_gross, coalesce(dj.end_sales, 0) end_sales,
           coalesce(dk.bulk, 0) bulk, coalesce(dk.invalid, 0) invalid
      from unnest(v_all) x(day) left join dj on dj.day = x.day left join dk on dk.day = x.day) q;

  select d into v_today from jsonb_array_elements(v_d) d where (d->>'day')::date = v_day;
  t_steps := (v_today->>'steps')::numeric; t_gross := (v_today->>'gross')::numeric; t_knocks := (v_today->>'knocks')::numeric;
  -- the earlier days that had anything on them (for this crew, team or worker)
  select coalesce(jsonb_agg(d order by d->>'day' desc), '[]'::jsonb), count(*) into v_prev, v_n
    from jsonb_array_elements(v_d) d where (d->>'day')::date <> v_day and ((d->>'end_steps')::numeric > 0 or (d->>'end_knocks')::numeric > 0);

  if v_n > 0 then
    select jsonb_build_object(
             'at_this_time', jsonb_build_object('knocks', round(percentile_cont(0.5) within group (order by (d->>'knocks')::numeric)::numeric, 1),
               'sales', round(percentile_cont(0.5) within group (order by (d->>'sales')::numeric)::numeric, 1),
               'steps', round(percentile_cont(0.5) within group (order by (d->>'steps')::numeric)::numeric, 1),
               'gross', round(percentile_cont(0.5) within group (order by (d->>'gross')::numeric)::numeric),
               'first_knock', to_char(time '00:00' + make_interval(secs => percentile_cont(0.5) within group (order by (d->>'first_knock_s')::numeric)), 'HH24:MI')),
             'end_of_day', jsonb_build_object('knocks', round(percentile_cont(0.5) within group (order by (d->>'end_knocks')::numeric)::numeric, 1),
               'steps', round(percentile_cont(0.5) within group (order by (d->>'end_steps')::numeric)::numeric, 1),
               'gross', round(percentile_cont(0.5) within group (order by (d->>'end_gross')::numeric)::numeric)),
             'rest_of_day', jsonb_build_object(
               'steps', round(percentile_cont(0.5) within group (order by (d->>'end_steps')::numeric - (d->>'steps')::numeric)::numeric, 1),
               'gross', round(percentile_cont(0.5) within group (order by (d->>'end_gross')::numeric - (d->>'gross')::numeric)::numeric)),
             'share_in_by_this_time', jsonb_build_object(
               'steps', round(percentile_cont(0.5) within group (order by (d->>'steps')::numeric / nullif((d->>'end_steps')::numeric, 0))::numeric, 2),
               'gross', round(percentile_cont(0.5) within group (order by (d->>'gross')::numeric / nullif((d->>'end_gross')::numeric, 0))::numeric, 2),
               'knocks', round(percentile_cont(0.5) within group (order by (d->>'knocks')::numeric / nullif((d->>'end_knocks')::numeric, 0))::numeric, 2)),
             'days_with_less_than_this_day', jsonb_build_object(
               'knocks', count(*) filter (where (d->>'knocks')::numeric < t_knocks),
               'steps', count(*) filter (where (d->>'steps')::numeric < t_steps),
               'gross', count(*) filter (where (d->>'gross')::numeric < t_gross)))
      into v_typ from jsonb_array_elements(v_prev) d;
    m_share_steps := (v_typ->'share_in_by_this_time'->>'steps')::numeric; m_share_gross := (v_typ->'share_in_by_this_time'->>'gross')::numeric;
    m_rest_steps := (v_typ->'rest_of_day'->>'steps')::numeric; m_rest_gross := (v_typ->'rest_of_day'->>'gross')::numeric;
  end if;

  -- where the day could end: two honest ways to carry it forward, never one number
  if not v_is_live or v_end or v_asked_at then v_proj := null;
  elsif v_n < 3 then v_proj := jsonb_build_object('none', 'Fewer than 3 earlier days to go by.');
  elsif coalesce(m_share_steps, 0) < 0.15 then v_proj := jsonb_build_object('none', 'Too early in the day: on earlier days almost nothing was logged by this time.');
  else v_proj := jsonb_build_object(
         'if_the_rest_goes_like_a_usual_day', jsonb_build_object('steps', t_steps + m_rest_steps, 'gross', round(t_gross + m_rest_gross)),
         'if_the_day_keeps_this_pace', jsonb_build_object('steps', round(t_steps / m_share_steps, 1), 'gross', case when coalesce(m_share_gross, 0) >= 0.15 then round(t_gross / m_share_gross) end),
         'how', 'The first adds what earlier days usually logged after this time. The second assumes the same share of the day is in as usual by now (' || round(m_share_steps * 100) || '% of steps).');
  end if;

  -- the day by the hour, and what an hour usually holds
  select coalesce(jsonb_agg(jsonb_build_object('hour', to_char(z.h, 'FM00') || ':00', 'knocks', z.kn, 'sales', z.sa, 'production', z.pr, 'gross', round(z.gr)) order by z.h), '[]'::jsonb)
    into v_hours
    from (select e.h, sum(e.kn) kn, sum(e.sa) sa, sum(e.pr) pr, sum(e.gr) gr from (
            select extract(hour from k.lt)::int h, 1 kn, 0 sa, 0 pr, 0::numeric gr from benny_pace_knocks(p_center, v_day, v_day, v_tz) k
             where k.day = v_day and (v_cns is null or k.cn = any (v_cns)) and not k.bulk and k.status <> 'invalid' and (v_end or k.lt <= k.day + v_clock)
            union all
            select extract(hour from j.lt)::int, 0, (j.kind = 'sale')::int, (j.kind = 'production')::int, j.gross from benny_pace_jobs(p_center, v_day, v_live, v_tz) j
             where j.day = v_day and (v_cns is null or j.cn = any (v_cns)) and j.lt is not null and j.lt::date = j.day and (v_end or j.lt <= j.day + v_clock)) e
           group by e.h) z;
  if v_n > 0 then
    select coalesce(jsonb_agg(jsonb_build_object('hour', to_char(z.h, 'FM00') || ':00', 'knocks', round(z.kn::numeric / v_n, 1), 'sales', round(z.sa::numeric / v_n, 1), 'production', round(z.pr::numeric / v_n, 1)) order by z.h), '[]'::jsonb)
      into v_usual
      from (select e.h, sum(e.kn) kn, sum(e.sa) sa, sum(e.pr) pr from (
              select extract(hour from k.lt)::int h, 1 kn, 0 sa, 0 pr from benny_pace_knocks(p_center, v_from, v_day, v_tz) k
               where k.day = any (v_days) and (v_cns is null or k.cn = any (v_cns)) and not k.bulk and k.status <> 'invalid'
              union all
              select extract(hour from j.lt)::int, 0, (j.kind = 'sale')::int, (j.kind = 'production')::int from benny_pace_jobs(p_center, v_from, v_live, v_tz) j
               where j.day = any (v_days) and (v_cns is null or j.cn = any (v_cns)) and j.lt is not null and j.lt::date = j.day) e
             where e.h between 5 and 22 group by e.h) z;
  end if;

  -- each worker on the day: what they have in by that time, when they started and last entered anything, and their own usual
  with nm as (
         select u.user_id cn, u.name, u.role, u.metadata->>'assignedManagerId' mgr from users u where v_is_live and u.command_center_id = p_center and u.role in ('Worker', 'RouteManager')
         union all
         select a.row_data->>'user_id', a.row_data->>'name', a.row_data->>'role', a.row_data->'metadata'->>'assignedManagerId'
           from archive.session_rows a where not v_is_live and a.center_id = p_center and a.day = v_day and a.source_table = 'users' and a.row_data->>'role' in ('Worker', 'RouteManager')),
       ev as (
         select k.day, k.cn, k.lt, 'knock'::text kind, k.status, k.route, 0 steps, 0::numeric gross, (v_end or k.lt <= k.day + v_clock) inby
           from benny_pace_knocks(p_center, v_from, v_day, v_tz) k where k.day = any (v_all) and (v_cns is null or k.cn = any (v_cns)) and not k.bulk and k.status <> 'invalid'
         union all
         select j.day, j.cn, j.lt, j.kind, null, null, j.steps, j.gross, (v_end or j.lt <= j.day + v_clock)
           from benny_pace_jobs(p_center, v_from, v_live, v_tz) j where j.day = any (v_all) and (v_cns is null or j.cn = any (v_cns))),
       base as (
         select n.cn from nm n where v_is_live and n.role = 'Worker' and (v_cns is null or n.cn = any (v_cns))
         union select e.cn from ev e where e.day = v_day and e.cn is not null),
       t as (
         select e.cn, count(*) filter (where e.kind = 'knock') knocks, count(*) filter (where e.status = 'not_home') not_home, count(*) filter (where e.status = 'no') said_no,
                count(*) filter (where e.status = 'go_back') go_back, count(*) filter (where e.kind = 'sale') sales, count(*) filter (where e.kind = 'production') production,
                coalesce(sum(e.steps), 0) steps, coalesce(sum(e.gross), 0) gross,
                min(e.lt) filter (where e.kind = 'knock') first_knock, max(e.lt) filter (where e.kind = 'knock') last_knock, max(e.lt) filter (where e.kind <> 'knock') last_job, max(e.lt) last_any,
                array_agg(distinct e.route) filter (where e.route is not null) routes
           from ev e where e.day = v_day and e.inby group by e.cn),
       g as (
         select x.cn, max(x.gap) longest from (
           select e.cn, extract(epoch from e.lt - lag(e.lt) over (partition by e.cn order by e.lt)) / 60 gap from ev e where e.day = v_day and e.inby and e.lt is not null) x group by x.cn),
       u as (
         select y.cn, count(*) days, percentile_cont(0.5) within group (order by y.knocks) knocks, percentile_cont(0.5) within group (order by y.steps) steps,
                percentile_cont(0.5) within group (order by y.fk) fk
           from (select e.cn, e.day, count(*) filter (where e.kind = 'knock' and e.inby) knocks, coalesce(sum(e.steps) filter (where e.inby), 0) steps,
                        extract(epoch from (min(e.lt) filter (where e.kind = 'knock'))::time) fk
                   from ev e where e.day <> v_day group by e.cn, e.day) y group by y.cn)
  select coalesce(jsonb_agg(w.o order by w.steps desc, w.knocks desc, w.name), '[]'::jsonb) into v_workers from (
    select coalesce(t.steps, 0) steps, coalesce(t.knocks, 0) knocks, coalesce(n.name, b.cn) name,
           jsonb_strip_nulls(jsonb_build_object('cn', b.cn, 'name', coalesce(n.name, b.cn),
             'manager', case when v_scope = 'center' then (select m.name from nm m where m.role = 'RouteManager' and m.cn = n.mgr limit 1) end,
             'knocks', coalesce(t.knocks, 0), 'not_home', coalesce(t.not_home, 0), 'said_no', coalesce(t.said_no, 0), 'go_back', coalesce(t.go_back, 0),
             'sales', coalesce(t.sales, 0), 'production', coalesce(t.production, 0), 'steps', coalesce(t.steps, 0), 'gross', round(coalesce(t.gross, 0), 2),
             'first_knock', to_char(t.first_knock, 'HH24:MI'), 'last_knock', to_char(t.last_knock, 'HH24:MI'), 'last_job', to_char(t.last_job, 'HH24:MI'),
             'minutes_since_last_entry', case when v_is_live and not v_end and not v_asked_at and t.last_any is not null then greatest(0, round(extract(epoch from v_now - t.last_any) / 60)) end,
             'longest_gap_minutes', round(g.longest::numeric), 'routes_knocked', to_jsonb(t.routes),
             'their_usual_by_this_time', case when u.days is not null then jsonb_build_object('days', u.days, 'knocks', round(u.knocks::numeric, 1), 'steps', round(u.steps::numeric, 1),
                                                'first_knock', to_char(time '00:00' + make_interval(secs => u.fk), 'HH24:MI')) end)) o
      from base b left join (select distinct on (cn) cn, name, mgr from nm where role = 'Worker' order by cn) n on n.cn = b.cn
      left join t on t.cn = b.cn left join g on g.cn = b.cn left join u on u.cn = b.cn
     order by coalesce(t.steps, 0) desc, coalesce(t.knocks, 0) desc limit 30) w;

  -- what was left out of the knock counts
  select jsonb_object_agg(d->>'day', (d->>'bulk')::int) into v_bulk from jsonb_array_elements(v_d) d where (d->>'bulk')::int > 0;
  v_notes := jsonb_build_array(
    'Times are when a knock or a job was entered in the app, not when it happened. Crews often enter a whole street at once, so read it by the hour, not the minute, and a cart with nothing entered may still be working.',
    'A knock is a door with no sale (no, not home, go back). A sale is a door too. Steps and gross are counted from the jobs logged, the same way on every day; the calendar’s day totals can read lower.');
  if v_bulk is not null then
    v_notes := v_notes || jsonb_build_array('Knocks stamped in bulk at one moment are left out (see left_out.bulk_knocks): those days’ knock counts are short.');
  end if;

  return jsonb_strip_nulls(jsonb_build_object('ok', true,
    'center', (select c.display_name from command_centers c where c.id = p_center), 'day', v_day, 'weekday', trim(to_char(v_day, 'Day')), 'live', v_is_live,
    'as_of', case when v_end then 'end of day' else to_char(v_clock, 'HH24:MI') end,
    'clock', case when v_asked_at then 'the time asked for' when v_end then 'the whole day' else 'now' end,
    'time_zone', case v_tz when 'America/Vancouver' then 'Pacific' else 'Eastern' end,
    'scope', v_scope, 'who', case when v_scope <> 'center' then v_who end, 'heard_as', v_w->'heard_as',
    'this_day', (v_today - 'first_knock_s' - 'bulk' - 'invalid' - 'day' - 'dow' - 'end_knocks' - 'end_steps' - 'end_gross' - 'end_sales')
      || jsonb_build_object('doors_per_sale', case when (v_today->>'sales')::numeric > 0 then round(((v_today->>'knocks')::numeric + (v_today->>'sales')::numeric) / (v_today->>'sales')::numeric, 1) end)
      || case when v_end then jsonb_build_object() else jsonb_build_object('note', 'so far, up to as_of') end,
    'by_hour', v_hours,
    'earlier_days', case when v_n > 0 then jsonb_build_object('count', v_n,
       'each_at_this_time', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('day', d->>'day', 'weekday', d->>'dow', 'knocks', d->'knocks', 'sales', d->'sales', 'production', d->'production',
                                'steps', d->'steps', 'gross', d->'gross', 'workers_knocking', d->'workers_knocking', 'first_knock', d->'first_knock',
                                'ended_at', jsonb_build_object('knocks', d->'end_knocks', 'steps', d->'end_steps', 'gross', d->'end_gross'))) order by d->>'day' desc)
                               from jsonb_array_elements(v_prev) d),
       'usual', v_typ, 'usual_by_hour', v_usual) end,
    'projection', v_proj,
    'workers', v_workers,
    'left_out', jsonb_strip_nulls(jsonb_build_object('bulk_knocks', v_bulk, 'houses_marked_invalid', nullif((v_today->>'invalid')::int, 0))),
    'notes', v_notes));
end $$;
revoke all on function public.benny_pace(uuid, text, text, date, text) from public, anon;
grant execute on function public.benny_pace(uuid, text, text, date, text) to authenticated;
