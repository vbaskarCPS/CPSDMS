-- MainstreetAI reps in the field (RUN_59). ADDITIVE ONLY (plus the one data change asked for:
-- Vijay is no longer a rep).
--
-- A rep signs in to their own app and works the zone + campaign pairs they're assigned. For every
-- business that fits the campaign they log a visit with one outcome:
--   come_back       closed / the owner wasn't in
--   not_interested
--   follow_up       a date and time, and the decision-maker's name, phone, email
--   interested      sent information
--   closed          a closed deal: goes to the admins' pipeline to be approved before it counts
--   cant_sell       shut down / wrong type / head office only: off the rep's list, flagged for an admin
-- Each visit keeps where the rep was standing; one logged more than 150 m from the business (or
-- further than the phone's accuracy) or with no location is marked for the admins.
--
-- A rep sees only their own visits. Reps can't hold any other permission (no management access),
-- and a Super Admin can't be a rep.
--
--   ms_visits, ms_deals                     (no direct access: only the functions below)
--   ms_rep_home()                           my zone + campaign pairs with their counts
--   ms_rep_zone(zone, campaign)             the zone and its businesses with my latest outcome
--   ms_rep_business(business, campaign)     one business: details and my visits
--   ms_rep_log_visit(...)                   log a visit
--   ms_rep_followups()                      my follow-ups: overdue, today, coming up
--   ms_rep_numbers()                        my visits per day and deals
--   ms_deals_list(status) / ms_decide_deal  the admins' deal pipeline
--   ms_flags_list() / ms_resolve_flag       the admins' "can't sell here" flags
--   ms_setup_is_rep(code)                   the setup page: is this a rep's link (MainstreetAI look)
--   ms_rep_reset_link(email)                forgot password (service role only, for the rep-auth function)
--   ms_rep_login_address(email)             sign in by email (service role only, for the rep-auth function)

-- ───────────── reps hold no other permission ─────────────
delete from public.user_permissions up
 using public.app_users u
 where u.id = up.user_id and u.username = 'basvi' and up.permission = 'mainstreet_rep';

create or replace function public.ms_rep_only_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.permission = 'mainstreet_rep' then
    if exists (select 1 from app_users where id = new.user_id and is_super_admin) then
      raise exception 'A Super Admin can’t be a MainstreetAI rep';
    end if;
    if exists (select 1 from user_permissions where user_id = new.user_id and permission <> 'mainstreet_rep') then
      raise exception 'A MainstreetAI rep can’t have any other permission';
    end if;
  elsif exists (select 1 from user_permissions where user_id = new.user_id and permission = 'mainstreet_rep') then
    raise exception 'This person is a MainstreetAI rep: reps can’t have any other permission';
  end if;
  return new;
end $$;
revoke all on function public.ms_rep_only_check() from public, anon, authenticated;
drop trigger if exists ms_rep_only on public.user_permissions;
create trigger ms_rep_only before insert or update on public.user_permissions for each row execute function public.ms_rep_only_check();

-- ───────────── tables ─────────────
create table if not exists public.ms_visits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.ms_businesses(id) on delete cascade,
  campaign_id uuid not null references public.ms_campaigns(id),
  zone_id uuid references public.ms_zones(id),
  rep_id uuid not null references public.app_users(id),
  at timestamptz not null default clock_timestamp(),   -- the moment it was logged (two in one go keep their order)
  outcome text not null check (outcome in ('come_back', 'not_interested', 'follow_up', 'interested', 'closed', 'cant_sell')),
  notes text,
  contact_name text, contact_phone text, contact_email text,
  follow_up_at timestamptz,
  lat double precision, lng double precision, accuracy_m numeric,
  distance_m int,
  far boolean not null default false,
  resolved_at timestamptz, resolved_by uuid, resolution text check (resolution in ('removed', 'kept')),
  created_at timestamptz not null default now(),
  check (outcome <> 'follow_up' or follow_up_at is not null)
);
create index if not exists ms_visits_mine on public.ms_visits (rep_id, campaign_id, business_id, at desc);
create index if not exists ms_visits_business on public.ms_visits (business_id);
create index if not exists ms_visits_flags on public.ms_visits (at) where outcome = 'cant_sell' and resolved_at is null;

create table if not exists public.ms_deals (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null unique references public.ms_visits(id) on delete cascade,
  business_id uuid not null references public.ms_businesses(id) on delete cascade,
  campaign_id uuid not null references public.ms_campaigns(id),
  zone_id uuid references public.ms_zones(id),
  rep_id uuid not null references public.app_users(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid, decided_at timestamptz, decision_note text,
  created_at timestamptz not null default now()
);
create index if not exists ms_deals_status on public.ms_deals (status, created_at);
create index if not exists ms_deals_rep on public.ms_deals (rep_id, status);

alter table public.ms_visits enable row level security;
alter table public.ms_deals enable row level security;
revoke all on public.ms_visits, public.ms_deals from anon, authenticated;

-- ───────────── helpers ─────────────
-- the rep is assigned this zone + campaign (an active zone, an active campaign)
create or replace function public.ms_rep_has(p_zone uuid, p_campaign uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select ms_is_rep() and exists (
    select 1 from ms_zone_campaigns zc join ms_zones z on z.id = zc.zone_id join ms_campaigns c on c.id = zc.campaign_id
     where zc.zone_id = p_zone and zc.campaign_id = p_campaign and zc.rep_id = auth.uid() and z.status = 'active' and c.is_active)
$$;
revoke all on function public.ms_rep_has(uuid, uuid) from public, anon, authenticated;

-- the businesses a zone holds for a campaign (the same rule zones are cut by): its categories, no
-- chains, not closed. A campaign without categories takes every kind.
create or replace function public.ms_zone_targets(p_zone uuid, p_campaign uuid)
returns setof public.ms_businesses language sql stable security definer set search_path = public as $$
  select b.* from ms_businesses b
   where b.zone_id = p_zone and not b.is_chain and b.status <> 'closed'
     and (not exists (select 1 from ms_campaign_categories cc where cc.campaign_id = p_campaign)
          or b.kind in (select cc.category from ms_campaign_categories cc where cc.campaign_id = p_campaign))
$$;
revoke all on function public.ms_zone_targets(uuid, uuid) from public, anon, authenticated;

-- the rep's latest visit to each business for a campaign, with its deal
create or replace function public.ms_rep_latest(p_rep uuid, p_campaign uuid)
returns table (business_id uuid, visit_id uuid, outcome text, at timestamptz, follow_up_at timestamptz, resolution text, deal text, visits int)
language sql stable security definer set search_path = public as $$
  select distinct on (v.business_id) v.business_id, v.id, v.outcome, v.at, v.follow_up_at, v.resolution, d.status,
         (count(*) over (partition by v.business_id))::int
    from ms_visits v left join ms_deals d on d.visit_id = v.id
   where v.rep_id = p_rep and v.campaign_id = p_campaign
   order by v.business_id, v.at desc
$$;
revoke all on function public.ms_rep_latest(uuid, uuid) from public, anon, authenticated;

-- what a pin shows: never visited, or the latest outcome (a closed deal by its pipeline status; a
-- "can't sell" an admin kept goes back on the list as come back)
create or replace function public.ms_pin_state(p_outcome text, p_resolution text, p_deal text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_outcome is null then 'new'
    when p_outcome = 'closed' then case p_deal when 'approved' then 'closed' when 'rejected' then 'rejected' else 'pending' end
    when p_outcome = 'cant_sell' and p_resolution = 'kept' then 'come_back'
    else p_outcome end
$$;

-- ───────────── the rep's app ─────────────
create or replace function public.ms_rep_home()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; me app_users; v_today date := (now() at time zone 'America/Toronto')::date;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  select * into me from app_users where id = auth.uid();
  -- per pair: its businesses against my latest visits (worked out once per pair)
  select coalesce(jsonb_agg(jsonb_build_object(
           'zone_id', p.zone_id, 'zone_name', p.zone_name, 'city', p.city, 'campaign_id', p.campaign_id,
           'campaign_name', p.campaign_name, 'color', p.color,
           'total', k.total, 'left', k.left_, 'visited', k.visited, 'followups_due', k.due,
           'deals_pending', k.pending, 'deals_approved', k.approved)
         order by p.zone_name, p.campaign_name), '[]'::jsonb) into v
    from (select z.id zone_id, z.name zone_name, z.city, c.id campaign_id, c.name campaign_name, c.color
            from ms_zone_campaigns zc
            join ms_zones z on z.id = zc.zone_id and z.status = 'active'
            join ms_campaigns c on c.id = zc.campaign_id and c.is_active
           where zc.rep_id = auth.uid()) p
    cross join lateral (
      select count(t.id)::int total,
             count(t.id) filter (where l.outcome is null)::int left_,
             count(t.id) filter (where l.outcome is not null)::int visited,
             count(t.id) filter (where l.outcome = 'follow_up' and (l.follow_up_at at time zone 'America/Toronto')::date <= v_today)::int due,
             count(t.id) filter (where l.outcome = 'closed' and coalesce(l.deal, 'pending') = 'pending')::int pending,
             count(t.id) filter (where l.outcome = 'closed' and l.deal = 'approved')::int approved
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
               'kind', t.kind, 'plaza', p.name, 'plaza_id', t.plaza_id,
               'state', ms_pin_state(l.outcome, l.resolution, l.deal), 'last_at', l.at, 'follow_up_at', l.follow_up_at, 'visits', coalesce(l.visits, 0))
             order by p.name nulls last, t.address, t.name)
        from ms_zone_targets(p_zone, p_campaign) t
        left join ms_plazas p on p.id = t.plaza_id
        left join ms_rep_latest(auth.uid(), p_campaign) l on l.business_id = t.id), '[]'::jsonb));
end $$;

create or replace function public.ms_rep_business(p_business uuid, p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b ms_businesses;
begin
  select * into b from ms_businesses where id = p_business;
  if b.id is null or b.zone_id is null or not ms_rep_has(b.zone_id, p_campaign) then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'id', b.id, 'name', b.name, 'address', b.address, 'lat', b.lat, 'lng', b.lng, 'kind', b.kind,
    'phone', b.phone, 'website', b.website, 'hours', b.hours,
    'plaza', (select name from ms_plazas where id = b.plaza_id),
    'zone_id', b.zone_id, 'campaign_id', p_campaign,
    'visits', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'id', v.id, 'at', v.at, 'outcome', v.outcome, 'notes', v.notes, 'contact_name', v.contact_name,
               'contact_phone', v.contact_phone, 'contact_email', v.contact_email, 'follow_up_at', v.follow_up_at,
               'far', v.far, 'distance_m', v.distance_m, 'resolution', v.resolution, 'deal', d.status, 'deal_note', d.decision_note))
             order by v.at desc)
        from ms_visits v left join ms_deals d on d.visit_id = v.id
       where v.business_id = p_business and v.campaign_id = p_campaign and v.rep_id = auth.uid()), '[]'::jsonb));
end $$;

create or replace function public.ms_rep_log_visit(
  p_business uuid, p_campaign uuid, p_outcome text, p_notes text default null,
  p_contact_name text default null, p_contact_phone text default null, p_contact_email text default null,
  p_follow_up_at timestamptz default null, p_lat double precision default null, p_lng double precision default null,
  p_accuracy numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b ms_businesses; v ms_visits; v_dist int; v_far boolean;
begin
  select * into b from ms_businesses where id = p_business;
  if b.id is null or b.zone_id is null or not ms_rep_has(b.zone_id, p_campaign) then raise exception 'Not allowed'; end if;
  if not exists (select 1 from ms_zone_targets(b.zone_id, p_campaign) t where t.id = b.id) then raise exception 'That business isn’t on this campaign’s list'; end if;
  if p_outcome is null or p_outcome not in ('come_back', 'not_interested', 'follow_up', 'interested', 'closed', 'cant_sell') then raise exception 'Pick an outcome'; end if;
  if p_outcome = 'follow_up' and p_follow_up_at is null then raise exception 'When should you follow up?'; end if;
  if p_outcome = 'follow_up' and p_follow_up_at < now() - interval '1 hour' then raise exception 'The follow-up time has already passed'; end if;
  if p_outcome = 'cant_sell' and nullif(trim(coalesce(p_notes, '')), '') is null then raise exception 'Say why you can’t sell here'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng is null or p_lng not between -180 and 180) then raise exception 'That location isn’t valid'; end if;

  if p_lat is not null and b.lat is not null then
    v_dist := round(ST_Distance(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography, ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4326)::geography));
    v_far := v_dist > greatest(150, coalesce(p_accuracy, 0));
  else
    v_far := true;   -- no location: the admins see it
  end if;

  insert into ms_visits (business_id, campaign_id, zone_id, rep_id, outcome, notes, contact_name, contact_phone, contact_email,
                         follow_up_at, lat, lng, accuracy_m, distance_m, far)
  values (b.id, p_campaign, b.zone_id, auth.uid(), p_outcome, nullif(trim(coalesce(p_notes, '')), ''),
          nullif(trim(coalesce(p_contact_name, '')), ''), nullif(trim(coalesce(p_contact_phone, '')), ''), nullif(trim(coalesce(p_contact_email, '')), ''),
          case when p_outcome = 'follow_up' then p_follow_up_at end, p_lat, p_lng, p_accuracy, v_dist, v_far)
  returning * into v;

  if p_outcome = 'closed' then
    insert into ms_deals (visit_id, business_id, campaign_id, zone_id, rep_id) values (v.id, b.id, p_campaign, b.zone_id, auth.uid());
  end if;
  return jsonb_build_object('id', v.id, 'at', v.at, 'outcome', v.outcome, 'far', v.far, 'distance_m', v.distance_m,
                            'state', ms_pin_state(v.outcome, null, case when p_outcome = 'closed' then 'pending' end));
end $$;

create or replace function public.ms_rep_followups()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'America/Toronto')::date;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'business_id', b.id, 'name', b.name, 'address', b.address, 'zone_id', zc.zone_id, 'zone_name', z.name,
             'campaign_id', zc.campaign_id, 'campaign_name', c.name, 'follow_up_at', l.follow_up_at,
             'when', case when (l.follow_up_at at time zone 'America/Toronto')::date < v_today then 'overdue'
                          when (l.follow_up_at at time zone 'America/Toronto')::date = v_today then 'today' else 'later' end,
             'contact_name', v.contact_name, 'contact_phone', v.contact_phone, 'notes', v.notes)
           order by l.follow_up_at)
      from ms_zone_campaigns zc
      join ms_zones z on z.id = zc.zone_id and z.status = 'active'
      join ms_campaigns c on c.id = zc.campaign_id and c.is_active
      join lateral ms_rep_latest(auth.uid(), zc.campaign_id) l on l.outcome = 'follow_up'
      join ms_businesses b on b.id = l.business_id and b.zone_id = zc.zone_id
      join ms_visits v on v.id = l.visit_id
     where zc.rep_id = auth.uid()), '[]'::jsonb);
end $$;

create or replace function public.ms_rep_numbers()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'America/Toronto')::date;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'today', v_today,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'visits', coalesce(n.visits, 0), 'deals', coalesce(n.deals, 0)) order by d)
        from generate_series(v_today - 13, v_today, interval '1 day') g(d0)
        cross join lateral (select g.d0::date d) dd
        left join (select (v.at at time zone 'America/Toronto')::date as vday, count(*)::int visits, count(*) filter (where v.outcome = 'closed')::int deals
                     from ms_visits v where v.rep_id = auth.uid() and v.at >= (v_today - 13)::timestamp at time zone 'America/Toronto'
                    group by 1) n on n.vday = dd.d), '[]'::jsonb),
    'visits_total', (select count(*) from ms_visits where rep_id = auth.uid()),
    'deals', jsonb_build_object(
      'pending', (select count(*) from ms_deals where rep_id = auth.uid() and status = 'pending'),
      'approved', (select count(*) from ms_deals where rep_id = auth.uid() and status = 'approved'),
      'rejected', (select count(*) from ms_deals where rep_id = auth.uid() and status = 'rejected')),
    'recent_deals', coalesce((
      select jsonb_agg(jsonb_build_object('id', d.id, 'business', b.name, 'campaign', c.name, 'at', d.created_at, 'status', d.status, 'note', d.decision_note)
                       order by d.created_at desc)
        from (select * from ms_deals where rep_id = auth.uid() order by created_at desc limit 20) d
        join ms_businesses b on b.id = d.business_id join ms_campaigns c on c.id = d.campaign_id), '[]'::jsonb));
end $$;

-- ───────────── the admins' pipeline ─────────────
create or replace function public.ms_deals_list(p_status text default 'pending')
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if p_status not in ('pending', 'approved', 'rejected') then raise exception 'Pick pending, approved or rejected'; end if;
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', d.id, 'status', d.status, 'at', d.created_at, 'decided_at', d.decided_at, 'decision_note', d.decision_note,
             'decided_by', (select full_name from app_users where id = d.decided_by),
             'business', jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address, 'kind', b.kind, 'phone', b.phone),
             'campaign', c.name, 'color', c.color, 'zone', z.name, 'rep', u.full_name, 'rep_id', u.id,
             'notes', v.notes, 'contact_name', v.contact_name, 'contact_phone', v.contact_phone, 'contact_email', v.contact_email,
             'far', v.far, 'distance_m', v.distance_m))
           order by d.created_at desc)
      from ms_deals d
      join ms_visits v on v.id = d.visit_id
      join ms_businesses b on b.id = d.business_id
      join ms_campaigns c on c.id = d.campaign_id
      left join ms_zones z on z.id = d.zone_id
      join app_users u on u.id = d.rep_id
     where d.status = p_status), '[]'::jsonb);
end $$;

create or replace function public.ms_decide_deal(p_deal uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare d ms_deals;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select * into d from ms_deals where id = p_deal for update;
  if d.id is null then raise exception 'No such deal'; end if;
  if p_approve is null then raise exception 'Approve or reject?'; end if;
  if not p_approve and nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Say why it’s rejected: the rep sees it'; end if;
  update ms_deals set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_deal;
  insert into audit_log (actor, entity, entity_id, action, before, after)
  values (auth.uid(), 'ms_deals', p_deal::text, case when p_approve then 'approve' else 'reject' end,
          jsonb_build_object('status', d.status), jsonb_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'note', p_note));
end $$;

create or replace function public.ms_flags_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', v.id, 'at', v.at, 'notes', v.notes, 'far', v.far, 'distance_m', v.distance_m,
             'business', jsonb_build_object('id', b.id, 'name', b.name, 'address', b.address, 'kind', b.kind),
             'campaign', c.name, 'zone', z.name, 'rep', u.full_name)
           order by v.at)
      from ms_visits v
      join ms_businesses b on b.id = v.business_id
      join ms_campaigns c on c.id = v.campaign_id
      left join ms_zones z on z.id = v.zone_id
      join app_users u on u.id = v.rep_id
     where v.outcome = 'cant_sell' and v.resolved_at is null), '[]'::jsonb);
end $$;

-- remove: the business comes off every list (marked closed); keep: it goes back on the rep's list
create or replace function public.ms_resolve_flag(p_visit uuid, p_remove boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v ms_visits;
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  select * into v from ms_visits where id = p_visit for update;
  if v.id is null or v.outcome <> 'cant_sell' then raise exception 'No such flag'; end if;
  if v.resolved_at is not null then raise exception 'Already sorted'; end if;
  update ms_visits set resolved_at = now(), resolved_by = auth.uid(), resolution = case when p_remove then 'removed' else 'kept' end where id = p_visit;
  if p_remove then
    update ms_businesses set status = 'closed' where id = v.business_id;   -- the reason stays on the visit
  end if;
end $$;

-- ───────────── sign-in and setup (MainstreetAI look) ─────────────
-- the setup page: whether this link is a rep's (it then shows MainstreetAI, not Property Stars)
create or replace function public.ms_setup_is_rep(p_code text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from app_setup_tokens t join user_permissions up on up.user_id = t.user_id and up.permission = 'mainstreet_rep'
                  where t.token_hash = encode(digest(coalesce(p_code, ''), 'sha256'), 'hex'))
$$;
revoke all on function public.ms_setup_is_rep(text) from public;
grant execute on function public.ms_setup_is_rep(text) to anon, authenticated;

-- sign in by email: the sign-in address of an active rep with this email (service role only, so
-- nobody can ask which emails are reps)
create or replace function public.ms_rep_login_address(p_email text)
returns text language sql stable security definer set search_path = public as $$
  select u.username || '@login.cpsdms.app'
    from app_users u join user_permissions up on up.user_id = u.id and up.permission = 'mainstreet_rep'
   where lower(u.email) = lower(trim(coalesce(p_email, ''))) and u.is_active
   limit 1
$$;
revoke all on function public.ms_rep_login_address(text) from public, anon, authenticated;
grant execute on function public.ms_rep_login_address(text) to service_role;

-- forgot password: a new one-time link for an active rep with this email (service role only); none
-- when the email isn't a rep's, and at most one every 2 minutes
create or replace function public.ms_rep_reset_link(p_email text)
returns table (code text, email text, full_name text, expires_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
declare u app_users; v_code text := encode(gen_random_bytes(32), 'hex'); v_exp timestamptz := now() + interval '2 hours';
begin
  select a.* into u from app_users a join user_permissions up on up.user_id = a.id and up.permission = 'mainstreet_rep'
   where lower(a.email) = lower(trim(coalesce(p_email, ''))) and a.is_active limit 1;
  if u.id is null then return; end if;
  if exists (select 1 from app_setup_tokens t where t.user_id = u.id and t.created_at > now() - interval '2 minutes') then return; end if;
  update app_setup_tokens t set cancelled_at = now() where t.user_id = u.id and t.used_at is null and t.cancelled_at is null;
  insert into app_setup_tokens (user_id, token_hash, email, created_by, expires_at)
  values (u.id, encode(digest(v_code, 'sha256'), 'hex'), trim(u.email), null, v_exp);
  return query select v_code, trim(u.email), u.full_name, v_exp;
end $$;
revoke all on function public.ms_rep_reset_link(text) from public, anon, authenticated;
grant execute on function public.ms_rep_reset_link(text) to service_role;

-- ───────────── access ─────────────
do $$
declare f text;
begin
  foreach f in array array[
    'ms_rep_home()', 'ms_rep_zone(uuid,uuid)', 'ms_rep_business(uuid,uuid)',
    'ms_rep_log_visit(uuid,uuid,text,text,text,text,text,timestamptz,double precision,double precision,numeric)',
    'ms_rep_followups()', 'ms_rep_numbers()', 'ms_deals_list(text)', 'ms_decide_deal(uuid,boolean,text)',
    'ms_flags_list()', 'ms_resolve_flag(uuid,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
