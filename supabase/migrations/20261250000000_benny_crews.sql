-- The Benny can split the crew between managers by how the workers have been doing, when it starts a day.
--   "Start the day, give Franklyn the worst half and me the good guys", "draft the teams between Jovan and Franklyn".
--
-- Two additions, both for super admins (starting a day is theirs):
--   * benny_crew_stats: the workers booked on a day, ranked by their average equiv per day worked this season at this
--     center (from the saved payout lines), with days worked, average steps and gross. No pay amounts.
--   * benny_plan_day takes a crew per manager (assign[].workers = names or CNs). When any manager is given a crew, every
--     worker who showed must be in exactly one: the check says who is missing, who is in two, and which roster cart the
--     split would break up. It still changes nothing: the card starts the day with the Start session code.
-- Additive only.

-- A day's roster with each worker's season so far. One place for the lookup and the plan check.
create or replace function public.benny_crew(p_center uuid, p_day uuid)
returns table (hire_id uuid, cn text, name text, team text, showed boolean, days int, avg_equiv numeric, avg_steps numeric, avg_gross numeric, last_day date)
language sql stable security definer set search_path to 'public' as $$
  select r.hire_id, h.cn, trim(p.first_name || ' ' || coalesce(p.last_name, '')), nullif(r.team, ''), coalesce(r.attendance, 'showed') = 'showed',
         coalesce(s.days, 0)::int,
         case when s.days > 0 then round(s.equiv / s.days, 2) end, case when s.days > 0 then round(s.steps / s.days, 1) end,
         case when s.days > 0 then round(s.gross / s.days, 0) end, s.last_day
    from day_roster r
    join hires h on h.id = r.hire_id
    join people p on p.id = h.person_id
    left join lateral (select count(distinct l.day) days, coalesce(sum(l.equiv), 0) equiv, coalesce(sum(l.steps), 0) steps, coalesce(sum(l.indiv_gross), 0) gross, max(l.day) last_day
                         from payout_lines l where l.hire_id = r.hire_id and l.center_id = p_center) s on true
   where r.day_id = p_day
$$;
revoke all on function public.benny_crew(uuid, uuid) from public, anon, authenticated;

-- The workers booked on a day, best first by average equiv per day worked. Super admins only.
create or replace function public.benny_crew_stats(p_center uuid, p_date date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare d days;
begin
  perform benny_ok(p_center);
  select * into d from days where center_id = p_center and day = p_date;
  if d.id is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Nobody is booked on ' || p_date || ' yet.')); end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'date', p_date,
    'ranked_by', 'average equiv per day worked this season at this center, best first',
    'ranked', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('rank', z.rk, 'name', z.name, 'cn', z.cn, 'days', z.days, 'avg_equiv', z.avg_equiv, 'avg_steps', z.avg_steps,
                                  'avg_gross', z.avg_gross, 'last_day', z.last_day, 'roster_cart', z.team)) order by z.rk)
                 from (select c.*, row_number() over (order by c.avg_equiv desc, c.avg_gross desc, c.name) rk from benny_crew(p_center, d.id) c where c.showed and c.days > 0) z),
    'no_days_yet', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', c.name, 'cn', c.cn, 'roster_cart', c.team)) order by c.name) from benny_crew(p_center, d.id) c where c.showed and c.days = 0),
    'no_shows', (select jsonb_agg(c.name order by c.name) from benny_crew(p_center, d.id) c where not c.showed),
    'counts', (select jsonb_build_object('booked', count(*), 'showed', count(*) filter (where c.showed), 'ranked', count(*) filter (where c.showed and c.days > 0),
                                         'no_days_yet', count(*) filter (where c.showed and c.days = 0)) from benny_crew(p_center, d.id) c)));
end $$;
revoke all on function public.benny_crew_stats(uuid, date) from public, anon;
grant execute on function public.benny_crew_stats(uuid, date) to authenticated;

-- Check a plan to start the day. Each entry of p_assign: { managers, maps and/or routes, workers? }.
create or replace function public.benny_plan_day(p_center uuid, p_date date, p_assign jsonb, p_pair boolean default false)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare d days; v_probs text[] := '{}'; v_out jsonb := '[]'; e jsonb; q text; m app_users; v_ids uuid[]; v_routes text[]; v_bad text[]; v_emaps text[];
        v_all_routes text[] := '{}'; v_live date := benny_live_date(p_center); v_avail uuid[];
        v_crewed boolean; v_roster jsonb; v_crew uuid[]; v_placed uuid[] := '{}'; v_where jsonb := '{}'::jsonb; v_notes text[] := '{}';
        v_hit uuid; v_name text; n_hit int; v_which text; v_i int := 0; best real; second real;
begin
  if benny_ok_any(p_center) <> 'admin' then raise exception 'Starting the day is for super admins' using errcode = '42501'; end if;
  select * into d from days where center_id = p_center and day = p_date;
  if d.id is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Nobody is booked on ' || p_date || ' yet. Book contractors on the day first.')); end if;
  if exists (select 1 from sessions s where s.day_id = d.id) then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array('The session for ' || p_date || ' has already started.')); end if;
  select coalesce(array_agg(u.id), '{}') into v_avail from app_users u
   where u.rm_center_id = p_center and u.is_active and not exists (select 1 from manager_days_off o where o.user_id = u.id and o.day = p_date);
  -- crews: only when a manager was given one
  v_crewed := exists (select 1 from jsonb_array_elements(coalesce(p_assign, '[]')) x where jsonb_typeof(x->'workers') = 'array' and jsonb_array_length(x->'workers') > 0);
  if v_crewed then
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_roster from benny_crew(p_center, d.id) c;
  end if;

  for e in select * from jsonb_array_elements(coalesce(p_assign, '[]')) loop
    v_ids := '{}'; v_crew := '{}';
    for q in select * from jsonb_array_elements_text(coalesce(e->'managers', '[]')) loop
      m := null;
      if lower(q) in ('me', 'myself', 'i') then select * into m from app_users where id = auth.uid();
      else select * into m from app_users u where u.is_active and (lower(u.username) = lower(q) or u.full_name ilike q || '%' or u.full_name ilike '% ' || q || '%')
             order by (u.id = any (v_avail)) desc, u.full_name limit 1;
        if m.id is null then
          select * into m from app_users u where u.id = any (v_avail) and benny_person_score(q, u.full_name) >= 0.55
           order by benny_person_score(q, u.full_name) desc limit 1;
        end if; end if;
      if m.id is null then v_probs := v_probs || ('No manager called “' || q || '”.');
      elsif not (m.id = any (v_avail)) then v_probs := v_probs || (m.full_name || ' isn’t a route manager available at this center on ' || p_date || '.');
      else v_ids := v_ids || m.id; end if;
    end loop;
    v_emaps := benny_resolve_maps(array(select jsonb_array_elements_text(coalesce(e->'maps', '[]'))));
    select coalesce(array_agg(distinct rm.route_code), '{}') into v_routes from route_maps rm
     where rm.status = 'approved' and (upper(rm.route_code) in (select upper(x) from jsonb_array_elements_text(coalesce(e->'routes', '[]')) x)
            or rm.area_name = any (v_emaps));
    select coalesce(array_agg(x), '{}') into v_bad from jsonb_array_elements_text(coalesce(e->'routes', '[]')) x where not (upper(x) = any (select upper(r) from unnest(v_routes) r));
    if cardinality(v_bad) > 0 then v_probs := v_probs || ('Not approved routes: ' || array_to_string(v_bad, ', ')); end if;
    if v_routes && v_all_routes then v_probs := v_probs || 'A route is given to two managers.'; end if;
    v_all_routes := v_all_routes || v_routes;

    -- this manager's crew: each name or CN is one worker who showed on the day's roster
    if v_crewed then
      for q in select trim(x) from jsonb_array_elements_text(case when jsonb_typeof(e->'workers') = 'array' then e->'workers' else '[]'::jsonb end) x where trim(x) <> '' loop
        v_hit := null; v_which := null;
        select count(*), min(c.hire_id::text)::uuid into n_hit, v_hit
          from jsonb_to_recordset(v_roster) as c(hire_id uuid, cn text, name text, showed boolean) where upper(c.cn) = upper(q) or lower(c.name) = lower(q);
        if n_hit = 0 then
          select count(*), min(c.hire_id::text)::uuid, string_agg(c.name, ', ' order by c.name) into n_hit, v_hit, v_which
            from jsonb_to_recordset(v_roster) as c(hire_id uuid, cn text, name text, showed boolean) where c.name ilike q || '%' or c.name ilike '% ' || q || '%';
        end if;
        if n_hit = 0 then   -- by sound, when one name is clearly the closest
          select count(*), max(s), (array_agg(s order by s desc))[2], (array_agg(hid order by s desc))[1] into n_hit, best, second, v_hit
            from (select c.hire_id hid, benny_person_score(q, c.name) s from jsonb_to_recordset(v_roster) as c(hire_id uuid, cn text, name text, showed boolean)) z where s >= 0.55;
          if n_hit > 1 and coalesce(second, 0) > best - 0.15 then n_hit := 0; v_hit := null; else n_hit := least(n_hit, 1); end if;
        end if;
        if n_hit = 0 or v_hit is null then v_probs := v_probs || ('No worker called “' || q || '” is booked on ' || p_date || '.');
        elsif n_hit > 1 then v_probs := v_probs || ('Which one: ' || coalesce(v_which, q) || '?');
        else
          select c.name into v_name from jsonb_to_recordset(v_roster) as c(hire_id uuid, name text) where c.hire_id = v_hit;
          if not (select c.showed from jsonb_to_recordset(v_roster) as c(hire_id uuid, showed boolean) where c.hire_id = v_hit) then
            v_probs := v_probs || (v_name || ' is marked a no-show for ' || p_date || '.');
          elsif v_hit = any (v_placed) then
            if not (v_hit = any (v_crew)) then v_probs := v_probs || (v_name || ' is in two crews.'); end if;
          else v_crew := v_crew || v_hit; v_placed := v_placed || v_hit; v_where := v_where || jsonb_build_object(v_hit::text, v_i);
          end if;
        end if;
      end loop;
    end if;

    v_out := v_out || jsonb_strip_nulls(jsonb_build_object(
      'managers', (select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.full_name)) from app_users u where u.id = any (v_ids)),
      'routes', (select jsonb_agg(jsonb_build_object('code', rm.route_code, 'area', rm.area_name, 'number', rm.route_number) order by rm.area_name, rm.route_number)
                   from route_maps rm where rm.route_code = any (v_routes) and rm.status = 'approved'),
      'crew', case when v_crewed then (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('hire_id', c.hire_id, 'cn', c.cn, 'name', c.name, 'days', c.days, 'avg_equiv', c.avg_equiv))
                                                  order by c.avg_equiv desc nulls last, c.name), '[]'::jsonb)
                                         from jsonb_to_recordset(v_roster) as c(hire_id uuid, cn text, name text, days int, avg_equiv numeric) where c.hire_id = any (v_crew)) end,
      'crew_avg', case when v_crewed then (select round(avg(c.avg_equiv), 2) from jsonb_to_recordset(v_roster) as c(hire_id uuid, days int, avg_equiv numeric) where c.hire_id = any (v_crew) and c.days > 0) end));
    v_i := v_i + 1;
  end loop;

  if jsonb_array_length(v_out) = 0 then v_probs := v_probs || 'Say who the managers are.'; end if;
  if cardinality(v_all_routes) = 0 then v_probs := v_probs || 'Pick at least one route.'; end if;
  if v_live is not null and v_live > p_date then v_probs := v_probs || ('The live map is on ' || v_live || ', a newer day.'); end if;

  if v_crewed then
    -- everyone who showed is in exactly one crew
    select string_agg(c.name, ', ' order by c.name) into v_which from jsonb_to_recordset(v_roster) as c(hire_id uuid, name text, showed boolean) where c.showed and not (c.hire_id = any (v_placed));
    if v_which is not null then v_probs := v_probs || ('Not in a crew yet: ' || v_which || '. Say who they go with.'); end if;
    -- a roster cart whose members would go to different managers is broken up: each of them gets a cart of their own
    for q, v_which in
      select c.team, string_agg(split_part(c.name, ' ', 1), ', ' order by c.name)
        from jsonb_to_recordset(v_roster) as c(hire_id uuid, name text, team text, showed boolean)
       where c.showed and c.team is not null and c.hire_id = any (v_placed)
       group by c.team having count(distinct v_where->>(c.hire_id::text)) > 1 order by 1 loop
      v_notes := v_notes || ('Roster cart ' || q || ' is split between the crews (' || v_which || '): each of them gets a cart of their own.');
    end loop;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', cardinality(v_probs) = 0, 'problems', to_jsonb(v_probs), 'date', p_date, 'day_id', d.id, 'pair', coalesce(p_pair, false), 'assign', v_out,
    'crews', case when v_crewed then true end, 'notes', case when cardinality(v_notes) > 0 then to_jsonb(v_notes) end,
    'booked', (select count(*) from day_roster r where r.day_id = d.id),
    'showed', (select count(*) from day_roster r where r.day_id = d.id and coalesce(r.attendance, 'showed') = 'showed'),
    'teams', (select count(distinct r.team) from day_roster r where r.day_id = d.id and r.team is not null),
    'no_team', (select count(*) from day_roster r where r.day_id = d.id and r.team is null and coalesce(r.attendance, 'showed') = 'showed'),
    'open_prebooks', (select count(*) from mb_bookings b join mb_lists l on l.id = b.list_id where l.center_id = p_center and b.status = 'open' and b.route_code = any (v_all_routes)),
    'live_map_on', v_live,
    'maps', (select jsonb_agg(distinct rm.area_name) from route_maps rm where rm.route_code = any (v_all_routes) and rm.status = 'approved')));
end $$;
