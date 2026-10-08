-- The Google Sheets bridge: until Master Bookings lives in the app, a closed day sends its
-- Logsheets and Accounts rows to the center's Master Bookings sheet (the old Export to Sheets).
-- ADDITIVE ONLY (one new table, three new functions, one function replaced).
--
--   day_sheet_sends                  each send: which day, who, when, how many rows, to which sheet
--   app_day_sheet_info(center, day)  the center's sheet and the day's earlier sends (Workerbook)
--   app_record_day_sheet_send(...)   records a send after the rows reach the sheet (Workerbook)
--   app_set_center_sheet(center, link)  sets a center's Master Bookings sheet from its link (Super Admin › Users)
--   app_archive_clear_session(...)   unchanged, except the saved copy of each sale now keeps its
--                                    card as the sheet shows it: a Bambora or masked last 4, never more
--
-- The rows themselves are built in the browser from the day's saved copy (app_archived_day) with
-- the same code the old app's Export to Google Sheets uses, and appended with the manager's own
-- Google sign-in. Card numbers, expiry dates and CVCs are never stored or sent.

create table if not exists public.day_sheet_sends (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.command_centers(id) on delete cascade,
  day date not null,
  sheet_id text not null,
  logsheets int not null default 0,
  accounts int not null default 0,
  sent_by uuid,
  sent_at timestamptz not null default clock_timestamp()
);
create index if not exists day_sheet_sends_center_day on public.day_sheet_sends (center_id, day, sent_at desc);
alter table public.day_sheet_sends enable row level security;   -- no policies: only these functions touch it
revoke all on public.day_sheet_sends from anon, authenticated;

-- ───────────── the day's sheet and earlier sends ─────────────
create or replace function public.app_day_sheet_info(p_center uuid, p_day date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'sheet_id', (select nullif(trim(coalesce(masterbookings_sheet_id, '')), '') from command_centers where id = p_center),
    'saved', exists (select 1 from archive.session_rows where center_id = p_center and day = p_day and source_table = 'transactions'),
    'sends', coalesce((
      select jsonb_agg(jsonb_build_object('sent_at', s.sent_at, 'by', u.full_name, 'logsheets', s.logsheets, 'accounts', s.accounts) order by s.sent_at desc)
        from day_sheet_sends s left join app_users u on u.id = s.sent_by
       where s.center_id = p_center and s.day = p_day), '[]'::jsonb));
end $$;
revoke all on function public.app_day_sheet_info(uuid, date) from public, anon;
grant execute on function public.app_day_sheet_info(uuid, date) to authenticated;

-- ───────────── record a send (after Google took the rows) ─────────────
create or replace function public.app_record_day_sheet_send(p_center uuid, p_day date, p_logsheets int, p_accounts int)
returns void language plpgsql security definer set search_path = public as $$
declare v_sheet text;
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  select nullif(trim(coalesce(masterbookings_sheet_id, '')), '') into v_sheet from command_centers where id = p_center;
  if v_sheet is null then raise exception 'This center has no Master Bookings sheet set'; end if;
  insert into day_sheet_sends (center_id, day, sheet_id, logsheets, accounts, sent_by)
  values (p_center, p_day, v_sheet, greatest(coalesce(p_logsheets, 0), 0), greatest(coalesce(p_accounts, 0), 0), auth.uid());
end $$;
revoke all on function public.app_record_day_sheet_send(uuid, date, int, int) from public, anon;
grant execute on function public.app_record_day_sheet_send(uuid, date, int, int) to authenticated;

-- ───────────── a center's Master Bookings sheet, from its link ─────────────
create or replace function public.app_set_center_sheet(p_center uuid, p_link text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if not app_has_perm('sa_users') then raise exception 'Not allowed'; end if;
  v_id := coalesce(substring(coalesce(p_link, '') from '/spreadsheets/d/([A-Za-z0-9_-]{20,})'),
                   substring(trim(coalesce(p_link, '')) from '^([A-Za-z0-9_-]{20,})$'));
  if v_id is null then raise exception 'That doesn’t look like a Google Sheets link'; end if;
  update command_centers set masterbookings_sheet_id = v_id where id = p_center;
  if not found then raise exception 'No such center'; end if;
  insert into audit_log (actor, entity, entity_id, action, after)
  values (auth.uid(), 'command_centers', p_center::text, 'update', jsonb_build_object('masterbookings_sheet_id', v_id));
  return v_id;
end $$;
revoke all on function public.app_set_center_sheet(uuid, text) from public, anon;
grant execute on function public.app_set_center_sheet(uuid, text) to authenticated;

-- ───────────── the saved copy keeps each sale's card as the sheet shows it ─────────────
-- Same as before (Card numbers, expiry dates, CVCs and passwords are never copied), plus
-- card_masked: "••••••••••••1234" for a Bambora payment, "CARD-••••1234" otherwise. Never more than 4 digits.
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
    union all select 'transactions', (to_jsonb(t) - 'cc_full_number' - 'cc_expiry' - 'cc_cvc')
        || jsonb_build_object('card_masked', case
             when t.cc_full_number like 'BAMBORA-%'
               then '••••••••••••' || right(regexp_replace(coalesce(t.cc_cvc, ''), '\D', '', 'g'), 4)
             when length(regexp_replace(coalesce(t.cc_full_number, ''), '\D', '', 'g')) >= 4
               then 'CARD-••••' || right(regexp_replace(t.cc_full_number, '\D', '', 'g'), 4)
           end)
        from transactions t where t.command_center_id = p_center
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
