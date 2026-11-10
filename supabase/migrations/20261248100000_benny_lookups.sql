-- The Benny (in-app assistant), step 1: read-only lookups it answers questions from. Each one is checked
-- against the signed-in person (super admins only for now) and the centers they can see. No passwords,
-- card numbers, SIN/ID numbers or free-text notes are returned. Additive only.

create or replace function public.benny_ok(p_center uuid default null)
returns void language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not coalesce(app_is_super_admin(), false) then raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_center is not null and not coalesce(app_can_see_center(p_center), false) then raise exception 'Not allowed' using errcode = '42501'; end if;
end $$;
revoke all on function public.benny_ok(uuid) from public, anon;
grant execute on function public.benny_ok(uuid) to authenticated;

-- People: workers (any year) and staff, by name, CN or phone digits.
create or replace function public.benny_find_people(p_center uuid, p_q text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare q text := trim(coalesce(p_q, '')); digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g'); v jsonb;
begin
  perform benny_ok(p_center);
  if length(q) < 2 then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(x order by x->>'name'), '[]') into v from (
    select jsonb_strip_nulls(jsonb_build_object(
             'kind', 'worker', 'name', trim(p.first_name || ' ' || coalesce(p.last_name, '')),
             'cell', p.cell_phone, 'alt_phone', p.alt_phone, 'email', p.email, 'first_year', p.first_year,
             'hires', (select jsonb_agg(jsonb_build_object('cn', h.cn, 'year', h.year, 'status', h.status,
                              'center', (select display_name from command_centers c where c.id = coalesce(h.current_center_id, h.center_id)),
                              'shuttle', h.shuttle) order by h.year desc)
                         from hires h where h.person_id = p.id))) x
      from people p
     where (trim(p.first_name || ' ' || coalesce(p.last_name, '')) ilike '%' || q || '%'
            or (length(digits) >= 4 and regexp_replace(coalesce(p.cell_phone, '') || ' ' || coalesce(p.alt_phone, ''), '\D', '', 'g') like '%' || digits || '%')
            or exists (select 1 from hires h where h.person_id = p.id and upper(h.cn) = upper(q)))
     limit 15) z;
  return v || coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('kind', 'staff', 'name', u.full_name, 'username', u.username,
                                  'cell', u.phone, 'email', u.email, 'super_admin', u.is_super_admin, 'active', u.is_active)))
                          from app_users u where u.full_name ilike '%' || q || '%' or u.username ilike '%' || q || '%'), '[]');
end $$;

-- A workerbook day: who's booked, the session (managers, routes, teams) and the close-out summary.
create or replace function public.benny_day(p_center uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare d days; s sessions; v_names jsonb;
begin
  perform benny_ok(p_center);
  select * into d from days where center_id = p_center and day = p_date;
  if d.id is null then return jsonb_build_object('date', p_date, 'exists', false); end if;
  select * into s from sessions where day_id = d.id order by started_at desc nulls last limit 1;
  select coalesce(jsonb_object_agg(h.id::text, trim(p.first_name || ' ' || coalesce(p.last_name, '')) || ' (' || coalesce(h.cn, '?') || ')'), '{}')
    into v_names from day_roster r join hires h on h.id = r.hire_id join people p on p.id = h.person_id where r.day_id = d.id;
  return jsonb_strip_nulls(jsonb_build_object(
    'date', d.day, 'exists', true, 'state', d.state, 'closed_at', d.closed_at, 'summary', d.summary,
    'roster', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('worker', v_names ->> r.hire_id::text, 'attendance', r.attendance,
                        'next_day', r.next_day, 'confirmed', r.confirmed_at is not null, 'shuttle', r.shuttle)) order by v_names ->> r.hire_id::text)
                 from day_roster r where r.day_id = d.id),
    'session', case when s.id is null then null else jsonb_build_object(
      'started_at', s.started_at,
      'managers', (select jsonb_agg(jsonb_build_object(
          'manager', coalesce((select full_name from app_users u where u.id::text = m.mid), m.mid),
          'routes', (select jsonb_agg(r->>'code' order by r->>'code') from jsonb_array_elements(s.routes) r where r->>'manager_id' = m.mid),
          'areas', (select jsonb_agg(distinct r->>'area') from jsonb_array_elements(s.routes) r where r->>'manager_id' = m.mid),
          'teams', (select jsonb_agg(jsonb_build_object('team', t->>'name', 'kind', t->>'kind',
                       'workers', (select jsonb_agg(v_names ->> hid) from jsonb_array_elements_text(t->'hire_ids') hid)))
                      from jsonb_array_elements(s.teams) t where t->>'manager_id' = m.mid)))
        from (select distinct x->>'manager_id' mid from jsonb_array_elements(coalesce(s.routes, '[]') || coalesce(s.teams, '[]')) x) m),
      'live_routes', (select jsonb_agg(jsonb_build_object('route', rt.route_code, 'workers', rt.assigned_worker_ids) order by rt.route_code)
                        from routes rt where rt.session_date = p_date and rt.command_center_id = p_center and coalesce(array_length(rt.assigned_worker_ids, 1), 0) > 0),
      'prebooks_loaded', (select count(*) from bookings b where b.session_date = p_date and b.command_center_id = p_center and b.booking_id like 'mb:%')) end));
end $$;

-- Master Bookings: counts by map and route, and the first bookings, for a map/city/route filter.
create or replace function public.benny_bookings(p_center uuid, p_where text default null, p_route text default null, p_status text default 'open')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare w text := nullif(trim(coalesce(p_where, '')), ''); v jsonb;
begin
  perform benny_ok(p_center);
  with b as (
    select b.*, l.name list_name, l.service, l.year from mb_bookings b join mb_lists l on l.id = b.list_id
     where l.center_id = p_center
       and (p_status is null or p_status = 'any' or b.status = p_status)
       and (p_route is null or upper(b.route_code) = upper(p_route))
       and (w is null or b.area_name ilike '%' || w || '%' or b.city ilike '%' || w || '%' or b.street_name ilike '%' || w || '%'))
  select jsonb_build_object(
    'total', (select count(*) from b),
    'by_map', (select coalesce(jsonb_agg(jsonb_build_object('map', coalesce(area_name, '(not on a map)'), 'count', n) order by n desc), '[]')
                 from (select area_name, count(*) n from b group by 1) x),
    'by_route', (select coalesce(jsonb_agg(jsonb_build_object('route', route_code, 'map', area_name, 'count', n) order by route_code), '[]')
                   from (select route_code, area_name, count(*) n from b where route_code is not null group by 1, 2) x),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from b group by 1) x),
    'first', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('address', trim(house_no || ' ' || street_name), 'city', city,
                       'route', route_code, 'map', area_name, 'status', status, 'placed', map_state, 'list', list_name, 'job', job_code))), '[]')
                from (select * from b order by area_name nulls last, route_code, street_name, house_no limit 30) y))
    into v;
  return v;
end $$;

-- Maps (master maps) of the center's region matching a name or city, with routes, houses and past clients.
create or replace function public.benny_maps(p_center uuid, p_q text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_region text; q text := nullif(trim(coalesce(p_q, '')), '');
begin
  perform benny_ok(p_center);
  select region into v_region from command_centers where id = p_center;
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'map', ap.area_name, 'city', ap.city, 'prefix', ap.prefix,
            'routes', (select count(*) from route_maps rm where rm.area_name = ap.area_name and rm.status = 'approved'),
            'first_route', (select min(route_code) from route_maps rm where rm.area_name = ap.area_name and rm.status = 'approved'),
            'last_route', (select max(route_code) from route_maps rm where rm.area_name = ap.area_name and rm.status = 'approved'),
            'houses', (select count(*) from route_houses h join route_maps rm on rm.route_code = h.route_code and rm.area_name = ap.area_name and rm.status = 'approved'),
            'past_clients', (select count(*) from clients c join route_maps rm on rm.route_code = c.route_code and rm.area_name = ap.area_name and rm.status = 'approved'))
          order by ap.area_name), '[]')
     from area_prefixes ap
    where (v_region is null or ap.region = v_region)
      and (q is null or ap.area_name ilike '%' || q || '%' or ap.city ilike '%' || q || '%')
    limit 40);
end $$;

-- One route: its map, houses, past clients by service, open prebooks, and who has it on a day.
create or replace function public.benny_route(p_center uuid, p_route text, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare rc text := upper(trim(coalesce(p_route, ''))); rm route_maps;
begin
  perform benny_ok(p_center);
  select * into rm from route_maps where upper(route_code) = rc and status = 'approved' limit 1;
  if rm.id is null then return jsonb_build_object('route', rc, 'found', false); end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'route', rm.route_code, 'found', true, 'map', rm.area_name,
    'streets', (select jsonb_agg(distinct s->>'name') from jsonb_array_elements(rm.segments) s where coalesce(s->>'name', '') <> ''),
    'houses', (select count(*) from route_houses h where h.route_code = rm.route_code),
    'past_clients', (select count(*) from clients c where c.route_code = rm.route_code),
    'past_clients_by_service', (select jsonb_object_agg(svc, n) from (select unnest(services) svc, count(*) n from clients c where c.route_code = rm.route_code group by 1) x),
    'open_prebooks', (select jsonb_agg(trim(b.house_no || ' ' || b.street_name)) from mb_bookings b join mb_lists l on l.id = b.list_id
                        where l.center_id = p_center and b.route_code = rm.route_code and b.status = 'open'),
    'on_day', case when p_date is null then null else (select jsonb_build_object('date', p_date, 'workers', r.assigned_worker_ids,
                   'manager', coalesce((select name from users u where u.user_id = r.manager_id), r.manager_id))
                 from routes r where r.route_code = rm.route_code and r.session_date = p_date and r.command_center_id = p_center limit 1) end));
end $$;

-- What to draw on the Benny's map: the master maps to outline, the routes to colour, and pins.
-- p_prebooks: open prebooks in those maps become pins, and their routes are highlighted.
create or replace function public.benny_map(p_center uuid, p_maps text[], p_routes text[] default null, p_prebooks boolean default false)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_maps text[]; v_pins jsonb := '[]'; v_hl text[] := coalesce(p_routes, '{}');
begin
  perform benny_ok(p_center);
  -- a map name or a city ("Surrey" = every Surrey map)
  select array_agg(distinct ap.area_name) into v_maps
    from area_prefixes ap, unnest(coalesce(p_maps, '{}')) m
   where ap.area_name ilike '%' || m || '%' or ap.city ilike '%' || m || '%';
  if (v_maps is null or not cardinality(v_maps) > 0) and cardinality(v_hl) > 0 then
    select array_agg(distinct area_name) into v_maps from route_maps where route_code = any (v_hl) and status = 'approved';
  end if;
  if p_prebooks and v_maps is not null then
    select coalesce(jsonb_agg(jsonb_build_object('lat', b.lat, 'lng', b.lng, 'label', trim(b.house_no || ' ' || b.street_name), 'route', b.route_code)), '[]'),
           v_hl || coalesce(array_agg(distinct b.route_code) filter (where b.route_code is not null), '{}')
      into v_pins, v_hl
      from mb_bookings b join mb_lists l on l.id = b.list_id
     where l.center_id = p_center and b.status = 'open' and b.lat is not null and b.area_name = any (v_maps);
  end if;
  return jsonb_build_object('maps', to_jsonb(coalesce(v_maps, '{}')), 'highlight', to_jsonb(v_hl), 'pins', v_pins);
end $$;

do $g$ declare f text; begin
  foreach f in array array['benny_find_people(uuid,text)','benny_day(uuid,date)','benny_bookings(uuid,text,text,text)','benny_maps(uuid,text)',
                           'benny_route(uuid,text,date)','benny_map(uuid,text[],text[],boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $g$;
