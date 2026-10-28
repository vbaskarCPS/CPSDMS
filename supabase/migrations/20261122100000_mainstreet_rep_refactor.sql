-- MainstreetAI rep app, round 2 (RUN_61). ADDITIVE ONLY (replaces RUN_59's visit-logging function,
-- which isn't merged yet, with a version that takes a few more things).
--
--   Home map            ms_rep_map(): every zone the rep is assigned, with every business on it, at once
--   Custom leads        a rep adds a business that isn't on the map (ms_rep_add_lead). It joins the zone it
--                       falls in and counts at once; admins only check for duplicates (ms_leads_list,
--                       ms_resolve_lead: keep, remove, or merge into an existing business)
--   Retry               "Not interested" comes back on the list after the campaign's retry days (default 90)
--   Start / end day     ms_rep_day_start / _ping / _end / ms_rep_today: hours, visits, deals, distance
--                       walked; admins see who's working (ms_reps_today)
--   Works offline       a visit carries the time it was logged on the phone and an id from the phone, so a
--                       visit sent twice (after losing signal) is kept once
--   Send info           the campaign's link, text and email; each send is logged (ms_rep_log_send)
--   Photos              a private bucket, ms-visit-photos: a rep uploads into their own folder, admins see all;
--                       a visit keeps its photos
--   Pitch kit           per campaign: pitch, objections, one-pager link (ms_rep_kit)
--   Goals, leaderboard  daily visit / deal goals (ms_rep_goals), this week's board, streak, and earnings once
--                       a campaign has a pay per deal (ms_rep_board)

-- ───────────── campaign kit, goals ─────────────
alter table public.ms_campaigns add column if not exists pay_per_deal numeric(10,2) check (pay_per_deal >= 0);
alter table public.ms_campaigns add column if not exists retry_days int not null default 90 check (retry_days between 1 and 3650);
alter table public.ms_campaigns add column if not exists info_url text;
alter table public.ms_campaigns add column if not exists info_sms text;
alter table public.ms_campaigns add column if not exists info_email_subject text;
alter table public.ms_campaigns add column if not exists info_email_body text;
alter table public.ms_campaigns add column if not exists pitch text;
alter table public.ms_campaigns add column if not exists objections jsonb not null default '[]'::jsonb;
alter table public.ms_campaigns add column if not exists onepager_url text;

create table if not exists public.ms_rep_goals (
  id int primary key default 1 check (id = 1),
  visits_per_day int not null default 40 check (visits_per_day between 1 and 500),
  deals_per_day int not null default 2 check (deals_per_day between 0 and 100),
  updated_at timestamptz not null default now(), updated_by uuid
);
insert into public.ms_rep_goals (id) values (1) on conflict do nothing;
alter table public.ms_rep_goals enable row level security;
revoke all on public.ms_rep_goals from anon, authenticated;

create or replace function public.ms_save_campaign_kit(p_id uuid, p_kit jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_obj jsonb := coalesce(p_kit->'objections', '[]'::jsonb);
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from ms_campaigns where id = p_id) then raise exception 'No such campaign'; end if;
  if jsonb_typeof(v_obj) <> 'array' then raise exception 'Objections must be a list'; end if;
  if coalesce(p_kit->>'info_url', '') <> '' and p_kit->>'info_url' !~* '^https?://' then raise exception 'The info link must start with http:// or https://'; end if;
  if coalesce(p_kit->>'onepager_url', '') <> '' and p_kit->>'onepager_url' !~* '^https?://' then raise exception 'The one-pager link must start with http:// or https://'; end if;
  update ms_campaigns set
    pay_per_deal = nullif(p_kit->>'pay_per_deal', '')::numeric,
    retry_days = coalesce(nullif(p_kit->>'retry_days', '')::int, 90),
    info_url = nullif(trim(coalesce(p_kit->>'info_url', '')), ''),
    info_sms = nullif(trim(coalesce(p_kit->>'info_sms', '')), ''),
    info_email_subject = nullif(trim(coalesce(p_kit->>'info_email_subject', '')), ''),
    info_email_body = nullif(trim(coalesce(p_kit->>'info_email_body', '')), ''),
    pitch = nullif(trim(coalesce(p_kit->>'pitch', '')), ''),
    objections = v_obj,
    onepager_url = nullif(trim(coalesce(p_kit->>'onepager_url', '')), ''),
    updated_at = now()
   where id = p_id;
end $$;

create or replace function public.ms_get_goals()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('visits_per_day', visits_per_day, 'deals_per_day', deals_per_day) from ms_rep_goals where id = 1
$$;
create or replace function public.ms_save_goals(p_visits int, p_deals int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  update ms_rep_goals set visits_per_day = p_visits, deals_per_day = p_deals, updated_at = now(), updated_by = auth.uid() where id = 1;
end $$;

-- ───────────── custom leads ─────────────
alter table public.ms_businesses add column if not exists added_by uuid references public.app_users(id);
alter table public.ms_businesses add column if not exists added_at timestamptz;
alter table public.ms_businesses add column if not exists lead_status text check (lead_status in ('new', 'kept', 'merged', 'removed'));
alter table public.ms_businesses add column if not exists merged_into uuid references public.ms_businesses(id);
alter table public.ms_businesses add column if not exists lead_campaign uuid references public.ms_campaigns(id);
create index if not exists ms_businesses_leads on public.ms_businesses (added_by) where added_by is not null;

-- the rep works this campaign somewhere (an active zone, an active campaign)
create or replace function public.ms_rep_has_campaign(p_campaign uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select ms_is_rep() and exists (
    select 1 from ms_zone_campaigns zc join ms_zones z on z.id = zc.zone_id join ms_campaigns c on c.id = zc.campaign_id
     where zc.campaign_id = p_campaign and zc.rep_id = auth.uid() and z.status = 'active' and c.is_active)
$$;
revoke all on function public.ms_rep_has_campaign(uuid) from public, anon, authenticated;

-- a zone's businesses for a campaign: as before, plus every business a rep added there (any kind)
create or replace function public.ms_zone_targets(p_zone uuid, p_campaign uuid)
returns setof public.ms_businesses language sql stable security definer set search_path = public as $$
  select b.* from ms_businesses b
   where b.zone_id = p_zone and b.status <> 'closed' and coalesce(b.lead_status, 'new') not in ('merged', 'removed')
     and (b.added_by is not null
          or (not b.is_chain
              and (not exists (select 1 from ms_campaign_categories cc where cc.campaign_id = p_campaign)
                   or b.kind in (select cc.category from ms_campaign_categories cc where cc.campaign_id = p_campaign))))
$$;
revoke all on function public.ms_zone_targets(uuid, uuid) from public, anon, authenticated;

-- may this rep work this business for this campaign: it's in a zone they're assigned, or a lead they
-- added for a campaign they work
create or replace function public.ms_rep_can(p_business uuid, p_campaign uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from ms_businesses b
     where b.id = p_business and b.status <> 'closed'
       and ((b.zone_id is not null and ms_rep_has(b.zone_id, p_campaign)
             and exists (select 1 from ms_zone_targets(b.zone_id, p_campaign) t where t.id = b.id))
            or (b.added_by = auth.uid() and coalesce(b.lead_status, 'new') not in ('merged', 'removed') and ms_rep_has_campaign(p_campaign))))
$$;
revoke all on function public.ms_rep_can(uuid, uuid) from public, anon, authenticated;

create or replace function public.ms_rep_add_lead(
  p_name text, p_kind text, p_address text, p_lat double precision, p_lng double precision,
  p_phone text default null, p_website text default null, p_campaign uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pt geometry; v_zone ms_zones; v_city uuid; v_id uuid; v_dupe text; v_camp uuid := p_campaign;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'What’s the business called?'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Where is it? Drop the pin or type the address.'; end if;
  if p_kind is null or not (p_kind = any (ms_business_kinds())) then raise exception 'Pick what kind of business it is'; end if;
  v_pt := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
  select b.name into v_dupe from ms_businesses b
   where b.status <> 'closed' and b.name_norm = ms_name_norm(p_name) and ST_DWithin(b.geom::geography, v_pt::geography, 60) limit 1;
  if v_dupe is not null then raise exception 'It’s already on the map: %', v_dupe; end if;
  select * into v_zone from ms_zones z where z.status = 'active' and z.geom is not null and ST_Contains(z.geom, v_pt) limit 1;
  -- the campaign: the one asked for, else the rep's campaign in that zone, else any of theirs
  if v_camp is null then
    select zc.campaign_id into v_camp from ms_zone_campaigns zc where zc.rep_id = auth.uid() and zc.zone_id = v_zone.id limit 1;
  end if;
  if v_camp is null then
    select zc.campaign_id into v_camp from ms_zone_campaigns zc where zc.rep_id = auth.uid() limit 1;
  end if;
  if v_camp is null or not ms_rep_has_campaign(v_camp) then raise exception 'You aren’t on that campaign'; end if;
  v_city := coalesce(v_zone.city_id,
                     (select c.id from ms_cities c where c.geom is not null and ST_Contains(c.geom, v_pt) limit 1),
                     (select b.city_id from ms_businesses b order by b.geom <-> v_pt limit 1));
  if v_city is null then raise exception 'That’s outside every city on the map'; end if;
  insert into ms_businesses (city_id, name, name_norm, address, lat, lng, geom, kind, sources, phone, website, status, zone_id,
                             added_by, added_at, lead_status, lead_campaign)
  values (v_city, trim(p_name), ms_name_norm(p_name), nullif(trim(coalesce(p_address, '')), ''), p_lat, p_lng, v_pt, p_kind, '{rep}',
          nullif(trim(coalesce(p_phone, '')), ''), nullif(trim(coalesce(p_website, '')), ''), 'open', v_zone.id,
          auth.uid(), now(), 'new', v_camp)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'zone_id', v_zone.id, 'zone_name', v_zone.name, 'campaign_id', v_camp,
                            'in_my_zone', v_zone.id is not null and ms_rep_has(v_zone.id, v_camp));
end $$;

create or replace function public.ms_leads_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', b.id, 'name', b.name, 'address', b.address, 'kind', b.kind, 'phone', b.phone, 'lat', b.lat, 'lng', b.lng,
             'at', b.added_at, 'rep', u.full_name, 'zone', z.name, 'campaign', c.name,
             'nearby', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'address', n.address,
                                                                     'm', round(ST_Distance(n.geom::geography, b.geom::geography))) order by n.geom <-> b.geom)
                                   from (select * from ms_businesses n where n.id <> b.id and n.status <> 'closed' and n.added_by is null
                                          and ST_DWithin(n.geom::geography, b.geom::geography, 80) order by n.geom <-> b.geom limit 4) n), '[]'::jsonb))
           order by b.added_at)
      from ms_businesses b
      join app_users u on u.id = b.added_by
      left join ms_zones z on z.id = b.zone_id
      left join ms_campaigns c on c.id = b.lead_campaign
     where b.lead_status = 'new'), '[]'::jsonb);
end $$;

-- keep (a real new business), remove (not a business: off every list), or merge into an existing
-- business (its visits and deals move over)
create or replace function public.ms_resolve_lead(p_lead uuid, p_action text, p_target uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare b ms_businesses; t ms_businesses;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select * into b from ms_businesses where id = p_lead and added_by is not null for update;
  if b.id is null then raise exception 'No such lead'; end if;
  if p_action = 'keep' then
    update ms_businesses set lead_status = 'kept' where id = b.id;
  elsif p_action = 'remove' then
    update ms_businesses set lead_status = 'removed', status = 'closed' where id = b.id;
  elsif p_action = 'merge' then
    select * into t from ms_businesses where id = p_target;
    if t.id is null or t.id = b.id then raise exception 'Pick the business it’s the same as'; end if;
    update ms_visits set business_id = t.id, zone_id = coalesce(t.zone_id, zone_id) where business_id = b.id;
    update ms_deals set business_id = t.id, zone_id = coalesce(t.zone_id, zone_id) where business_id = b.id;
    update ms_businesses set lead_status = 'merged', status = 'closed', merged_into = t.id where id = b.id;
  else
    raise exception 'Keep, remove or merge?';
  end if;
  insert into audit_log (actor, entity, entity_id, action, after)
  values (auth.uid(), 'ms_businesses', b.id::text, 'lead_' || p_action, jsonb_build_object('target', p_target));
end $$;


-- ───────────── pins: retry ─────────────
create or replace function public.ms_pin_state2(p_outcome text, p_resolution text, p_deal text, p_at timestamptz, p_retry_days int)
returns text language sql stable set search_path = public as $$
  select case
    when p_outcome = 'not_interested' and p_at < now() - make_interval(days => coalesce(p_retry_days, 90)) then 'retry'
    else ms_pin_state(p_outcome, p_resolution, p_deal) end
$$;
create or replace function public.ms_state_open(p_state text)
returns boolean language sql immutable set search_path = public as $$
  select p_state in ('new', 'come_back', 'follow_up', 'interested', 'rejected', 'retry')
$$;

-- the rep's latest visit to every business, per campaign, with its deal
create or replace function public.ms_rep_latest_all(p_rep uuid)
returns table (business_id uuid, campaign_id uuid, visit_id uuid, outcome text, at timestamptz, follow_up_at timestamptz, resolution text, deal text, visits int)
language sql stable security definer set search_path = public as $$
  select distinct on (v.business_id, v.campaign_id) v.business_id, v.campaign_id, v.id, v.outcome, v.at, v.follow_up_at, v.resolution, d.status,
         (count(*) over (partition by v.business_id, v.campaign_id))::int
    from ms_visits v left join ms_deals d on d.visit_id = v.id
   where v.rep_id = p_rep
   order by v.business_id, v.campaign_id, v.at desc
$$;
revoke all on function public.ms_rep_latest_all(uuid) from public, anon, authenticated;

-- ───────────── the home map: every assigned zone at once ─────────────
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
    -- leads I added outside my zones
    select b.id, b.name, b.address, b.lat, b.lng, b.kind, b.plaza_id, b.hours, b.added_by, null, b.lead_campaign, c.retry_days
      from ms_businesses b join ms_campaigns c on c.id = b.lead_campaign and c.is_active
     where b.added_by = auth.uid() and b.status <> 'closed' and coalesce(b.lead_status, 'new') not in ('merged', 'removed')
       and not exists (select 1 from pairs p where p.zone_id = b.zone_id and p.campaign_id = b.lead_campaign))
  -- kept small for phones: empty fields are left out, and hours drop the day names (always Monday first)
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

-- the zone list and one zone: retry, rep-added leads, hours
create or replace function public.ms_rep_home()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; me app_users; v_today date := (now() at time zone 'America/Toronto')::date;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  select * into me from app_users where id = auth.uid();
  select coalesce(jsonb_agg(jsonb_build_object(
           'zone_id', p.zone_id, 'zone_name', p.zone_name, 'city', p.city, 'campaign_id', p.campaign_id,
           'campaign_name', p.campaign_name, 'color', p.color,
           'total', k.total, 'left', k.left_, 'visited', k.visited, 'followups_due', k.due,
           'deals_pending', k.pending, 'deals_approved', k.approved, 'leads', k.leads)
         order by p.zone_name, p.campaign_name), '[]'::jsonb) into v
    from (select z.id zone_id, z.name zone_name, z.city, c.id campaign_id, c.name campaign_name, c.color, c.retry_days
            from ms_zone_campaigns zc
            join ms_zones z on z.id = zc.zone_id and z.status = 'active'
            join ms_campaigns c on c.id = zc.campaign_id and c.is_active
           where zc.rep_id = auth.uid()) p
    cross join lateral (
      select count(t.id)::int total,
             count(t.id) filter (where ms_pin_state2(l.outcome, l.resolution, l.deal, l.at, p.retry_days) in ('new', 'retry'))::int left_,
             count(t.id) filter (where ms_pin_state2(l.outcome, l.resolution, l.deal, l.at, p.retry_days) not in ('new', 'retry'))::int visited,
             count(t.id) filter (where l.outcome = 'follow_up' and (l.follow_up_at at time zone 'America/Toronto')::date <= v_today)::int due,
             count(t.id) filter (where l.outcome = 'closed' and coalesce(l.deal, 'pending') = 'pending')::int pending,
             count(t.id) filter (where l.outcome = 'closed' and l.deal = 'approved')::int approved,
             count(t.id) filter (where t.added_by is not null)::int leads
        from ms_zone_targets(p.zone_id, p.campaign_id) t
        left join ms_rep_latest(auth.uid(), p.campaign_id) l on l.business_id = t.id) k;
  return jsonb_build_object('name', me.full_name, 'first_name', split_part(me.full_name, ' ', 1), 'today', v_today, 'zones', v);
end $$;

create or replace function public.ms_rep_zone(p_zone uuid, p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare z ms_zones; c ms_campaigns;
begin
  if not ms_rep_has(p_zone, p_campaign) then raise exception 'Not allowed'; end if;
  select * into z from ms_zones where id = p_zone;
  select * into c from ms_campaigns where id = p_campaign;
  return jsonb_build_object(
    'zone', jsonb_build_object('id', z.id, 'name', z.name, 'city', z.city, 'polygon', z.polygon, 'center', jsonb_build_array(z.center_lng, z.center_lat)),
    'campaign', jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color),
    'businesses', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'address', t.address, 'lat', round(t.lat::numeric, 6), 'lng', round(t.lng::numeric, 6),
               'kind', t.kind, 'plaza', p.name, 'plaza_id', t.plaza_id, 'hours', t.hours, 'lead', t.added_by is not null,
               'state', ms_pin_state2(l.outcome, l.resolution, l.deal, l.at, c.retry_days), 'last_at', l.at, 'follow_up_at', l.follow_up_at,
               'visits', coalesce(l.visits, 0))
             order by p.name nulls last, t.address, t.name)
        from ms_zone_targets(p_zone, p_campaign) t
        left join ms_plazas p on p.id = t.plaza_id
        left join ms_rep_latest(auth.uid(), p_campaign) l on l.business_id = t.id), '[]'::jsonb));
end $$;

-- ───────────── one business, logging a visit (photos, offline) ─────────────
alter table public.ms_visits add column if not exists photos text[] not null default '{}';
alter table public.ms_visits add column if not exists client_id uuid;
alter table public.ms_visits add column if not exists logged_at timestamptz;   -- when it reached us (at = when it happened)
create unique index if not exists ms_visits_client_id on public.ms_visits (client_id) where client_id is not null;

create or replace function public.ms_rep_business(p_business uuid, p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b ms_businesses;
begin
  if not ms_rep_can(p_business, p_campaign) then raise exception 'Not allowed'; end if;
  select * into b from ms_businesses where id = p_business;
  return jsonb_build_object(
    'id', b.id, 'name', b.name, 'address', b.address, 'lat', b.lat, 'lng', b.lng, 'kind', b.kind,
    'phone', b.phone, 'website', b.website, 'hours', b.hours, 'lead', b.added_by is not null,
    'plaza', (select name from ms_plazas where id = b.plaza_id),
    'zone_id', b.zone_id, 'campaign_id', p_campaign,
    'visits', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', v.id, 'at', v.at, 'outcome', v.outcome, 'notes', v.notes, 'contact_name', v.contact_name,
               'contact_phone', v.contact_phone, 'contact_email', v.contact_email, 'follow_up_at', v.follow_up_at,
               'far', v.far, 'distance_m', v.distance_m, 'resolution', v.resolution, 'deal', d.status, 'deal_note', d.decision_note,
               'photos', case when cardinality(v.photos) > 0 then to_jsonb(v.photos) end))
             order by v.at desc)
        from ms_visits v left join ms_deals d on d.visit_id = v.id
       where v.business_id = p_business and v.campaign_id = p_campaign and v.rep_id = auth.uid()), '[]'::jsonb),
    'sends', coalesce((select jsonb_agg(jsonb_build_object('at', s.at, 'channel', s.channel, 'to', s.sent_to) order by s.at desc)
                         from ms_sends s where s.business_id = p_business and s.rep_id = auth.uid()), '[]'::jsonb));
end $$;

drop function if exists public.ms_rep_log_visit(uuid, uuid, text, text, text, text, text, timestamptz, double precision, double precision, numeric);
create or replace function public.ms_rep_log_visit(
  p_business uuid, p_campaign uuid, p_outcome text, p_notes text default null,
  p_contact_name text default null, p_contact_phone text default null, p_contact_email text default null,
  p_follow_up_at timestamptz default null, p_lat double precision default null, p_lng double precision default null,
  p_accuracy numeric default null, p_at timestamptz default null, p_client_id uuid default null, p_photos text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b ms_businesses; v ms_visits; v_dist int; v_far boolean; v_at timestamptz := coalesce(p_at, clock_timestamp()); ph text;
begin
  -- sent twice (the phone lost signal and tried again): the first one stands
  if p_client_id is not null then
    select * into v from ms_visits where client_id = p_client_id;
    if v.id is not null then
      if v.rep_id <> auth.uid() then raise exception 'Not allowed'; end if;
      return jsonb_build_object('id', v.id, 'at', v.at, 'outcome', v.outcome, 'far', v.far, 'distance_m', v.distance_m, 'again', true);
    end if;
  end if;
  if not ms_rep_can(p_business, p_campaign) then
    select * into b from ms_businesses where id = p_business;
    if b.zone_id is not null and ms_rep_has(b.zone_id, p_campaign) then raise exception 'That business isn’t on this campaign’s list'; end if;
    raise exception 'Not allowed';
  end if;
  select * into b from ms_businesses where id = p_business;
  if p_outcome is null or p_outcome not in ('come_back', 'not_interested', 'follow_up', 'interested', 'closed', 'cant_sell') then raise exception 'Pick an outcome'; end if;
  if v_at > now() + interval '10 minutes' or v_at < now() - interval '3 days' then raise exception 'That visit time isn’t right (more than 3 days ago, or in the future)'; end if;
  if p_outcome = 'follow_up' and p_follow_up_at is null then raise exception 'When should you follow up?'; end if;
  if p_outcome = 'follow_up' and p_follow_up_at < v_at - interval '1 hour' then raise exception 'The follow-up time has already passed'; end if;
  if p_outcome = 'cant_sell' and nullif(trim(coalesce(p_notes, '')), '') is null then raise exception 'Say why you can’t sell here'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng is null or p_lng not between -180 and 180) then raise exception 'That location isn’t valid'; end if;
  foreach ph in array coalesce(p_photos, '{}') loop
    if ph !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$') then raise exception 'A photo isn’t yours'; end if;
  end loop;
  if cardinality(coalesce(p_photos, '{}')) > 6 then raise exception 'Up to 6 photos a visit'; end if;

  if p_lat is not null and b.lat is not null then
    v_dist := round(ST_Distance(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4326)::geography));
    v_far := v_dist > greatest(150, coalesce(p_accuracy, 0));
  else
    v_far := true;   -- no location: the admins see it
  end if;

  insert into ms_visits (business_id, campaign_id, zone_id, rep_id, at, logged_at, outcome, notes, contact_name, contact_phone, contact_email,
                         follow_up_at, lat, lng, accuracy_m, distance_m, far, photos, client_id)
  values (b.id, p_campaign, b.zone_id, auth.uid(), v_at, now(), p_outcome, nullif(trim(coalesce(p_notes, '')), ''),
          nullif(trim(coalesce(p_contact_name, '')), ''), nullif(trim(coalesce(p_contact_phone, '')), ''), nullif(trim(coalesce(p_contact_email, '')), ''),
          case when p_outcome = 'follow_up' then p_follow_up_at end, p_lat, p_lng, p_accuracy, v_dist, v_far, coalesce(p_photos, '{}'), p_client_id)
  returning * into v;

  if p_outcome = 'closed' then
    insert into ms_deals (visit_id, business_id, campaign_id, zone_id, rep_id) values (v.id, b.id, p_campaign, b.zone_id, auth.uid());
  end if;
  return jsonb_build_object('id', v.id, 'at', v.at, 'outcome', v.outcome, 'far', v.far, 'distance_m', v.distance_m,
                            'state', ms_pin_state(v.outcome, null, case when p_outcome = 'closed' then 'pending' end));
end $$;

-- the admins' deal list shows the visit's photos
create or replace function public.ms_deal_photos(p_deal uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select v.photos from ms_deals d join ms_visits v on v.id = d.visit_id where d.id = p_deal and ms_is_admin()
$$;

-- ───────────── photos: a private bucket ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ms-visit-photos', 'ms-visit-photos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;
drop policy if exists ms_visit_photos_insert on storage.objects;
create policy ms_visit_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ms-visit-photos' and (storage.foldername(name))[1] = auth.uid()::text and public.ms_is_rep());
drop policy if exists ms_visit_photos_read on storage.objects;
create policy ms_visit_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'ms-visit-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.ms_is_admin()));

-- ───────────── send info ─────────────
create table if not exists public.ms_sends (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.app_users(id),
  business_id uuid not null references public.ms_businesses(id) on delete cascade,
  campaign_id uuid not null references public.ms_campaigns(id),
  channel text not null check (channel in ('sms', 'email')),
  sent_to text,
  at timestamptz not null default now()
);
create index if not exists ms_sends_business on public.ms_sends (business_id, at desc);
alter table public.ms_sends enable row level security;
revoke all on public.ms_sends from anon, authenticated;

create or replace function public.ms_rep_log_send(p_business uuid, p_campaign uuid, p_channel text, p_to text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not ms_rep_can(p_business, p_campaign) then raise exception 'Not allowed'; end if;
  if p_channel not in ('sms', 'email') then raise exception 'Text or email?'; end if;
  insert into ms_sends (rep_id, business_id, campaign_id, channel, sent_to) values (auth.uid(), p_business, p_campaign, p_channel, nullif(trim(coalesce(p_to, '')), ''));
end $$;

-- the campaign's pitch kit, links and texts, and the rep's code for the link
create or replace function public.ms_rep_kit(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c ms_campaigns;
begin
  if not (ms_rep_has_campaign(p_campaign) or ms_is_admin()) then raise exception 'Not allowed'; end if;
  select * into c from ms_campaigns where id = p_campaign;
  return jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color, 'pitch', c.pitch, 'objections', c.objections,
    'info_url', c.info_url, 'info_sms', c.info_sms, 'info_email_subject', c.info_email_subject, 'info_email_body', c.info_email_body,
    'onepager_url', c.onepager_url, 'pay_per_deal', c.pay_per_deal, 'retry_days', c.retry_days,
    'ref', (select upper(username) from app_users where id = auth.uid()));
end $$;

-- ───────────── start / end day ─────────────
create table if not exists public.ms_rep_days (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.app_users(id),
  day date not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_lat double precision, start_lng double precision, end_lat double precision, end_lng double precision,
  last_lat double precision, last_lng double precision, last_at timestamptz,
  distance_m int not null default 0, pings int not null default 0,
  unique (rep_id, day)
);
alter table public.ms_rep_days enable row level security;
revoke all on public.ms_rep_days from anon, authenticated;

create or replace function public.ms_rep_today()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d ms_rep_days; v_today date := (now() at time zone 'America/Toronto')::date; g ms_rep_goals;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  select * into d from ms_rep_days where rep_id = auth.uid() and day = v_today;
  select * into g from ms_rep_goals where id = 1;
  return jsonb_build_object(
    'day', v_today, 'started_at', d.started_at, 'ended_at', d.ended_at, 'distance_m', coalesce(d.distance_m, 0),
    'minutes', case when d.id is null then 0 else round(extract(epoch from coalesce(d.ended_at, now()) - d.started_at) / 60) end,
    'visits', (select count(*) from ms_visits v where v.rep_id = auth.uid() and (v.at at time zone 'America/Toronto')::date = v_today),
    'deals', (select count(*) from ms_visits v where v.rep_id = auth.uid() and v.outcome = 'closed' and (v.at at time zone 'America/Toronto')::date = v_today),
    'followups', (select count(*) from ms_visits v where v.rep_id = auth.uid() and v.outcome = 'follow_up' and (v.at at time zone 'America/Toronto')::date = v_today),
    'goal_visits', g.visits_per_day, 'goal_deals', g.deals_per_day);
end $$;

create or replace function public.ms_rep_day_start(p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'America/Toronto')::date;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  insert into ms_rep_days (rep_id, day, start_lat, start_lng, last_lat, last_lng, last_at)
  values (auth.uid(), v_today, p_lat, p_lng, p_lat, p_lng, case when p_lat is not null then now() end)
  on conflict (rep_id, day) do update set ended_at = null;   -- starting again after ending: the day carries on
  return ms_rep_today();
end $$;

-- a location while the day is on: adds the distance walked (jumps, driving speed and poor fixes left out)
create or replace function public.ms_rep_day_ping(p_lat double precision, p_lng double precision, p_accuracy numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare d ms_rep_days; v_m double precision; v_s double precision; v_today date := (now() at time zone 'America/Toronto')::date;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then return; end if;
  if coalesce(p_accuracy, 0) > 60 then return; end if;
  select * into d from ms_rep_days where rep_id = auth.uid() and day = v_today and ended_at is null for update;
  if d.id is null then return; end if;
  if d.last_lat is null then
    update ms_rep_days set last_lat = p_lat, last_lng = p_lng, last_at = now(), pings = pings + 1 where id = d.id; return;
  end if;
  v_m := ST_Distance(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, ST_SetSRID(ST_MakePoint(d.last_lng, d.last_lat), 4326)::geography);
  if v_m < 15 then update ms_rep_days set pings = pings + 1 where id = d.id; return; end if;
  v_s := extract(epoch from now() - d.last_at);
  update ms_rep_days set
    distance_m = distance_m + case when v_s > 0 and v_m / v_s <= 3.5 and v_m <= 3000 then round(v_m)::int else 0 end,
    last_lat = p_lat, last_lng = p_lng, last_at = now(), pings = pings + 1
   where id = d.id;
end $$;

create or replace function public.ms_rep_day_end(p_lat double precision default null, p_lng double precision default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_today date := (now() at time zone 'America/Toronto')::date;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  update ms_rep_days set ended_at = now(), end_lat = p_lat, end_lng = p_lng where rep_id = auth.uid() and day = v_today and ended_at is null;
  return ms_rep_today();
end $$;

-- who's working today (admins)
create or replace function public.ms_reps_today()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'America/Toronto')::date;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'rep_id', u.id, 'name', u.full_name, 'started_at', d.started_at, 'ended_at', d.ended_at, 'last_at', d.last_at,
             'lat', d.last_lat, 'lng', d.last_lng, 'distance_m', coalesce(d.distance_m, 0),
             'visits', (select count(*) from ms_visits v where v.rep_id = u.id and (v.at at time zone 'America/Toronto')::date = v_today),
             'deals', (select count(*) from ms_visits v where v.rep_id = u.id and v.outcome = 'closed' and (v.at at time zone 'America/Toronto')::date = v_today),
             'zones', (select count(*) from ms_zone_campaigns zc where zc.rep_id = u.id))
           order by (d.started_at is null), (d.ended_at is not null), u.full_name)
      from app_users u
      join user_permissions up on up.user_id = u.id and up.permission = 'mainstreet_rep'
      left join ms_rep_days d on d.rep_id = u.id and d.day = v_today
     where u.is_active), '[]'::jsonb);
end $$;

-- ───────────── goals, streak, this week's board, earnings ─────────────
create or replace function public.ms_rep_board()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_week date := date_trunc('week', (now() at time zone 'America/Toronto'))::date;   -- Monday
  g ms_rep_goals; v_streak int := 0; r record; v_first boolean := true;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  select * into g from ms_rep_goals where id = 1;
  -- streak: days the goal was met in a row, counting back over the days worked (today counts once it's met)
  for r in
    select (v.at at time zone 'America/Toronto')::date d, count(*) n
      from ms_visits v where v.rep_id = auth.uid() and v.at > now() - interval '120 days'
     group by 1 order by 1 desc
  loop
    if v_first and r.d = v_today and r.n < g.visits_per_day then v_first := false; continue; end if;
    v_first := false;
    exit when r.n < g.visits_per_day;
    v_streak := v_streak + 1;
  end loop;

  return jsonb_build_object(
    'week_of', v_week, 'goal_visits', g.visits_per_day, 'goal_deals', g.deals_per_day, 'streak', v_streak,
    'board', coalesce((
      select jsonb_agg(jsonb_build_object('me', x.id = auth.uid(), 'name', x.short, 'visits', x.visits, 'approved', x.approved, 'pending', x.pending)
                       order by x.approved desc, x.visits desc, x.short)
        from (select u.id,
                     split_part(u.full_name, ' ', 1) || coalesce(' ' || left(nullif(split_part(u.full_name, ' ', 2), ''), 1) || '.', '') short,
                     (select count(*) from ms_visits v where v.rep_id = u.id and v.at >= v_week::timestamp at time zone 'America/Toronto')::int visits,
                     (select count(*) from ms_deals d where d.rep_id = u.id and d.status = 'approved' and d.created_at >= v_week::timestamp at time zone 'America/Toronto')::int approved,
                     (select count(*) from ms_deals d where d.rep_id = u.id and d.status = 'pending' and d.created_at >= v_week::timestamp at time zone 'America/Toronto')::int pending
                from app_users u join user_permissions up on up.user_id = u.id and up.permission = 'mainstreet_rep'
               where u.is_active) x
       where x.visits > 0 or x.id = auth.uid()), '[]'::jsonb),
    'earnings', jsonb_build_object(
      'week', (select coalesce(sum(c.pay_per_deal), 0) from ms_deals d join ms_campaigns c on c.id = d.campaign_id
                where d.rep_id = auth.uid() and d.status = 'approved' and d.created_at >= v_week::timestamp at time zone 'America/Toronto'),
      'total', (select coalesce(sum(c.pay_per_deal), 0) from ms_deals d join ms_campaigns c on c.id = d.campaign_id
                 where d.rep_id = auth.uid() and d.status = 'approved'),
      'unpriced', (select count(*) from ms_deals d join ms_campaigns c on c.id = d.campaign_id
                    where d.rep_id = auth.uid() and d.status = 'approved' and c.pay_per_deal is null)));
end $$;

-- ───────────── access ─────────────
revoke all on function public.ms_deal_photos(uuid) from public, anon;
grant execute on function public.ms_deal_photos(uuid) to authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'ms_save_campaign_kit(uuid,jsonb)', 'ms_get_goals()', 'ms_save_goals(int,int)', 'ms_rep_add_lead(text,text,text,double precision,double precision,text,text,uuid)',
    'ms_leads_list()', 'ms_resolve_lead(uuid,text,uuid)', 'ms_rep_map()', 'ms_rep_home()', 'ms_rep_zone(uuid,uuid)', 'ms_rep_business(uuid,uuid)',
    'ms_rep_log_visit(uuid,uuid,text,text,text,text,text,timestamptz,double precision,double precision,numeric,timestamptz,uuid,text[])',
    'ms_rep_log_send(uuid,uuid,text,text)', 'ms_rep_kit(uuid)', 'ms_rep_today()', 'ms_rep_day_start(double precision,double precision)',
    'ms_rep_day_ping(double precision,double precision,numeric)', 'ms_rep_day_end(double precision,double precision)', 'ms_reps_today()', 'ms_rep_board()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
