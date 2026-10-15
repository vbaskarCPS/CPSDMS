-- RUN_28 — Master Bookings, route level: the route's pending bookings for the sidebar (from the
-- app's bookings table; one per address). Replaces app_mb_route (RUN_27) with the same inputs;
-- nothing else changes.

create or replace function public.app_mb_route(p_route text, p_service text, p_season int, p_round int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_area text; rd mb_rounds; v_end timestamptz := mb_season_end(p_season); v_pct int; v_center uuid; s record;
begin
  perform mb_check_input(p_service, p_season);
  select rm.area_name into v_area from route_maps rm where rm.route_code = p_route and rm.status = 'approved' limit 1;
  if v_area is null then raise exception 'That route isn''t on a map'; end if;
  perform mb_check_area(v_area);
  select mac.center_id into v_center from map_area_centers mac where mac.area_name = v_area limit 1;
  v_pct := coalesce((select done_pct from mb_settings where center_id = v_center), 50);
  rd := mb_round_for(v_area, p_service, p_season, p_round);
  select * into s from mb_route_stats(array[p_route], coalesce(rd.started_at, 'infinity'::timestamptz), coalesce(rd.ended_at, v_end), rd.id);

  return jsonb_build_object(
    'route', p_route, 'area', v_area, 'round', rd.round_no, 'open', rd.id is not null and rd.ended_at is null,
    'started', rd.started_at, 'ended', rd.ended_at, 'done_pct', v_pct,
    'doors', s.doors, 'knocked', s.knocked, 'flagged', mb_flagged(s.knocks, s.fast), 'days', to_jsonb(s.days),
    'done', s.doors > 0 and s.knocked * 100 >= v_pct * s.doors,
    'line', (select rm.segments from route_maps rm where rm.route_code = p_route and rm.status = 'approved' limit 1),
    -- the route's pending bookings (one per address: a booking copied onto several days counts once)
    'bookings', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', b.booking_id, 'name', nullif(trim(concat_ws(' ', b.customer_details->>'First Name', b.customer_details->>'Last Name')), ''),
               'address', nullif(b.customer_details->>'Full Address', ''), 'phone', nullif(coalesce(b.customer_details->>'Cell Phone', b.customer_details->>'Home Phone'), ''),
               'type', nullif(b.customer_details->>'FO/BO/FP', ''), 'price', nullif(b.price, ''), 'prepaid', b.is_prepaid,
               'notes', nullif(b.log_notes, ''), 'services', b.services, 'day', b.session_date)) order by x.addr)
        from (select distinct on (lower(coalesce(bb.customer_details->>'Full Address', bb.booking_id))) bb.booking_id, lower(coalesce(bb.customer_details->>'Full Address', '')) addr
                from bookings bb where bb.route_number = p_route and coalesce(bb.status, 'pending') = 'pending'
               order by lower(coalesce(bb.customer_details->>'Full Address', bb.booking_id)), bb.session_date desc nulls last) x
        join bookings b on b.booking_id = x.booking_id), '[]'::jsonb),
    'houses', coalesce((
      with k as (select distinct on (v.house_key) v.house_key, v.status, v.fast, v.day
                   from mb_visits(array[p_route], coalesce(rd.started_at, 'infinity'::timestamptz), coalesce(rd.ended_at, v_end)) v
                  order by v.house_key, v.at desc)
      select jsonb_agg(jsonb_build_object(
               'k', rh.house_key, 'lat', round(rh.lat::numeric, 6), 'lng', round(rh.lng::numeric, 6),
               'no', rh.civic_no, 'sx', rh.civic_suffix, 'u', nullif(rh.unit, ''),
               'a', trim(concat_ws(' ', rh.civic_no::text || coalesce(rh.civic_suffix, ''), rh.street_name)) || coalesce(' #' || nullif(rh.unit, ''), ''),
               's', rh.street_norm, 'st', k.status, 'fast', coalesce(k.fast, false), 'day', k.day,
               'carried', exists (select 1 from mb_carried_invalids ci where ci.round_id = rd.id and ci.route_code = p_route and ci.house_key = rh.house_key),
               'c', cl.id, 'n', cl.name, 'f', coalesce(cl.f, 0)) order by rh.street_norm, rh.civic_no)
        from route_houses rh
        left join k on k.house_key = rh.house_key
        left join lateral (select c.id, nullif(trim(concat_ws(' ', c.people->0->>'first', c.people->0->>'last')), '') name, mb_client_flags(c.history, p_season) f
                             from clients c where c.route_code = p_route and crm_house_key(c.house_no, c.street_norm) = rh.house_key
                            order by jsonb_array_length(c.history) desc limit 1) cl on true
       where rh.route_code = p_route and rh.lat is not null), '[]'::jsonb),
    'streets', coalesce((
      with kv as (select distinct v.house_key
                    from mb_visits(array[p_route], coalesce(rd.started_at, 'infinity'::timestamptz), coalesce(rd.ended_at, v_end)) v where not v.fast),
           hs as (select rh.street_norm, count(*)::int - count(ci.house_key)::int doors, count(kv.house_key)::int knocked
                    from route_houses rh
                    left join kv on kv.house_key = rh.house_key
                    left join mb_carried_invalids ci on ci.round_id = rd.id and ci.route_code = p_route and ci.house_key = rh.house_key
                   where rh.route_code = p_route group by 1),
           ln as (select l.street_norm, ST_Simplify(ST_LineMerge(ST_Collect(l.line::geometry)), 0.00002) g
                    from route_street_lines l where l.route_code = p_route group by 1)
      select jsonb_agg(jsonb_build_array(p_route, ln.street_norm, coalesce(hs.doors, 0), coalesce(hs.knocked, 0), ST_AsGeoJSON(ln.g, 6)::jsonb))
        from ln left join hs on hs.street_norm = ln.street_norm), '[]'::jsonb));
end $$;

revoke all on function public.app_mb_route(text, text, int, int) from public, anon;
grant execute on function public.app_mb_route(text, text, int, int) to authenticated;
