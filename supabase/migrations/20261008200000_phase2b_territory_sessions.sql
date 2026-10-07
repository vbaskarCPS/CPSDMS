-- Phase 2b · territory assignments, sessions started from a Day, one manager login.
--
-- ADDITIVE ONLY.
--   map_area_centers  each digital-map area (route_maps.area_name) belongs to one command center
--   sessions          the live part of a day: routes picked, teams, settings, who started it
--   app_start_session records the session and the day's roll call / teams in one step
--   legacy_login_rm   managers can sign in to the old RM screens with their /app password
--
-- While the RM map, map logsheet and payouts still live in the old app, Start session also
-- writes the old session tables (daily_sessions, users, routes, logsheet_sessions) from the
-- browser exactly the way Import from Sheets does; this migration doesn't touch those tables.

-- ───────────────────────── territory ─────────────────────────
create table if not exists public.map_area_centers (
  area_name text primary key,
  center_id uuid not null references public.command_centers(id) on delete cascade,
  assigned_by uuid,
  assigned_at timestamptz not null default now()
);
create index if not exists map_area_centers_center on public.map_area_centers (center_id);

alter table public.map_area_centers enable row level security;
drop policy if exists area_centers_read on public.map_area_centers;
create policy area_centers_read on public.map_area_centers for select to authenticated
  using (app_has_perm('sa_territory') or app_can_see_center(center_id));
drop policy if exists area_centers_write on public.map_area_centers;
create policy area_centers_write on public.map_area_centers for all to authenticated
  using (app_has_perm('sa_territory')) with check (app_has_perm('sa_territory'));

drop trigger if exists audit on public.map_area_centers;
create or replace function public.audit_area_center()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor, entity, entity_id, action, before, after)
  values (auth.uid(), 'map_area_centers', coalesce(new.area_name, old.area_name), lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
revoke execute on function public.audit_area_center() from public, anon, authenticated;
create trigger audit after insert or update or delete on public.map_area_centers
  for each row execute function public.audit_area_center();

-- ───────────────────────── sessions ─────────────────────────
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null unique references public.days(id) on delete restrict,
  settings jsonb not null,           -- {service, productCostPercent, emailReceipts, liveCard, noTaxOnCash}
  routes jsonb not null default '[]', -- [{code, area, manager_id}]
  teams jsonb not null default '[]',  -- [{name, kind: 'cart'|'ramp', manager_id, hire_ids: []}]
  started_by uuid,
  started_at timestamptz not null default now()
);

alter table public.sessions enable row level security;
drop policy if exists sessions_read on public.sessions;
create policy sessions_read on public.sessions for select to authenticated
  using (exists (select 1 from days d where d.id = day_id and app_can_see_center(d.center_id)
                 and (app_has_perm('workerbook') or app_has_perm('route_manager'))));

drop trigger if exists audit on public.sessions;
create trigger audit after insert or update or delete on public.sessions for each row execute function public.audit_row();

-- Supabase grants ALL on new tables by default; give exactly what the app uses.
revoke all on public.map_area_centers, public.sessions from anon, authenticated;
grant select, insert, update, delete on public.map_area_centers to authenticated;
grant select on public.sessions to authenticated;

-- Start a day's session: records routes, teams and settings, ticks who showed, fills
-- manager and team on the roster, and makes the day live. All or nothing.
create or replace function public.app_start_session(p_day uuid, p_settings jsonb, p_routes jsonb, p_teams jsonb, p_showed uuid[])
returns uuid language plpgsql security definer set search_path = public as $$
declare v_center uuid; v_state text; v_id uuid; t jsonb; v_missing int;
begin
  select center_id, state into v_center, v_state from days where id = p_day for update;
  if v_center is null then raise exception 'Unknown day'; end if;
  if not (app_has_perm('workerbook') and app_can_see_center(v_center)) then raise exception 'Not allowed'; end if;
  if v_state <> 'planned' then raise exception 'This day has already been started'; end if;
  if jsonb_typeof(p_teams) <> 'array' or jsonb_array_length(p_teams) = 0 then raise exception 'Add at least one team'; end if;
  if jsonb_typeof(p_routes) <> 'array' or jsonb_array_length(p_routes) = 0 then raise exception 'Pick at least one route'; end if;

  -- everyone in a team must be on the roster and ticked as showed
  select count(*) into v_missing
    from jsonb_array_elements(p_teams) tm, jsonb_array_elements_text(tm->'hire_ids') h
   where not exists (select 1 from day_roster r where r.day_id = p_day and r.hire_id = h::uuid)
      or not (h::uuid = any(p_showed));
  if v_missing > 0 then raise exception 'Every team member must be on the roster and marked as showed'; end if;

  insert into sessions (day_id, settings, routes, teams, started_by)
  values (p_day, p_settings, p_routes, p_teams, auth.uid())
  returning id into v_id;

  update day_roster set attendance = 'showed' where day_id = p_day and hire_id = any(p_showed);
  for t in select * from jsonb_array_elements(p_teams) loop
    update day_roster set team = t->>'name', manager_id = nullif(t->>'manager_id', '')::uuid
     where day_id = p_day and hire_id in (select h::uuid from jsonb_array_elements_text(t->'hire_ids') h);
  end loop;
  update days set state = 'live' where id = p_day;
  return v_id;
end $$;
revoke all on function public.app_start_session(uuid, jsonb, jsonb, jsonb, uuid[]) from public, anon;
grant execute on function public.app_start_session(uuid, jsonb, jsonb, jsonb, uuid[]) to authenticated;

-- ───────────────────────── one manager login ─────────────────────────
-- The old RM screens accept the manager's /app username and password as well as the
-- password stored in the old users table (which a session started from /app leaves empty).
create or replace function public.legacy_login_rm(p_username text, p_password text)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
  select case when count(*) = 1 then (array_agg(to_jsonb(u) - 'password'))[1] end
    from users u
   where u.role = 'RouteManager' and lower(u.username) = lower(p_username) and coalesce(p_password, '') <> ''
     and (lower(u.password) = lower(p_password)
          or exists (select 1 from app_users a join auth.users au on au.id = a.id
                      where a.username = lower(p_username) and a.is_active
                        and au.encrypted_password = crypt(p_password, au.encrypted_password)))
$$;
revoke all on function public.legacy_login_rm(text, text) from public;
grant execute on function public.legacy_login_rm(text, text) to anon, authenticated;
