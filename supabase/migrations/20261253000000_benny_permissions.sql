-- The Benny follows the app's own permissions (User Management), not just "super admin or route manager".
--
--   route manager (Route Manager, Floater)  : their team on the live map, as before
--   admin         (Workerbook)              : the workerbook's side: the day, crew, start the day, payouts, bonuses,
--                                             a closed day's jobs, the crew's week, texts to workers, find people;
--                                             and the whole center's live day (not one team)
--                 (Master Bookings)         : one booking, changing it, the booking emails, the master maps
--   super admin   (SA · Territory)          : the master maps too;  (SA · User Management): staff contact details
--   is_super_admin                          : everything, as before
--
-- Before, anyone who wasn't is_super_admin was a plain route manager to the Benny, whatever else they could do in the app:
-- Franklyn (Route Manager + Workerbook + Master Bookings) asked "who won the day" and got a ranking it worked out itself
-- from his team's live map, because the bonus ranking was for super admins only.
--
-- Every check is in the database, as the signed-in person: the edge function only decides which tools to offer.
-- Also: the live map's equiv for a cart that is paid out is the payout's (it was the figure saved while logging, which
-- can be behind or ahead of what the payout worked out).

-- ── who may do what ──
create or replace function public.benny_can(p_what text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select auth.uid() is not null and (coalesce(app_is_super_admin(), false) or case p_what
    when 'workerbook' then coalesce(app_has_perm('workerbook'), false)
    when 'bookings'   then coalesce(app_has_perm('bookings'), false)
    when 'territory'  then coalesce(app_has_perm('sa_territory'), false)
    when 'staff'      then coalesce(app_has_perm('sa_users'), false)
    when 'rm'         then coalesce(app_has_perm('route_manager'), false) or coalesce(app_has_perm('rm_floater'), false)
    else false end)
$$;

-- … at this center: one of their own centers. A floater also reaches a center whose day is live (their map follows
-- managers anywhere), but only as a route manager: never for the workerbook or the bookings of a center that isn't theirs.
create or replace function public.benny_can_at(p_center uuid, p_what text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select benny_can(p_what) and (p_center is null or coalesce(app_can_see_center(p_center), false)
    or (p_what = 'rm' and coalesce(app_has_perm('rm_floater'), false)
        and exists (select 1 from daily_sessions d join command_centers c on c.id = d.command_center_id and not c.is_demo
                     where d.command_center_id = p_center and d.is_active)))
$$;

-- Stops unless the person has one of these at this center.
create or replace function public.benny_need(p_center uuid, variadic p_any text[]) returns void
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null or not exists (select 1 from unnest(p_any) w where benny_can_at(p_center, w)) then
    raise exception 'Not allowed' using errcode = '42501'; end if;
end $$;

-- The workerbook's side of the Benny (was: super admins only).
create or replace function public.benny_ok(p_center uuid default null) returns void
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform benny_need(p_center, 'workerbook');
end $$;

-- The live day: 'admin' sees the whole center (Workerbook, or a super admin), 'rm' their own team.
create or replace function public.benny_ok_any(p_center uuid default null) returns text
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  if benny_can_at(p_center, 'workerbook') then return 'admin'; end if;
  if benny_can_at(p_center, 'rm') then return 'rm'; end if;
  raise exception 'Not allowed' using errcode = '42501';
end $$;

-- Anyone the Benny works for at this center: the two above, and 'office' = Master Bookings (or Territory) with neither.
-- Only for what such a person may read anyway (the bookings, a route, the maps) and for the Benny's own log.
create or replace function public.benny_ok_office(p_center uuid default null) returns text
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if auth.uid() is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  if benny_can_at(p_center, 'workerbook') then return 'admin'; end if;
  if benny_can_at(p_center, 'rm') then return 'rm'; end if;
  if benny_can_at(p_center, 'bookings') or benny_can_at(p_center, 'territory') then return 'office'; end if;
  raise exception 'Not allowed' using errcode = '42501';
end $$;

-- What the edge function asks first: which tools to offer. role null = the Benny isn't for this person here.
create or replace function public.benny_who(p_center uuid default null) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'super', auth.uid() is not null and coalesce(app_is_super_admin(), false),
    'rm', benny_can_at(p_center, 'rm') and not coalesce(app_is_super_admin(), false),
    'workerbook', benny_can_at(p_center, 'workerbook'),
    'bookings', benny_can_at(p_center, 'bookings'),
    'territory', benny_can_at(p_center, 'territory'),
    'role', case when benny_can_at(p_center, 'workerbook') then 'admin' when benny_can_at(p_center, 'rm') then 'rm'
                 when benny_can_at(p_center, 'bookings') or benny_can_at(p_center, 'territory') then 'office' end)
$$;

revoke all on function public.benny_can(text) from public, anon;
revoke all on function public.benny_can_at(uuid, text) from public, anon;
revoke all on function public.benny_need(uuid, text[]) from public, anon;
revoke all on function public.benny_ok_office(uuid) from public, anon;
revoke all on function public.benny_who(uuid) from public, anon;
grant execute on function public.benny_can(text) to authenticated;
grant execute on function public.benny_can_at(uuid, text) to authenticated;
grant execute on function public.benny_need(uuid, text[]) to authenticated;
grant execute on function public.benny_ok_office(uuid) to authenticated;
grant execute on function public.benny_who(uuid) to authenticated;

-- Who has the Benny at all (the morning report): now also Workerbook and Master Bookings.
create or replace function public.benny_has(p_user uuid) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select notify_super(p_user) or notify_perm(p_user, 'route_manager') or notify_perm(p_user, 'rm_floater')
      or notify_perm(p_user, 'workerbook') or notify_perm(p_user, 'bookings')
$$;

-- ── the functions that checked for a super admin by hand ──
do $$
declare d text; n text;
  procedure_missing constant text := 'benny permissions: could not patch ';
begin
  -- readable by the office too: the bookings, a route, the maps, and the Benny's own log
  foreach n in array array['benny_bookings', 'benny_route', 'benny_map', 'benny_outlines', 'benny_bug_save', 'benny_log_save'] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = n;
    if position('benny_ok_office(p_center)' in d) = 0 then
      if position('perform benny_ok_any(p_center);' in d) = 0 then raise exception '%', procedure_missing || n; end if;
      execute replace(d, 'perform benny_ok_any(p_center);', 'perform benny_ok_office(p_center);');
    end if;
  end loop;

  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_ai_log_save';
  if position('benny_ok_office' in d) = 0 then
    if position($q$coalesce(benny_ok_any(v_center), '') not in ('admin', 'rm')$q$ in d) = 0 then raise exception '%', procedure_missing || 'benny_ai_log_save'; end if;
    execute replace(d, $q$coalesce(benny_ok_any(v_center), '') not in ('admin', 'rm')$q$, $q$coalesce(benny_ok_office(v_center), '') not in ('admin', 'rm', 'office')$q$);
  end if;

  -- one booking, and changing it: Master Bookings
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_booking';
  if position('benny_need(' in d) = 0 then
    if position($q$if benny_ok_any(p_center) <> 'admin' then raise exception 'Not allowed' using errcode = '42501'; end if;$q$ in d) = 0 then raise exception '%', procedure_missing || 'benny_booking'; end if;
    execute replace(d, $q$if benny_ok_any(p_center) <> 'admin' then raise exception 'Not allowed' using errcode = '42501'; end if;$q$, $q$perform benny_need(p_center, 'bookings');$q$);
  end if;

  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_check_booking';
  if position('benny_can_at(' in d) = 0 then
    if position($q$if benny_ok_any(p_center) <> 'admin' then$q$ in d) = 0 or position('Only super admins can change a booking from here. Use Bookings › List.' in d) = 0 then raise exception '%', procedure_missing || 'benny_check_booking'; end if;
    d := replace(d, $q$if benny_ok_any(p_center) <> 'admin' then$q$, $q$if benny_ok_office(p_center) is null or not benny_can_at(p_center, 'bookings') then$q$);
    execute replace(d, 'Only super admins can change a booking from here. Use Bookings › List.', 'Changing a booking needs the Master Bookings permission.');
  end if;

  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_check_emails';
  if position('benny_can_at(' in d) = 0 then
    if position($q$if benny_ok_any(p_center) <> 'admin' then$q$ in d) = 0 or position('Only super admins can set up booking emails from here. Use Bookings › Send booking emails.' in d) = 0 then raise exception '%', procedure_missing || 'benny_check_emails'; end if;
    d := replace(d, $q$if benny_ok_any(p_center) <> 'admin' then$q$, $q$if benny_ok_office(p_center) is null or not benny_can_at(p_center, 'bookings') then$q$);
    execute replace(d, 'Only super admins can set up booking emails from here. Use Bookings › Send booking emails.', 'Setting up booking emails needs the Master Bookings permission.');
  end if;

  -- the master maps (past clients per route): Master Bookings or Territory
  foreach n in array array['benny_maps', 'benny_maps_pcl'] loop
    select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = n;
    if position('benny_need(' in d) = 0 then
      if position('perform benny_ok(p_center);' in d) = 0 then raise exception '%', procedure_missing || n; end if;
      execute replace(d, 'perform benny_ok(p_center);', $q$perform benny_need(p_center, 'bookings', 'territory');$q$);
    end if;
  end loop;

  -- starting the day: Workerbook (benny_ok_any says 'admin' for it now)
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_plan_day';
  if position('Starting the day is for super admins' in d) > 0 then
    execute replace(d, 'Starting the day is for super admins', 'Starting the day needs the Workerbook permission');
  end if;

  -- find people: workers of the centers the person can see; staff phone numbers and emails only with User Management
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_find_people';
  if position('benny_can(''staff'')' in d) = 0 then
    if position($q$where (trim(p.first_name || ' ' || coalesce(p.last_name, '')) ilike '%' || q || '%'$q$ in d) = 0
       or position($q$from people p where benny_person_score(q, trim(p.first_name || ' ' || coalesce(p.last_name, ''))) >= 0.45$q$ in d) = 0
       or position($q$'cell', u.phone, 'email', u.email, 'super_admin', u.is_super_admin$q$ in d) = 0 then raise exception '%', procedure_missing || 'benny_find_people'; end if;
    d := replace(d, $q$where (trim(p.first_name || ' ' || coalesce(p.last_name, '')) ilike '%' || q || '%'$q$,
      $q$where (coalesce(app_is_super_admin(), false) or exists (select 1 from hires hc where hc.person_id = p.id and app_can_see_center(coalesce(hc.current_center_id, hc.center_id))))
       and (trim(p.first_name || ' ' || coalesce(p.last_name, '')) ilike '%' || q || '%'$q$);
    d := replace(d, $q$from people p where benny_person_score(q, trim(p.first_name || ' ' || coalesce(p.last_name, ''))) >= 0.45$q$,
      $q$from people p where (coalesce(app_is_super_admin(), false) or exists (select 1 from hires hc where hc.person_id = p.id and app_can_see_center(coalesce(hc.current_center_id, hc.center_id))))
         and benny_person_score(q, trim(p.first_name || ' ' || coalesce(p.last_name, ''))) >= 0.45$q$);
    execute replace(d, $q$'cell', u.phone, 'email', u.email, 'super_admin', u.is_super_admin$q$,
      $q$'cell', case when benny_can('staff') then u.phone end, 'email', case when benny_can('staff') then u.email end, 'super_admin', u.is_super_admin$q$);
  end if;

  -- the live map: a paid-out cart's equiv is the payout's
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_live';
  if position('equiv_from' in d) = 0 then
    if position($q$'equiv', round(coalesce((l.stats->>'totalEQ')::numeric, 0), 2),$q$ in d) = 0
       or position($q$'equiv_behind', case when coalesce((l.stats->>'stepCount')$q$ in d) = 0
       or position($q$(k.c->>'gross')::numeric) > 0.01 then true end,$q$ in d) = 0
       or position('cross join lateral (select benny_cart_counts(p_center, l.id, w.cns) c) k' in d) = 0 then raise exception '%', procedure_missing || 'benny_live'; end if;
    d := replace(d, $q$'equiv', round(coalesce((l.stats->>'totalEQ')::numeric, 0), 2),$q$,
      $q$'equiv', round(coalesce(po.eq, (l.stats->>'totalEQ')::numeric, 0), 2), 'equiv_from', case when po.eq is not null then 'payout' end,$q$);
    d := replace(d, $q$'equiv_behind', case when coalesce((l.stats->>'stepCount')$q$, $q$'equiv_behind', case when po.eq is null and (coalesce((l.stats->>'stepCount')$q$);
    d := replace(d, $q$(k.c->>'gross')::numeric) > 0.01 then true end,$q$, $q$(k.c->>'gross')::numeric) > 0.01) then true end,$q$);
    execute replace(d, 'cross join lateral (select benny_cart_counts(p_center, l.id, w.cns) c) k',
      $q$cross join lateral (select benny_cart_counts(p_center, l.id, w.cns) c) k
      cross join lateral (select case when coalesce(l.validation->>'isValidated', '') = 'true' and jsonb_typeof(l.validation->'actualTotalEQ') = 'number'
                                      then (l.validation->'actualTotalEQ')::numeric end eq) po$q$);
  end if;

  -- … and the same on one logsheet
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_live_jobs';
  if position('v_eq' in d) = 0 then
    if position('c record; k jsonb; v_behind boolean;' in d) = 0
       or position('k := benny_cart_counts(p_center, c.cart_id, c.cns);' in d) = 0
       or position($q$v_behind := coalesce((c.stats->>'stepCount')$q$ in d) = 0
       or position($q$(k->>'gross')::numeric) > 0.01;$q$ in d) = 0
       or position($q$jsonb_build_object('equiv', round(coalesce((c.stats->>'totalEQ')::numeric, 0), 2))$q$ in d) = 0 then raise exception '%', procedure_missing || 'benny_live_jobs'; end if;
    d := replace(d, 'c record; k jsonb; v_behind boolean;', 'c record; k jsonb; v_behind boolean; v_eq numeric;');
    d := replace(d, 'k := benny_cart_counts(p_center, c.cart_id, c.cns);',
      $q$k := benny_cart_counts(p_center, c.cart_id, c.cns);
  select case when coalesce(l.validation->>'isValidated', '') = 'true' and jsonb_typeof(l.validation->'actualTotalEQ') = 'number' then (l.validation->'actualTotalEQ')::numeric end
    into v_eq from logsheet_sessions l where l.id = c.cart_id and l.command_center_id = p_center;$q$);
    d := replace(d, $q$v_behind := coalesce((c.stats->>'stepCount')$q$, $q$v_behind := v_eq is null and (coalesce((c.stats->>'stepCount')$q$);
    d := replace(d, $q$(k->>'gross')::numeric) > 0.01;$q$, $q$(k->>'gross')::numeric) > 0.01);$q$);
    execute replace(d, $q$jsonb_build_object('equiv', round(coalesce((c.stats->>'totalEQ')::numeric, 0), 2))$q$,
      $q$jsonb_build_object('equiv', round(coalesce(v_eq, (c.stats->>'totalEQ')::numeric, 0), 2))$q$);
  end if;
end $$;
