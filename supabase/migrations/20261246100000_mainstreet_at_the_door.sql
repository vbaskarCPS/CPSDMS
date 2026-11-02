-- MainstreetAI › at the door: adding a business where you're standing, several people per business (scanned from
-- business cards or typed), who decides and when to catch them, and do-not-knock.
-- Additive only.

-- ── people at a business: more about each ──
alter table public.ms_business_contacts add column if not exists title text;
alter table public.ms_business_contacts add column if not exists decides boolean not null default false;
alter table public.ms_business_contacts add column if not exists best_time text;
alter table public.ms_business_contacts add column if not exists card_photo text;     -- ms-visit-photos path

create or replace function public.ms_business_contacts_list(p_business uuid, p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (ms_is_admin() or ms_rep_can(p_business, p_campaign)) then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', k.id, 'name', k.name, 'role', k.role, 'title', k.title,
           'phone', k.phone, 'email', k.email, 'decides', case when k.decides then true end, 'best_time', k.best_time,
           'card_photo', k.card_photo, 'source', k.source, 'updated_at', k.updated_at))
           order by k.decides desc, k.updated_at desc)
      from ms_business_contacts k where k.business_id = p_business and k.active), '[]'::jsonb);
end $$;

-- add or change one person (p_id null: add). Card photos are the rep's own uploads.
create or replace function public.ms_contact_save(p_id uuid, p_business uuid, p_campaign uuid, p_name text, p_role text, p_title text,
  p_phone text, p_email text, p_decides boolean, p_best_time text, p_card_photo text default null, p_source text default 'typed')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_id; v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  if not (ms_is_admin() or ms_rep_can(p_business, p_campaign)) then raise exception 'Not allowed'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null and nullif(trim(coalesce(p_phone, '')), '') is null and v_email is null then
    raise exception 'Add a name, phone or email'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email doesn’t look right'; end if;
  if p_card_photo is not null and not (ms_is_admin() or split_part(p_card_photo, '/', 1) = auth.uid()::text) then raise exception 'Not allowed'; end if;
  if v_id is not null then
    update ms_business_contacts set name = left(nullif(trim(coalesce(p_name, '')), ''), 120), role = left(nullif(trim(coalesce(p_role, '')), ''), 40),
           title = left(nullif(trim(coalesce(p_title, '')), ''), 120), phone = left(nullif(trim(coalesce(p_phone, '')), ''), 40), email = left(v_email, 200),
           decides = coalesce(p_decides, false), best_time = left(nullif(trim(coalesce(p_best_time, '')), ''), 120),
           card_photo = coalesce(p_card_photo, card_photo), updated_at = now()
     where id = v_id and business_id = p_business and active;
    if not found then raise exception 'That person is gone'; end if;
  else
    insert into ms_business_contacts (business_id, campaign_id, name, role, title, phone, email, decides, best_time, card_photo, source, added_by)
    values (p_business, p_campaign, left(nullif(trim(coalesce(p_name, '')), ''), 120), left(nullif(trim(coalesce(p_role, '')), ''), 40),
            left(nullif(trim(coalesce(p_title, '')), ''), 120), left(nullif(trim(coalesce(p_phone, '')), ''), 40), left(v_email, 200),
            coalesce(p_decides, false), left(nullif(trim(coalesce(p_best_time, '')), ''), 120), p_card_photo,
            case when p_source in ('card', 'typed', 'deck') then p_source else 'typed' end, auth.uid())
    returning id into v_id;
  end if;
  -- only one person decides
  if coalesce(p_decides, false) then update ms_business_contacts set decides = false where business_id = p_business and id <> v_id and decides; end if;
  return v_id;
end $$;

-- take someone off (kept, just hidden)
create or replace function public.ms_contact_hide(p_id uuid, p_campaign uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_biz uuid;
begin
  select business_id into v_biz from ms_business_contacts where id = p_id;
  if v_biz is null then raise exception 'That person is gone'; end if;
  if not (ms_is_admin() or ms_rep_can(v_biz, p_campaign)) then raise exception 'Not allowed'; end if;
  update ms_business_contacts set active = false, updated_at = now() where id = p_id;
end $$;

-- a website read off a card fills the business's, when it has none
create or replace function public.ms_business_set_website(p_business uuid, p_campaign uuid, p_website text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (ms_is_admin() or ms_rep_can(p_business, p_campaign)) then raise exception 'Not allowed'; end if;
  update ms_businesses set website = left(trim(p_website), 200), updated_at = now()
   where id = p_business and nullif(trim(coalesce(website, '')), '') is null and nullif(trim(coalesce(p_website, '')), '') is not null;
end $$;

-- ── what's already here: businesses within 60 m of where the rep stands (for "already added") ──
create or replace function public.ms_rep_nearby(p_lat double precision, p_lng double precision)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pt geometry := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
begin
  if not (ms_is_rep() or ms_is_admin()) then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'m')::int) from (
    select jsonb_strip_nulls(jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address, 'kind', b.kind,
             'm', round(ST_Distance(b.geom::geography, v_pt::geography))::int,
             'by', (select full_name from app_users where id = b.added_by), 'at', b.added_at,
             'dnk', b.do_not_knock)) x
      from ms_businesses b
     where b.status <> 'closed' and coalesce(b.lead_status, 'new') not in ('merged', 'removed')
       and ST_DWithin(b.geom::geography, v_pt::geography, 60)
     order by b.geom <-> v_pt limit 8) s), '[]'::jsonb);
end $$;

-- ── do not knock: off every rep's list and map until an admin undoes it ──
alter table public.ms_businesses add column if not exists do_not_knock text;     -- no_soliciting | asked_not_to_return | closed_for_good
alter table public.ms_businesses add column if not exists dnk_at timestamptz;
alter table public.ms_businesses add column if not exists dnk_by uuid references public.app_users(id);

create or replace function public.ms_set_do_not_knock(p_business uuid, p_campaign uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_reason is not null and p_reason not in ('no_soliciting', 'asked_not_to_return', 'closed_for_good') then raise exception 'Pick a reason'; end if;
  if p_reason is null then
    if not ms_is_admin() then raise exception 'Only an admin can put it back'; end if;
  elsif not (ms_is_admin() or ms_rep_can(p_business, p_campaign)) then raise exception 'Not allowed';
  end if;
  update ms_businesses set do_not_knock = p_reason, dnk_at = case when p_reason is null then null else now() end,
         dnk_by = case when p_reason is null then null else auth.uid() end, updated_at = now()
   where id = p_business;
end $$;

create or replace function public.ms_do_not_knock_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address, 'reason', b.do_not_knock,
           'at', b.dnk_at, 'by', (select full_name from app_users where id = b.dnk_by)) order by b.dnk_at desc)
      from ms_businesses b where b.do_not_knock is not null), '[]'::jsonb);
end $$;

-- the rep's targets, access and map leave out do-not-knock businesses
create or replace function public.ms_zone_targets(p_zone uuid, p_campaign uuid)
returns setof public.ms_businesses language sql stable security definer set search_path = public as $$
  select b.* from ms_businesses b
   where b.zone_id = p_zone and b.status <> 'closed' and b.do_not_knock is null and coalesce(b.lead_status, 'new') not in ('merged', 'removed')
     and (b.added_by is not null
          or (not b.is_chain
              and (not exists (select 1 from ms_campaign_categories cc where cc.campaign_id = p_campaign)
                   or b.kind in (select cc.category from ms_campaign_categories cc where cc.campaign_id = p_campaign))))
$$;

create or replace function public.ms_rep_can(p_business uuid, p_campaign uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from ms_businesses b
     where b.id = p_business and b.status <> 'closed' and b.do_not_knock is null
       and ((b.zone_id is not null and ms_rep_has(b.zone_id, p_campaign)
             and exists (select 1 from ms_zone_targets(b.zone_id, p_campaign) t where t.id = b.id))
            or (b.added_by = auth.uid() and coalesce(b.lead_status, 'new') not in ('merged', 'removed') and ms_rep_has_campaign(p_campaign))))
$$;

create or replace function public.ms_rep_map()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pairs jsonb; v_biz jsonb;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  with pairs as (
    select zc.zone_id, zc.campaign_id, c.retry_days
      from ms_zone_campaigns zc join ms_zones z on z.id = zc.zone_id and z.status = 'active' join ms_campaigns c on c.id = zc.campaign_id and c.is_active
     where zc.rep_id = auth.uid())
  select coalesce(jsonb_agg(jsonb_build_object('zone_id', z.id, 'zone_name', z.name, 'city', z.city, 'polygon', z.polygon,
                                               'campaign_id', c.id, 'campaign_name', c.name, 'color', c.color) order by z.name, c.name), '[]'::jsonb)
    into v_pairs
    from pairs p join ms_zones z on z.id = p.zone_id join ms_campaigns c on c.id = p.campaign_id;

  with pairs as (
    select zc.zone_id, zc.campaign_id, c.retry_days
      from ms_zone_campaigns zc join ms_zones z on z.id = zc.zone_id and z.status = 'active' join ms_campaigns c on c.id = zc.campaign_id and c.is_active
     where zc.rep_id = auth.uid()),
  latest as (select * from ms_rep_latest_all(auth.uid())),
  rows as (
    select t.id, t.name, t.address, t.lat, t.lng, t.kind, t.plaza_id, t.hours, t.added_by, p.zone_id, p.campaign_id, p.retry_days
      from pairs p cross join lateral ms_zone_targets(p.zone_id, p.campaign_id) t
    union all
    select b.id, b.name, b.address, b.lat, b.lng, b.kind, b.plaza_id, b.hours, b.added_by, null, b.lead_campaign, c.retry_days
      from ms_businesses b join ms_campaigns c on c.id = b.lead_campaign and c.is_active
     where b.added_by = auth.uid() and b.status <> 'closed' and b.do_not_knock is null and coalesce(b.lead_status, 'new') not in ('merged', 'removed')
       and not exists (select 1 from pairs p where p.zone_id = b.zone_id and p.campaign_id = b.lead_campaign))
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', r.id, 'n', r.name, 'a', r.address, 'lat', round(r.lat::numeric, 5), 'lng', round(r.lng::numeric, 5), 'k', r.kind,
           'p', pl.name, 'z', r.zone_id, 'c', r.campaign_id,
           'h', (select jsonb_agg(regexp_replace(x, '^[A-Za-z]+:\s*', '') order by o) from jsonb_array_elements_text(case when jsonb_typeof(r.hours) = 'array' then r.hours end) with ordinality as hx(x, o)),
           'lead', case when r.added_by is not null then true end,
           's', ms_pin_state2(l.outcome, l.resolution, l.deal, l.at, r.retry_days), 'at', l.at, 'f', l.follow_up_at))), '[]'::jsonb)
    into v_biz
    from rows r
    left join ms_plazas pl on pl.id = r.plaza_id
    left join latest l on l.business_id = r.id and l.campaign_id = r.campaign_id;

  return jsonb_build_object('pairs', v_pairs, 'businesses', v_biz);
end $$;

revoke all on function public.ms_zone_targets(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ms_contact_save(uuid, uuid, uuid, text, text, text, text, text, boolean, text, text, text),
  public.ms_contact_hide(uuid, uuid), public.ms_business_set_website(uuid, uuid, text), public.ms_rep_nearby(double precision, double precision),
  public.ms_set_do_not_knock(uuid, uuid, text), public.ms_do_not_knock_list() from public, anon;
grant execute on function public.ms_contact_save(uuid, uuid, uuid, text, text, text, text, text, boolean, text, text, text),
  public.ms_contact_hide(uuid, uuid), public.ms_business_set_website(uuid, uuid, text), public.ms_rep_nearby(double precision, double precision),
  public.ms_set_do_not_knock(uuid, uuid, text), public.ms_do_not_knock_list() to authenticated;
