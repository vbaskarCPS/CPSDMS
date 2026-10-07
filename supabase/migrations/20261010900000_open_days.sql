-- Days close one at a time, whenever you get to them. ADDITIVE ONLY (replaces three functions).
--
-- Starting a new day no longer waits for the previous one to be closed. The old app's tables (worker
-- sign-ins, logsheets, the RM map) hold one day at a time, so the newest day started takes them over:
--
--   app_handoff_day(center, day)  the open day's carts and sales are saved first (by the app), then
--                                 this keeps a copy of its old-app session and clears it, so the new day
--                                 can be loaded. The day stays open (state live, handed_off_at set);
--                                 its payouts are finished in the app and it's closed later.
--
--   payout_carts.finalized        a cart that wasn't paid out before its day was handed off is saved
--                                 as not finalized; it's finished (and finalized) in the payout editor.
--
--   app_close_day_check / app_close_day   work on a handed-off day too: the day's numbers come from its
--                                 saved carts, and closing waits until every cart with sales is finalized.
--                                 Road-trip rules (no attendance, no NS list) are kept.

alter table public.payout_carts add column if not exists finalized boolean not null default true;
alter table public.days add column if not exists handed_off_at timestamptz;
grant select (handed_off_at) on public.days to authenticated;

-- ───────────── saving a day's carts keeps "finalized" ─────────────
create or replace function public.app_save_payout_day(p_center uuid, p_day date, p_carts jsonb, p_lines jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  ci bigint;
  cart_id uuid;
  n int;
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  if exists (select 1 from payout_lines l join payslips s on s.id = l.payslip_id
              where l.center_id = p_center and l.day = p_day and s.status <> 'void') then
    raise exception '% is on a generated payslip, so it''s locked. Void that payslip to change the day.', p_day;
  end if;
  if not exists (select 1 from days where center_id = p_center and day = p_day and state in ('live', 'closed')) then
    raise exception 'There''s no session on % to save payouts for', p_day;
  end if;

  delete from payout_carts where center_id = p_center and day = p_day;   -- sales go with them
  for c, ci in select x, o from jsonb_array_elements(coalesce(p_carts, '[]'::jsonb)) with ordinality t(x, o) loop
    insert into payout_carts (center_id, day, sort, label, manager, members, eq_override, crackfill_lbs, bonuses, settings, notes, source, finalized, created_by, updated_by)
    values (p_center, p_day, ci, coalesce(c->>'label', ''), nullif(c->>'manager', ''), coalesce(c->'members', '[]'::jsonb),
            nullif(c->>'eq_override', '')::numeric, coalesce(nullif(c->>'crackfill_lbs', '')::numeric, 0),
            coalesce(c->'bonuses', '[]'::jsonb), coalesce(c->'settings', '{}'::jsonb), nullif(c->>'notes', ''),
            coalesce(c->>'source', 'edited'), coalesce((c->>'finalized')::boolean, true), auth.uid(), auth.uid())
    returning id into cart_id;
    insert into payout_sales (cart_id, center_id, day, sort, route_code, address, client_name, price, payment_type, payments, type, display_price, service, notes, meta)
    select cart_id, p_center, p_day, so, nullif(s->>'route_code', ''), nullif(s->>'address', ''), nullif(s->>'client_name', ''),
           coalesce(nullif(s->>'price', '')::numeric, 0), coalesce(nullif(s->>'payment_type', ''), 'Cash'),
           case when jsonb_typeof(s->'payments') = 'object' then s->'payments' end,
           coalesce(nullif(s->>'type', ''), 'Sale'), nullif(s->>'display_price', ''), nullif(s->>'service', ''), nullif(s->>'notes', ''),
           coalesce(s->'meta', '{}'::jsonb)
      from jsonb_array_elements(coalesce(c->'sales', '[]'::jsonb)) with ordinality u(s, so);
  end loop;

  n := app_save_payout_lines(p_center, p_day, p_lines);
  return n;
end $$;

-- ───────────── the old app's session: keep a copy, then clear it (internal) ─────────────
-- Same steps as the old app's own reset. Card numbers, expiry dates, CVCs and passwords are never copied.
create or replace function public.app_archive_clear_session(p_center uuid, p_day date)
returns int language plpgsql security definer set search_path = public as $$
declare archived int := 0;
begin
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
  return archived;
end $$;
revoke all on function public.app_archive_clear_session(uuid, date) from public, anon, authenticated;

-- ───────────── hand the old app's tables to a newer day ─────────────
create or replace function public.app_handoff_day(p_center uuid, p_day date)
returns int language plpgsql security definer set search_path = public as $$
declare
  d days;
  n int;
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  select * into d from days where center_id = p_center and day = p_day for update;
  if d.id is null or d.state <> 'live' then raise exception '% isn''t an open session day', p_day; end if;
  if not exists (select 1 from daily_sessions where command_center_id = p_center and date = p_day) then
    raise exception 'The old app isn''t holding % any more', p_day;
  end if;
  -- the day's carts must have been saved first, or its payouts would be lost
  if exists (select 1 from logsheet_sessions ls where ls.command_center_id = p_center and ls.date = p_day
               and exists (select 1 from transactions t where t.session_id = ls.id))
     and not exists (select 1 from payout_carts where center_id = p_center and day = p_day) then
    raise exception 'Save % carts before handing the day off', p_day;
  end if;
  n := app_archive_clear_session(p_center, p_day);
  update days set handed_off_at = now() where id = d.id;
  return n;
end $$;
revoke all on function public.app_handoff_day(uuid, date) from public, anon;
grant execute on function public.app_handoff_day(uuid, date) to authenticated;

-- ───────────── what closing would do ─────────────
create or replace function public.app_close_day_check(p_center uuid, p_day date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d days;
  has_legacy boolean;
  unpaid jsonb;
  unfinalized jsonb;
  unmarked jsonb;
  noshows jsonb;
  carts int; paid int; steps int; gross numeric; upsells int;
  road_trip boolean;
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  select * into d from days where center_id = p_center and day = p_day;
  if d.id is null then raise exception 'There is no day planned for %', p_day; end if;
  select center_type = 'road_trip' into road_trip from command_centers where id = p_center;
  road_trip := coalesce(road_trip, false);

  select exists (select 1 from daily_sessions where command_center_id = p_center and date = p_day) into has_legacy;

  if has_legacy then
    -- still in the old app: carts with sales that aren't paid out there yet
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
  else
    unpaid := '[]'::jsonb;
    -- handed off (or imported): the day's saved carts
    select count(*), count(*) filter (where c.finalized),
           coalesce(sum((select count(*) from payout_sales s where s.cart_id = c.id and s.type in ('Sale', 'Production', 'Upgrade'))), 0)::int,
           coalesce(sum((select sum(s.price) from payout_sales s where s.cart_id = c.id)), 0),
           coalesce(sum((select count(*) from payout_sales s where s.cart_id = c.id and s.type in ('Upgrade', 'Add-On'))), 0)::int
      into carts, paid, steps, gross, upsells
      from payout_carts c where c.center_id = p_center and c.day = p_day;
  end if;

  -- carts saved with sales but not finalized yet (finish them in the payout editor)
  select coalesce(jsonb_agg(jsonb_build_object('label', c.label,
           'sales', (select count(*) from payout_sales s where s.cart_id = c.id)) order by c.sort), '[]'::jsonb)
    into unfinalized
    from payout_carts c
   where c.center_id = p_center and c.day = p_day and not c.finalized
     and exists (select 1 from payout_sales s where s.cart_id = c.id);

  select coalesce(jsonb_agg(jsonb_build_object('cn', h.cn, 'name', trim(p.first_name || ' ' || p.last_name)) order by h.cn), '[]'::jsonb)
    into unmarked
    from day_roster r join hires h on h.id = r.hire_id join people p on p.id = h.person_id
   where r.day_id = d.id and r.attendance is null and not road_trip;   -- road trips don't take attendance

  select coalesce(jsonb_agg(jsonb_build_object('cn', h.cn, 'name', trim(p.first_name || ' ' || p.last_name),
                                               'status', h.status, 'ns_count', h.ns_count) order by h.cn), '[]'::jsonb)
    into noshows
    from day_roster r join hires h on h.id = r.hire_id join people p on p.id = h.person_id
   where r.day_id = d.id and r.attendance = 'no_show' and not road_trip;   -- nor keep an NS list

  return jsonb_build_object(
    'state', d.state,
    'road_trip', road_trip,
    'has_session', has_legacy,
    'handed_off', d.handed_off_at is not null,
    'carts', carts, 'paid', paid, 'steps', steps, 'gross', gross, 'upsells', upsells,
    'booked', (select count(*) from day_roster where day_id = d.id),
    'showed', (select count(*) from day_roster where day_id = d.id and attendance = 'showed'),
    'unpaid', unpaid,
    'unfinalized', unfinalized,
    'unmarked', unmarked,
    'no_shows', noshows,
    'can_close', d.state <> 'closed' and jsonb_array_length(unpaid) = 0 and jsonb_array_length(unfinalized) = 0
                 and jsonb_array_length(unmarked) = 0
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
  if jsonb_array_length(chk->'unfinalized') > 0 then
    raise exception 'Finalize every cart with sales in the payout editor before closing (% not finalized)', jsonb_array_length(chk->'unfinalized');
  end if;
  if jsonb_array_length(chk->'unmarked') > 0 then
    raise exception 'Mark everyone Showed or No-show before closing (% not marked)', jsonb_array_length(chk->'unmarked');
  end if;
  select * into d from days where center_id = p_center and day = p_day for update;

  -- the old app's session, if it's still holding this day
  if (chk->>'has_session')::boolean then archived := app_archive_clear_session(p_center, p_day); end if;

  -- no-shows onto the NS list (status_entries is written by the hires trigger)
  if not coalesce((chk->>'road_trip')::boolean, false) then
    update hires h
       set status = 'NS', status_since = p_day, ns_count = h.ns_count + 1, updated_at = now()
      from day_roster r
     where r.day_id = d.id and r.hire_id = h.id and r.attendance = 'no_show';
    get diagnostics moved = row_count;
  end if;

  v_summary := jsonb_build_object(
    'carts', chk->'carts', 'steps', chk->'steps', 'gross', chk->'gross', 'upsells', chk->'upsells',
    'booked', chk->'booked', 'showed', chk->'showed', 'no_shows', moved,
    'had_session', chk->'has_session', 'handed_off', chk->'handed_off', 'archived_rows', archived, 'road_trip', chk->'road_trip');
  update days set state = 'closed', closed_at = now(), closed_by = auth.uid(), summary = v_summary where id = d.id;
  return v_summary;
end $$;

revoke all on function public.app_close_day_check(uuid, date) from public, anon;
revoke all on function public.app_close_day(uuid, date) from public, anon;
grant execute on function public.app_close_day_check(uuid, date) to authenticated;
grant execute on function public.app_close_day(uuid, date) to authenticated;
