-- The Benny can prepare taking a worker off today's live day ("remove Kenan from today, he isn't working").
--
-- A route manager asked for it by voice; the Benny had no card for it. The app can already do it by hand (route manager
-- map › the worker › Remove from session), and the card does exactly that, after the person taps it. The Benny itself
-- removes nobody: these functions check, record and confirm; the app's own remove does the work.
--
-- Removing erases the worker's logsheet for the day and anything logged on it, so it is narrow on purpose:
--   * only a worker with NOTHING logged today, on a logsheet that is not paid out;
--   * only a worker who was named exactly: a CN, a full name, or a first or last name that only one worker on the map
--     has. A name that merely sounds close ("Devante" for Kevontae), or part of a name, never makes a card: the check
--     says who is closest, and the person has to say the name;
--   * a route manager only for their own team (a floater: the teams they cover); super admins for anyone;
--   * every removal is recorded: who, when, which worker, what they had (benny_removals).
-- The roster follows, so it and the live day agree: at an in-city center the worker is marked a no-show; at a road-trip
-- center there are no no-shows, so the "showed" mark is taken off (not marked). A worker who turns up after all is put
-- back from the day page (Late arrival).
-- Additive only.

create table if not exists public.benny_removals (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null,
  day date not null,
  cn text not null,
  worker_name text,
  manager text,                      -- the old-app id of the manager whose team they were on
  cart_id text,                      -- the logsheet they were on when the card was made
  cart_mates text,                   -- who they shared it with, if anyone
  routes text[],                     -- the routes they were on
  roster_id uuid,                    -- today's roster row, when they are on the day's list
  roster_before text, roster_after text,
  by_user uuid not null, by_name text,
  state text not null default 'started' check (state in ('started', 'done', 'not_removed')),
  started_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists benny_removals_day on public.benny_removals (center_id, day, started_at desc);
alter table public.benny_removals enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'benny_removals' and policyname = 'benny_removals_read') then
    create policy benny_removals_read on public.benny_removals for select to authenticated using (coalesce(app_is_super_admin(), false));
  end if;
end $p$;
revoke all on public.benny_removals from public, anon, authenticated;
grant select on public.benny_removals to authenticated;

-- Was this worker named exactly? A CN, the full name, the first name with more of the name after it, or one whole
-- word of the name (first name, last name, either half of a double-barrelled one). "Ken" for Kenan is not exact.
create or replace function public.benny_named_exactly(p_q text, p_cn text, p_name text)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(
    upper(trim(p_q)) = upper(p_cn)
    or lower(trim(p_q)) = lower(trim(p_name))
    or lower(trim(p_q)) = any (regexp_split_to_array(lower(trim(p_name)), '\s+'))
    or lower(trim(p_q)) = any (regexp_split_to_array(lower(trim(p_name)), '[\s-]+'))
    or (lower(trim(p_name)) like lower(trim(p_q)) || '%' and lower(split_part(trim(p_q), ' ', 1)) = lower(split_part(trim(p_name), ' ', 1)) and position(' ' in trim(p_q)) > 0),
    false)
$$;

-- The check that becomes the card. p_workers = ["Kenan Francis-Bull", "I1479"]: names or CNs, eight at most.
create or replace function public.benny_check_remove(p_center uuid, p_workers jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_role text := benny_ok_any(p_center);
  v_date date := benny_live_date(p_center);
  v_mine text[] := benny_my_reach(p_center);
  v_type text; q text; w jsonb; v_cart record; v_counts jsonb; v_routes text[]; v_frees text[]; v_pre int; v_mates text[];
  v_roster record; v_then text;
  v_probs text[] := '{}'; v_seen text[] := '{}'; v_out jsonb := '[]'::jsonb; v_sig text := '';
begin
  if v_date is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('No day is live on the map yet.')); end if;
  if p_workers is null or jsonb_typeof(p_workers) <> 'array' or jsonb_array_length(p_workers) = 0 then
    return jsonb_build_object('ok', false, 'date', v_date, 'problems', jsonb_build_array('Who should come off today?')); end if;
  if jsonb_array_length(p_workers) > 8 then
    return jsonb_build_object('ok', false, 'date', v_date, 'problems', jsonb_build_array('That is a lot of people to take off at once: do up to 8 at a time.')); end if;
  select coalesce(c.center_type, 'in_city') into v_type from command_centers c where c.id = p_center;

  for q in select trim(x) from jsonb_array_elements_text(p_workers) x where trim(x) <> '' loop
    w := benny_live_worker(p_center, q);
    if not coalesce((w->>'found')::boolean, false) then
      v_probs := v_probs || case when w ? 'which' and jsonb_array_length(w->'which') > 0
        then 'Which one is “' || q || '”: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(w->'which') x) || '?'
        else 'No worker called “' || q || '” is on today’s map.' end;
      continue;
    end if;
    -- a name that only sounds close, or only part of a name, is never enough to take someone off
    if w ? 'heard_as' or not benny_named_exactly(q, w->>'cn', w->>'name') then
      v_probs := v_probs || ('Nobody on today’s map is called exactly “' || q || '”. The closest is ' || (w->>'name') || ' (' || (w->>'cn') || '): ask whether that is who they mean, and use the full name.');
      continue;
    end if;
    if (w->>'cn') = any (v_seen) then continue; end if;
    v_seen := v_seen || (w->>'cn');
    if v_mine is not null and not (coalesce(w->>'manager', '') = any (v_mine)) then
      v_probs := v_probs || ((w->>'name') || ' isn’t on your team.'); continue; end if;

    v_mates := null; v_counts := null;
    select l.id, upper(coalesce(l.status, 'OPEN')) status, coalesce(nullif(l.team_worker_ids, '{}'), array[l.worker_id]) cns into v_cart
      from logsheet_sessions l where l.id = w->>'cart_id' and l.command_center_id = p_center;
    if v_cart.id is not null then
      v_counts := benny_cart_counts(p_center, v_cart.id, v_cart.cns);
      select array_agg(u.name order by u.name) into v_mates from users u
       where u.command_center_id = p_center and u.user_id = any (v_cart.cns) and u.user_id <> (w->>'cn');
      if v_cart.status = 'PAID' then
        v_probs := v_probs || ((w->>'name') || ' is already paid out today, so they can’t be taken off from here.'); continue;
      elsif coalesce((v_counts->>'jobs')::int, 0) > 0 then
        v_probs := v_probs || ((w->>'name') || case when v_mates is null then ' has ' else '’s cart has ' end || (v_counts->>'jobs')
          || case when (v_counts->>'jobs')::int = 1 then ' job' else ' jobs' end || ' logged today, so I won’t take them off: removing erases what is logged.');
        continue;
      end if;
    end if;
    -- the app's remove erases every logsheet and job this worker has at the center, so anything outside today's cart stops it too
    if exists (select 1 from transactions t where t.command_center_id = p_center and t.worker_id = w->>'cn') then
      v_probs := v_probs || ((w->>'name') || ' has a job logged, so I won’t take them off: removing erases what is logged.'); continue; end if;
    if exists (select 1 from logsheet_sessions l where l.command_center_id = p_center and l.date is distinct from v_date
                 and (w->>'cn') = any (coalesce(nullif(l.team_worker_ids, '{}'), array[l.worker_id]))) then
      v_probs := v_probs || ((w->>'name') || ' still has a logsheet from another day here, so they can’t be taken off from here.'); continue; end if;
    -- their routes today; the ones nobody else is on go back to free
    select array_agg(r.route_code order by r.route_code), array_agg(r.route_code order by r.route_code) filter (where cardinality(r.assigned_worker_ids) = 1)
      into v_routes, v_frees
      from routes r where r.command_center_id = p_center and r.session_date = v_date and (w->>'cn') = any (r.assigned_worker_ids);
    select count(*) into v_pre from bookings b
     where b.command_center_id = p_center and b.session_date = v_date and b.status = 'pending' and b.route_number = any (coalesce(v_frees, '{}'));
    -- today's list: what the roster says now, and what it will say
    select r.id, r.attendance into v_roster from day_roster r join days d on d.id = r.day_id join hires h on h.id = r.hire_id
     where d.center_id = p_center and d.day = v_date and upper(h.cn) = upper(w->>'cn') limit 1;
    v_then := case when v_type = 'road_trip' then null else 'no_show' end;

    v_out := v_out || jsonb_strip_nulls(jsonb_build_object(
      'cn', w->>'cn', 'name', w->>'name', 'manager', w->>'manager',
      'manager_name', (select m.name from users m where m.command_center_id = p_center and m.user_id = w->>'manager' limit 1),
      'cart_id', v_cart.id, 'mates', to_jsonb(v_mates), 'routes', to_jsonb(v_routes), 'frees', to_jsonb(v_frees), 'prebooks', nullif(v_pre, 0),
      'roster', case when v_roster.id is not null then jsonb_build_object('id', v_roster.id, 'now', coalesce(v_roster.attendance, 'not marked'), 'then', coalesce(v_then, 'not marked')) end));
    v_sig := v_sig || '|' || (w->>'cn') || ':' || coalesce(v_cart.id, '-') || ':' || coalesce(v_cart.status, '-') || ':' || coalesce(v_counts->>'jobs', '0')
      || ':' || coalesce(array_to_string(v_routes, ','), '') || ':' || coalesce(array_to_string(v_cart.cns, ','), '');
  end loop;

  if cardinality(v_probs) = 0 and jsonb_array_length(v_out) = 0 then v_probs := v_probs || 'Who should come off today?'::text; end if;
  return jsonb_strip_nulls(jsonb_build_object('ok', cardinality(v_probs) = 0, 'problems', case when cardinality(v_probs) > 0 then to_jsonb(v_probs) end,
    'date', v_date, 'center_type', v_type, 'workers', case when cardinality(v_probs) = 0 then v_out end,
    'stamp', case when cardinality(v_probs) = 0 then md5(v_date::text || v_sig) end));
end $$;

-- The person tapped the card: check once more that nothing moved, and record who is about to come off.
create or replace function public.benny_remove_begin(p_center uuid, p_workers jsonb, p_stamp text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare k jsonb := benny_check_remove(p_center, p_workers); o jsonb; v_id uuid; v_ids uuid[] := '{}';
begin
  if not coalesce((k->>'ok')::boolean, false) then return k; end if;
  if (k->>'stamp') is distinct from p_stamp then
    return k || jsonb_build_object('ok', false, 'problems', jsonb_build_array('The live map changed since I checked. Ask me again.')); end if;
  for o in select * from jsonb_array_elements(k->'workers') loop
    insert into benny_removals (center_id, day, cn, worker_name, manager, cart_id, cart_mates, routes, roster_id, roster_before, by_user, by_name)
    values (p_center, (k->>'date')::date, o->>'cn', o->>'name', o->>'manager', o->>'cart_id',
            (select string_agg(x, ' + ') from jsonb_array_elements_text(coalesce(o->'mates', '[]'::jsonb)) x),
            case when o ? 'routes' then array(select jsonb_array_elements_text(o->'routes')) end,
            (o->'roster'->>'id')::uuid, o->'roster'->>'now',
            auth.uid(), (select u.full_name from app_users u where u.id = auth.uid()))
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  return k || jsonb_build_object('change_ids', to_jsonb(v_ids));
end $$;

-- The app has removed them (or failed to): look at the live day, close the records, and bring the roster in line for
-- the ones who really are off. A worker counts as off when they are no longer a worker on the day and on no logsheet.
create or replace function public.benny_remove_done(p_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare r benny_removals; v_gone boolean; v_then text; v_after text; v_out jsonb := '[]'::jsonb; v_n int := 0; v_done int := 0;
begin
  for r in select * from benny_removals where id = any (p_ids) and by_user = auth.uid() and state = 'started' and started_at > now() - interval '1 hour' order by started_at, id loop
    perform benny_ok_any(r.center_id);
    v_n := v_n + 1;
    v_gone := not exists (select 1 from users u where u.command_center_id = r.center_id and u.user_id = r.cn and u.role = 'Worker')
          and not exists (select 1 from logsheet_sessions l where l.command_center_id = r.center_id and l.date = r.day
                             and r.cn = any (coalesce(nullif(l.team_worker_ids, '{}'), array[l.worker_id])));
    v_after := r.roster_before;
    if v_gone and r.roster_id is not null then
      v_then := case when (select coalesce(c.center_type, 'in_city') from command_centers c where c.id = r.center_id) = 'road_trip' then null else 'no_show' end;
      update day_roster dr set attendance = v_then
       where dr.id = r.roster_id and dr.attendance is distinct from v_then
         and exists (select 1 from days d where d.id = dr.day_id and d.center_id = r.center_id and d.day = r.day);
      select coalesce(dr.attendance, 'not marked') into v_after from day_roster dr where dr.id = r.roster_id;
    end if;
    update benny_removals set state = case when v_gone then 'done' else 'not_removed' end, roster_after = v_after, done_at = now() where id = r.id;
    if v_gone then v_done := v_done + 1; end if;
    v_out := v_out || jsonb_strip_nulls(jsonb_build_object('id', r.id, 'cn', r.cn, 'name', r.worker_name, 'state', case when v_gone then 'done' else 'not_removed' end,
      'routes', to_jsonb(r.routes), 'roster', case when r.roster_id is not null then v_after end));
  end loop;
  return jsonb_build_object('state', case when v_n = 0 then 'unknown' when v_done = v_n then 'done' when v_done = 0 then 'not_removed' else 'partly' end, 'workers', v_out);
end $$;

revoke all on function public.benny_named_exactly(text, text, text) from public, anon;
revoke all on function public.benny_check_remove(uuid, jsonb) from public, anon;
revoke all on function public.benny_remove_begin(uuid, jsonb, text) from public, anon;
revoke all on function public.benny_remove_done(uuid[]) from public, anon;
grant execute on function public.benny_named_exactly(text, text, text) to authenticated;
grant execute on function public.benny_check_remove(uuid, jsonb) to authenticated;
grant execute on function public.benny_remove_begin(uuid, jsonb, text) to authenticated;
grant execute on function public.benny_remove_done(uuid[]) to authenticated;
