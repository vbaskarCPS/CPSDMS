-- Close day from the new app. ADDITIVE ONLY.
--
--   app_close_day_check(center, day)  what stands in the way, and what closing will do
--   app_close_day(center, day)        does it, all or nothing:
--     1. keeps a copy of the old app's session rows in archive.session_rows (passwords and
--        card number / expiry / CVC never copied) — the same copy the Oct 6 script made
--     2. clears the old app's session exactly like its own reset (adminResetDailySession),
--        so the next day can start; door-knock results and map pins carry over as before
--     3. moves the day's no-shows onto the NS list (+1 on their no-show count)
--     4. marks the day closed with a summary (carts, steps, gross, upsells, attendance)
--
-- Closing is blocked while a cart with sales isn't paid out, or anyone on the roster
-- isn't marked Showed or No-show. Needs Workerbook at that center.

alter table public.days
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid,
  add column if not exists summary jsonb;

-- ───────────── what closing would do ─────────────
create or replace function public.app_close_day_check(p_center uuid, p_day date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d days;
  has_legacy boolean;
  unpaid jsonb;
  unmarked jsonb;
  noshows jsonb;
  carts int; paid int; steps int; gross numeric; upsells int;
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  select * into d from days where center_id = p_center and day = p_day;
  if d.id is null then raise exception 'There is no day planned for %', p_day; end if;

  select exists (select 1 from daily_sessions where command_center_id = p_center and date = p_day) into has_legacy;

  -- carts with sales that aren't paid out yet
  select coalesce(jsonb_agg(jsonb_build_object(
           'worker_id', ls.worker_id, 'status', ls.status,
           'names', (select string_agg(u.name, ' & ' order by u.name) from users u
                      where u.command_center_id = p_center and u.role = 'Worker'
                        and u.user_id = any(case when cardinality(ls.team_worker_ids) > 0 then ls.team_worker_ids else array[ls.worker_id] end)),
           'sales', (select count(*) from transactions t where t.session_id = ls.id))
           order by ls.worker_id), '[]'::jsonb)
    into unpaid
    from logsheet_sessions ls
   where ls.command_center_id = p_center and ls.date = p_day and ls.status <> 'PAID'
     and exists (select 1 from transactions t where t.session_id = ls.id);

  select count(*), count(*) filter (where status = 'PAID'),
         coalesce(sum((stats->>'stepCount')::numeric), 0)::int,
         coalesce(sum(coalesce((stats->>'prodGross')::numeric, 0) + coalesce((stats->>'upsellGross')::numeric, 0)), 0),
         coalesce(sum((stats->>'upsellCount')::numeric), 0)::int
    into carts, paid, steps, gross, upsells
    from logsheet_sessions where command_center_id = p_center and date = p_day;

  select coalesce(jsonb_agg(jsonb_build_object('cn', h.cn, 'name', trim(p.first_name || ' ' || p.last_name)) order by h.cn), '[]'::jsonb)
    into unmarked
    from day_roster r join hires h on h.id = r.hire_id join people p on p.id = h.person_id
   where r.day_id = d.id and r.attendance is null;

  select coalesce(jsonb_agg(jsonb_build_object('cn', h.cn, 'name', trim(p.first_name || ' ' || p.last_name),
                                               'status', h.status, 'ns_count', h.ns_count) order by h.cn), '[]'::jsonb)
    into noshows
    from day_roster r join hires h on h.id = r.hire_id join people p on p.id = h.person_id
   where r.day_id = d.id and r.attendance = 'no_show';

  return jsonb_build_object(
    'state', d.state,
    'has_session', has_legacy,
    'carts', carts, 'paid', paid, 'steps', steps, 'gross', gross, 'upsells', upsells,
    'booked', (select count(*) from day_roster where day_id = d.id),
    'showed', (select count(*) from day_roster where day_id = d.id and attendance = 'showed'),
    'unpaid', unpaid,
    'unmarked', unmarked,
    'no_shows', noshows,
    'can_close', d.state <> 'closed' and jsonb_array_length(unpaid) = 0 and jsonb_array_length(unmarked) = 0
  );
end $$;

-- ───────────── close it ─────────────
create or replace function public.app_close_day(p_center uuid, p_day date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  chk jsonb;
  d days;
  archived int := 0;
  moved int := 0;
  v_summary jsonb;
begin
  chk := app_close_day_check(p_center, p_day);   -- also checks permission
  if chk->>'state' = 'closed' then raise exception 'This day is already closed'; end if;
  if jsonb_array_length(chk->'unpaid') > 0 then
    raise exception 'Pay out every cart with sales before closing (% not paid)', jsonb_array_length(chk->'unpaid');
  end if;
  if jsonb_array_length(chk->'unmarked') > 0 then
    raise exception 'Mark everyone Showed or No-show before closing (% not marked)', jsonb_array_length(chk->'unmarked');
  end if;
  select * into d from days where center_id = p_center and day = p_day for update;

  -- 1 + 2. the old app's session: keep a copy, then clear it (same steps as its own reset)
  if (chk->>'has_session')::boolean then
    insert into archive.session_rows (day, center_id, source_table, row_data)
    select p_day, p_center, x.t, x.r from (
      select 'daily_sessions' t, to_jsonb(s) r from daily_sessions s where s.date = p_day and s.command_center_id = p_center
      union all select 'logsheet_sessions', to_jsonb(l) from logsheet_sessions l where l.date = p_day and l.command_center_id = p_center
      union all select 'routes', to_jsonb(r) from routes r where r.session_date = p_day and r.command_center_id = p_center
      union all select 'bookings', to_jsonb(b) from bookings b where b.session_date = p_day and b.command_center_id = p_center
      union all select 'transactions', to_jsonb(t) - 'cc_full_number' - 'cc_expiry' - 'cc_cvc' from transactions t where t.command_center_id = p_center
      union all select 'route_splits', to_jsonb(s) from route_splits s where s.command_center_id = p_center::text
      union all select 'route_historical_properties', to_jsonb(h) from route_historical_properties h where h.command_center_id = p_center
      union all select 'pending_sales', to_jsonb(p) from pending_sales p where p.command_center_id = p_center
      union all select 'users', to_jsonb(u) - 'password' from users u where u.role in ('Worker', 'RouteManager') and u.command_center_id = p_center
    ) x;
    get diagnostics archived = row_count;

    delete from geocode_cache               where command_center_id = p_center;
    delete from route_historical_properties where command_center_id = p_center;
    delete from pending_sales               where command_center_id = p_center;
    delete from route_splits                where command_center_id = p_center::text;
    delete from transactions                where command_center_id = p_center;
    delete from logsheet_sessions           where date = p_day and command_center_id = p_center;
    delete from routes                      where session_date = p_day and command_center_id = p_center;
    delete from bookings                    where session_date = p_day and command_center_id = p_center;
    delete from daily_sessions              where date = p_day and command_center_id = p_center;
    delete from users                       where role in ('Worker', 'RouteManager') and command_center_id = p_center;
  end if;

  -- 3. no-shows onto the NS list (status_entries is written by the hires trigger)
  update hires h
     set status = 'NS', status_since = p_day, ns_count = h.ns_count + 1, updated_at = now()
    from day_roster r
   where r.day_id = d.id and r.hire_id = h.id and r.attendance = 'no_show';
  get diagnostics moved = row_count;

  -- 4. closed, with the day's numbers
  v_summary := jsonb_build_object(
    'carts', chk->'carts', 'steps', chk->'steps', 'gross', chk->'gross', 'upsells', chk->'upsells',
    'booked', chk->'booked', 'showed', chk->'showed', 'no_shows', moved,
    'had_session', chk->'has_session', 'archived_rows', archived);
  update days set state = 'closed', closed_at = now(), closed_by = auth.uid(), summary = v_summary where id = d.id;
  return v_summary;
end $$;

revoke all on function public.app_close_day_check(uuid, date) from public, anon;
revoke all on function public.app_close_day(uuid, date) from public, anon;
grant execute on function public.app_close_day_check(uuid, date) to authenticated;
grant execute on function public.app_close_day(uuid, date) to authenticated;
