-- The Benny: areas. Which master maps (and routes) close best, from what was entered in the app: doors knocked, sales,
-- prebooks done, the closing rate, how many days each map was worked, and which routes on a map nobody has knocked yet
-- (with their houses and open prebooks), so a manager can pick where to go back. Read-only. Additive only.
--
-- Where it comes from:
--   knocks  client_visits (one row per house per day: its last answer that day; invalid is not a knock). Every row
--           counts here, also the ones stamped in bulk: the time is wrong on those, the house and the answer are not.
--   jobs    transactions today and archive.session_rows for closed days, by named fields only (an archived transaction
--           still carries its card fields). The route is the one in the job's customer snapshot, else its route_code.
--   maps    route_maps (a route code's map; the approved row when a code is listed twice), route_houses (houses built),
--           mb_bookings (prebooks, by route).
-- Doors = knocks + sales. Closing rate = sales / doors.

-- Every knock and every sale or prebook done at a center between two days, with its route and that route's map.
create or replace function public.benny_areas_ev(p_center uuid, p_from date, p_to date, p_live date)
returns table (day date, route text, kind text, cn text, house text, map text)
language sql stable security definer set search_path to 'public' as $$
  with rt as (select distinct on (upper(m.route_code)) upper(m.route_code) code, m.area_name map from route_maps m
               where m.route_code is not null order by upper(m.route_code), (m.status = 'approved') desc, m.updated_at desc),
  e as (
    select v.day, upper(v.route_code) route, 'knock'::text kind, v.worker_id cn, v.house_key house from client_visits v
     where v.center_id = p_center::text and v.day between p_from and p_to and v.status <> 'invalid'
    union all
    select p_live, upper(coalesce(nullif(t.customer_snapshot->>'routeCode', ''), nullif(t.route_code, ''))),
           case t.type when 'Sale' then 'sale' else 'production' end, t.worker_id, null
      from transactions t
     where p_live is not null and p_live between p_from and p_to and t.command_center_id = p_center and t.type in ('Sale', 'Production')
    union all
    select a.day, upper(coalesce(nullif(a.row_data->'customer_snapshot'->>'routeCode', ''), nullif(a.row_data->>'route_code', ''))),
           case a.row_data->>'type' when 'Sale' then 'sale' else 'production' end, a.row_data->>'worker_id', null
      from archive.session_rows a
     where a.center_id = p_center and a.source_table = 'transactions' and a.day between p_from and p_to
       and (p_live is null or a.day <> p_live) and a.row_data->>'type' in ('Sale', 'Production'))
  select e.day, e.route, e.kind, e.cn, e.house, rt.map from e left join rt on rt.code = e.route
$$;
revoke all on function public.benny_areas_ev(uuid, date, date, date) from public, anon, authenticated;

create or replace function public.benny_areas(p_center uuid, p_map text default null, p_from date default null, p_to date default null, p_min_doors int default 40)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_role text := benny_ok_any(p_center);
  v_live date := benny_live_date(p_center);
  v_to date; v_from date; v_min int := greatest(coalesce(p_min_doors, 40), 1);
  v_maps text[]; v_map text; v_out jsonb; v_q text[];
begin
  if p_center is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Pick a center first.')); end if;
  v_to := coalesce(p_to, v_live, current_date);
  v_from := coalesce(p_from, (select min(v.day) from client_visits v where v.center_id = p_center::text), v_to);

  -- one map asked for: the exact name, else the one map whose name holds it
  if nullif(trim(coalesce(p_map, '')), '') is not null then
    v_maps := array(select distinct e.map from benny_areas_ev(p_center, v_from, v_to, v_live) e where upper(e.map) = upper(trim(p_map)));
    if cardinality(v_maps) = 0 then
      -- word by word: each word said starts the map's word in the same place ("north van 2" = NORTH VANCOUVER #2)
      v_q := regexp_split_to_array(trim(regexp_replace(replace(upper(trim(p_map)), 'POCO', 'PORT COQUITLAM'), '[^A-Z0-9]+', ' ', 'g')), ' ');
      v_maps := array(select distinct e.map from benny_areas_ev(p_center, v_from, v_to, v_live) e
                       where (select bool_and(w.mw like w.qw || '%') and count(*) = cardinality(v_q)
                                from unnest(regexp_split_to_array(trim(regexp_replace(upper(e.map), '[^A-Z0-9]+', ' ', 'g')), ' '), v_q) w(mw, qw)
                               where w.mw is not null and w.qw is not null)
                          and cardinality(regexp_split_to_array(trim(regexp_replace(upper(e.map), '[^A-Z0-9]+', ' ', 'g')), ' ')) = cardinality(v_q)
                       order by 1);
    end if;
    if cardinality(v_maps) = 0 then
      v_maps := array(select distinct e.map from benny_areas_ev(p_center, v_from, v_to, v_live) e
                       where e.map ilike '%' || trim(p_map) || '%' or replace(e.map, ' #', ' ') ilike '%' || replace(trim(p_map), '#', '') || '%' order by 1);
    end if;
    if cardinality(v_maps) = 0 then
      return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Nothing was knocked or sold on a map called “' || trim(p_map) || '” at this center between ' || v_from || ' and ' || v_to || '.'));
    elsif cardinality(v_maps) > 1 then
      return jsonb_build_object('ok', false, 'which', to_jsonb(v_maps), 'problems', jsonb_build_array('More than one map fits “' || trim(p_map) || '”.'));
    end if;
    v_map := v_maps[1];
  end if;

  with ev0 as (select * from benny_areas_ev(p_center, v_from, v_to, v_live)),
  ev as (select e.day, e.route, e.kind, e.cn, e.house, coalesce(e.map, '(no map)') map from ev0 e),
  rt as (select distinct on (upper(m.route_code)) upper(m.route_code) code, m.area_name map from route_maps m
          where m.route_code is not null order by upper(m.route_code), (m.status = 'approved') desc, m.updated_at desc),
  pb as (select upper(b.route_code) route, count(*) filter (where b.status = 'open') open, count(*) filter (where b.status = 'done') done
           from mb_bookings b join mb_lists l on l.id = b.list_id where l.center_id = p_center and b.route_code is not null group by 1),
  m as (
    select ev.map, count(*) filter (where kind = 'knock') knocks, count(*) filter (where kind = 'sale') sales, count(*) filter (where kind = 'production') production,
           count(distinct ev.day) days, count(distinct ev.route) filter (where kind = 'knock') routes_knocked,
           count(distinct ev.cn) filter (where kind in ('knock', 'sale')) workers, min(ev.day) first_day, max(ev.day) last_day
      from ev where v_map is null or ev.map = v_map group by ev.map),
  mr as (  -- each map's routes, with what happened on them
    select r.map, r.code,
           (select count(*) from route_houses h where h.route_code = r.code) houses,
           count(distinct e.house) filter (where e.kind = 'knock') houses_tapped,
           count(*) filter (where e.kind = 'knock') knocks, count(*) filter (where e.kind = 'sale') sales, count(*) filter (where e.kind = 'production') production,
           count(distinct e.day) days, coalesce(max(pb.open), 0) open_prebooks
      from rt r left join ev e on e.route = r.code left join pb on pb.route = r.code
     where r.map in (select map from m) group by r.map, r.code),
  rated as (
    select m.*, m.knocks + m.sales doors,
           round(100.0 * m.sales / nullif(m.knocks + m.sales, 0), 1) close_pct,
           round((m.knocks + m.sales)::numeric / nullif(m.sales, 0), 1) doors_per_sale,
           (select count(*) from mr where mr.map = m.map) routes_on_map,
           (select coalesce(sum(houses), 0) from mr where mr.map = m.map) houses_on_map,
           (select coalesce(sum(open_prebooks), 0) from mr where mr.map = m.map) open_prebooks,
           (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('route', mr.code, 'houses', nullif(mr.houses, 0), 'open_prebooks', nullif(mr.open_prebooks, 0)))
                      order by mr.open_prebooks desc, mr.houses desc, mr.code), '[]'::jsonb)
              from mr where mr.map = m.map and mr.knocks = 0 and mr.sales = 0 and mr.production = 0) not_knocked
      from m),
  line as (
    select r.*, jsonb_strip_nulls(jsonb_build_object('map', r.map, 'close_pct', r.close_pct, 'doors', r.doors, 'knocks', r.knocks, 'sales', r.sales,
             'doors_per_sale', r.doors_per_sale, 'prebooks_done', r.production, 'days_worked', r.days, 'first_day', r.first_day, 'last_day', r.last_day,
             'workers', r.workers, 'routes_on_map', r.routes_on_map, 'routes_knocked', r.routes_knocked, 'houses_on_map', nullif(r.houses_on_map, 0),
             'open_prebooks', r.open_prebooks, 'routes_not_knocked', jsonb_array_length(r.not_knocked),
             'not_knocked', case when v_map is not null then r.not_knocked else (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(r.not_knocked) x limit 8) y) end)) o
      from rated r where r.map <> '(no map)')
  select jsonb_strip_nulls(jsonb_build_object('ok', true,
    'center', (select c.display_name from command_centers c where c.id = p_center),
    'from', v_from, 'to', v_to, 'map', v_map, 'min_doors', v_min,
    'totals', (select jsonb_build_object('knocks', sum(knocks), 'sales', sum(sales), 'doors', sum(doors), 'prebooks_done', sum(production),
                 'close_pct', round(100.0 * sum(sales) / nullif(sum(doors), 0), 1)) from rated),
    'maps', (select coalesce(jsonb_agg(o order by close_pct desc nulls last, doors desc), '[]'::jsonb) from line where doors >= v_min or v_map is not null),
    'too_few_doors', case when v_map is null then (select jsonb_agg(jsonb_build_object('map', map, 'doors', doors, 'sales', sales) order by doors desc) from line where doors < v_min) end,
    'routes', case when v_map is not null then (
       select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('route', mr.code, 'knocks', mr.knocks, 'sales', mr.sales, 'prebooks_done', mr.production,
                'close_pct', round(100.0 * mr.sales / nullif(mr.knocks + mr.sales, 0), 1), 'days_worked', mr.days, 'houses', nullif(mr.houses, 0),
                'houses_tapped', mr.houses_tapped, 'open_prebooks', mr.open_prebooks)) order by mr.sales desc, mr.knocks desc, mr.code), '[]'::jsonb)
         from mr where mr.map = v_map and (mr.knocks > 0 or mr.sales > 0 or mr.production > 0)) end,
    'by_worker', case when v_map is not null and v_role = 'admin' then (
       select coalesce(jsonb_agg(jsonb_build_object('cn', w.cn, 'name', coalesce(u.name, w.cn), 'knocks', w.knocks, 'sales', w.sales) order by w.sales desc, w.knocks desc), '[]'::jsonb)
         from (select ev.cn, count(*) filter (where kind = 'knock') knocks, count(*) filter (where kind = 'sale') sales from ev where ev.map = v_map and ev.cn is not null group by ev.cn) w
         left join users u on u.user_id = w.cn and u.command_center_id = p_center) end,
    'jobs_with_no_route', (select nullif(count(*), 0) from ev where route is null and kind <> 'knock'),
    'notes', jsonb_build_array(
      'Doors are knocks plus sales; the closing rate is sales divided by doors. Prebooks done are not sales and are not in the rate.',
      'Knocks are what was entered in the app, and they start ' || v_from || '. How much each worker enters varies a lot, so part of a map''s rate is who worked it: say so, and give the doors and the days worked with every rate.',
      'A map worked one or two days, or with few doors, swings a lot on one or two sales: never rank on the rate alone.',
      'Maps with fewer than ' || v_min || ' doors are in too_few_doors, not ranked. Never work out a figure yourself: every rate and count is here.')))
    into v_out;
  return v_out;
end $$;
revoke all on function public.benny_areas(uuid, text, date, date, int) from public, anon;
grant execute on function public.benny_areas(uuid, text, date, date, int) to authenticated;
