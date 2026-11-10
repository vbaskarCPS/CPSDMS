-- The Benny, steps 2–4: route managers can use it too; connected routes; the live team; checks that build the
-- confirm cards for changes (start the day, give a route, partner up, solo cart); bug reports.
-- The Benny never changes anything here: these only look things up and check a change. The change itself runs in
-- the app (the same code as the screens) after the person taps Confirm. Additive only.

-- Who may use the Benny at a center: super admins, and route managers (incl. floaters) who can see that center.
-- Returns 'admin' or 'rm'.
create or replace function public.benny_ok_any(p_center uuid default null)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  if coalesce(app_is_super_admin(), false) then v_role := 'admin';
  elsif coalesce(app_has_perm('route_manager'), false) or coalesce(app_has_perm('rm_floater'), false) then v_role := 'rm';
  else raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_center is not null and not coalesce(app_can_see_center(p_center), false) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return v_role;
end $$;

-- The old app's manager ids this person acts for: their own (rm_<name>) and those they float for.
-- Super admins: null (anyone).
create or replace function public.benny_my_rm_ids(p_center uuid)
returns text[] language plpgsql stable security definer set search_path to 'public' as $$
declare v_own text; v_ff text[];
begin
  if benny_ok_any(p_center) = 'admin' then return null; end if;
  select 'rm_' || regexp_replace(lower(full_name), '[^a-z0-9]', '', 'g') into v_own from app_users where id = auth.uid();
  select coalesce(array_agg(x), '{}') into v_ff from users u, jsonb_array_elements_text(case when jsonb_typeof(u.metadata->'floatingFor') = 'array' then u.metadata->'floatingFor' else '[]' end) x
   where u.user_id = v_own and u.command_center_id = p_center;
  return array[v_own] || v_ff;
end $$;

-- A route's street lines as one geometry (internal).
create or replace function public.benny_route_geom(p_code text)
returns geometry language sql stable security definer set search_path to 'public' as $$
  select st_collect(g) from (
    select st_setsrid(st_makeline(array(select st_makepoint((c.v->>0)::float8, (c.v->>1)::float8)
                                          from jsonb_array_elements(s->'coordinates') with ordinality c(v, i) order by c.i)), 4326) g
      from route_maps rm, jsonb_array_elements(rm.segments) s
     where rm.route_code = p_code and rm.status = 'approved'
       and jsonb_typeof(s->'coordinates') = 'array' and jsonb_array_length(s->'coordinates') >= 2) z
$$;

-- Map names or cities → master map names (a city = every map in it). Internal.
create or replace function public.benny_resolve_maps(p_maps text[])
returns text[] language sql stable security definer set search_path to 'public' as $$
  select coalesce(array_agg(distinct ap.area_name), '{}')
    from area_prefixes ap, unnest(coalesce(p_maps, '{}')) m
   where length(trim(m)) > 0
     and (upper(ap.area_name) = upper(trim(m))
          or (not exists (select 1 from area_prefixes a2 where upper(a2.area_name) = upper(trim(m)))
              and (ap.area_name ilike '%' || trim(m) || '%' or ap.city ilike '%' || trim(m) || '%')))
$$;

-- The live session date at a center (the old app's open day), or null.
create or replace function public.benny_live_date(p_center uuid)
returns date language sql stable security definer set search_path to 'public' as $$
  select max(date) from daily_sessions where command_center_id = p_center and is_active
$$;

-- Routes connected to others.
--   from: routes and/or whole maps.  in: the maps to pick from (default: the from routes' maps).
--   mode 'touching' = street lines within 60 m of the from set; 'half' = the nearer half of the in-maps' routes;
--   'all' = every route in the in-maps (nearest first). Each with its distance, open prebooks, and who has it today.
create or replace function public.benny_connected(p_center uuid, p_from_routes text[] default null, p_from_maps text[] default null,
                                                   p_in_maps text[] default null, p_mode text default 'touching')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_from text[]; v_from_maps text[] := benny_resolve_maps(p_from_maps); v_in text[]; g geometry; v_live date := benny_live_date(p_center);
        v jsonb; n int;
begin
  perform benny_ok_any(p_center);
  select coalesce(array_agg(distinct route_code), '{}') into v_from from route_maps
   where status = 'approved' and (upper(route_code) = any (select upper(x) from unnest(coalesce(p_from_routes, '{}')) x) or area_name = any (v_from_maps));
  if cardinality(v_from) = 0 and coalesce(p_mode, '') <> 'all' then return jsonb_build_object('error', 'No routes or maps found to start from'); end if;
  v_in := case when p_in_maps is not null and cardinality(p_in_maps) > 0 then benny_resolve_maps(p_in_maps)
               else (select coalesce(array_agg(distinct area_name), '{}') from route_maps where route_code = any (v_from) and status = 'approved') end;
  select st_collect(benny_route_geom(x)) into g from unnest(v_from) x;
  with c as (
    select rm.route_code, rm.area_name, rm.route_number,
           case when g is null then null else round(st_distance(benny_route_geom(rm.route_code)::geography, g::geography))::int end dist
      from route_maps rm
     where rm.status = 'approved' and rm.area_name = any (v_in) and not (rm.route_code = any (v_from))),
  ranked as (select c.*, row_number() over (order by dist nulls last, route_number) rn, count(*) over () total from c)
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'route', r.route_code, 'map', r.area_name, 'distance_m', r.dist, 'touching', r.dist is not null and r.dist <= 60,
           'open_prebooks', (select count(*) from mb_bookings b join mb_lists l on l.id = b.list_id where l.center_id = p_center and b.route_code = r.route_code and b.status = 'open'),
           'today', case when v_live is null then null else (select jsonb_build_object('manager', rt.manager_id, 'workers', rt.assigned_worker_ids)
                       from routes rt where rt.route_code = r.route_code and rt.session_date = v_live and rt.command_center_id = p_center limit 1) end))
           order by r.rn), '[]'), max(r.total)
    into v, n
    from ranked r
   where case coalesce(p_mode, 'touching')
           when 'all' then true
           when 'half' then r.rn <= ceil(r.total / 2.0)
           else r.dist <= 60 end;
  return jsonb_build_object('from', to_jsonb(v_from), 'in_maps', to_jsonb(v_in), 'mode', coalesce(p_mode, 'touching'), 'of', coalesce(n, 0), 'routes', v);
end $$;

-- Today's live team (the old app's open day): carts and their workers, the manager's routes and who has them,
-- the route managers on the day. p_manager = an old-app manager id (rm_…) or null (route managers: their own team).
create or replace function public.benny_live(p_center uuid, p_manager text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_date date := benny_live_date(p_center); v_mine text[] := benny_my_rm_ids(p_center); v_mgrs text[];
begin
  if v_date is null then return jsonb_build_object('live', false); end if;
  v_mgrs := case when p_manager is not null then array[p_manager] else v_mine end;   -- null = everyone (admins)
  if v_mine is not null and p_manager is not null and not (p_manager = any (v_mine)) then raise exception 'That isn’t your team' using errcode = '42501'; end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'live', true, 'date', v_date,
    'managers', (select jsonb_agg(jsonb_build_object('id', u.user_id, 'name', u.name) order by u.name) from users u where u.command_center_id = p_center and u.role = 'RouteManager'),
    'carts', (select jsonb_agg(x order by x->>'manager', x->>'workers') from (
        select jsonb_build_object('cart_id', l.id,
                 'manager', (select u.metadata->>'assignedManagerId' from users u where u.user_id = l.worker_id and u.command_center_id = p_center),
                 'workers', (select jsonb_agg(jsonb_build_object('cn', u.user_id, 'name', u.name) order by u.name) from users u
                              where u.command_center_id = p_center and u.user_id = any (coalesce(nullif(l.team_worker_ids, '{}'), array[l.worker_id]))),
                 'routes', (select jsonb_agg(rt.route_code order by rt.route_code) from routes rt where rt.session_date = v_date and rt.command_center_id = p_center
                              and rt.assigned_worker_ids && coalesce(nullif(l.team_worker_ids, '{}'), array[l.worker_id]))) x
          from logsheet_sessions l where l.date = v_date and l.command_center_id = p_center) c
       where v_mgrs is null or x->>'manager' = any (v_mgrs)),
    'routes', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('route', rt.route_code, 'manager', rt.manager_id,
                    'workers', (select jsonb_agg(u.name) from users u where u.command_center_id = p_center and u.user_id = any (rt.assigned_worker_ids)),
                    'split', exists (select 1 from route_splits s where s.route_code = rt.route_code and s.session_date = v_date and s.command_center_id = p_center::text)))
                  order by rt.route_code)
                 from routes rt where rt.session_date = v_date and rt.command_center_id = p_center and (v_mgrs is null or rt.manager_id = any (v_mgrs)))));
end $$;

-- A worker on today's live day by CN or name (internal). Returns a match, or candidates when several match.
create or replace function public.benny_live_worker(p_center uuid, p_q text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare q text := trim(coalesce(p_q, '')); v_date date := benny_live_date(p_center); v jsonb; n int;
begin
  with w as (
    select u.user_id cn, u.name, u.metadata->>'assignedManagerId' manager,
           (select l.id from logsheet_sessions l where l.date = v_date and l.command_center_id = p_center
               and u.user_id = any (coalesce(nullif(l.team_worker_ids, '{}'), array[l.worker_id])) limit 1) cart_id
      from users u where u.command_center_id = p_center and u.role = 'Worker'),
  m as (select * from w where upper(cn) = upper(q)
        union all select * from w where not exists (select 1 from w w2 where upper(w2.cn) = upper(q))
                                    and (name ilike q || '%' or name ilike '% ' || q || '%' or name ilike '%' || q || '%'))
  select jsonb_agg(jsonb_build_object('cn', cn, 'name', name, 'manager', manager, 'cart_id', cart_id) order by name), count(*) into v, n from m;
  if coalesce(n, 0) = 0 then return jsonb_build_object('found', false, 'q', q); end if;
  if n > 1 then
    -- "Michael A" = first name + last initial
    select jsonb_agg(e) into v from jsonb_array_elements(v) e
     where (e->>'name') ilike split_part(q, ' ', 1) || ' ' || split_part(q, ' ', 2) || '%';
    if jsonb_array_length(coalesce(v, '[]')) <> 1 then
      return jsonb_build_object('found', false, 'q', q, 'which', (select jsonb_agg(e->>'name') from jsonb_array_elements(coalesce(v, '[]')) e)); end if;
  end if;
  return jsonb_build_object('found', true) || (v->0);
end $$;

-- Check "give <route> to <worker>'s cart" and say exactly what it would do.
create or replace function public.benny_check_give(p_center uuid, p_route text, p_worker text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_date date := benny_live_date(p_center); v_mine text[] := benny_my_rm_ids(p_center); w jsonb; rt routes; v_cart text[]; v_probs text[] := '{}';
begin
  if v_date is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('No day is live on the map yet.')); end if;
  w := benny_live_worker(p_center, p_worker);
  if not (w->>'found')::boolean then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array(case when w ? 'which' and jsonb_array_length(w->'which') > 0
      then 'Which one: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(w->'which') x) || '?' else 'No worker called “' || p_worker || '” on today’s map.' end)); end if;
  select * into rt from routes where upper(route_code) = upper(trim(p_route)) and session_date = v_date and command_center_id = p_center;
  if rt.route_code is null then v_probs := v_probs || ('Route ' || upper(p_route) || ' isn’t on today’s map. Add it from the day page first.'); end if;
  if v_mine is not null and rt.route_code is not null and not (rt.manager_id = any (v_mine)) and not ((w->>'manager') = any (v_mine)) then
    v_probs := v_probs || ('Route ' || rt.route_code || ' and ' || (w->>'name') || ' aren’t on your team.'); end if;
  if v_mine is not null and not ((w->>'manager') = any (v_mine)) then v_probs := v_probs || ((w->>'name') || ' isn’t on your team.'); end if;
  if rt.route_code is not null and exists (select 1 from route_splits s where s.route_code = rt.route_code and s.session_date = v_date and s.command_center_id = p_center::text) then
    v_probs := v_probs || ('Route ' || rt.route_code || ' is split into parts: assign its parts on the map.'); end if;
  if w->>'cart_id' is null then v_probs := v_probs || ((w->>'name') || ' isn’t on a cart yet (not signed in today).'); end if;
  select coalesce(nullif(l.team_worker_ids, '{}'), array[l.worker_id]) into v_cart from logsheet_sessions l where l.id = w->>'cart_id';
  return jsonb_strip_nulls(jsonb_build_object(
    'ok', cardinality(v_probs) = 0, 'problems', to_jsonb(v_probs), 'date', v_date,
    'route', rt.route_code, 'map', (select area_name from route_maps where route_code = rt.route_code and status = 'approved' limit 1),
    'worker', w, 'cart', (select jsonb_agg(jsonb_build_object('cn', u.user_id, 'name', u.name) order by u.name) from users u where u.command_center_id = p_center and u.user_id = any (v_cart)),
    'now', (select jsonb_agg(u.name) from users u where u.command_center_id = p_center and u.user_id = any (rt.assigned_worker_ids)),
    'route_manager', rt.manager_id,
    'open_prebooks', (select count(*) from mb_bookings b join mb_lists l on l.id = b.list_id where l.center_id = p_center and b.route_code = rt.route_code and b.status = 'open')));
end $$;

-- Check "partner <a> with <b>" (= <b> joins <a>'s cart), or "<a> on a solo cart" when p_b is null.
create or replace function public.benny_check_move(p_center uuid, p_a text, p_b text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_date date := benny_live_date(p_center); v_mine text[] := benny_my_rm_ids(p_center); a jsonb; b jsonb; v_probs text[] := '{}';
  cart_of jsonb;
begin
  if v_date is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('No day is live on the map yet.')); end if;
  a := benny_live_worker(p_center, p_a);
  b := case when p_b is null then null else benny_live_worker(p_center, p_b) end;
  foreach cart_of in array array_remove(array[a, b], null) loop
    if not (cart_of->>'found')::boolean then
      v_probs := v_probs || case when cart_of ? 'which' and jsonb_array_length(cart_of->'which') > 0
        then 'Which one: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(cart_of->'which') x) || '?'
        else 'No worker called “' || (cart_of->>'q') || '” on today’s map.' end;
    elsif cart_of->>'cart_id' is null then v_probs := v_probs || ((cart_of->>'name') || ' isn’t on a cart yet (not signed in today).');
    elsif v_mine is not null and not ((cart_of->>'manager') = any (v_mine)) then v_probs := v_probs || ((cart_of->>'name') || ' isn’t on your team.');
    end if;
  end loop;
  if b is not null and (a->>'cart_id') is not null and a->>'cart_id' = b->>'cart_id' then v_probs := v_probs || ((a->>'name') || ' and ' || (b->>'name') || ' are already on the same cart.'); end if;
  if b is null and (a->>'cart_id') is not null and (select cardinality(coalesce(nullif(team_worker_ids, '{}'), array[worker_id])) from logsheet_sessions where id = a->>'cart_id') <= 1 then
    v_probs := v_probs || ((a->>'name') || ' is already on a cart alone.'); end if;
  return jsonb_strip_nulls(jsonb_build_object('ok', cardinality(v_probs) = 0, 'problems', to_jsonb(v_probs), 'date', v_date,
    'a', a, 'b', b,
    'carts', (select jsonb_object_agg(l.id, (select jsonb_agg(u.name order by u.name) from users u where u.command_center_id = p_center
                                                and u.user_id = any (coalesce(nullif(l.team_worker_ids, '{}'), array[l.worker_id]))))
                from logsheet_sessions l where l.id in (a->>'cart_id', b->>'cart_id'))));
end $$;

-- Check a "start the day" plan and say exactly what it would do.
-- p_assign: [{ "managers": ["me" | name | username, …], "routes": ["NVN07", …] }, …]
--   one entry per manager (or per pair when p_pair), routes are codes (use benny_connected to pick them).
create or replace function public.benny_plan_day(p_center uuid, p_date date, p_assign jsonb, p_pair boolean default false)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare d days; v_probs text[] := '{}'; v_out jsonb := '[]'; e jsonb; q text; m app_users; v_ids uuid[]; v_routes text[]; v_bad text[];
        v_all_routes text[] := '{}'; v_live date := benny_live_date(p_center); v_avail uuid[];
begin
  if benny_ok_any(p_center) <> 'admin' then raise exception 'Starting the day is for super admins' using errcode = '42501'; end if;
  select * into d from days where center_id = p_center and day = p_date;
  if d.id is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Nobody is booked on ' || p_date || ' yet. Book contractors on the day first.')); end if;
  if exists (select 1 from sessions s where s.day_id = d.id) then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array('The session for ' || p_date || ' has already started.')); end if;
  select coalesce(array_agg(u.id), '{}') into v_avail from app_users u
   where u.rm_center_id = p_center and u.is_active and not exists (select 1 from manager_days_off o where o.user_id = u.id and o.day = p_date);
  for e in select * from jsonb_array_elements(coalesce(p_assign, '[]')) loop
    v_ids := '{}';
    for q in select * from jsonb_array_elements_text(coalesce(e->'managers', '[]')) loop
      m := null;
      if lower(q) in ('me', 'myself', 'i') then select * into m from app_users where id = auth.uid();
      else select * into m from app_users u where u.is_active and (lower(u.username) = lower(q) or u.full_name ilike q || '%' or u.full_name ilike '% ' || q || '%')
             order by (u.id = any (v_avail)) desc, u.full_name limit 1; end if;
      if m.id is null then v_probs := v_probs || ('No manager called “' || q || '”.');
      elsif not (m.id = any (v_avail)) then v_probs := v_probs || (m.full_name || ' isn’t a route manager available at this center on ' || p_date || '.');
      else v_ids := v_ids || m.id; end if;
    end loop;
    select coalesce(array_agg(distinct rm.route_code), '{}') into v_routes from route_maps rm
     where rm.status = 'approved' and upper(rm.route_code) in (select upper(x) from jsonb_array_elements_text(coalesce(e->'routes', '[]')) x);
    select coalesce(array_agg(x), '{}') into v_bad from jsonb_array_elements_text(coalesce(e->'routes', '[]')) x where not (upper(x) = any (select upper(r) from unnest(v_routes) r));
    if cardinality(v_bad) > 0 then v_probs := v_probs || ('Not approved routes: ' || array_to_string(v_bad, ', ')); end if;
    if v_routes && v_all_routes then v_probs := v_probs || 'A route is given to two managers.'; end if;
    v_all_routes := v_all_routes || v_routes;
    v_out := v_out || jsonb_build_object(
      'managers', (select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.full_name)) from app_users u where u.id = any (v_ids)),
      'routes', (select jsonb_agg(jsonb_build_object('code', rm.route_code, 'area', rm.area_name, 'number', rm.route_number) order by rm.area_name, rm.route_number)
                   from route_maps rm where rm.route_code = any (v_routes) and rm.status = 'approved'));
  end loop;
  if jsonb_array_length(v_out) = 0 then v_probs := v_probs || 'Say who the managers are.'; end if;
  if cardinality(v_all_routes) = 0 then v_probs := v_probs || 'Pick at least one route.'; end if;
  if v_live is not null and v_live > p_date then v_probs := v_probs || ('The live map is on ' || v_live || ', a newer day.'); end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'ok', cardinality(v_probs) = 0, 'problems', to_jsonb(v_probs), 'date', p_date, 'day_id', d.id, 'pair', coalesce(p_pair, false), 'assign', v_out,
    'booked', (select count(*) from day_roster r where r.day_id = d.id),
    'showed', (select count(*) from day_roster r where r.day_id = d.id and coalesce(r.attendance, 'showed') = 'showed'),
    'teams', (select count(distinct r.team) from day_roster r where r.day_id = d.id and r.team is not null),
    'no_team', (select count(*) from day_roster r where r.day_id = d.id and r.team is null and coalesce(r.attendance, 'showed') = 'showed'),
    'open_prebooks', (select count(*) from mb_bookings b join mb_lists l on l.id = b.list_id where l.center_id = p_center and b.status = 'open' and b.route_code = any (v_all_routes)),
    'live_map_on', v_live,
    'maps', (select jsonb_agg(distinct rm.area_name) from route_maps rm where rm.route_code = any (v_all_routes) and rm.status = 'approved')));
end $$;

-- Bug reports from the Benny: kept here; the GitHub issue and the email go out from the Benny's server.
create table if not exists public.benny_bugs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  center_id uuid,
  path text,
  title text not null,
  report jsonb not null default '{}',
  issue_url text,
  emailed_at timestamptz,
  send_error text
);
alter table public.benny_bugs enable row level security;
create policy benny_bugs_read on public.benny_bugs for select to authenticated using (coalesce(app_is_super_admin(), false));

create or replace function public.benny_bug_save(p_center uuid, p_path text, p_title text, p_report jsonb)
returns uuid language plpgsql volatile security definer set search_path to 'public' as $$
declare v uuid;
begin
  perform benny_ok_any(p_center);
  if length(trim(coalesce(p_title, ''))) = 0 then raise exception 'A bug report needs a title'; end if;
  insert into benny_bugs (center_id, path, title, report) values (p_center, left(p_path, 300), left(trim(p_title), 200), coalesce(p_report, '{}'))
  returning id into v;
  return v;
end $$;

create or replace function public.benny_bug_sent(p_id uuid, p_issue_url text, p_emailed boolean, p_error text default null)
returns void language plpgsql volatile security definer set search_path to 'public' as $$
begin
  update benny_bugs set issue_url = coalesce(p_issue_url, issue_url), emailed_at = case when p_emailed then now() else emailed_at end,
         send_error = p_error
   where id = p_id and created_by = auth.uid();
end $$;

-- Route managers can use the route, bookings and map lookups for their center too.
do $$ declare f text; src text; nsrc text; begin
  foreach f in array array['benny_route(uuid,text,date)', 'benny_bookings(uuid,text,text,text)', 'benny_map(uuid,text[],text[],boolean)'] loop
    select pg_get_functiondef(('public.' || f)::regprocedure) into src;
    nsrc := replace(src, 'perform benny_ok(p_center);', 'perform benny_ok_any(p_center);');
    if nsrc = src then raise exception 'benny_ok not found in %', f; end if;
    execute nsrc;
  end loop;
end $$;

do $g$ declare f text; begin
  foreach f in array array['benny_ok_any(uuid)', 'benny_my_rm_ids(uuid)', 'benny_connected(uuid,text[],text[],text[],text)', 'benny_live(uuid,text)',
                           'benny_check_give(uuid,text,text)', 'benny_check_move(uuid,text,text)', 'benny_plan_day(uuid,date,jsonb,boolean)',
                           'benny_bug_save(uuid,text,text,jsonb)', 'benny_bug_sent(uuid,text,boolean,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- internal helpers: only the functions above call them
  foreach f in array array['benny_route_geom(text)', 'benny_resolve_maps(text[])', 'benny_live_date(uuid)', 'benny_live_worker(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $g$;
