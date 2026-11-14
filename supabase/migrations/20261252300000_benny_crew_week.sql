-- The Benny: what the crew has made over a stretch of days ("how much has the crew made this week"), with an optional
-- hotel cost per worker per night taken off. Closed days come from payout_lines (each worker's total_payout); the live
-- day adds the carts already paid out (their final pay) and names the carts not paid out yet. Hotel nights = the days
-- each worker worked in the stretch (one night per day worked), so the answer says that.
-- Read only. Super admins only (benny_ok), like the other payout tools.

create or replace function public.benny_crew_week(p_center uuid, p_from date default null, p_to date default null, p_hotel numeric default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_live date; v_to date; v_from date; v_hotel numeric := greatest(coalesce(p_hotel, 0), 0);
  v_workers jsonb; v_days jsonb; v_live_part jsonb := null; v_closed_pay numeric; v_closed_nights int;
  v_live_pay numeric := 0; v_live_people int := 0;
begin
  perform benny_ok(p_center);
  v_live := benny_live_date(p_center);
  v_to := coalesce(p_to, v_live, current_date);
  v_from := coalesce(p_from, date_trunc('week', v_to)::date);   -- Monday of that week
  if v_from > v_to then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('The first day is after the last day.')); end if;

  -- closed days: one payout line per worker per day
  select coalesce(jsonb_agg(w.x order by (w.x->>'pay')::numeric desc), '[]'::jsonb), coalesce(sum((w.x->>'pay')::numeric), 0), coalesce(sum((w.x->>'nights')::int), 0)
    into v_workers, v_closed_pay, v_closed_nights
  from (select jsonb_build_object(
          'cn', max(l.cn), 'name', trim(max(l.first_name) || ' ' || coalesce(max(l.last_name), '')),
          'days', count(distinct l.day), 'pay', round(sum(coalesce(l.total_payout, 0)), 2),
          'bonus', round(sum(coalesce(l.daily_bonus, 0)), 2), 'equiv', round(sum(coalesce(l.equiv, 0)), 1),
          'nights', count(distinct l.day),
          'hotel', round(count(distinct l.day) * v_hotel, 2),
          'after_hotel', round(sum(coalesce(l.total_payout, 0)) - count(distinct l.day) * v_hotel, 2)) x
        from payout_lines l
       where l.center_id = p_center and l.day between v_from and v_to and (v_live is null or l.day <> v_live)
       group by coalesce(l.hire_id::text, l.cn)) w;

  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'workers', d.n, 'pay', d.pay) order by d.day), '[]'::jsonb) into v_days
  from (select l.day, count(distinct coalesce(l.hire_id::text, l.cn)) n, round(sum(coalesce(l.total_payout, 0)), 2) pay
          from payout_lines l where l.center_id = p_center and l.day between v_from and v_to and (v_live is null or l.day <> v_live) group by l.day) d;

  -- the live day, if it is in the stretch: what is paid out so far, and what isn't yet
  if v_live is not null and v_live between v_from and v_to then
    select coalesce(sum(case when upper(coalesce(s.status, 'OPEN')) = 'PAID' and (s.validation->>'finalCommission') ~ '^-?[0-9]+(\.[0-9]+)?$'
                             then (s.validation->>'finalCommission')::numeric end), 0),
           coalesce(sum(coalesce(array_length(nullif(s.team_worker_ids, '{}'), 1), 1)), 0)
      into v_live_pay, v_live_people
      from logsheet_sessions s where s.command_center_id = p_center and s.date = v_live;
    v_live_part := jsonb_build_object('day', v_live,
      'paid_out_carts', (select count(*) from logsheet_sessions s where s.command_center_id = p_center and s.date = v_live and upper(coalesce(s.status, 'OPEN')) = 'PAID'),
      'open_carts', (select count(*) from logsheet_sessions s where s.command_center_id = p_center and s.date = v_live and upper(coalesce(s.status, 'OPEN')) <> 'PAID'),
      'pay_so_far', round(v_live_pay, 2), 'workers', v_live_people, 'hotel', round(v_live_people * v_hotel, 2),
      'note', 'Live day: only the carts already paid out are counted; the open carts are not paid out yet.');
  end if;

  return jsonb_build_object('ok', true, 'from', v_from, 'to', v_to, 'hotel_per_night', v_hotel,
    'hotel_rule', 'one night per worker per day worked',
    'closed_days', v_days, 'workers', v_workers, 'live_day', v_live_part,
    'totals', jsonb_build_object(
      'pay', round(v_closed_pay + v_live_pay, 2),
      'hotel_nights', v_closed_nights + v_live_people,
      'hotel', round((v_closed_nights + v_live_people) * v_hotel, 2),
      'after_hotel', round(v_closed_pay + v_live_pay - (v_closed_nights + v_live_people) * v_hotel, 2)));
end $$;
revoke all on function public.benny_crew_week(uuid, date, date, numeric) from public, anon;
grant execute on function public.benny_crew_week(uuid, date, date, numeric) to authenticated;
