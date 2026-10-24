-- MainstreetAI (RUN_50): knock zones, campaigns and reps. ADDITIVE ONLY (replaces one function).
--
-- MainstreetAI is the business-to-business door-knocking side of the app. It sits outside the
-- Property Stars framework: no command centers, no seasons. Everything here is keyed on its own.
--
--   user_permissions.permission   may now also be 'mainstreet_admin' (runs it) or 'mainstreet_rep' (a rep)
--   ms_campaigns                  what the reps are selling (the first is Taxifi); a name, a colour, on/off
--   ms_zones                      a named polygon drawn on the map; City/Area filled in from the map;
--                                 zones never overlap; retired zones are kept but hidden by default
--   ms_zone_campaigns             a campaign attached to a zone, with (at most) one rep for that pair.
--                                 Reassigning hands the whole pair to the new rep.
--
-- Reps are app_users with the 'mainstreet_rep' permission: they sign in like managers, choose their
-- password from a setup email, and belong to no center. A MainstreetAI Admin adds them from the
-- Reps screen (no User Management permission needed).
--
--   ms_save_campaign / ms_set_campaign_active
--   ms_save_zone (draw, rename, redraw) / ms_set_zone_status / ms_delete_zone
--   ms_set_zone_campaigns / ms_assign_rep
--   ms_zones_list()               every zone with its campaigns and their reps (admins); a rep sees
--                                 only the zones they're assigned in
--   ms_reps()                     the reps, with whether their setup email was sent / used
--   ms_admin_create_rep / ms_admin_update_rep
--   app_admin_issue_setup         (replaced) a MainstreetAI Admin may send a rep's setup email

-- ───────────── permissions ─────────────
alter table public.user_permissions drop constraint if exists user_permissions_permission_check;
alter table public.user_permissions add constraint user_permissions_permission_check check (permission in
  ('route_manager','rm_floater','workerbook','bookings','dialer','sa_users','sa_territory','sa_reporting',
   'mainstreet_admin','mainstreet_rep'));

create or replace function public.ms_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select app_has_perm('mainstreet_admin')
$$;
create or replace function public.ms_is_rep(p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_permissions up join app_users u on u.id = up.user_id
                 where up.user_id = p_user and up.permission = 'mainstreet_rep' and u.is_active)
$$;

-- ───────────── campaigns ─────────────
create table if not exists public.ms_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  is_active boolean not null default true,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ms_campaigns_name on public.ms_campaigns (lower(name));
alter table public.ms_campaigns enable row level security;
drop policy if exists ms_campaigns_read on public.ms_campaigns;
create policy ms_campaigns_read on public.ms_campaigns for select to authenticated using (ms_is_admin() or ms_is_rep());
revoke all on public.ms_campaigns from anon, authenticated;
grant select on public.ms_campaigns to authenticated;   -- writes only through the functions below
drop trigger if exists touch on public.ms_campaigns;
create trigger touch before update on public.ms_campaigns for each row execute function public.touch_updated_at();

-- ───────────── zones ─────────────
create table if not exists public.ms_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  polygon jsonb not null,                        -- GeoJSON Polygon, [lng, lat] rings
  geom geometry(Polygon, 4326),                  -- the same shape, for overlap checks (kept by trigger)
  center_lat double precision,
  center_lng double precision,
  city text,                                     -- from the map (reverse geocode at the centre)
  area text,                                     -- neighbourhood / locality, when the map knows one
  status text not null default 'active' check (status in ('active','retired')),
  retired_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ms_zones_name on public.ms_zones (lower(name));
create index if not exists ms_zones_geom on public.ms_zones using gist (geom);
alter table public.ms_zones enable row level security;
revoke all on public.ms_zones from anon, authenticated;
grant select on public.ms_zones to authenticated;   -- writes only through the functions below
drop trigger if exists touch on public.ms_zones;
create trigger touch before update on public.ms_zones for each row execute function public.touch_updated_at();

-- the shape must be a valid polygon, and may not overlap another live zone
create or replace function public.ms_zone_prepare()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  g geometry; other text;
begin
  if new.polygon is null or new.polygon->>'type' <> 'Polygon' then raise exception 'Draw the zone as a polygon'; end if;
  begin
    g := ST_SetSRID(ST_GeomFromGeoJSON(new.polygon::text), 4326);
  exception when others then raise exception 'That shape can’t be read: %', sqlerrm; end;
  if not ST_IsValid(g) then g := ST_MakeValid(g); end if;
  if ST_GeometryType(g) <> 'ST_Polygon' or ST_NPoints(g) < 4 then raise exception 'A zone needs at least three corners'; end if;
  if ST_Area(g::geography) < 100 then raise exception 'That zone is too small to be real'; end if;
  new.geom := g;
  new.center_lat := ST_Y(ST_PointOnSurface(g));
  new.center_lng := ST_X(ST_PointOnSurface(g));
  if new.status = 'retired' and new.retired_at is null then new.retired_at := now(); end if;
  if new.status = 'active' then
    new.retired_at := null;
    -- touching edges are fine; sharing ground is not (tolerance: 1% of the smaller zone)
    select z.name into other from ms_zones z
     where z.id <> new.id and z.status = 'active'
       and ST_Intersects(z.geom, g)
       and ST_Area(ST_Intersection(z.geom, g)::geography) > 0.01 * least(ST_Area(z.geom::geography), ST_Area(g::geography))
     limit 1;
    if other is not null then raise exception 'This zone overlaps “%”. Zones can’t share ground.', other; end if;
  end if;
  return new;
end $$;
drop trigger if exists prepare on public.ms_zones;
create trigger prepare before insert or update of polygon, status on public.ms_zones for each row execute function public.ms_zone_prepare();

-- ───────────── a campaign on a zone, and its rep ─────────────
create table if not exists public.ms_zone_campaigns (
  zone_id uuid not null references public.ms_zones(id) on delete cascade,
  campaign_id uuid not null references public.ms_campaigns(id) on delete restrict,
  rep_id uuid references public.app_users(id) on delete set null,
  assigned_at timestamptz,
  assigned_by uuid,
  created_at timestamptz not null default now(),
  primary key (zone_id, campaign_id)
);
create index if not exists ms_zone_campaigns_rep on public.ms_zone_campaigns (rep_id);
alter table public.ms_zone_campaigns enable row level security;
revoke all on public.ms_zone_campaigns from anon, authenticated;
grant select on public.ms_zone_campaigns to authenticated;   -- writes only through the functions below

create or replace function public.ms_zone_campaign_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.rep_id is not null and not ms_is_rep(new.rep_id) then raise exception 'That person isn’t a MainstreetAI rep'; end if;
  if new.rep_id is distinct from coalesce(old.rep_id, null) then
    new.assigned_at := case when new.rep_id is null then null else now() end;
    new.assigned_by := case when new.rep_id is null then null else auth.uid() end;
  end if;
  return new;
end $$;
drop trigger if exists check_rep on public.ms_zone_campaigns;
create trigger check_rep before insert or update on public.ms_zone_campaigns for each row execute function public.ms_zone_campaign_check();

-- a rep can see the zones they're assigned in (and nothing else)
drop policy if exists ms_zones_read on public.ms_zones;
create policy ms_zones_read on public.ms_zones for select to authenticated using (
  ms_is_admin() or exists (select 1 from ms_zone_campaigns zc where zc.zone_id = ms_zones.id and zc.rep_id = auth.uid()));
drop policy if exists ms_zone_campaigns_read on public.ms_zone_campaigns;
create policy ms_zone_campaigns_read on public.ms_zone_campaigns for select to authenticated using (ms_is_admin() or rep_id = auth.uid());

-- every change is on the record
do $$ declare t text; begin
  foreach t in array array['ms_campaigns','ms_zones','ms_zone_campaigns'] loop
    execute format('drop trigger if exists audit on public.%I', t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t);
  end loop;
end $$;

-- ───────────── campaigns: save / on-off ─────────────
create or replace function public.ms_save_campaign(p_id uuid, p_name text, p_color text, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Give the campaign a name'; end if;
  if v_id is null then
    insert into ms_campaigns (name, color, notes, created_by) values (trim(p_name), coalesce(p_color, '#2563eb'), nullif(trim(coalesce(p_notes, '')), ''), auth.uid())
    returning id into v_id;
  else
    update ms_campaigns set name = trim(p_name), color = coalesce(p_color, color), notes = nullif(trim(coalesce(p_notes, '')), '') where id = v_id;
    if not found then raise exception 'No such campaign'; end if;
  end if;
  return v_id;
exception when unique_violation then raise exception 'There’s already a campaign called “%”', trim(p_name);
end $$;
revoke all on function public.ms_save_campaign(uuid, text, text, text) from public, anon;
grant execute on function public.ms_save_campaign(uuid, text, text, text) to authenticated;

create or replace function public.ms_set_campaign_active(p_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  update ms_campaigns set is_active = p_active where id = p_id;
  if not found then raise exception 'No such campaign'; end if;
end $$;
revoke all on function public.ms_set_campaign_active(uuid, boolean) from public, anon;
grant execute on function public.ms_set_campaign_active(uuid, boolean) to authenticated;

-- ───────────── zones: draw / rename / redraw, retire, delete ─────────────
create or replace function public.ms_save_zone(p_id uuid, p_name text, p_polygon jsonb, p_city text default null, p_area text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'Give the zone a name'; end if;
  if v_id is null then
    insert into ms_zones (name, polygon, city, area, created_by)
    values (trim(p_name), p_polygon, nullif(trim(coalesce(p_city, '')), ''), nullif(trim(coalesce(p_area, '')), ''), auth.uid())
    returning id into v_id;
  else
    update ms_zones set name = trim(p_name), polygon = coalesce(p_polygon, polygon),
           city = coalesce(nullif(trim(coalesce(p_city, '')), ''), city), area = coalesce(nullif(trim(coalesce(p_area, '')), ''), area)
     where id = v_id;
    if not found then raise exception 'No such zone'; end if;
  end if;
  return v_id;
exception when unique_violation then raise exception 'There’s already a zone called “%”', trim(p_name);
end $$;
revoke all on function public.ms_save_zone(uuid, text, jsonb, text, text) from public, anon;
grant execute on function public.ms_save_zone(uuid, text, jsonb, text, text) to authenticated;

create or replace function public.ms_set_zone_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if p_status not in ('active', 'retired') then raise exception 'Status must be active or retired'; end if;
  update ms_zones set status = p_status where id = p_id;
  if not found then raise exception 'No such zone'; end if;
end $$;
revoke all on function public.ms_set_zone_status(uuid, text) from public, anon;
grant execute on function public.ms_set_zone_status(uuid, text) to authenticated;

-- Deleting is for mistakes. A zone with a campaign on it is retired instead, so nothing logged against it is lost.
create or replace function public.ms_delete_zone(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if exists (select 1 from ms_zone_campaigns where zone_id = p_id) then
    raise exception 'This zone has campaigns on it. Retire it instead, or take the campaigns off first.';
  end if;
  delete from ms_zones where id = p_id;
  if not found then raise exception 'No such zone'; end if;
end $$;
revoke all on function public.ms_delete_zone(uuid) from public, anon;
grant execute on function public.ms_delete_zone(uuid) to authenticated;

-- ───────────── campaigns on a zone, and who works each ─────────────
-- Sets the zone's campaigns to exactly this list. Taking a campaign off also drops its rep.
create or replace function public.ms_set_zone_campaigns(p_zone uuid, p_campaigns uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from ms_zones where id = p_zone) then raise exception 'No such zone'; end if;
  delete from ms_zone_campaigns where zone_id = p_zone and not (campaign_id = any(coalesce(p_campaigns, '{}')));
  insert into ms_zone_campaigns (zone_id, campaign_id)
  select p_zone, c from unnest(coalesce(p_campaigns, '{}')) c
  on conflict do nothing;
end $$;
revoke all on function public.ms_set_zone_campaigns(uuid, uuid[]) from public, anon;
grant execute on function public.ms_set_zone_campaigns(uuid, uuid[]) to authenticated;

create or replace function public.ms_assign_rep(p_zone uuid, p_campaign uuid, p_rep uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  update ms_zone_campaigns set rep_id = p_rep where zone_id = p_zone and campaign_id = p_campaign;
  if not found then raise exception 'That campaign isn’t on this zone yet'; end if;
end $$;
revoke all on function public.ms_assign_rep(uuid, uuid, uuid) from public, anon;
grant execute on function public.ms_assign_rep(uuid, uuid, uuid) to authenticated;

-- ───────────── reading ─────────────
-- Every zone (admins) or the zones a rep is assigned in, each with its campaigns and their reps.
create or replace function public.ms_zones_list()
returns table (
  id uuid, name text, polygon jsonb, center_lat double precision, center_lng double precision,
  city text, area text, status text, created_at timestamptz, updated_at timestamptz, campaigns jsonb
) language sql stable security definer set search_path = public as $$
  select z.id, z.name, z.polygon, z.center_lat, z.center_lng, z.city, z.area, z.status, z.created_at, z.updated_at,
         coalesce((select jsonb_agg(jsonb_build_object(
                     'campaign_id', zc.campaign_id, 'name', c.name, 'color', c.color, 'is_active', c.is_active,
                     'rep_id', zc.rep_id, 'rep_name', u.full_name, 'assigned_at', zc.assigned_at) order by c.name)
                     from ms_zone_campaigns zc join ms_campaigns c on c.id = zc.campaign_id
                     left join app_users u on u.id = zc.rep_id
                    where zc.zone_id = z.id and (ms_is_admin() or zc.rep_id = auth.uid())), '[]'::jsonb)
    from ms_zones z
   where ms_is_admin() or exists (select 1 from ms_zone_campaigns zc where zc.zone_id = z.id and zc.rep_id = auth.uid())
   order by z.status, z.name;
$$;
revoke all on function public.ms_zones_list() from public, anon;
grant execute on function public.ms_zones_list() to authenticated;

-- The reps: name, contact, on/off, and where their setup email stands.
create or replace function public.ms_reps()
returns table (
  id uuid, username text, full_name text, email text, phone text, is_active boolean, must_change_password boolean,
  created_at timestamptz, setup_sent_at timestamptz, setup_used_at timestamptz, setup_error text, zones int
) language sql stable security definer set search_path = public as $$
  select u.id, u.username, u.full_name, u.email, u.phone, u.is_active, u.must_change_password, u.created_at,
         t.sent_at, t.used_at, t.send_error,
         (select count(*)::int from ms_zone_campaigns zc where zc.rep_id = u.id)
    from app_users u
    join user_permissions up on up.user_id = u.id and up.permission = 'mainstreet_rep'
    left join lateral (select s.sent_at, s.used_at, s.send_error from app_setup_tokens s where s.user_id = u.id order by s.created_at desc limit 1) t on true
   where ms_is_admin()
   order by u.is_active desc, u.full_name;
$$;
revoke all on function public.ms_reps() from public, anon;
grant execute on function public.ms_reps() to authenticated;

-- ───────────── reps: add / change ─────────────
-- A rep gets a long random password nobody knows and chooses their own from the setup email.
create or replace function public.ms_admin_create_rep(p_full_name text, p_email text, p_phone text default null)
returns table (id uuid, username text) language plpgsql security definer set search_path = public, extensions as $$
declare v_username text; v_id uuid;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if nullif(trim(coalesce(p_full_name, '')), '') is null then raise exception 'Their name is needed'; end if;
  if nullif(trim(coalesce(p_email, '')), '') is null then raise exception 'Their email is needed: that’s how they set up their account'; end if;
  if exists (select 1 from app_users u where lower(u.email) = lower(trim(p_email))) then raise exception 'Someone already has the email %', trim(p_email); end if;
  v_username := app_make_username(p_full_name);
  v_id := app_create_auth_user(v_username, encode(gen_random_bytes(32), 'hex'));
  insert into app_users (id, username, full_name, phone, email) values (v_id, v_username, trim(p_full_name), nullif(trim(coalesce(p_phone, '')), ''), trim(p_email));
  insert into user_permissions (user_id, permission) values (v_id, 'mainstreet_rep');
  return query select v_id, v_username;
end $$;
revoke all on function public.ms_admin_create_rep(text, text, text) from public, anon;
grant execute on function public.ms_admin_create_rep(text, text, text) to authenticated;

create or replace function public.ms_admin_update_rep(p_user uuid, p_full_name text, p_email text, p_phone text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from user_permissions where user_id = p_user and permission = 'mainstreet_rep') then raise exception 'That person isn’t a MainstreetAI rep'; end if;
  if (select is_super_admin from app_users where id = p_user) then raise exception 'Not allowed'; end if;
  if nullif(trim(coalesce(p_full_name, '')), '') is null then raise exception 'Their name is needed'; end if;
  update app_users set full_name = trim(p_full_name), email = nullif(trim(coalesce(p_email, '')), ''),
         phone = nullif(trim(coalesce(p_phone, '')), ''), is_active = coalesce(p_active, is_active)
   where id = p_user;
end $$;
revoke all on function public.ms_admin_update_rep(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.ms_admin_update_rep(uuid, text, text, text, boolean) to authenticated;

-- ───────────── setup emails for reps ─────────────
-- (replaces 20261011's version) A MainstreetAI Admin may send a rep's setup link; everything else is unchanged.
create or replace function public.app_admin_issue_setup(p_user uuid)
returns table (code text, email text, full_name text, username text, expires_at timestamptz, reply_to text, invited_by text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  u app_users;
  v_code text := encode(gen_random_bytes(32), 'hex');
  v_exp timestamptz := now() + interval '7 days';
  me app_users;
  v_rep boolean;
begin
  select * into u from app_users where app_users.id = p_user;
  if u.id is null then raise exception 'No such user'; end if;
  v_rep := exists (select 1 from user_permissions where user_id = p_user and permission = 'mainstreet_rep');
  if not (app_has_perm('sa_users') or (v_rep and ms_is_admin())) then raise exception 'Not allowed'; end if;
  if u.is_super_admin and not app_is_super_admin() then raise exception 'Only the Super Admin can send this account a setup link'; end if;
  if not u.is_active then raise exception '% is disabled. Turn the account on first.', u.full_name; end if;
  if nullif(trim(coalesce(u.email, '')), '') is null then raise exception '% has no email address', u.full_name; end if;
  select * into me from app_users where app_users.id = auth.uid();
  update app_setup_tokens t set cancelled_at = now() where t.user_id = u.id and t.used_at is null and t.cancelled_at is null;
  insert into app_setup_tokens (user_id, token_hash, email, created_by, expires_at)
  values (u.id, encode(digest(v_code, 'sha256'), 'hex'), trim(u.email), auth.uid(), v_exp);
  return query select v_code, trim(u.email), u.full_name, u.username, v_exp, nullif(trim(coalesce(me.email, '')), ''), me.full_name;
end $$;
revoke all on function public.app_admin_issue_setup(uuid) from public, anon;
grant execute on function public.app_admin_issue_setup(uuid) to authenticated;
