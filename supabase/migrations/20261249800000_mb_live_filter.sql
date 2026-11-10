-- Master Bookings › Bookings: a "Live" filter — the bookings loaded into today's live session. Start session copies
-- the open bookings on the day's routes into the old session's bookings table (booking_id 'mb:<uuid>'), where the
-- crew works them on the map; that table holds only the live day's, so it is exactly "loaded today".
-- Additive: app_mb_list_bookings takes p_status 'live', and app_mb_lists counts 'live' per list.

create or replace function public.app_mb_list_bookings(p_list uuid, p_q text default null, p_status text default null, p_state text default null,
  p_area text default null, p_route text default null, p_limit integer default 200, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_q text := lower(trim(coalesce(p_q, '')));
begin
  perform mb_list_ok(p_list);
  return (
    with f as (
      select b.* from mb_bookings b
       where b.list_id = p_list
         and (p_status is null
              or (p_status = 'tried' and b.status = 'open' and jsonb_array_length(b.attempts) > 0)
              or (p_status = 'live' and exists (select 1 from bookings lb where lb.booking_id = 'mb:' || b.id::text))
              or b.status = p_status)
         and (p_state is null or b.map_state = p_state or (p_state = 'on_map' and b.map_state = 'moved'))
         and (p_area is null or b.area_name = p_area)
         and (p_route is null or upper(b.route_code) = upper(p_route) or upper(coalesce(b.sheet_route, '')) = upper(p_route))
         and (v_q = '' or lower(concat_ws(' ', b.house_no, b.street_name, b.city, b.route_code, b.sheet_route, b.field_notes, b.office_notes,
               (select string_agg(concat_ws(' ', p->>'first', p->>'last'), ' ') from jsonb_array_elements(b.people) p),
               array_to_string(b.phones, ' '), array_to_string(b.emails, ' '))) like '%' || v_q || '%'))
    select jsonb_build_object('total', (select count(*) from f),
      'rows', coalesce((select jsonb_agg(mb_booking_json(x) order by x.route_code nulls last, x.street_name, x.house_no)
                          from (select * from f order by route_code nulls last, street_name, house_no limit least(greatest(p_limit, 1), 1000) offset greatest(p_offset, 0)) x), '[]'::jsonb)));
end $$;

create or replace function public.app_mb_lists(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_region text;
begin
  perform mb_check_center(p_center);
  select region into v_region from command_centers where id = p_center;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'region', l.region, 'year', l.year, 'part', l.part, 'service', l.service, 'name', l.name,
             'center_id', l.center_id, 'mine', l.center_id = p_center, 'job_code', l.job_code,
             'total', coalesce(c.total, 0), 'open', coalesce(c.open, 0), 'done', coalesce(c.done, 0), 'cancelled', coalesce(c.cancelled, 0),
             'tried', coalesce(c.tried, 0), 'on_map', coalesce(c.on_map, 0), 'moved', coalesce(c.moved, 0),
             'waiting', coalesce(c.waiting, 0), 'no_location', coalesce(c.no_location, 0), 'live', coalesce(c.live, 0))
           order by l.year desc, case l.part when 'spring' then 1 when 'summer' then 2 else 3 end, l.service)
      from mb_lists l
      left join lateral (
        select count(*)::int total, count(*) filter (where status = 'open')::int open, count(*) filter (where status = 'done')::int done,
               count(*) filter (where status = 'cancelled')::int cancelled,
               count(*) filter (where status = 'open' and jsonb_array_length(attempts) > 0)::int tried,
               count(*) filter (where map_state = 'on_map')::int on_map, count(*) filter (where map_state = 'moved')::int moved,
               count(*) filter (where map_state = 'waiting')::int waiting, count(*) filter (where map_state = 'no_location')::int no_location,
               count(*) filter (where exists (select 1 from bookings lb where lb.booking_id = 'mb:' || b.id::text))::int live
          from mb_bookings b where b.list_id = l.id) c on true
     where l.region = v_region or l.center_id = p_center), '[]'::jsonb);
end $$;
