-- Phase 1 of the CPSDMS refactor: people, permissions, command centers, seasons, rate cards.
--
-- Everything here is ADDITIVE. The existing app keeps using its own tables
-- (users, command_centers, daily_sessions …) unchanged until each center is
-- switched over. New logins go through Supabase Auth; a manager's username is
-- mapped to an internal login address  <username>@login.cpsdms.app  so the real
-- email never has to be unique or verified.

-- ───────────────────────── command centers: new settings ─────────────────────────
alter table public.command_centers
  add column if not exists services text[] not null default '{}',
  add column if not exists cn_prefix text,
  add column if not exists local_number text,
  add column if not exists review_link text,
  add column if not exists tax_name text,
  add column if not exists tax_rate numeric(5,2),
  add column if not exists is_active boolean not null default true;

-- ───────────────────────── people ─────────────────────────
create table if not exists public.app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z]{5}[0-9]*$'),
  full_name text not null,
  phone text,
  email text,
  is_super_admin boolean not null default false,
  rm_center_id uuid references public.command_centers(id) on delete set null,
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_permissions (
  user_id uuid not null references public.app_users(id) on delete cascade,
  permission text not null check (permission in
    ('route_manager','workerbook','bookings','dialer','sa_users','sa_territory','sa_reporting')),
  primary key (user_id, permission)
);

create table if not exists public.user_centers (
  user_id uuid not null references public.app_users(id) on delete cascade,
  center_id uuid not null references public.command_centers(id) on delete cascade,
  primary key (user_id, center_id)
);

-- Managers are available every day unless a day off is recorded here.
create table if not exists public.manager_days_off (
  user_id uuid not null references public.app_users(id) on delete cascade,
  day date not null,
  primary key (user_id, day)
);

-- ───────────────────────── seasons & rate cards ─────────────────────────
create table if not exists public.seasons (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.command_centers(id) on delete cascade,
  service text not null check (service in ('aeration','lawn_rejuv','sealing','cleaning')),
  year int not null check (year between 2000 and 2100),
  starts_on date not null,
  ends_on date not null,
  closed_at timestamptz,
  closed_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (center_id, service, year)
);

-- A rate card version applies from effective_from until the next version starts.
create table if not exists public.rate_cards (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.seasons(id) on delete cascade,
  version int not null,
  effective_from date not null,
  data jsonb not null,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  unique (season_id, version)
);

-- ───────────────────────── audit ─────────────────────────
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  entity text not null,
  entity_id text,
  action text not null,
  before jsonb,
  after jsonb
);

-- ───────────────────────── helpers ─────────────────────────
create or replace function public.app_is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_super_admin and is_active from app_users where id = auth.uid()), false)
$$;

create or replace function public.app_has_perm(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select app_is_super_admin()
      or exists (select 1 from user_permissions up join app_users u on u.id = up.user_id
                 where up.user_id = auth.uid() and up.permission = p and u.is_active)
$$;

create or replace function public.app_can_see_center(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select app_is_super_admin()
      or exists (select 1 from user_centers uc join app_users u on u.id = uc.user_id
                 where uc.user_id = auth.uid() and uc.center_id = c and u.is_active)
$$;

-- Seasons may not overlap at a center.
create or replace function public.seasons_no_overlap()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from seasons s
             where s.center_id = new.center_id and s.id <> new.id
               and daterange(s.starts_on, s.ends_on, '[]') && daterange(new.starts_on, new.ends_on, '[]')) then
    raise exception 'Seasons at a center cannot overlap' using errcode = '23P01';
  end if;
  return new;
end $$;
drop trigger if exists seasons_no_overlap on public.seasons;
create trigger seasons_no_overlap before insert or update on public.seasons
  for each row execute function public.seasons_no_overlap();

-- Rate card versions are append-only and numbered automatically.
create or replace function public.rate_cards_version()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Rate cards cannot be edited; save a new version instead';
  end if;
  select coalesce(max(version), 0) + 1 into new.version from rate_cards where season_id = new.season_id;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;
drop trigger if exists rate_cards_version on public.rate_cards;
create trigger rate_cards_version before insert or update on public.rate_cards
  for each row execute function public.rate_cards_version();

-- Generic audit trigger for money and people tables.
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor, entity, entity_id, action, before, after)
  values (auth.uid(), tg_table_name,
          coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id',
                   (case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'user_id'),
          lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
do $$ declare t text; begin
  foreach t in array array['app_users','user_permissions','user_centers','seasons','rate_cards'] loop
    execute format('drop trigger if exists audit on public.%I', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists touch on public.app_users;
create trigger touch before update on public.app_users for each row execute function public.touch_updated_at();

-- ───────────────────────── usernames ─────────────────────────
-- Same rule as route-manager logins today: first 3 letters of the last name +
-- first 2 of the first name, lower-case; a clash gets 2, 3, …
create or replace function public.app_make_username(p_full_name text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := regexp_split_to_array(trim(lower(p_full_name)), '\s+');
  first_n text := regexp_replace(coalesce(parts[1], ''), '[^a-z]', '', 'g');
  last_n text := regexp_replace(coalesce(array_to_string(parts[2:array_length(parts,1)], ''), ''), '[^a-z]', '', 'g');
  base text;
  candidate text;
  n int := 1;
begin
  if last_n = '' then last_n := first_n; end if;
  base := rpad(left(last_n, 3), 3, 'x') || rpad(left(first_n, 2), 2, 'x');
  candidate := base;
  while exists (select 1 from app_users where username = candidate) loop
    n := n + 1;
    candidate := base || n;
  end loop;
  return candidate;
end $$;

-- ───────────────────────── account management (Super Admin → User Management) ─────────────────────────
-- Accounts are created inside the database so the browser never needs a service key.
create or replace function public.app_create_auth_user(p_username text, p_password text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := gen_random_uuid();
  login text := p_username || '@login.cpsdms.app';
begin
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'Password must be at least 8 characters';
  end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', login,
          crypt(p_password, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', jsonb_build_object('username', p_username),
          now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
          jsonb_build_object('sub', uid::text, 'email', login, 'email_verified', true),
          'email', now(), now(), now());
  return uid;
end $$;
revoke all on function public.app_create_auth_user(text, text) from public, anon, authenticated;

create or replace function public.app_admin_create_user(
  p_full_name text, p_password text, p_phone text default null, p_email text default null,
  p_permissions text[] default '{}', p_centers uuid[] default '{}', p_rm_center uuid default null)
returns table (id uuid, username text) language plpgsql security definer set search_path = public as $$
declare
  v_username text;
  v_id uuid;
begin
  if not app_has_perm('sa_users') then raise exception 'Not allowed'; end if;
  if 'sa_users' = any(p_permissions) or 'sa_territory' = any(p_permissions) or 'sa_reporting' = any(p_permissions) then
    if not app_is_super_admin() then raise exception 'Only the Super Admin can grant Super Admin permissions'; end if;
  end if;
  v_username := app_make_username(p_full_name);
  v_id := app_create_auth_user(v_username, p_password);
  insert into app_users (id, username, full_name, phone, email, rm_center_id)
  values (v_id, v_username, trim(p_full_name), p_phone, p_email, p_rm_center);
  insert into user_permissions (user_id, permission) select v_id, unnest(p_permissions);
  insert into user_centers (user_id, center_id) select v_id, unnest(p_centers);
  return query select v_id, v_username;
end $$;
revoke all on function public.app_admin_create_user(text, text, text, text, text[], uuid[], uuid) from public, anon;
grant execute on function public.app_admin_create_user(text, text, text, text, text[], uuid[], uuid) to authenticated;

create or replace function public.app_admin_update_user(
  p_user uuid, p_full_name text, p_phone text, p_email text,
  p_permissions text[], p_centers uuid[], p_rm_center uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  had_sa boolean;
begin
  if not app_has_perm('sa_users') then raise exception 'Not allowed'; end if;
  select exists (select 1 from user_permissions where user_id = p_user and permission like 'sa\_%')
    into had_sa;
  if (had_sa or exists (select 1 from unnest(p_permissions) x where x like 'sa\_%')
      or (select is_super_admin from app_users where id = p_user)) and not app_is_super_admin() then
    raise exception 'Only the Super Admin can change Super Admin accounts or permissions';
  end if;
  if p_rm_center is not null and not (p_rm_center = any(p_centers)) then
    raise exception 'The RM center must be one of the user''s centers';
  end if;
  update app_users set full_name = trim(p_full_name), phone = p_phone, email = p_email,
                       rm_center_id = p_rm_center, is_active = p_active
   where id = p_user;
  delete from user_permissions where user_id = p_user and permission <> all(p_permissions);
  insert into user_permissions (user_id, permission)
    select p_user, x from unnest(p_permissions) x on conflict do nothing;
  delete from user_centers where user_id = p_user and center_id <> all(p_centers);
  insert into user_centers (user_id, center_id)
    select p_user, x from unnest(p_centers) x on conflict do nothing;
end $$;
revoke all on function public.app_admin_update_user(uuid, text, text, text, text[], uuid[], uuid, boolean) from public, anon;
grant execute on function public.app_admin_update_user(uuid, text, text, text, text[], uuid[], uuid, boolean) to authenticated;

create or replace function public.app_admin_reset_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not app_has_perm('sa_users') then raise exception 'Not allowed'; end if;
  if (select is_super_admin from app_users where id = p_user) and not app_is_super_admin() then
    raise exception 'Only the Super Admin can reset this password';
  end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Password must be at least 8 characters'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user;
  update app_users set must_change_password = true where id = p_user;
end $$;
revoke all on function public.app_admin_reset_password(uuid, text) from public, anon;
grant execute on function public.app_admin_reset_password(uuid, text) to authenticated;

-- Called by the app right after a user changes their own password through Supabase Auth.
create or replace function public.app_password_changed()
returns void language sql security definer set search_path = public as $$
  update app_users set must_change_password = false where id = auth.uid()
$$;
grant execute on function public.app_password_changed() to authenticated;

-- One-off seeding of the first Super Admin. Not callable from the app; run once by the owner.
create or replace function public.app_seed_super_admin(
  p_username text, p_full_name text, p_phone text, p_email text, p_password text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if exists (select 1 from app_users where is_super_admin) then
    raise exception 'A Super Admin already exists';
  end if;
  v_id := app_create_auth_user(p_username, p_password);
  insert into app_users (id, username, full_name, phone, email, is_super_admin, must_change_password)
  values (v_id, p_username, p_full_name, p_phone, p_email, true, false);
  insert into user_permissions (user_id, permission)
    select v_id, unnest(array['route_manager','workerbook','bookings','dialer','sa_users','sa_territory','sa_reporting']);
  return v_id;
end $$;
revoke all on function public.app_seed_super_admin(text, text, text, text, text) from public, anon, authenticated;

-- ───────────────────────── row-level security ─────────────────────────
alter table public.app_users enable row level security;
alter table public.user_permissions enable row level security;
alter table public.user_centers enable row level security;
alter table public.manager_days_off enable row level security;
alter table public.seasons enable row level security;
alter table public.rate_cards enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists app_users_read on public.app_users;
create policy app_users_read on public.app_users for select to authenticated
  using (id = auth.uid() or app_has_perm('sa_users')
         or exists (select 1 from user_centers mine join user_centers theirs on theirs.center_id = mine.center_id
                    where mine.user_id = auth.uid() and theirs.user_id = app_users.id));

drop policy if exists user_permissions_read on public.user_permissions;
create policy user_permissions_read on public.user_permissions for select to authenticated
  using (user_id = auth.uid() or app_has_perm('sa_users'));

drop policy if exists user_centers_read on public.user_centers;
create policy user_centers_read on public.user_centers for select to authenticated
  using (user_id = auth.uid() or app_has_perm('sa_users') or app_can_see_center(center_id));

drop policy if exists days_off_read on public.manager_days_off;
create policy days_off_read on public.manager_days_off for select to authenticated using (true);
drop policy if exists days_off_write on public.manager_days_off;
create policy days_off_write on public.manager_days_off for all to authenticated
  using (app_has_perm('sa_users')) with check (app_has_perm('sa_users'));

drop policy if exists seasons_read on public.seasons;
create policy seasons_read on public.seasons for select to authenticated using (app_can_see_center(center_id));
drop policy if exists seasons_write on public.seasons;
create policy seasons_write on public.seasons for all to authenticated
  using (app_has_perm('sa_users') and app_can_see_center(center_id))
  with check (app_has_perm('sa_users') and app_can_see_center(center_id));

drop policy if exists rate_cards_read on public.rate_cards;
create policy rate_cards_read on public.rate_cards for select to authenticated
  using (exists (select 1 from seasons s where s.id = season_id and app_can_see_center(s.center_id)));
drop policy if exists rate_cards_insert on public.rate_cards;
create policy rate_cards_insert on public.rate_cards for insert to authenticated
  with check (app_has_perm('workerbook')
              and exists (select 1 from seasons s where s.id = season_id and app_can_see_center(s.center_id)
                          and s.closed_at is null));

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (app_is_super_admin());

grant select on public.app_users, public.user_permissions, public.user_centers, public.manager_days_off,
  public.seasons, public.rate_cards, public.audit_log to authenticated;
grant insert, update, delete on public.manager_days_off, public.seasons to authenticated;
grant insert on public.rate_cards to authenticated;

-- ───────────────────────── command center settings (Super Admin) ─────────────────────────
create or replace function public.app_admin_save_center(
  p_id uuid, p_display_name text, p_region text, p_services text[], p_cn_prefix text,
  p_local_number text, p_review_link text, p_tax_name text, p_tax_rate numeric, p_active boolean)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid := p_id; v_user text;
begin
  if not app_is_super_admin() then raise exception 'Only the Super Admin can manage command centers'; end if;
  if exists (select 1 from unnest(p_services) s where s not in ('aeration','lawn_rejuv','sealing','cleaning')) then
    raise exception 'Unknown service';
  end if;
  if v_id is null then
    v_user := regexp_replace(lower(p_display_name), '[^a-z0-9]', '', 'g');
    while exists (select 1 from command_centers where username = v_user) loop v_user := v_user || '1'; end loop;
    insert into command_centers (username, password, display_name, region, workerbook_sheet_id, masterbookings_sheet_id)
    values (v_user, encode(gen_random_bytes(12), 'hex'), trim(p_display_name), p_region, '', '')
    returning id into v_id;
  end if;
  update command_centers set display_name = trim(p_display_name), region = p_region, services = p_services,
         cn_prefix = upper(nullif(trim(p_cn_prefix), '')), local_number = p_local_number, review_link = p_review_link,
         tax_name = p_tax_name, tax_rate = p_tax_rate, is_active = p_active
   where id = v_id;
  insert into audit_log (actor, entity, entity_id, action, after)
  values (auth.uid(), 'command_centers', v_id::text, case when p_id is null then 'insert' else 'update' end,
          (select to_jsonb(c) - 'password' from command_centers c where c.id = v_id));
  return v_id;
end $$;
revoke all on function public.app_admin_save_center(uuid, text, text, text[], text, text, text, text, numeric, boolean) from public, anon;
grant execute on function public.app_admin_save_center(uuid, text, text, text[], text, text, text, text, numeric, boolean) to authenticated;
