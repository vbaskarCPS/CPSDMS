-- RUN_66 — Master Bookings: booking lists that last all season, plans, and the day feed.
--
-- ADDITIVE ONLY.
--   mb_lists     one booking list per season of a region's year: West runs Spring Aeration,
--                Spring Rejuv, Summer Service and Fall Rejuv. A list is worked by one center.
--   mb_plans     a plan a customer bought (SP Pro, Grub Control…): always prepaid. Its bookings
--                point back at it. (Recipes that turn one plan into bookings in each season come later.)
--   mb_bookings  one booking per row: the address, the job code (AFSL…) and services, prepaid,
--                field notes (the crew sees them) and office notes (they don't), status
--                (open / done / cancelled), every try ("next time") with its reason, what was
--                actually done and by whom, and where it sits on the digital maps:
--                  on_map       its point lands on a built route that matches the sheet's code
--                  moved        it lands on a built route with a different code (the map's is used)
--                  waiting      no built route there yet (keeps the sheet's code; can't go in a day)
--                  no_location  the address couldn't be found
--   bookings.attempt_reason / attempt_note   what the crew picked when they tapped Next time.
--
-- How a booking reaches a crew: Start session (and adding routes to a live session) copies the
-- open bookings on the day's routes into the old session table `bookings`, id "mb:<uuid>". The
-- crew's map logsheet shows them on their houses already. What happens to them flows back at once:
--   a finished job (transactions, job_id "mb:…")  → done, with date, crew and services done
--   Next time                                     → a try is added; the booking stays open and comes back
--                                                   the next day its route is worked
--   Cancelled                                     → cancelled (the office can reopen it)
--   a deleted job                                 → open again
-- When new route lines are drawn (a map approved), waiting bookings nearby are placed again.
-- Every write goes through the security-definer functions below; the tables have no grants.

-- ───────────── tables ─────────────
create table if not exists public.mb_lists (
  id uuid primary key default gen_random_uuid(),
  region text not null check (region in ('West', 'East', 'Central')),
  year int not null check (year between 2000 and 2100),
  part text not null check (part in ('spring', 'summer', 'fall')),
  service text not null check (service in ('aeration', 'lawn_rejuv', 'summer_service', 'sealing', 'cleaning')),
  name text not null,
  center_id uuid references public.command_centers(id) on delete set null,
  job_code text,                                  -- what a booking on this list is done as by default (AFSL)
  created_at timestamptz not null default now(),
  unique (region, year, part, service)
);

create table if not exists public.mb_plans (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('sp_pro', 'star_plan', 'grub', 'chafer', 'sppp', 'other')),
  region text not null,
  year int not null check (year between 2000 and 2100),
  client_id uuid references public.clients(id) on delete set null,
  sold_list_id uuid references public.mb_lists(id) on delete set null,
  price numeric(10, 2),                           -- what the plan cost, tax in (never shown to crews)
  prepaid boolean not null default true,
  note text,
  source jsonb,
  created_at timestamptz not null default now(),
  created_by uuid
);
create index if not exists mb_plans_client on public.mb_plans (client_id);
create index if not exists mb_plans_kind on public.mb_plans (region, kind, year);

create table if not exists public.mb_bookings (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.mb_lists(id) on delete cascade,
  plan_id uuid references public.mb_plans(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  house_no text not null,
  street_name text not null,
  street_norm text not null,
  unit text, city text, province text, postal_code text,
  lat double precision, lng double precision,
  sheet_route text,                               -- the route code the sheet gave
  route_code text,                                -- the route it's worked on
  area_name text,
  map_state text not null default 'waiting' check (map_state in ('on_map', 'moved', 'waiting', 'no_location')),
  map_how text,                                   -- house | line | zone | sheet
  moved_from text,
  map_checked_at timestamptz,
  job_code text not null default '',
  services jsonb not null default '{}',           -- booked: {aeration, dethatch, fertilizer, seed, lime}
  property_type text,
  prepaid boolean not null default true,
  people jsonb not null default '[]',
  phones text[] not null default '{}',
  emails text[] not null default '{}',
  field_notes text,
  office_notes text,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  attempts jsonb not null default '[]',           -- [{day, by, reason, note, at, kind}]
  done_on date, done_by text, done_by_name text, done_services jsonb, done_tx text,
  this_year jsonb not null default '[]',          -- [{label, done}] earlier visits this year
  booked_by text, booked_at text,
  source jsonb, source_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create unique index if not exists mb_bookings_source on public.mb_bookings (list_id, source_key) where source_key is not null;
create index if not exists mb_bookings_list on public.mb_bookings (list_id, status);
create index if not exists mb_bookings_route on public.mb_bookings (route_code) where status = 'open';
create index if not exists mb_bookings_client on public.mb_bookings (client_id);
create index if not exists mb_bookings_plan on public.mb_bookings (plan_id);
create index if not exists mb_bookings_waiting on public.mb_bookings (list_id) where map_state = 'waiting';

alter table public.bookings add column if not exists attempt_reason text;
alter table public.bookings add column if not exists attempt_note text;

alter table public.mb_lists enable row level security;
alter table public.mb_plans enable row level security;
alter table public.mb_bookings enable row level security;
revoke all on public.mb_lists, public.mb_plans, public.mb_bookings from anon, authenticated;

drop trigger if exists audit on public.mb_bookings;
create trigger audit after insert or update or delete on public.mb_bookings for each row execute function public.audit_row();
drop trigger if exists audit on public.mb_plans;
create trigger audit after insert or update or delete on public.mb_plans for each row execute function public.audit_row();

-- West's four seasons for 2026 (only Fall Rejuv is filled for now; BC Fall RJ works it)
insert into public.mb_lists (region, year, part, service, name, center_id, job_code) values
  ('West', 2026, 'spring', 'aeration', 'Spring Aeration', null, null),
  ('West', 2026, 'spring', 'lawn_rejuv', 'Spring Rejuv', null, null),
  ('West', 2026, 'summer', 'summer_service', 'Summer Service', null, null),
  ('West', 2026, 'fall', 'lawn_rejuv', 'Fall Rejuv', (select id from public.command_centers where username = 'bcfallrj' limit 1), 'AFSL')
on conflict (region, year, part, service) do nothing;

-- ───────────── access ─────────────
create or replace function public.mb_list_ok(p_list uuid, p_write boolean default false)
returns mb_lists language plpgsql stable security definer set search_path = public as $$
declare l mb_lists;
begin
  select * into l from mb_lists where id = p_list;
  if l.id is null then raise exception 'That booking list doesn''t exist'; end if;
  if auth.uid() is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  if coalesce(app_is_super_admin(), false) then return l; end if;
  if not (coalesce(app_has_perm('bookings'), false) or (not p_write and coalesce(app_has_perm('workerbook'), false))) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if l.center_id is not null and not app_can_see_center(l.center_id) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return l;
end $$;
revoke all on function public.mb_list_ok(uuid, boolean) from public, anon, authenticated;

-- "NVN42 OFF" → "NVN42", " tsw09a" → "TSW09A"
create or replace function public.mb_norm_route(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(coalesce(substring(upper(coalesce(p, '')) from '^\s*([A-Z]+[0-9]+[A-Z]?)'), upper(trim(coalesce(p, '')))), '')
$$;

-- ───────────── placing a point on the digital maps ─────────────
-- The built route a point is on: a house of the same address on a route nearby, else the zone of
-- the same street, else the nearest line of the same street within 150 m, else any route zone the
-- point is inside. Only approved routes count. Purely by location, so a code that two provinces
-- share (NEW13) can't pull a booking across the country.
create or replace function public.mb_route_at(p_lat double precision, p_lng double precision, p_street_norm text, p_house text)
returns table (route_code text, area_name text, how text)
language sql stable security definer set search_path = public, extensions as $$
  with pt as (select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) g),
  cand as (
    (select rh.route_code, 1 pri, 'house'::text how from route_houses rh, pt
      where p_lat is not null and rh.house_key = crm_house_key(p_house, p_street_norm)
        and ST_DWithin(ST_SetSRID(ST_MakePoint(rh.lng, rh.lat), 4326)::geography, pt.g::geography, 300)
      order by ST_Distance(ST_SetSRID(ST_MakePoint(rh.lng, rh.lat), 4326)::geography, pt.g::geography) limit 1)
    union all
    (select l.route_code, 2, 'line' from route_street_lines l, pt
      where p_lat is not null and l.street_norm = p_street_norm and l.zone is not null and ST_Covers(l.zone, pt.g) limit 1)
    union all
    (select l.route_code, 3, 'line' from route_street_lines l, pt
      where p_lat is not null and l.street_norm = p_street_norm and ST_DWithin(l.line, pt.g::geography, 150)
      order by ST_Distance(l.line, pt.g::geography) limit 1)
    union all
    (select l.route_code, 4, 'zone' from route_street_lines l, pt
      where p_lat is not null and l.zone is not null and ST_Covers(l.zone, pt.g) limit 1)
  )
  select c.route_code, rm.area_name, c.how
    from cand c join route_maps rm on rm.route_code = c.route_code and rm.status = 'approved'
   order by c.pri limit 1
$$;
revoke all on function public.mb_route_at(double precision, double precision, text, text) from public, anon, authenticated;

-- Where a booking sits: on_map / moved / waiting / no_location, with the route it's worked on.
create or replace function public.mb_place_point(p_lat double precision, p_lng double precision, p_street_norm text, p_house text, p_sheet_route text,
  out route_code text, out area_name text, out map_state text, out how text, out moved_from text)
language plpgsql stable security definer set search_path = public as $$
declare r record; v_sheet text := mb_norm_route(p_sheet_route);
begin
  moved_from := null;
  if p_lat is null or p_lng is null then
    route_code := v_sheet; area_name := null; map_state := 'no_location'; how := null; return;
  end if;
  select * into r from mb_route_at(p_lat, p_lng, p_street_norm, p_house);
  if r.route_code is null then
    route_code := v_sheet; area_name := null; map_state := 'waiting'; how := 'sheet'; return;
  end if;
  route_code := r.route_code; area_name := r.area_name; how := r.how;
  if v_sheet is null or upper(r.route_code) = v_sheet then map_state := 'on_map';
  else map_state := 'moved'; moved_from := v_sheet; end if;
end $$;
revoke all on function public.mb_place_point(double precision, double precision, text, text, text) from public, anon, authenticated;

-- Place stored bookings again (all of them, or the ones given). A booking someone placed by hand
-- (map_how 'manual') keeps its route.
create or replace function public.mb_place(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare b record; p record; n int := 0;
begin
  for b in select * from mb_bookings where id = any(p_ids) and coalesce(map_how, '') <> 'manual' loop
    select * into p from mb_place_point(b.lat, b.lng, b.street_norm, b.house_no, b.sheet_route);
    update mb_bookings set route_code = p.route_code, area_name = p.area_name, map_state = p.map_state, map_how = p.how,
           moved_from = p.moved_from, map_checked_at = now()
     where id = b.id and (route_code is distinct from p.route_code or map_state is distinct from p.map_state
                          or area_name is distinct from p.area_name or moved_from is distinct from p.moved_from);
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.mb_place(uuid[]) from public, anon, authenticated;

-- New route lines (a map approved or redrawn): waiting bookings near them are placed again.
create or replace function public.mb_lines_added()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_ids uuid[];
begin
  select array_agg(distinct b.id) into v_ids
    from mb_bookings b
   where b.map_state = 'waiting' and b.lat is not null
     and exists (select 1 from new_lines l
                  where ST_DWithin(l.line, ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4326)::geography, 400));
  if v_ids is not null then perform mb_place(v_ids); end if;
  return null;
end $$;
revoke all on function public.mb_lines_added() from public, anon, authenticated;
drop trigger if exists mb_lines_added on public.route_street_lines;
create trigger mb_lines_added after insert on public.route_street_lines
  referencing new table as new_lines for each statement execute function public.mb_lines_added();

-- ───────────── the lists ─────────────
-- The center's region's lists, each with its counts. "mine" = this center works it.
create or replace function public.app_mb_lists(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_region text;
begin
  perform mb_check_center(p_center);
  select region into v_region from command_centers where id = p_center;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', l.id, 'region', l.region, 'year', l.year, 'part', l.part, 'service', l.service, 'name', l.name,
             'center_id', l.center_id, 'mine', l.center_id = p_center, 'job_code', l.job_code,
             'total', coalesce(c.total, 0), 'open', coalesce(c.open, 0), 'done', coalesce(c.done, 0), 'cancelled', coalesce(c.cancelled, 0),
             'tried', coalesce(c.tried, 0), 'on_map', coalesce(c.on_map, 0), 'moved', coalesce(c.moved, 0),
             'waiting', coalesce(c.waiting, 0), 'no_location', coalesce(c.no_location, 0))
           order by l.year desc, case l.part when 'spring' then 1 when 'summer' then 2 else 3 end, l.service)
      from mb_lists l
      left join lateral (
        select count(*)::int total, count(*) filter (where status = 'open')::int open, count(*) filter (where status = 'done')::int done,
               count(*) filter (where status = 'cancelled')::int cancelled,
               count(*) filter (where status = 'open' and jsonb_array_length(attempts) > 0)::int tried,
               count(*) filter (where map_state = 'on_map')::int on_map, count(*) filter (where map_state = 'moved')::int moved,
               count(*) filter (where map_state = 'waiting')::int waiting, count(*) filter (where map_state = 'no_location')::int no_location
          from mb_bookings b where b.list_id = l.id) c on true
     where l.region = v_region or l.center_id = p_center), '[]'::jsonb);
end $$;
revoke all on function public.app_mb_lists(uuid) from public, anon;
grant execute on function public.app_mb_lists(uuid) to authenticated;

-- a booking as the office sees it
create or replace function public.mb_booking_json(b mb_bookings)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', b.id, 'list_id', b.list_id, 'plan_id', b.plan_id, 'client_id', b.client_id,
    'house_no', b.house_no, 'street_name', b.street_name, 'unit', b.unit, 'city', b.city, 'province', b.province, 'postal_code', b.postal_code,
    'lat', b.lat, 'lng', b.lng, 'sheet_route', b.sheet_route, 'route_code', b.route_code, 'area_name', b.area_name,
    'map_state', b.map_state, 'map_how', b.map_how, 'moved_from', b.moved_from,
    'job_code', b.job_code, 'services', b.services, 'property_type', b.property_type, 'prepaid', b.prepaid,
    'people', b.people, 'phones', to_jsonb(b.phones), 'emails', to_jsonb(b.emails),
    'field_notes', b.field_notes, 'office_notes', b.office_notes, 'status', b.status, 'attempts', b.attempts,
    'done_on', b.done_on, 'done_by', b.done_by, 'done_by_name', b.done_by_name, 'done_services', b.done_services,
    'this_year', b.this_year, 'booked_by', b.booked_by, 'booked_at', b.booked_at, 'source', b.source,
    'created_at', b.created_at, 'updated_at', b.updated_at,
    'plan', (select jsonb_build_object('id', p.id, 'kind', p.kind, 'year', p.year, 'price', p.price, 'prepaid', p.prepaid) from mb_plans p where p.id = b.plan_id))
$$;
revoke all on function public.mb_booking_json(mb_bookings) from public, anon, authenticated;

-- One list's bookings, filtered, a page at a time.
create or replace function public.app_mb_list_bookings(p_list uuid, p_q text default null, p_status text default null, p_state text default null,
  p_area text default null, p_route text default null, p_limit int default 200, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_q text := lower(trim(coalesce(p_q, '')));
begin
  perform mb_list_ok(p_list);
  return (
    with f as (
      select b.* from mb_bookings b
       where b.list_id = p_list
         and (p_status is null or (p_status = 'tried' and b.status = 'open' and jsonb_array_length(b.attempts) > 0) or b.status = p_status)
         and (p_state is null or b.map_state = p_state)
         and (p_area is null or b.area_name = p_area)
         and (p_route is null or upper(b.route_code) = upper(p_route) or upper(coalesce(b.sheet_route, '')) = upper(p_route))
         and (v_q = '' or lower(concat_ws(' ', b.house_no, b.street_name, b.city, b.route_code, b.sheet_route, b.field_notes, b.office_notes,
               (select string_agg(concat_ws(' ', p->>'first', p->>'last'), ' ') from jsonb_array_elements(b.people) p),
               array_to_string(b.phones, ' '), array_to_string(b.emails, ' '))) like '%' || v_q || '%'))
    select jsonb_build_object('total', (select count(*) from f),
      'rows', coalesce((select jsonb_agg(mb_booking_json(x) order by x.route_code nulls last, x.street_name, x.house_no)
                          from (select * from f order by route_code nulls last, street_name, house_no limit least(greatest(p_limit, 1), 1000) offset greatest(p_offset, 0)) x), '[]'::jsonb)));
end $$;
revoke all on function public.app_mb_list_bookings(uuid, text, text, text, text, text, int, int) from public, anon;
grant execute on function public.app_mb_list_bookings(uuid, text, text, text, text, text, int, int) to authenticated;

-- One booking, with its customer's history.
create or replace function public.app_mb_booking(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b mb_bookings;
begin
  select * into b from mb_bookings where id = p_id;
  if b.id is null then raise exception 'That booking doesn''t exist'; end if;
  perform mb_list_ok(b.list_id);
  return mb_booking_json(b) || jsonb_build_object(
    'list', (select jsonb_build_object('id', l.id, 'name', l.name, 'year', l.year) from mb_lists l where l.id = b.list_id),
    'history', coalesce((select c.history from clients c where c.id = b.client_id), '[]'::jsonb));
end $$;
revoke all on function public.app_mb_booking(uuid) from public, anon;
grant execute on function public.app_mb_booking(uuid) to authenticated;

-- Add or change a booking (the office). p: the fields to set. A new address (or point) places it
-- again on the maps; route_code given by hand sets map_how 'manual'.
create or replace function public.app_mb_booking_save(p_id uuid, p_list uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b mb_bookings; l mb_lists; v_new boolean := p_id is null; v_moved boolean := false; v_status text;
begin
  if v_new then
    l := mb_list_ok(p_list, true);
    if nullif(trim(p->>'house_no'), '') is null or nullif(trim(p->>'street_name'), '') is null then raise exception 'A booking needs a house number and street'; end if;
    insert into mb_bookings (list_id, house_no, street_name, street_norm, job_code, created_at, updated_by, booked_by, booked_at, source)
    values (l.id, trim(p->>'house_no'), trim(p->>'street_name'), coalesce(norm_street(p->>'street_name'), lower(trim(p->>'street_name'))),
            coalesce(nullif(p->>'job_code', ''), l.job_code, ''), now(), auth.uid(),
            (select coalesce(nullif(full_name, ''), username) from app_users where id = auth.uid()), to_char(now() at time zone 'America/Vancouver', 'YYYY-MM-DD HH24:MI'),
            jsonb_build_object('how', 'added'))
    returning * into b;
    v_moved := true;
  else
    select * into b from mb_bookings where id = p_id;
    if b.id is null then raise exception 'That booking doesn''t exist'; end if;
    perform mb_list_ok(b.list_id, true);
  end if;

  if p ? 'house_no' or p ? 'street_name' or p ? 'lat' or p ? 'lng' or p ? 'city' or p ? 'unit' then
    v_moved := v_moved or (p ? 'lat') or (p ? 'lng') or coalesce(p->>'house_no', b.house_no) is distinct from b.house_no
               or coalesce(p->>'street_name', b.street_name) is distinct from b.street_name;
  end if;
  v_status := coalesce(nullif(p->>'status', ''), b.status);
  if v_status not in ('open', 'done', 'cancelled') then raise exception 'Unknown status'; end if;

  update mb_bookings set
    house_no = coalesce(nullif(trim(p->>'house_no'), ''), house_no),
    street_name = coalesce(nullif(trim(p->>'street_name'), ''), street_name),
    street_norm = coalesce(norm_street(coalesce(nullif(trim(p->>'street_name'), ''), street_name)), street_norm),
    unit = case when p ? 'unit' then nullif(trim(p->>'unit'), '') else unit end,
    city = case when p ? 'city' then nullif(trim(p->>'city'), '') else city end,
    province = case when p ? 'province' then nullif(trim(p->>'province'), '') else province end,
    postal_code = case when p ? 'postal_code' then nullif(trim(p->>'postal_code'), '') else postal_code end,
    lat = case when p ? 'lat' then (p->>'lat')::float8 else lat end,
    lng = case when p ? 'lng' then (p->>'lng')::float8 else lng end,
    sheet_route = case when p ? 'sheet_route' then nullif(trim(p->>'sheet_route'), '') else sheet_route end,
    job_code = case when p ? 'job_code' then coalesce(p->>'job_code', '') else job_code end,
    services = case when p ? 'services' then coalesce(p->'services', '{}'::jsonb) else services end,
    property_type = case when p ? 'property_type' then nullif(p->>'property_type', '') else property_type end,
    prepaid = case when p ? 'prepaid' then coalesce((p->>'prepaid')::boolean, true) else prepaid end,
    people = case when p ? 'people' then coalesce(p->'people', '[]'::jsonb) else people end,
    phones = case when p ? 'phones' then coalesce(array(select jsonb_array_elements_text(p->'phones')), '{}') else phones end,
    emails = case when p ? 'emails' then coalesce(array(select jsonb_array_elements_text(p->'emails')), '{}') else emails end,
    field_notes = case when p ? 'field_notes' then nullif(p->>'field_notes', '') else field_notes end,
    office_notes = case when p ? 'office_notes' then nullif(p->>'office_notes', '') else office_notes end,
    status = v_status,
    done_on = case when v_status = 'done' and status <> 'done' then (now() at time zone 'America/Vancouver')::date
                   when v_status <> 'done' then null else done_on end,
    done_by_name = case when v_status = 'done' and status <> 'done' then 'Marked done by the office' when v_status <> 'done' then null else done_by_name end,
    done_by = case when v_status <> 'done' then null else done_by end,
    done_tx = case when v_status <> 'done' then null else done_tx end,
    done_services = case when v_status <> 'done' then null else done_services end,
    updated_at = now(), updated_by = auth.uid()
  where id = b.id;

  if p ? 'route_code' and nullif(trim(p->>'route_code'), '') is not null then
    update mb_bookings set route_code = upper(trim(p->>'route_code')), map_how = 'manual', moved_from = null,
           area_name = (select rm.area_name from route_maps rm where rm.route_code = upper(trim(p->>'route_code')) and rm.status = 'approved' limit 1),
           map_state = case when exists (select 1 from route_maps rm where rm.route_code = upper(trim(p->>'route_code')) and rm.status = 'approved') then 'on_map' else 'waiting' end,
           map_checked_at = now()
     where id = b.id;
  elsif v_moved then
    update mb_bookings set map_how = null where id = b.id and map_how = 'manual';
    perform mb_place(array[b.id]);
  end if;

  select * into b from mb_bookings where id = b.id;
  return mb_booking_json(b);
end $$;
revoke all on function public.app_mb_booking_save(uuid, uuid, jsonb) from public, anon;
grant execute on function public.app_mb_booking_save(uuid, uuid, jsonb) to authenticated;

-- Look at every waiting booking of a list again (after maps were built), or every booking.
create or replace function public.app_mb_place_again(p_list uuid, p_all boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  perform mb_list_ok(p_list, true);
  select array_agg(id) into v_ids from mb_bookings
   where list_id = p_list and (p_all or map_state in ('waiting', 'no_location'));
  return coalesce(mb_place(coalesce(v_ids, '{}')), 0);
end $$;
revoke all on function public.app_mb_place_again(uuid, boolean) from public, anon;
grant execute on function public.app_mb_place_again(uuid, boolean) to authenticated;

-- Waiting bookings by the sheet's route prefix (NVN, WHR…), so the busiest maps get built first.
create or replace function public.app_mb_waiting(p_list uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform mb_list_ok(p_list);
  return coalesce((
    with w as (select coalesce(substring(mb_norm_route(sheet_route) from '^[A-Z]+'), '—') prefix, mb_norm_route(sheet_route) code, city
                 from mb_bookings where list_id = p_list and map_state = 'waiting'),
         r as (select prefix, code, count(*)::int n from w group by 1, 2),
         x as (select w.prefix, count(*)::int n, to_jsonb(array_remove(array_agg(distinct w.city), null)) cities from w group by 1)
    select jsonb_agg(jsonb_build_object('prefix', x.prefix, 'n', x.n, 'cities', x.cities,
             'routes', (select jsonb_agg(jsonb_build_object('code', r.code, 'n', r.n) order by r.code) from r where r.prefix = x.prefix))
           order by x.n desc, x.prefix)
      from x), '[]'::jsonb);
end $$;
revoke all on function public.app_mb_waiting(uuid) from public, anon;
grant execute on function public.app_mb_waiting(uuid) to authenticated;

-- ───────────── importing a list ─────────────
-- What an import would do, row by row, without saving: already loaded, the customer it joins,
-- and where it lands on the maps.
-- in: [{i, key, house_no, street, unit, city, lat, lng, sheet_route}]
create or replace function public.app_mb_import_check(p_list uuid, p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_out jsonb := '[]'; p record; v_norm text;
begin
  perform mb_list_ok(p_list, true);
  if jsonb_array_length(p_rows) > 500 then raise exception 'At most 500 rows per call'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_norm := coalesce(norm_street(r->>'street'), lower(trim(r->>'street')));
    select * into p from mb_place_point((r->>'lat')::float8, (r->>'lng')::float8, v_norm, r->>'house_no', r->>'sheet_route');
    v_out := v_out || jsonb_build_object('i', r->'i',
      'already', exists (select 1 from mb_bookings b where b.list_id = p_list and b.source_key = r->>'key'),
      'client_id', client_find(r->>'house_no', v_norm, r->>'unit', r->>'city'),
      'route_code', p.route_code, 'area_name', p.area_name, 'map_state', p.map_state, 'how', p.how, 'moved_from', p.moved_from);
  end loop;
  return v_out;
end $$;
revoke all on function public.app_mb_import_check(uuid, jsonb) from public, anon;
grant execute on function public.app_mb_import_check(uuid, jsonb) to authenticated;

-- Save rows into a list. Rows already loaded (same key) are skipped. Each row joins the customer at
-- its address (a new customer record is made when there's none) and, when it carries a plan, gets
-- its plan. in: [{key, house_no, street, unit, city, province, postal_code, lat, lng, sheet_route,
-- people, phones, emails, field_notes, office_notes, job_code, services, property_type, prepaid,
-- plan: {kind, price}, this_year, booked_by, booked_at, source}]
create or replace function public.app_mb_import_save(p_list uuid, p_file text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l mb_lists; r jsonb; v_norm text; v_client uuid; v_plan uuid; v_id uuid; v_city text;
        n_added int := 0; n_already int := 0; n_new_clients int := 0; v_ids uuid[] := '{}';
begin
  l := mb_list_ok(p_list, true);
  if jsonb_array_length(p_rows) > 300 then raise exception 'At most 300 rows per call'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    continue when nullif(trim(r->>'house_no'), '') is null or nullif(trim(r->>'street'), '') is null;
    if exists (select 1 from mb_bookings b where b.list_id = p_list and b.source_key = r->>'key') then n_already := n_already + 1; continue; end if;
    v_norm := coalesce(norm_street(r->>'street'), lower(trim(r->>'street')));
    v_city := nullif(trim(r->>'city'), '');
    v_client := client_find(r->>'house_no', v_norm, r->>'unit', v_city);
    if v_client is null then
      insert into clients (address_key, house_no, street_name, street_norm, unit, city, province, postal_code, lat, lng, route_code, match_how, people, phones, emails)
      values (client_address_key(trim(r->>'house_no'), v_norm, r->>'unit', v_city), trim(r->>'house_no'), trim(r->>'street'), v_norm,
              nullif(trim(r->>'unit'), ''), v_city, coalesce(nullif(trim(r->>'province'), ''), case l.region when 'West' then 'BC' end), nullif(trim(r->>'postal_code'), ''),
              (r->>'lat')::float8, (r->>'lng')::float8, null, 'geocode',
              coalesce(r->'people', '[]'::jsonb), coalesce(array(select jsonb_array_elements_text(r->'phones')), '{}'),
              coalesce(array(select jsonb_array_elements_text(r->'emails')), '{}'))
      on conflict (address_key) do nothing
      returning id into v_client;
      if v_client is null then v_client := client_find(r->>'house_no', v_norm, r->>'unit', v_city); else n_new_clients := n_new_clients + 1; end if;
    end if;
    v_plan := null;
    if r ? 'plan' and jsonb_typeof(r->'plan') = 'object' then
      insert into mb_plans (kind, region, year, client_id, price, prepaid, source, created_by)
      values (coalesce(nullif(r->'plan'->>'kind', ''), 'other'), l.region, l.year, v_client,
              nullif(regexp_replace(coalesce(r->'plan'->>'price', ''), '[^0-9.]', '', 'g'), '')::numeric,
              coalesce((r->'plan'->>'prepaid')::boolean, true), jsonb_build_object('file', p_file, 'key', r->>'key'), auth.uid())
      returning id into v_plan;
    end if;
    insert into mb_bookings (list_id, plan_id, client_id, house_no, street_name, street_norm, unit, city, province, postal_code, lat, lng,
                             sheet_route, job_code, services, property_type, prepaid, people, phones, emails, field_notes, office_notes,
                             this_year, booked_by, booked_at, source, source_key, updated_by)
    values (p_list, v_plan, v_client, trim(r->>'house_no'), trim(r->>'street'), v_norm, nullif(trim(r->>'unit'), ''), v_city,
            coalesce(nullif(trim(r->>'province'), ''), case l.region when 'West' then 'BC' end), nullif(trim(r->>'postal_code'), ''),
            (r->>'lat')::float8, (r->>'lng')::float8, nullif(trim(r->>'sheet_route'), ''),
            coalesce(nullif(r->>'job_code', ''), l.job_code, ''), coalesce(r->'services', '{}'::jsonb), nullif(r->>'property_type', ''),
            coalesce((r->>'prepaid')::boolean, true), coalesce(r->'people', '[]'::jsonb),
            coalesce(array(select jsonb_array_elements_text(r->'phones')), '{}'), coalesce(array(select jsonb_array_elements_text(r->'emails')), '{}'),
            nullif(r->>'field_notes', ''), nullif(r->>'office_notes', ''), coalesce(r->'this_year', '[]'::jsonb),
            nullif(r->>'booked_by', ''), nullif(r->>'booked_at', ''),
            coalesce(r->'source', '{}'::jsonb) || jsonb_build_object('file', p_file, 'how', 'import'), r->>'key', auth.uid())
    returning id into v_id;
    v_ids := v_ids || v_id;
    n_added := n_added + 1;
  end loop;
  perform mb_place(v_ids);
  update clients c set route_code = b.route_code, updated_at = now()
    from mb_bookings b
   where b.id = any(v_ids) and b.client_id = c.id and c.route_code is null and b.map_state in ('on_map', 'moved');
  return jsonb_build_object('added', n_added, 'already', n_already, 'new_clients', n_new_clients,
    'states', (select coalesce(jsonb_object_agg(map_state, n), '{}'::jsonb) from (select map_state, count(*)::int n from mb_bookings where id = any(v_ids) group by 1) s));
end $$;
revoke all on function public.app_mb_import_save(uuid, text, jsonb) from public, anon;
grant execute on function public.app_mb_import_save(uuid, text, jsonb) to authenticated;

-- ───────────── the day feed ─────────────
-- The open bookings on these routes for the lists this center works, shaped as the old app's
-- prebooks (Feed Placeholder rows), with what the crew card shows under "mb".
create or replace function public.app_mb_day_bookings(p_center uuid, p_routes text[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (coalesce(app_is_super_admin(), false) or coalesce(app_has_perm('workerbook'), false) or coalesce(app_has_perm('bookings'), false))
     or not app_can_see_center(p_center) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'Booking ID', 'mb:' || b.id,
      'Route Number', b.route_code,
      'First Name', coalesce(b.people->0->>'first', ''),
      'Last Name', coalesce(b.people->0->>'last', ''),
      'House Number', b.house_no || coalesce('-' || nullif(b.unit, ''), ''),
      'Street Name', b.street_name,
      'Full Address', trim(b.house_no || ' ' || b.street_name),
      'Home Phone', b.phones[1], 'Cell Phone', b.phones[2], 'Email Address', b.emails[1],
      'Price', nullif(b.job_code, ''),
      'FO/BO/FP', b.property_type,
      'Prepaid', case when b.prepaid then 'x' end,
      'Log Sheet Notes', coalesce(b.field_notes, ''),
      'Status', 'pending',
      'isPrebooked', true,
      'commandCenterId', p_center::text,
      'services', b.services,
      'mb', jsonb_build_object(
        'id', b.id, 'list', l.name, 'jobCode', b.job_code, 'prepaid', b.prepaid,
        'plan', (select case p.kind when 'sp_pro' then 'SP Pro' when 'star_plan' then 'Star Plan' when 'grub' then 'Grub Control'
                                    when 'chafer' then 'Chafer Beetle' when 'sppp' then 'SP Protection Plus' else 'Plan' end from mb_plans p where p.id = b.plan_id),
        'fieldNotes', b.field_notes,
        'attempts', (select coalesce(jsonb_agg(a order by a->>'at' desc), '[]'::jsonb) from (select a from jsonb_array_elements(b.attempts) a order by a->>'at' desc limit 5) z),
        'thisYear', b.this_year,
        'history', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('year', h->>'year', 'service', h->>'service', 'line', h->>'line',
                                                'price', h->>'price', 'contractor', h->>'contractor', 'product', h->>'product'))), '[]'::jsonb)
                      from (select h from clients c, jsonb_array_elements(c.history) h where c.id = b.client_id
                             order by (h->>'year') desc nulls last limit 8) hh),
        'lat', b.lat, 'lng', b.lng))) order by b.route_code, b.street_name, b.house_no)
      from mb_bookings b join mb_lists l on l.id = b.list_id
     where l.center_id = p_center and b.status = 'open' and b.map_state in ('on_map', 'moved')
       and upper(b.route_code) = any (select upper(x) from unnest(p_routes) x)), '[]'::jsonb);
end $$;
revoke all on function public.app_mb_day_bookings(uuid, text[]) from public, anon;
grant execute on function public.app_mb_day_bookings(uuid, text[]) to authenticated;

-- Booking dots for maps (the route picker and Master Bookings): every booking of the center's
-- lists on these areas' routes. [id, lat, lng, route, status, tried, name, job]
create or replace function public.app_mb_area_bookings(p_center uuid, p_areas text[], p_service text default null, p_year int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (coalesce(app_is_super_admin(), false) or coalesce(app_has_perm('workerbook'), false) or coalesce(app_has_perm('bookings'), false))
     or not app_can_see_center(p_center) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_array(b.id, round(b.lat::numeric, 6), round(b.lng::numeric, 6), b.route_code, b.status,
             jsonb_array_length(b.attempts) > 0, nullif(trim(concat_ws(' ', b.people->0->>'first', b.people->0->>'last')), ''), b.job_code,
             trim(b.house_no || ' ' || b.street_name)))
      from mb_bookings b join mb_lists l on l.id = b.list_id
     where l.center_id = p_center and b.lat is not null
       and (p_service is null or l.service = p_service) and (p_year is null or l.year = p_year)
       and b.area_name = any (p_areas)), '[]'::jsonb);
end $$;
revoke all on function public.app_mb_area_bookings(uuid, text[], text, int) from public, anon;
grant execute on function public.app_mb_area_bookings(uuid, text[], text, int) to authenticated;

-- Booking counts by master map for a center's season (Master Bookings cards).
create or replace function public.app_mb_area_counts(p_center uuid, p_service text, p_year int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform mb_check_center(p_center);
  return coalesce((
    select jsonb_object_agg(x.area_name, jsonb_build_object('total', x.total, 'done', x.done, 'open', x.open, 'cancelled', x.cancelled))
      from (select b.area_name, count(*)::int total, count(*) filter (where b.status = 'done')::int done,
                   count(*) filter (where b.status = 'open')::int open, count(*) filter (where b.status = 'cancelled')::int cancelled
              from mb_bookings b join mb_lists l on l.id = b.list_id
             where l.center_id = p_center and l.service = p_service and l.year = p_year and b.area_name is not null
             group by 1) x), '{}'::jsonb);
end $$;
revoke all on function public.app_mb_area_counts(uuid, text, int) from public, anon;
grant execute on function public.app_mb_area_counts(uuid, text, int) to authenticated;

-- A route's bookings (Master Bookings level 3).
create or replace function public.app_mb_route_bookings(p_center uuid, p_route text, p_service text, p_year int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform mb_check_center(p_center);
  return coalesce((
    select jsonb_agg(mb_booking_json(b) order by b.street_name, b.house_no)
      from mb_bookings b join mb_lists l on l.id = b.list_id
     where l.center_id = p_center and l.service = p_service and l.year = p_year and upper(b.route_code) = upper(p_route)), '[]'::jsonb);
end $$;
revoke all on function public.app_mb_route_bookings(uuid, text, text, int) from public, anon;
grant execute on function public.app_mb_route_bookings(uuid, text, text, int) to authenticated;

-- ───────────── plans ─────────────
-- Every plan in the center's region (all seasons), with its customer and its bookings.
create or replace function public.app_mb_plans(p_center uuid, p_kind text default null, p_year int default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_region text;
begin
  perform mb_check_center(p_center);
  select region into v_region from command_centers where id = p_center;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'kind', p.kind, 'year', p.year, 'price', p.price, 'prepaid', p.prepaid, 'note', p.note, 'created_at', p.created_at,
             'client', (select jsonb_build_object('id', c.id, 'address', trim(concat_ws(' ', c.house_no, c.street_name)) || coalesce(' #' || nullif(c.unit, ''), ''),
                                                  'city', c.city, 'name', nullif(trim(concat_ws(' ', c.people->0->>'first', c.people->0->>'last')), ''))
                          from clients c where c.id = p.client_id),
             'bookings', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'list', l.name, 'part', l.part, 'status', b.status, 'done_on', b.done_on,
                                                     'route_code', b.route_code, 'job_code', b.job_code, 'tried', jsonb_array_length(b.attempts))
                                   order by l.year, case l.part when 'spring' then 1 when 'summer' then 2 else 3 end), '[]'::jsonb)
                            from mb_bookings b join mb_lists l on l.id = b.list_id where b.plan_id = p.id))
           order by p.year desc, p.kind, p.created_at)
      from mb_plans p
     where p.region = v_region and (p_kind is null or p.kind = p_kind) and (p_year is null or p.year = p_year)), '[]'::jsonb);
end $$;
revoke all on function public.app_mb_plans(uuid, text, int) from public, anon;
grant execute on function public.app_mb_plans(uuid, text, int) to authenticated;

-- ───────────── what the crew did flows back ─────────────
-- A finished job on an "mb:" booking marks it done; deleting that job opens it again.
create or replace function public.mb_from_transaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_day date;
begin
  if tg_op = 'DELETE' then
    if old.job_id like 'mb:%' then
      begin v_id := substring(old.job_id from 4)::uuid; exception when others then return null; end;
      update mb_bookings set status = 'open', done_on = null, done_by = null, done_by_name = null, done_services = null, done_tx = null, updated_at = now()
       where id = v_id and done_tx = old.id;
    end if;
    return null;
  end if;
  if new.job_id like 'mb:%' and coalesce(new.type, '') = 'Production' then
    begin v_id := substring(new.job_id from 4)::uuid; exception when others then return null; end;
    select bk.session_date into v_day from bookings bk where bk.booking_id = new.job_id and bk.command_center_id = new.command_center_id
     order by bk.session_date desc nulls last limit 1;
    update mb_bookings set status = 'done',
           done_on = coalesce(v_day, (coalesce(new."timestamp", now()) at time zone 'America/Vancouver')::date),
           done_by = new.worker_id, done_by_name = new.worker_name, done_services = nullif(new.services, '{}'::jsonb),
           done_tx = new.id, updated_at = now()
     where id = v_id and (status <> 'done' or done_tx is distinct from new.id or done_services is distinct from nullif(new.services, '{}'::jsonb));
  end if;
  return null;
end $$;
revoke all on function public.mb_from_transaction() from public, anon, authenticated;
drop trigger if exists mb_from_transaction on public.transactions;
create trigger mb_from_transaction after insert or update or delete on public.transactions
  for each row execute function public.mb_from_transaction();

-- Next time / Cancelled / back to pending on an "mb:" booking in the day's session.
create or replace function public.mb_from_session_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_day text := coalesce(new.session_date::text, (now() at time zone 'America/Vancouver')::date::text); v_try jsonb;
begin
  if new.booking_id not like 'mb:%' or new.status is not distinct from old.status then return null; end if;
  begin v_id := substring(new.booking_id from 4)::uuid; exception when others then return null; end;
  if new.status in ('next_time', 'cancelled') then
    v_try := jsonb_strip_nulls(jsonb_build_object('day', v_day, 'kind', new.status, 'by', new.contractor_id,
               'reason', nullif(trim(coalesce(new.attempt_reason, '')), ''), 'note', nullif(trim(coalesce(new.attempt_note, '')), ''), 'at', now()));
    update mb_bookings set
           attempts = coalesce((select jsonb_agg(a) from jsonb_array_elements(attempts) a where a->>'day' is distinct from v_day), '[]'::jsonb) || v_try,
           status = case when new.status = 'cancelled' and status = 'open' then 'cancelled' else status end,
           updated_at = now()
     where id = v_id and status <> 'done';
  elsif new.status = 'pending' and old.status in ('next_time', 'cancelled') then
    update mb_bookings set
           attempts = coalesce((select jsonb_agg(a) from jsonb_array_elements(attempts) a where a->>'day' is distinct from v_day), '[]'::jsonb),
           status = case when status = 'cancelled' then 'open' else status end,
           updated_at = now()
     where id = v_id and status <> 'done';
  end if;
  return null;
end $$;
revoke all on function public.mb_from_session_booking() from public, anon, authenticated;
drop trigger if exists mb_from_session_booking on public.bookings;
create trigger mb_from_session_booking after update of status on public.bookings
  for each row execute function public.mb_from_session_booking();
