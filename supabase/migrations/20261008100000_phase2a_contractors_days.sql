-- Phase 2a · contractors and days.
--
-- ADDITIVE ONLY. The old `contractors` table (onboarding, training, shuttle
-- emails) stays exactly as it is; new hires link back to it by legacy_contractor_id.
--
--   people        one row per real person, kept forever (lifetime days, hats per service)
--   hires         that person's year at a home center: a new CN # every year
--   status_entries every move onto or off a status list (NS, WDR, TNB, SNOW, Q, F, WL)
--   days          one row per center per date (planned → live → closed)
--   day_roster    who is booked on a day, confirmation, attendance, manager / team
--
-- ID numbers (SIN, licence, health card, passport) have no column here and are never imported.

-- ───────────────────────── people & hires ─────────────────────────
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null default '',
  cell_phone text,
  alt_phone text,
  email text,
  address text,
  first_year int check (first_year between 2000 and 2100),       -- first season worked (Alumni counts from year 2)
  lifetime_days int not null default 0 check (lifetime_days >= 0), -- days worked before this app; app days add on top
  hats jsonb not null default '{"AER":0,"RJ":0,"SE":0,"CL":0}',     -- lifetime Silver Hats per service before this app
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists people_cell_digits on public.people ((right(regexp_replace(coalesce(cell_phone, ''), '\D', '', 'g'), 10)));

create table if not exists public.hires (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete restrict,
  center_id uuid not null references public.command_centers(id) on delete restrict,  -- home center (sets the CN # prefix)
  year int not null check (year between 2000 and 2100),
  cn text not null check (cn ~ '^[A-Z]{1,5}[0-9]{1,6}$'),
  shuttle text,
  status text not null default 'active' check (status in ('active','NS','WDR','TNB','SNOW','Q','F','WL')),
  status_since date,
  ns_count int not null default 0 check (ns_count >= 0),              -- no-shows before this app
  alumni_rate numeric(6,2),                                           -- $/EQ from the sheet, kept until the rate card takes over
  silver_rate numeric(6,2),
  legacy_contractor_id uuid,                                          -- the matching row in the old contractors table
  pin_hash text,                                                      -- worker login (phase 2 · worker app)
  pin_set_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year, cn),
  unique (person_id, year)
);
create index if not exists hires_center_year on public.hires (center_id, year);

create table if not exists public.status_entries (
  id bigint generated always as identity primary key,
  hire_id uuid not null references public.hires(id) on delete cascade,
  status text not null,
  since date not null default current_date,
  from_day_id uuid,
  set_by uuid,
  set_at timestamptz not null default now()
);
create index if not exists status_entries_hire on public.status_entries (hire_id, set_at desc);

-- ───────────────────────── days & roster ─────────────────────────
create table if not exists public.days (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.command_centers(id) on delete restrict,
  day date not null,
  state text not null default 'planned' check (state in ('planned','live','closed')),
  notes text,
  created_at timestamptz not null default now(),
  unique (center_id, day)
);

create table if not exists public.day_roster (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references public.days(id) on delete cascade,
  hire_id uuid not null references public.hires(id) on delete restrict,
  shuttle text,
  manager_id uuid references public.app_users(id) on delete set null,
  team text,
  confirmed_at timestamptz,
  confirmed_via text check (confirmed_via in ('staff','email','text','worker')),
  attendance text check (attendance in ('showed','no_show')),
  next_day date,
  rolled_at timestamptz,
  notes text,
  added_by uuid,
  created_at timestamptz not null default now(),
  unique (day_id, hire_id),
  check ((confirmed_at is null) = (confirmed_via is null))
);
create index if not exists day_roster_hire on public.day_roster (hire_id);

-- ───────────────────────── rules ─────────────────────────
-- status_since: the day the current status started (today, unless the caller set it).
create or replace function public.hires_status_log()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.status_since := coalesce(new.status_since, current_date);
  elsif new.status is distinct from old.status and new.status_since is not distinct from old.status_since then
    new.status_since := current_date;
  end if;
  return new;
end $$;
drop trigger if exists status_since on public.hires;
create trigger status_since before insert or update on public.hires for each row execute function public.hires_status_log();

create or replace function public.hires_status_entry()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into status_entries (hire_id, status, since, set_by) values (new.id, new.status, coalesce(new.status_since, current_date), auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists status_entry on public.hires;
create trigger status_entry after insert or update on public.hires for each row execute function public.hires_status_entry();

-- WL (waitlist) can't be booked; nothing on a closed day changes (Super Admin excepted).
create or replace function public.day_roster_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_state text; v_status text;
begin
  select state into v_state from days where id = coalesce(new.day_id, old.day_id);
  if v_state = 'closed' and not app_is_super_admin() then
    raise exception 'This day is closed and can no longer be changed';
  end if;
  if tg_op = 'INSERT' then
    select status into v_status from hires where id = new.hire_id;
    if v_status = 'WL' then raise exception 'This contractor is on the waitlist (WL) and can''t be booked until they''re taken off'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists guard on public.day_roster;
create trigger guard before insert or update or delete on public.day_roster for each row execute function public.day_roster_guard();

drop trigger if exists touch on public.people;
create trigger touch before update on public.people for each row execute function public.touch_updated_at();
drop trigger if exists touch on public.hires;
create trigger touch before update on public.hires for each row execute function public.touch_updated_at();

do $$ declare t text; begin
  foreach t in array array['people','hires','days','day_roster'] loop
    execute format('drop trigger if exists audit on public.%I', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ───────────────────────── CN numbers ─────────────────────────
-- Next CN # for a center and year: the center's prefix + the next number after the highest used.
create or replace function public.app_next_cn(p_center uuid, p_year int)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_prefix text; v_max int;
begin
  if not app_has_perm('workerbook') then raise exception 'Not allowed'; end if;
  select upper(coalesce(nullif(trim(cn_prefix), ''), 'X')) into v_prefix from command_centers where id = p_center;
  if v_prefix is null then raise exception 'Unknown center'; end if;
  select max((regexp_replace(cn, '^[A-Z]+', ''))::int) into v_max
    from hires where year = p_year and cn ~ ('^' || v_prefix || '[0-9]+$');
  return v_prefix || greatest(coalesce(v_max, 1000) + 1, 1001)::text;
end $$;
revoke all on function public.app_next_cn(uuid, int) from public, anon;
grant execute on function public.app_next_cn(uuid, int) to authenticated;

-- ───────────────────────── import from the Workerbook Contractors tab ─────────────────────────
-- p_rows: [{cn, first, last, cell, alt, email, shuttle, status, days, ns, alm, slv, returning, hats:{AER,RJ,SE,CL}}]
-- Matching, so a re-run never duplicates: same CN # this year → that hire; else same cell phone
-- (last 10 digits) → that person; else a new person. Returns counts and a reason for each skipped row.
create or replace function public.app_import_contractors(p_center uuid, p_year int, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; v_cn text; v_first text; v_last text; v_cell text; v_digits text; v_status text;
  v_person uuid; v_hire uuid; v_legacy uuid;
  n_read int := 0; n_new_people int := 0; n_new_hires int := 0; n_updated int := 0; skipped jsonb := '[]'::jsonb;
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a list'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    n_read := n_read + 1;
    v_cn := upper(regexp_replace(coalesce(r->>'cn', ''), '\s', '', 'g'));
    v_first := nullif(trim(coalesce(r->>'first', '')), '');
    v_last := trim(coalesce(r->>'last', ''));
    v_cell := nullif(trim(coalesce(r->>'cell', '')), '');
    v_digits := right(regexp_replace(coalesce(v_cell, ''), '\D', '', 'g'), 10);
    v_status := upper(coalesce(nullif(trim(r->>'status'), ''), 'ACTIVE'));
    if v_status not in ('NS','WDR','TNB','SNOW','Q','F','WL') then v_status := 'active'; end if;

    if v_cn !~ '^[A-Z]{1,5}[0-9]{1,6}$' then
      skipped := skipped || jsonb_build_object('row', n_read, 'cn', r->>'cn', 'reason', 'No valid CN #'); continue;
    end if;
    if v_first is null then
      skipped := skipped || jsonb_build_object('row', n_read, 'cn', v_cn, 'reason', 'No first name'); continue;
    end if;

    select id, person_id into v_hire, v_person from hires where year = p_year and cn = v_cn;
    if v_hire is not null and (select center_id from hires where id = v_hire) <> p_center then
      skipped := skipped || jsonb_build_object('row', n_read, 'cn', v_cn, 'reason', 'CN # already used at another center this year'); continue;
    end if;

    if v_person is null and length(v_digits) = 10 then
      select id into v_person from people
       where right(regexp_replace(coalesce(cell_phone, ''), '\D', '', 'g'), 10) = v_digits
       order by created_at limit 1;
    end if;

    if v_person is null then
      insert into people (first_name, last_name, cell_phone, alt_phone, email, first_year, lifetime_days, hats)
      values (v_first, v_last, v_cell, nullif(trim(coalesce(r->>'alt', '')), ''), nullif(lower(trim(coalesce(r->>'email', ''))), ''),
              case when coalesce((r->>'returning')::boolean, false) then p_year - 1 else p_year end,
              greatest(coalesce((r->>'days')::int, 0), 0),
              jsonb_build_object('AER', greatest(coalesce((r->'hats'->>'AER')::int, 0), 0), 'RJ', greatest(coalesce((r->'hats'->>'RJ')::int, 0), 0),
                                 'SE', greatest(coalesce((r->'hats'->>'SE')::int, 0), 0), 'CL', greatest(coalesce((r->'hats'->>'CL')::int, 0), 0)))
      returning id into v_person;
      n_new_people := n_new_people + 1;
    else
      update people set
        first_name = v_first, last_name = v_last,
        cell_phone = coalesce(v_cell, cell_phone),
        alt_phone = coalesce(nullif(trim(coalesce(r->>'alt', '')), ''), alt_phone),
        email = coalesce(nullif(lower(trim(coalesce(r->>'email', ''))), ''), email),
        lifetime_days = greatest(lifetime_days, coalesce((r->>'days')::int, 0)),
        hats = jsonb_build_object(
          'AER', greatest(coalesce((hats->>'AER')::int, 0), coalesce((r->'hats'->>'AER')::int, 0)),
          'RJ',  greatest(coalesce((hats->>'RJ')::int, 0),  coalesce((r->'hats'->>'RJ')::int, 0)),
          'SE',  greatest(coalesce((hats->>'SE')::int, 0),  coalesce((r->'hats'->>'SE')::int, 0)),
          'CL',  greatest(coalesce((hats->>'CL')::int, 0),  coalesce((r->'hats'->>'CL')::int, 0)))
       where id = v_person;
    end if;

    select id into v_legacy from contractors where upper(contractor_id) = v_cn and command_center_id::text = p_center::text limit 1;

    if v_hire is null then
      -- the same person may already be hired this year under another CN # (a re-numbered row)
      select id into v_hire from hires where person_id = v_person and year = p_year;
      if v_hire is not null then
        skipped := skipped || jsonb_build_object('row', n_read, 'cn', v_cn, 'reason', 'Same phone as ' || (select cn from hires where id = v_hire) || ' this year');
        continue;
      end if;
      insert into hires (person_id, center_id, year, cn, shuttle, status, ns_count, alumni_rate, silver_rate, legacy_contractor_id)
      values (v_person, p_center, p_year, v_cn, nullif(trim(coalesce(r->>'shuttle', '')), ''), v_status,
              greatest(coalesce((r->>'ns')::int, 0), 0), (r->>'alm')::numeric, (r->>'slv')::numeric, v_legacy);
      n_new_hires := n_new_hires + 1;
    else
      update hires set shuttle = coalesce(nullif(trim(coalesce(r->>'shuttle', '')), ''), shuttle),
                       status = v_status, ns_count = greatest(ns_count, coalesce((r->>'ns')::int, 0)),
                       alumni_rate = coalesce((r->>'alm')::numeric, alumni_rate), silver_rate = coalesce((r->>'slv')::numeric, silver_rate),
                       legacy_contractor_id = coalesce(legacy_contractor_id, v_legacy)
       where id = v_hire;
      n_updated := n_updated + 1;
    end if;
  end loop;

  insert into audit_log (actor, entity, entity_id, action, after)
  values (auth.uid(), 'contractor_import', p_center::text, 'import',
          jsonb_build_object('year', p_year, 'read', n_read, 'new_people', n_new_people, 'new_hires', n_new_hires, 'updated', n_updated, 'skipped', jsonb_array_length(skipped)));

  return jsonb_build_object('read', n_read, 'new_people', n_new_people, 'new_hires', n_new_hires, 'updated', n_updated, 'skipped', skipped);
end $$;
revoke all on function public.app_import_contractors(uuid, int, jsonb) from public, anon;
grant execute on function public.app_import_contractors(uuid, int, jsonb) to authenticated;

-- Book contractors onto a date at a center (creates the day if needed). Waitlisted (WL) people are
-- skipped. Returns how many were added.
create or replace function public.app_book(p_center uuid, p_day date, p_hires uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_day uuid; v_n int;
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  insert into days (center_id, day) values (p_center, p_day) on conflict (center_id, day) do nothing;
  select id into v_day from days where center_id = p_center and day = p_day;
  insert into day_roster (day_id, hire_id, shuttle, added_by)
  select v_day, h.id, h.shuttle, auth.uid() from hires h where h.id = any(p_hires) and h.status <> 'WL'
  on conflict (day_id, hire_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.app_book(uuid, date, uuid[]) from public, anon;
grant execute on function public.app_book(uuid, date, uuid[]) to authenticated;

-- ───────────────────────── row-level security ─────────────────────────
alter table public.people enable row level security;
alter table public.hires enable row level security;
alter table public.status_entries enable row level security;
alter table public.days enable row level security;
alter table public.day_roster enable row level security;

-- Contractors are bookable at any center, so Workerbook holders can read every contractor;
-- only their home center's Workerbook holders change a hire.
drop policy if exists people_read on public.people;
create policy people_read on public.people for select to authenticated using (app_has_perm('workerbook'));
drop policy if exists people_write on public.people;
create policy people_write on public.people for insert to authenticated with check (app_has_perm('workerbook'));
drop policy if exists people_update on public.people;
create policy people_update on public.people for update to authenticated using (app_has_perm('workerbook')) with check (app_has_perm('workerbook'));

drop policy if exists hires_read on public.hires;
create policy hires_read on public.hires for select to authenticated using (app_has_perm('workerbook'));
drop policy if exists hires_insert on public.hires;
create policy hires_insert on public.hires for insert to authenticated
  with check (app_has_perm('workerbook') and app_can_see_center(center_id));
drop policy if exists hires_update on public.hires;
create policy hires_update on public.hires for update to authenticated
  using (app_has_perm('workerbook') and app_can_see_center(center_id))
  with check (app_has_perm('workerbook') and app_can_see_center(center_id));

drop policy if exists status_entries_read on public.status_entries;
create policy status_entries_read on public.status_entries for select to authenticated using (app_has_perm('workerbook'));

drop policy if exists days_read on public.days;
create policy days_read on public.days for select to authenticated
  using (app_can_see_center(center_id) and (app_has_perm('workerbook') or app_has_perm('route_manager')));
drop policy if exists days_write on public.days;
create policy days_write on public.days for insert to authenticated
  with check (app_has_perm('workerbook') and app_can_see_center(center_id));
drop policy if exists days_update on public.days;
create policy days_update on public.days for update to authenticated
  using (app_has_perm('workerbook') and app_can_see_center(center_id))
  with check (app_has_perm('workerbook') and app_can_see_center(center_id));

drop policy if exists roster_read on public.day_roster;
create policy roster_read on public.day_roster for select to authenticated
  using (exists (select 1 from days d where d.id = day_id and app_can_see_center(d.center_id)
                 and (app_has_perm('workerbook') or app_has_perm('route_manager'))));
drop policy if exists roster_write on public.day_roster;
create policy roster_write on public.day_roster for all to authenticated
  using (exists (select 1 from days d where d.id = day_id and app_can_see_center(d.center_id) and app_has_perm('workerbook')))
  with check (exists (select 1 from days d where d.id = day_id and app_can_see_center(d.center_id) and app_has_perm('workerbook')));

-- The PIN hash is never readable from the app.
revoke all on public.people, public.hires, public.status_entries, public.days, public.day_roster from anon;
grant select, insert, update on public.people to authenticated;
grant select (id, person_id, center_id, year, cn, shuttle, status, status_since, ns_count, alumni_rate, silver_rate,
              legacy_contractor_id, pin_set_at, created_at, updated_at) on public.hires to authenticated;
grant insert (person_id, center_id, year, cn, shuttle, status, status_since, ns_count, alumni_rate, silver_rate, legacy_contractor_id)
  on public.hires to authenticated;
grant update (shuttle, status, status_since, ns_count, alumni_rate, silver_rate) on public.hires to authenticated;
grant select on public.status_entries to authenticated;
grant select, insert, update on public.days to authenticated;
grant select, insert, update, delete on public.day_roster to authenticated;
