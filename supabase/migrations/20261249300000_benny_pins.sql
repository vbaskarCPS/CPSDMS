-- The Benny on the route manager map: drop a pin by asking, and plan a drop / pickup / check order.
--   benny_check_pin    where a pin would go (a route, a worker, an address, or "here"), its name and who sees it
--   benny_plan_stops   the manager's carts in the shortest driving order, as numbered stops
-- As with every change, these only CHECK and work things out. The app drops the pins, with the map's own pin code,
-- after the person taps the card. Route managers: their own team. Super admins: the manager whose map is open.
-- Additive only.

-- Straight-line kilometres between two points.
create or replace function public.benny_km(lat1 float8, lng1 float8, lat2 float8, lng2 float8)
returns float8 language sql immutable set search_path to 'public' as $$
  select 6371 * 2 * asin(least(1, sqrt(power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))
$$;

-- The order to visit points in: nearest next, then untangled (2-opt), from a start point when there is one
-- (else from the stop at one end). Returns the points' positions (1-based) in visiting order.
create or replace function public.benny_order(p_lat float8[], p_lng float8[], p_slat float8 default null, p_slng float8 default null)
returns int[] language plpgsql immutable set search_path to 'public' as $$
declare n int := coalesce(cardinality(p_lat), 0); ord int[] := '{}'; used boolean[]; i int; j int; best int; bd float8; d float8;
        clat float8; clng float8; curlat float8; curlng float8; improved boolean; pass int := 0; was float8; nw float8;
        fixed boolean := p_slat is not null and p_slng is not null;
begin
  if n = 0 then return ord; end if;
  used := array_fill(false, array[n]);
  if fixed then curlat := p_slat; curlng := p_slng;
  else
    select avg(x) into clat from unnest(p_lat) x; select avg(x) into clng from unnest(p_lng) x;
    bd := -1;
    for i in 1..n loop d := benny_km(clat, clng, p_lat[i], p_lng[i]); if d > bd then bd := d; best := i; end if; end loop;
    ord := array[best]; used[best] := true; curlat := p_lat[best]; curlng := p_lng[best];
  end if;
  while cardinality(ord) < n loop
    bd := null;
    for i in 1..n loop
      if not used[i] then d := benny_km(curlat, curlng, p_lat[i], p_lng[i]); if bd is null or d < bd then bd := d; best := i; end if; end if;
    end loop;
    ord := ord || best; used[best] := true; curlat := p_lat[best]; curlng := p_lng[best];
  end loop;
  loop
    improved := false; pass := pass + 1;
    for i in 1..n - 1 loop
      for j in i + 1..n loop
        -- reversing stops i..j changes the leg into i and the leg out of j
        if i = 1 then
          if fixed then was := benny_km(p_slat, p_slng, p_lat[ord[i]], p_lng[ord[i]]); nw := benny_km(p_slat, p_slng, p_lat[ord[j]], p_lng[ord[j]]);
          else was := 0; nw := 0; end if;
        else was := benny_km(p_lat[ord[i - 1]], p_lng[ord[i - 1]], p_lat[ord[i]], p_lng[ord[i]]); nw := benny_km(p_lat[ord[i - 1]], p_lng[ord[i - 1]], p_lat[ord[j]], p_lng[ord[j]]); end if;
        if j < n then
          was := was + benny_km(p_lat[ord[j]], p_lng[ord[j]], p_lat[ord[j + 1]], p_lng[ord[j + 1]]);
          nw := nw + benny_km(p_lat[ord[i]], p_lng[ord[i]], p_lat[ord[j + 1]], p_lng[ord[j + 1]]);
        end if;
        if nw < was - 1e-9 then
          ord := ord[1:i - 1] || array(select ord[x] from generate_series(i, j) x order by x desc) || ord[j + 1:n];
          improved := true;
        end if;
      end loop;
    end loop;
    exit when not improved or pass >= 30;
  end loop;
  return ord;
end $$;

-- Where a route can be driven to: the point on its streets nearest its middle.
create or replace function public.benny_route_point(p_code text)
returns geometry language sql stable security definer set search_path to 'public' as $$
  select st_closestpoint(x.g, st_centroid(x.g)) from (select benny_route_geom(p_code) g) x where x.g is not null
$$;

-- Whose pins these are. A route manager: their own, for their team (and anyone they float for).
-- A super admin: the manager whose map is open.
create or replace function public.benny_pin_manager(p_center uuid, p_manager text, out manager text, out team text[], out problem text)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_mine text[];
begin
  if benny_ok_any(p_center) = 'rm' then
    v_mine := benny_my_rm_ids(p_center); manager := v_mine[1]; team := v_mine; return;
  end if;
  if nullif(trim(coalesce(p_manager, '')), '') is null then
    problem := 'Open a route manager’s map first: pins live on a manager’s map.'; return; end if;
  if not exists (select 1 from users u where u.user_id = p_manager and u.command_center_id = p_center) then
    problem := 'That manager isn’t in this center.'; return; end if;
  manager := p_manager;
  team := array[p_manager] || coalesce((select array_agg(x) from users u,
            jsonb_array_elements_text(case when jsonb_typeof(u.metadata->'floatingFor') = 'array' then u.metadata->'floatingFor' else '[]'::jsonb end) x
           where u.user_id = p_manager and u.command_center_id = p_center), '{}');
end $$;

-- Today's carts for a team (null = every cart), each with where it can be found: its first route, and where it is now
-- (the newer of a phone's position and the house of its last knock: the same rule as the map's cart markers).
create or replace function public.benny_cart_spots(p_center uuid, p_team text[])
returns table (cart_id text, cns text[], names text[], manager text, route text, route_lat float8, route_lng float8,
               now_lat float8, now_lng float8, now_at timestamptz, now_how text)
language sql stable security definer set search_path to 'public' as $$
  with d as (select benny_live_date(p_center) dt),
  carts as (
    select l.id::text cart_id, coalesce(nullif(l.team_worker_ids, '{}'), array[l.worker_id]) cns,
           (select u.metadata->>'assignedManagerId' from users u where u.user_id = l.worker_id and u.command_center_id = p_center) manager
      from logsheet_sessions l, d
     where l.date = d.dt and l.command_center_id = p_center),
  mine as (select * from carts c where p_team is null or c.manager = any (p_team)),
  r as (
    select c.*, (select rt.route_code from routes rt, d where rt.session_date = d.dt and rt.command_center_id = p_center
                    and rt.assigned_worker_ids && c.cns order by rt.route_code limit 1) route
      from mine c),
  rp as (select r.*, benny_route_point(r.route) pt from r),
  gps as (
    select distinct on (c.cart_id) c.cart_id, wl.lat, wl.lng, wl.updated_at
      from mine c join worker_locations wl on wl.worker_id = any (c.cns) and wl.command_center_id::text = p_center::text
     where wl.updated_at > now() - interval '45 minutes' and wl.lat is not null
     order by c.cart_id, wl.updated_at desc),
  knock as (
    select distinct on (c.cart_id) c.cart_id, rh.lat, rh.lng, hd.updated_at
      from mine c join house_dispositions hd on (hd.worker_id = any (c.cns) or hd.session_id = c.cart_id) and hd.command_center_id = p_center::text
      join route_houses rh on rh.route_code = hd.route_code and rh.house_key = hd.house_key
     where hd.updated_at > now() - interval '4 hours' and rh.lat is not null
     order by c.cart_id, hd.updated_at desc)
  select rp.cart_id, rp.cns,
         (select array_agg(u.name order by u.name) from users u where u.command_center_id = p_center and u.user_id = any (rp.cns)),
         rp.manager, rp.route, st_y(rp.pt), st_x(rp.pt),
         case when g.updated_at is not null and (k.updated_at is null or g.updated_at >= k.updated_at) then g.lat else k.lat end,
         case when g.updated_at is not null and (k.updated_at is null or g.updated_at >= k.updated_at) then g.lng else k.lng end,
         greatest(g.updated_at, k.updated_at),
         case when g.updated_at is not null and (k.updated_at is null or g.updated_at >= k.updated_at) then 'phone' when k.updated_at is not null then 'knock' end
    from rp left join gps g on g.cart_id = rp.cart_id left join knock k on k.cart_id = rp.cart_id
$$;

-- Check one pin: where it goes, what it is called and who sees it. Changes nothing.
-- p_place: { route: "NDEL32" } | { worker: "Kyle" } | { address: "10992 Brandy Dr" } | { here: true }
-- p_see: me (default) | everyone | manager (p_to = the manager) | driver (p_to = the worker driver: a stop on their queue)
create or replace function public.benny_check_pin(p_center uuid, p_manager text, p_place jsonb, p_label text default null,
                                                  p_see text default 'me', p_to text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare m record; v_date date := benny_live_date(p_center); pl jsonb := coalesce(p_place, '{}'::jsonb); v_probs text[] := '{}';
        v_lat float8; v_lng float8; v_at text; v_route text; v_map text; v_default text;
        v_label text := nullif(trim(coalesce(p_label, '')), '');
        v_see text := lower(trim(coalesce(p_see, 'me'))); v_to text := nullif(trim(coalesce(p_to, '')), '');
        v_vis text; v_seen text; v_tm text; v_tm_name text; v_tw text; v_tw_name text;
        w jsonb; f jsonb; s record; q text; pt geometry; n int; v_house text; v_norm text; v_first text; v_which text;
begin
  select * into m from benny_pin_manager(p_center, p_manager);
  if m.problem is not null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array(m.problem)); end if;
  if v_date is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('No day is live on the map yet, so there’s no map to pin.')); end if;

  -- where
  if nullif(trim(pl->>'route'), '') is not null then
    v_route := upper(regexp_replace(pl->>'route', '\s', '', 'g'));
    pt := benny_route_point(v_route);
    if pt is null then v_probs := v_probs || ('Route ' || v_route || ' isn’t on a built map.'); v_route := null;
    else v_lat := st_y(pt); v_lng := st_x(pt); v_at := 'on ' || v_route; v_default := v_route; end if;
  elsif nullif(trim(pl->>'worker'), '') is not null then
    w := benny_live_worker(p_center, pl->>'worker');
    if not coalesce((w->>'found')::boolean, false) then
      v_probs := v_probs || (case when w ? 'which' and jsonb_array_length(w->'which') > 0 then 'Which one: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(w->'which') x) || '?'
                                  else 'No worker called “' || (pl->>'worker') || '” on today’s map.' end);
    elsif not ((w->>'manager') = any (m.team)) then v_probs := v_probs || ((w->>'name') || ' isn’t on this team.');
    else
      v_first := split_part(w->>'name', ' ', 1);
      select * into s from benny_cart_spots(p_center, m.team) c where (w->>'cn') = any (c.cns) limit 1;
      if s.now_lat is not null then
        v_lat := s.now_lat; v_lng := s.now_lng; v_route := s.route;
        v_at := 'where ' || v_first || case s.now_how when 'phone' then '’s phone was ' else ' last knocked, ' end || greatest(0, round(extract(epoch from now() - s.now_at) / 60))::int || ' min ago';
      elsif s.route_lat is not null then v_lat := s.route_lat; v_lng := s.route_lng; v_route := s.route; v_at := 'on ' || v_first || '’s route ' || s.route;
      else v_probs := v_probs || ('I don’t know where ' || v_first || ' is: no route, knock or phone location yet.'); end if;
      v_default := v_first;
    end if;
  elsif nullif(trim(pl->>'address'), '') is not null then
    -- a booking's address first, then any house on this center's built routes (the team's routes today win a tie)
    f := benny_booking_find(p_center, pl->>'address');
    if coalesce((f->>'found')::boolean, false) and (f->'booking'->>'lat') is not null then
      v_lat := (f->'booking'->>'lat')::float8; v_lng := (f->'booking'->>'lng')::float8; v_route := f->'booking'->>'route';
      v_at := 'at ' || (f->'booking'->>'address'); v_default := f->'booking'->>'address';
    else
      q := trim(regexp_replace(split_part(pl->>'address', ',', 1), '\s+', ' ', 'g'));
      if split_part(q, ' ', 1) ~ '^[0-9]{1,7}[A-Za-z]?$' and nullif(trim(substr(q, length(split_part(q, ' ', 1)) + 1)), '') is not null then
        v_house := regexp_replace(split_part(q, ' ', 1), '\D', '', 'g'); v_norm := norm_street(substr(q, length(split_part(q, ' ', 1)) + 1));
        select count(*), min(z.lat), min(z.lng), min(z.route_code), min(z.addr), string_agg(z.addr || ' (' || z.route_code || ')', '; ' order by z.route_code)
          into n, v_lat, v_lng, v_route, v_default, v_which
          from (select h.*, bool_or(h.today) over () any_today from (
                  select rh.lat, rh.lng, rh.route_code, rh.civic_no || coalesce(rh.civic_suffix, '') || ' ' || rh.street_name addr,
                         exists (select 1 from routes rt where rt.session_date = v_date and rt.command_center_id = p_center and rt.route_code = rh.route_code and rt.manager_id = any (m.team)) today
                    from route_houses rh join route_maps rm on rm.route_code = rh.route_code and rm.status = 'approved'
                    join map_area_centers mc on mc.area_name = rm.area_name and mc.center_id = p_center
                   where rh.civic_no = v_house::int and rh.lat is not null
                     and (rh.street_norm = v_norm or rh.street_norm like v_norm || ' %')) h) z
         where z.today or not z.any_today;
        if coalesce(n, 0) = 1 then v_at := 'at ' || v_default;
        elsif coalesce(n, 0) > 1 then v_probs := v_probs || ('Which one: ' || v_which || '?'); v_lat := null; v_lng := null; v_route := null;
        else v_probs := v_probs || ('I can’t find “' || q || '” on this center’s maps. Name a route or a worker instead.'); end if;
      else v_probs := v_probs || 'Give me the house number and street, like “10992 Brandy Dr”.'::text; end if;
    end if;
  elsif coalesce((pl->>'here')::boolean, false) then
    select ml.lat, ml.lng into v_lat, v_lng from manager_locations ml
     where ml.manager_id = m.manager and ml.command_center_id::text = p_center::text and ml.updated_at > now() - interval '15 minutes';
    if v_lat is null then v_probs := v_probs || 'I don’t have your location right now. Name a route, a worker or an address instead.'::text;
    else v_at := 'where you are'; v_default := 'Meet here'; end if;
  else
    v_probs := v_probs || 'Where should it go? A route, a worker, an address, or “here”.'::text;
  end if;

  -- who sees it (the map's own four choices)
  if v_see in ('me', 'just me', 'private', '') then v_vis := 'private'; v_seen := 'Just you';
  elsif v_see in ('everyone', 'all', 'team') then v_vis := 'all'; v_seen := 'Every manager in this center';
  elsif v_see = 'manager' then
    v_vis := 'manager';
    select count(*), min(u.user_id), min(u.name) into n, v_tm, v_tm_name from users u
     where u.command_center_id = p_center and u.role = 'RouteManager' and v_to is not null and u.name ilike '%' || v_to || '%';
    if coalesce(n, 0) <> 1 then
      v_probs := v_probs || ('Which manager should get it: ' || coalesce((select string_agg(u.name, ', ' order by u.name) from users u where u.command_center_id = p_center and u.role = 'RouteManager'), 'nobody is set up') || '?');
    else v_seen := 'Sent to ' || v_tm_name; end if;
  elsif v_see in ('driver', 'worker') then
    v_vis := 'worker';
    w := case when v_to is null then jsonb_build_object('found', false) else benny_live_worker(p_center, v_to) end;
    if not coalesce((w->>'found')::boolean, false) then
      v_probs := v_probs || (case when w ? 'which' and jsonb_array_length(w->'which') > 0 then 'Which driver: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(w->'which') x) || '?'
                                  else 'Which worker driver is the stop for?' end);
    else v_tw := w->>'cn'; v_tw_name := w->>'name'; v_seen := 'A driver stop for ' || v_tw_name || ': it goes on their map logsheet, at the end of their queue'; end if;
  else v_probs := v_probs || 'Who should see it: just you, everyone, one manager, or a worker driver?'::text;
  end if;

  -- the map to show it on: the route's, else the map of the nearest built house, else the team's first route today
  select rm.area_name into v_map from route_maps rm
   where rm.status = 'approved' and rm.route_code = coalesce(v_route,
           (select rh.route_code from route_houses rh where v_lat is not null
             order by st_setsrid(st_makepoint(rh.lng, rh.lat), 4326) <-> st_setsrid(st_makepoint(v_lng, v_lat), 4326) limit 1),
           (select rt.route_code from routes rt where rt.session_date = v_date and rt.command_center_id = p_center
               and rt.manager_id = any (m.team) order by rt.route_code limit 1)) limit 1;
  v_label := left(coalesce(v_label, v_default, 'Pin'), 40);

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', cardinality(v_probs) = 0, 'problems', to_jsonb(v_probs), 'date', v_date, 'manager', m.manager,
    'label', v_label, 'lat', v_lat, 'lng', v_lng, 'at', v_at, 'visibility', v_vis, 'seen_by', v_seen,
    'target_manager', v_tm, 'target_worker', v_tw, 'map', v_map, 'route', v_route,
    'pin', case when v_lat is not null then jsonb_build_object('lat', v_lat, 'lng', v_lng, 'label', v_label, 'route', v_route) end));
end $$;

-- Plan a drop, pickup or check order: the team's carts as numbered stops in the shortest driving order (straight
-- lines), from where the manager is when their location is known. Changes nothing.
--   drop   = each cart's route          pickup, check = where each cart is now, else its route
create or replace function public.benny_plan_stops(p_center uuid, p_manager text, p_kind text, p_only text[] default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare m record; v_date date := benny_live_date(p_center); v_kind text := lower(trim(coalesce(p_kind, ''))); v_word text;
        v_only text[] := '{}'; w jsonb; q text; v_probs text[] := '{}'; v_left text[] := '{}';
        v_lat float8[] := '{}'; v_lng float8[] := '{}'; v_meta jsonb := '[]'; s record; slat float8; slng float8; ord int[];
        v_stops jsonb := '[]'; i int; km float8 := 0; plat float8; plng float8; how text; e jsonb; n_old int; n_carts int := 0; v_first text;
begin
  select * into m from benny_pin_manager(p_center, p_manager);
  if m.problem is not null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array(m.problem)); end if;
  if v_date is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('No day is live on the map yet.')); end if;
  if v_kind not in ('drop', 'pickup', 'check') then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array('I can plan a drop order, a pickup order or a check order.')); end if;
  v_word := initcap(v_kind);

  foreach q in array coalesce(p_only, '{}') loop
    continue when nullif(trim(coalesce(q, '')), '') is null;
    w := benny_live_worker(p_center, q);
    if coalesce((w->>'found')::boolean, false) then v_only := v_only || (w->>'cn');
    else v_probs := v_probs || (case when w ? 'which' and jsonb_array_length(w->'which') > 0 then 'Which one: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(w->'which') x) || '?'
                                     else 'No worker called “' || q || '” on today’s map.' end); end if;
  end loop;
  if cardinality(v_probs) > 0 then return jsonb_build_object('ok', false, 'problems', to_jsonb(v_probs)); end if;

  for s in select * from benny_cart_spots(p_center, m.team) c where cardinality(v_only) = 0 or c.cns && v_only order by c.names loop
    n_carts := n_carts + 1;
    v_first := (select string_agg(split_part(nm, ' ', 1), ' + ') from unnest(s.names) nm);
    if v_kind <> 'drop' and s.now_lat is not null then plat := s.now_lat; plng := s.now_lng; how := s.now_how;
    elsif s.route_lat is not null then plat := s.route_lat; plng := s.route_lng; how := 'route';
    else
      v_left := v_left || (v_first || case when s.route is null then ' (no route yet)' else ' (route ' || s.route || ' has no map)' end);
      continue;
    end if;
    v_lat := v_lat || plat; v_lng := v_lng || plng;
    v_meta := v_meta || jsonb_strip_nulls(jsonb_build_object('who', v_first, 'route', s.route, 'by', how, 'lat', plat, 'lng', plng,
                'age_min', case when how <> 'route' then greatest(0, round(extract(epoch from now() - s.now_at) / 60))::int end,
                -- a cart with no route of its own: the route of the nearest built house, so the map has streets to draw around it
                'near', case when s.route is null then (select rh.route_code from route_houses rh
                                                         order by st_setsrid(st_makepoint(rh.lng, rh.lat), 4326) <-> st_setsrid(st_makepoint(plng, plat), 4326) limit 1) end));
  end loop;
  if cardinality(v_lat) = 0 then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array(
      case when n_carts = 0 then 'No carts on this team today.' else 'None of the carts has a route or a location yet: ' || array_to_string(v_left, ', ') || '.' end));
  end if;

  select ml.lat, ml.lng into slat, slng from manager_locations ml
   where ml.manager_id = m.manager and ml.command_center_id::text = p_center::text and ml.updated_at > now() - interval '30 minutes';
  ord := benny_order(v_lat, v_lng, slat, slng);
  plat := slat; plng := slng;
  for i in 1..cardinality(ord) loop
    e := v_meta->(ord[i] - 1);
    if plat is not null then km := km + benny_km(plat, plng, (e->>'lat')::float8, (e->>'lng')::float8); end if;
    plat := (e->>'lat')::float8; plng := (e->>'lng')::float8;
    v_stops := v_stops || (e || jsonb_build_object('n', i, 'label', v_word || ' ' || i || ' · ' || (e->>'who')));
  end loop;

  -- an earlier order of the same kind is replaced, so the numbers on the map are only this order's
  select count(*) into n_old from map_pins mp
   where mp.command_center_id::text = p_center::text and mp.session_date = v_date and mp.created_by = m.manager and mp.visibility = 'private'
     and mp.label ~ ('^' || v_word || ' [0-9]+ · ');

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'problems', '[]'::jsonb, 'kind', v_kind, 'date', v_date, 'manager', m.manager,
    'start', case when slat is not null then jsonb_build_object('lat', slat, 'lng', slng) end,
    'stops', v_stops, 'left_out', to_jsonb(v_left), 'km', round(km::numeric, 1), 'replaces', nullif(n_old, 0),
    'maps', (select to_jsonb(array_agg(distinct rm.area_name)) from route_maps rm
              where rm.status = 'approved' and rm.route_code in (select coalesce(x->>'route', x->>'near') from jsonb_array_elements(v_stops) x)),
    'routes', (select jsonb_agg(distinct x->>'route') from jsonb_array_elements(v_stops) x where x->>'route' is not null)));
end $$;

-- the helpers are for the two checks only; the checks are for signed-in people (each works out who is asking)
do $g$ declare f text; begin
  foreach f in array array['benny_km(float8,float8,float8,float8)', 'benny_order(float8[],float8[],float8,float8)', 'benny_route_point(text)',
                           'benny_pin_manager(uuid,text)', 'benny_cart_spots(uuid,text[])'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['benny_check_pin(uuid,text,jsonb,text,text,text)', 'benny_plan_stops(uuid,text,text,text[])'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $g$;
