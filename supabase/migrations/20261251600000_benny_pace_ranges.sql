-- The Benny: pace, after its first day on the live site. Read-only, additive (the same function, with more in its answer).
--   - Each of the two ways a day could end now says how it was reached. Before, one line said "the first ..., the
--     second ...", but jsonb does not keep the order of keys, so the Benny could put the explanation on the wrong one.
--   - The lowest and the highest earlier day for each measure, at this time of day and by the end
--     (earlier_days.lowest_and_highest): the Benny had worked a range out from the list of days, and got it wrong.
--   - Prebooks done (production) in the usual figures, at this time and by the end; sales by the end.
--   - Notes: the times are the center's own clock; a worker's gross is all their jobs, not their sales' dollars; the
--     usual figures are each the middle of their own measure.

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
  v_typ jsonb; v_hours jsonb; v_usual jsonb; v_workers jsonb; v_proj jsonb; v_bulk jsonb; v_notes jsonb; v_range jsonb;
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
                       coalesce(sum(jj.steps), 0) end_steps, coalesce(sum(jj.gross), 0) end_gross, count(*) filter (where jj.kind = 'sale') end_sales,
                       count(*) filter (where jj.kind = 'production') end_production
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
           coalesce(dk.end_knocks, 0) end_knocks, coalesce(dj.end_steps, 0) end_steps, round(coalesce(dj.end_gross, 0), 2) end_gross, coalesce(dj.end_sales, 0) end_sales, coalesce(dj.end_production, 0) end_production,
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
               'production', round(percentile_cont(0.5) within group (order by (d->>'production')::numeric)::numeric, 1),
               'steps', round(percentile_cont(0.5) within group (order by (d->>'steps')::numeric)::numeric, 1),
               'gross', round(percentile_cont(0.5) within group (order by (d->>'gross')::numeric)::numeric),
               'first_knock', to_char(time '00:00' + make_interval(secs => percentile_cont(0.5) within group (order by (d->>'first_knock_s')::numeric)), 'HH24:MI')),
             'end_of_day', jsonb_build_object('knocks', round(percentile_cont(0.5) within group (order by (d->>'end_knocks')::numeric)::numeric, 1),
               'sales', round(percentile_cont(0.5) within group (order by (d->>'end_sales')::numeric)::numeric, 1),
               'production', round(percentile_cont(0.5) within group (order by (d->>'end_production')::numeric)::numeric, 1),
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
    -- the lowest and the highest earlier day for each measure, at this time of day and by the end: a range is read from
    -- here, never worked out from the list of days (a tie names the latest of the tied days)
    select jsonb_build_object(
             'at_this_time', jsonb_object_agg(k.k, jsonb_build_object(
               'lowest', (select jsonb_build_object('value', (d->>k.k)::numeric, 'day', d->>'day') from jsonb_array_elements(v_prev) d order by (d->>k.k)::numeric, d->>'day' desc limit 1),
               'highest', (select jsonb_build_object('value', (d->>k.k)::numeric, 'day', d->>'day') from jsonb_array_elements(v_prev) d order by (d->>k.k)::numeric desc, d->>'day' desc limit 1))),
             'end_of_day', jsonb_object_agg(k.k, jsonb_build_object(
               'lowest', (select jsonb_build_object('value', (d->>('end_' || k.k))::numeric, 'day', d->>'day') from jsonb_array_elements(v_prev) d order by (d->>('end_' || k.k))::numeric, d->>'day' desc limit 1),
               'highest', (select jsonb_build_object('value', (d->>('end_' || k.k))::numeric, 'day', d->>'day') from jsonb_array_elements(v_prev) d order by (d->>('end_' || k.k))::numeric desc, d->>'day' desc limit 1))))
      into v_range from unnest(array['knocks', 'sales', 'production', 'steps', 'gross']) k(k);
  end if;

  -- where the day could end: two honest ways to carry it forward, never one number
  if not v_is_live or v_end or v_asked_at then v_proj := null;
  elsif v_n < 3 then v_proj := jsonb_build_object('none', 'Fewer than 3 earlier days to go by.');
  elsif coalesce(m_share_steps, 0) < 0.15 then v_proj := jsonb_build_object('none', 'Too early in the day: on earlier days almost nothing was logged by this time.');
  else v_proj := jsonb_build_object(
         'if_the_rest_goes_like_a_usual_day', jsonb_build_object('steps', t_steps + m_rest_steps, 'gross', round(t_gross + m_rest_gross),
           'how', format('This day so far, plus what the earlier days usually logged after this time of day (%s steps, $%s).', m_rest_steps::float8, round(m_rest_gross))),
         'if_the_day_keeps_this_pace', jsonb_build_object('steps', round(t_steps / m_share_steps, 1), 'gross', case when coalesce(m_share_gross, 0) >= 0.15 then round(t_gross / m_share_gross) end,
           'how', format('This day so far, scaled up by the share of a day that is usually in by this time of day (%s%% of the steps%s).', round(m_share_steps * 100),
                         case when coalesce(m_share_gross, 0) >= 0.15 then format(', %s%% of the gross', round(m_share_gross * 100)) else '' end)));
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
    'A knock is a door with no sale (no, not home, go back). A sale is a door too. Steps and gross are counted from the jobs logged, the same way on every day; the calendar’s day totals can read lower.',
    'Every time here is the center’s own clock (time_zone).',
    'A worker’s gross is everything they logged by then, sales and prebooks done (production) together: it is not the dollars of their sales.',
    'Each usual figure is the middle one of the earlier days for that measure by itself, so the usual figures need not add up to each other. For a range, read earlier_days.lowest_and_highest: never work one out from the list of days.');
  if v_bulk is not null then
    v_notes := v_notes || jsonb_build_array('Knocks stamped in bulk at one moment are left out (see left_out.bulk_knocks): those days’ knock counts are short.');
  end if;

  return jsonb_strip_nulls(jsonb_build_object('ok', true,
    'center', (select c.display_name from command_centers c where c.id = p_center), 'day', v_day, 'weekday', trim(to_char(v_day, 'Day')), 'live', v_is_live,
    'as_of', case when v_end then 'end of day' else to_char(v_clock, 'HH24:MI') end,
    'clock', case when v_asked_at then 'the time asked for' when v_end then 'the whole day' else 'now' end,
    'time_zone', case v_tz when 'America/Vancouver' then 'Pacific' else 'Eastern' end,
    'scope', v_scope, 'who', case when v_scope <> 'center' then v_who end, 'heard_as', v_w->'heard_as',
    'this_day', (v_today - 'first_knock_s' - 'bulk' - 'invalid' - 'day' - 'dow' - 'end_knocks' - 'end_steps' - 'end_gross' - 'end_sales' - 'end_production')
      || jsonb_build_object('doors_per_sale', case when (v_today->>'sales')::numeric > 0 then round(((v_today->>'knocks')::numeric + (v_today->>'sales')::numeric) / (v_today->>'sales')::numeric, 1) end)
      || case when v_end then jsonb_build_object() else jsonb_build_object('note', 'so far, up to as_of') end,
    'by_hour', v_hours,
    'earlier_days', case when v_n > 0 then jsonb_build_object('count', v_n,
       'each_at_this_time', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('day', d->>'day', 'weekday', d->>'dow', 'knocks', d->'knocks', 'sales', d->'sales', 'production', d->'production',
                                'steps', d->'steps', 'gross', d->'gross', 'workers_knocking', d->'workers_knocking', 'first_knock', d->'first_knock',
                                'ended_at', jsonb_build_object('knocks', d->'end_knocks', 'steps', d->'end_steps', 'gross', d->'end_gross'))) order by d->>'day' desc)
                               from jsonb_array_elements(v_prev) d),
       'usual', v_typ, 'lowest_and_highest', v_range, 'usual_by_hour', v_usual) end,
    'projection', v_proj,
    'workers', v_workers,
    'left_out', jsonb_strip_nulls(jsonb_build_object('bulk_knocks', v_bulk, 'houses_marked_invalid', nullif((v_today->>'invalid')::int, 0))),
    'notes', v_notes));
end $$;
revoke all on function public.benny_pace(uuid, text, text, date, text) from public, anon;
grant execute on function public.benny_pace(uuid, text, text, date, text) to authenticated;
