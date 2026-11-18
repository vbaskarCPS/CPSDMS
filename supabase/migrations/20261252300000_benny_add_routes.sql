-- The Benny: add whole maps and/or routes to a manager on the live day, for the person to confirm on a card. Only adds:
-- a route another manager already has is left off, never moved. For people with Workerbook (the same as the Session
-- details screen, "Add routes to the live session", which the app's save is shared with). Changes nothing itself.
--
-- benny_check_add_routes(center, manager ('me' or a name), maps, routes) → which routes are new for that manager, which
-- they already have, which another manager holds, and the open prebooks on the new ones.
create or replace function public.benny_check_add_routes(p_center uuid, p_manager text, p_maps text[] default null, p_routes text[] default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_date date; m app_users; v_rm text; v_probs text[] := '{}'; v_maps text[] := '{}'; v_hit text[]; q text; v_codes text[];
        v_bad text[]; v_new jsonb; v_mine jsonb; v_other jsonb; v_by_map jsonb;
begin
  if benny_ok_any(p_center) <> 'admin' then
    raise exception 'Adding routes to the live day needs the Workerbook permission' using errcode = '42501'; end if;
  v_date := benny_live_date(p_center);
  if v_date is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('No day is live yet. Routes for a new day are picked when it starts.')); end if;

  -- the manager: me, or a name
  q := nullif(trim(coalesce(p_manager, '')), '');
  if q is null or lower(q) in ('me', 'myself', 'i', 'mine') then select * into m from app_users where id = auth.uid();
  else
    select * into m from app_users u where u.is_active and (lower(u.username) = lower(q) or u.full_name ilike q || '%' or u.full_name ilike '% ' || q || '%')
     order by (u.rm_center_id = p_center) desc, u.full_name limit 1;
    if m.id is null then
      select * into m from app_users u where u.is_active and u.rm_center_id = p_center and benny_person_score(q, u.full_name) >= 0.55
       order by benny_person_score(q, u.full_name) desc limit 1;
    end if;
  end if;
  if m.id is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('No manager called “' || q || '”.')); end if;
  v_rm := 'rm_' || regexp_replace(lower(m.full_name), '[^a-z0-9]', '', 'g');
  if not exists (select 1 from users u where u.user_id = v_rm and u.command_center_id = p_center and u.role = 'RouteManager') then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array(m.full_name || ' isn’t a route manager on this center’s live map.'));
  end if;

  -- the maps, one by one, so a map that isn't found or is unclear is said
  foreach q in array coalesce(p_maps, '{}') loop
    continue when nullif(trim(q), '') is null;
    v_hit := benny_resolve_maps(array[q]);
    if cardinality(v_hit) = 0 then v_probs := v_probs || ('No map called “' || q || '”.');
    elsif cardinality(v_hit) > 1 then v_probs := v_probs || ('Which map for “' || q || '”: ' || array_to_string(v_hit, ', ') || '?');
    else v_maps := v_maps || v_hit; end if;
  end loop;
  select coalesce(array_agg(distinct rm.route_code), '{}') into v_codes from route_maps rm
   where rm.status = 'approved' and (rm.area_name = any (v_maps) or upper(rm.route_code) in (select upper(trim(x)) from unnest(coalesce(p_routes, '{}')) x));
  select coalesce(array_agg(x), '{}') into v_bad from unnest(coalesce(p_routes, '{}')) x
   where nullif(trim(x), '') is not null and not (upper(trim(x)) = any (select upper(c) from unnest(v_codes) c));
  if cardinality(v_bad) > 0 then v_probs := v_probs || ('Not approved routes: ' || array_to_string(v_bad, ', ') || '.'); end if;
  if cardinality(v_codes) = 0 and cardinality(v_probs) = 0 then v_probs := v_probs || 'Name a map or some routes to add.'::text; end if;
  if cardinality(v_probs) > 0 then return jsonb_build_object('ok', false, 'problems', to_jsonb(v_probs), 'manager', m.full_name); end if;

  -- each route: new, already theirs, or another manager's (left off)
  with r as (
    select rm.route_code code, rm.area_name area, rm.route_number num, lr.manager_id owner,
           (select u.name from users u where u.user_id = lr.manager_id and u.command_center_id = p_center) owner_name
      from route_maps rm
      left join routes lr on lr.route_code = rm.route_code and lr.session_date = v_date and lr.command_center_id = p_center
     where rm.status = 'approved' and rm.route_code = any (v_codes))
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'area', area, 'number', num) order by area, num) filter (where owner is null), '[]'),
         coalesce(jsonb_agg(code order by area, num) filter (where owner = v_rm), '[]'),
         coalesce(jsonb_agg(jsonb_build_object('code', code, 'manager', coalesce(owner_name, owner)) order by area, num) filter (where owner is not null and owner <> v_rm), '[]'),
         coalesce((select jsonb_agg(jsonb_build_object('map', area, 'total', t, 'new', n) order by area)
                     from (select area, count(*) t, count(*) filter (where owner is null) n from r group by area) z), '[]')
    into v_new, v_mine, v_other, v_by_map from r;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', jsonb_array_length(v_new) > 0,
    'problems', case when jsonb_array_length(v_new) = 0 then jsonb_build_array(case when jsonb_array_length(v_mine) > 0 and jsonb_array_length(v_other) = 0
                  then 'Those routes are already on ' || m.full_name || '’s map.' else 'None of those routes are free: they’re all on today’s map already.' end) end,
    'date', v_date, 'manager', jsonb_build_object('id', v_rm, 'name', m.full_name, 'me', m.id = auth.uid()),
    'maps', v_by_map, 'new', v_new, 'mine', v_mine, 'other', v_other,
    'open_prebooks', (select count(*) from mb_bookings b join mb_lists l on l.id = b.list_id
                       where l.center_id = p_center and b.status = 'open' and b.route_code in (select x->>'code' from jsonb_array_elements(v_new) x)),
    'stamp', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')));
end $$;
revoke all on function public.benny_check_add_routes(uuid, text, text[], text[]) from public, anon;
grant execute on function public.benny_check_add_routes(uuid, text, text[], text[]) to authenticated;

-- give-a-route: when the route isn't on today's map, say how to add it
do $do$
declare src text; was text;
begin
  src := replace(pg_get_functiondef('public.benny_check_give(uuid,text,text)'::regprocedure), E'\r', '');
  was := src;
  src := replace(src, $a$' isn’t on today’s map. Add it from the day page first.'$a$,
    $b$' isn’t on today’s map yet. Add it first: ask me to “add ' || upper(trim(p_route)) || ' to <manager>”, or Workerbook › today › Session details › Add routes to the live session.'$b$);
  if src = was then raise exception 'benny_check_give: change did not apply'; end if;
  execute src;
end $do$;
