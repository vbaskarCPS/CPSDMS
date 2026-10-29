-- RUN_67 — Master Bookings › Bookings: the On map filter also shows Moved bookings (both are on a built route).
create or replace function public.app_mb_list_bookings(p_list uuid, p_q text default null, p_status text default null, p_state text default null,
  p_area text default null, p_route text default null, p_limit int default 200, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_q text := lower(trim(coalesce(p_q, '')));
begin
  perform mb_list_ok(p_list);
  return (
    with f as (
      select b.* from mb_bookings b
       where b.list_id = p_list
         and (p_status is null or (p_status = 'tried' and b.status = 'open' and jsonb_array_length(b.attempts) > 0) or b.status = p_status)
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
