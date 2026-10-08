-- RUN_19 — the customer CRM: every knock kept as a visit, the customer page, the territory map.
-- ADDITIVE ONLY.
--
-- house_dispositions holds one row per house (its latest knock): a house knocked "Not home" on
-- Monday and "No" on Wednesday only remembers "No". client_visits keeps one row per house per day,
-- written as the crew taps (a trigger on house_dispositions), so a customer's page can show every
-- visit. Existing knocks (since Sep 15) are copied in once.
--
--   app_customer(id)        one customer: the record, its route map, every visit at the house,
--                           and the PCL texts sent to it.
--   app_my_areas()          the route maps (areas) the person can see, with customer counts.
--   app_area_customers(a)   one route map's customers as map points, each with a category for this
--                           season (done, new, owed, said no, past customer), and the season's totals.
-- All three are for people with Clients, Master Bookings, Workerbook or Territory access, and only
-- for the centers they can see.

create table if not exists public.client_visits (
  route_code text not null,
  house_key  text not null,              -- "123a|elm rd", as the map logsheet writes it
  day        date not null,
  status     text not null,              -- no / not_home / go_back / invalid
  note       text,
  first_name text,                       -- a name the crew jotted at the door
  worker_id  text,
  center_id  text,
  at         timestamptz not null default now(),
  primary key (route_code, house_key, day)
);
create index if not exists client_visits_day on public.client_visits (day);
alter table public.client_visits enable row level security;
revoke all on public.client_visits from public, anon, authenticated;

create or replace function public.crm_keep_visit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    -- a knock taken back the same day: forget it
    delete from client_visits
     where route_code = old.route_code and house_key = old.house_key
       and day = (now() at time zone 'America/Toronto')::date and status = old.status;
    return null;
  end if;
  insert into client_visits (route_code, house_key, day, status, note, first_name, worker_id, center_id, at)
  -- the day is the database's own (Toronto) day, not the phone's clock
  values (new.route_code, new.house_key, (now() at time zone 'America/Toronto')::date,
          new.status, nullif(trim(coalesce(new.note, '')), ''), nullif(trim(coalesce(new.first_name, '')), ''), new.worker_id,
          new.command_center_id, now())
  on conflict (route_code, house_key, day) do update
    set status = excluded.status, note = coalesce(excluded.note, client_visits.note),
        first_name = coalesce(excluded.first_name, client_visits.first_name), worker_id = excluded.worker_id, at = excluded.at;
  return null;
end $$;
revoke all on function public.crm_keep_visit() from public, anon, authenticated;
drop trigger if exists crm_keep_visit on public.house_dispositions;
create trigger crm_keep_visit after insert or update or delete on public.house_dispositions
  for each row execute function public.crm_keep_visit();

-- the knocks so far (each house's latest, on the day it was made; houses already kept are left alone)
insert into client_visits (route_code, house_key, day, status, note, first_name, worker_id, center_id, at)
select route_code, house_key, (coalesce(updated_at, created_at) at time zone 'America/Toronto')::date, status,
       nullif(trim(coalesce(note, '')), ''), nullif(trim(coalesce(first_name, '')), ''), worker_id, command_center_id, coalesce(updated_at, created_at)
  from house_dispositions hd where route_code is not null and house_key is not null and status is not null
   and not exists (select 1 from client_visits v where v.route_code = hd.route_code and v.house_key = hd.house_key)
on conflict do nothing;

-- ───────────── who may open customers ─────────────
create or replace function public.crm_can_read()
returns boolean language sql stable security definer set search_path = public as $$
  select app_has_perm('dialer') or app_has_perm('bookings') or app_has_perm('workerbook') or app_has_perm('sa_territory')
$$;
revoke all on function public.crm_can_read() from public, anon;
grant execute on function public.crm_can_read() to authenticated;

-- the route maps (areas) a person can see: every map for Super Admins, else their centers' maps
create or replace function public.crm_visible_areas()
returns setof text language sql stable security definer set search_path = public as $$
  select distinct rm.area_name from route_maps rm
   where rm.status = 'approved'
     and (app_is_super_admin()
          or exists (select 1 from map_area_centers mac where mac.area_name = rm.area_name and app_can_see_center(mac.center_id)))
$$;
revoke all on function public.crm_visible_areas() from public, anon, authenticated;

-- a customer's house key, the way the map logsheet writes it ("123a|elm rd")
create or replace function public.crm_house_key(p_house text, p_street_norm text)
returns text language sql immutable set search_path = public as $$
  select lower(regexp_replace(coalesce(p_house, ''), '\s+', '', 'g')) || '|' || coalesce(p_street_norm, '')
$$;

-- ───────────── one customer ─────────────
create or replace function public.app_customer(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c clients; v_area text; v_key text; v_text_key text;
begin
  if not crm_can_read() then raise exception 'Not allowed'; end if;
  select * into c from clients where id = p_id;
  if c.id is null then raise exception 'That customer isn''t on file'; end if;
  select area_name into v_area from route_maps where route_code = c.route_code and status = 'approved' limit 1;
  if v_area is not null and v_area not in (select crm_visible_areas()) then raise exception 'Not allowed'; end if;
  v_key := crm_house_key(c.house_no, c.street_norm);
  v_text_key := lower(coalesce(c.route_code, '') || '|' || regexp_replace(trim(coalesce(c.house_no, '') || ' ' || coalesce(c.street_name, '')), '\s+', ' ', 'g'));
  return jsonb_build_object(
    'client', to_jsonb(c) - 'search_text',
    'area', v_area,
    'visits', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                 'day', v.day, 'at', v.at, 'status', v.status, 'note', v.note, 'first_name', v.first_name, 'worker_id', v.worker_id,
                 'worker', coalesce(
                     (select nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '') from hires h join people p on p.id = h.person_id
                       where h.cn = v.worker_id order by h.year desc limit 1),
                     (select nullif(trim(concat_ws(' ', k.first_name, k.last_name)), '') from contractors k
                       where k.contractor_id = v.worker_id limit 1))))
                 order by v.day desc, v.at desc)
               from client_visits v where v.route_code = c.route_code and v.house_key = v_key), '[]'::jsonb),
    'texts', coalesce((select jsonb_agg(jsonb_build_object('at', e.sent_at) order by e.sent_at desc)
               from email_logs e where e.email_type = 'pcl_outreach_text' and lower(e.recipient_email) = v_text_key), '[]'::jsonb)
  );
end $$;
revoke all on function public.app_customer(uuid) from public, anon;
grant execute on function public.app_customer(uuid) to authenticated;

-- ───────────── the route maps a person can see, with counts ─────────────
create or replace function public.app_my_areas()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare yr text := extract(year from now() at time zone 'America/Toronto')::int::text;
begin
  if not crm_can_read() then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('area', a.area_name, 'region', ap.region, 'routes', a.routes, 'customers', coalesce(k.customers, 0),
                                        'done', coalesce(k.done, 0)) order by a.area_name)
      from (select area_name, count(*) routes, array_agg(route_code) codes from route_maps
             where status = 'approved' and area_name in (select crm_visible_areas()) group by area_name) a
      left join area_prefixes ap on ap.area_name = a.area_name
      left join lateral (
        select count(*) customers,
               count(*) filter (where c.history @> jsonb_build_array(jsonb_build_object('year', yr::int))
                                   or c.history @> jsonb_build_array(jsonb_build_object('year', yr))) done
          from clients c where c.route_code = any(a.codes)) k on true), '[]'::jsonb);
end $$;
revoke all on function public.app_my_areas() from public, anon;
grant execute on function public.app_my_areas() to authenticated;

-- ───────────── one route map's customers, as map points ─────────────
-- Each point: [id, lat, lng, route, category, address, name, paid this season (not counting owed)]. Categories, first
-- that fits: owed (a job this season not paid yet), done (a job this season, a customer before),
-- new (a job this season, first time), no (said no or invalid this season), past (a customer in
-- earlier years), none. Houses that said no this season but aren't customers come too (id null).
create or replace function public.app_area_customers(p_area text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  yr int := extract(year from now() at time zone 'America/Toronto')::int;
  y0 date := make_date(extract(year from now() at time zone 'America/Toronto')::int, 1, 1);
  codes text[];
  pts jsonb; extra jsonb;
begin
  if not crm_can_read() then raise exception 'Not allowed'; end if;
  if p_area not in (select crm_visible_areas()) then raise exception 'Not allowed'; end if;
  select array_agg(route_code) into codes from route_maps where area_name = p_area and status = 'approved';
  if codes is null then return jsonb_build_object('points', '[]'::jsonb, 'routes', 0); end if;

  with c as (
    select c.id, c.lat, c.lng, c.route_code, c.house_no, c.street_name, c.street_norm,
           nullif(trim(concat_ws(' ', c.people->0->>'first', c.people->0->>'last')), '') as name,
           (select count(*) from jsonb_array_elements(c.history) h where h->>'year' = yr::text) as jobs_now,
           (select count(*) from jsonb_array_elements(c.history) h where h->>'year' ~ '^\d{4}$' and (h->>'year')::int < yr) as jobs_before,
           (select count(*) from jsonb_array_elements(c.history) h where h->>'year' = yr::text and h->>'paid' in ('owed', 'to_confirm')) as unpaid,
           (select coalesce(sum(nullif(regexp_replace(coalesce(h->>'price', ''), '[^0-9.]', '', 'g'), '')::numeric), 0)
              from jsonb_array_elements(c.history) h
             where h->>'year' = yr::text and coalesce(h->>'paid', '') not in ('owed', 'to_confirm')) as paid,
           jsonb_array_length(c.history) as hist,
           exists (select 1 from client_visits v where v.route_code = c.route_code and v.house_key = crm_house_key(c.house_no, c.street_norm)
                    and v.day >= y0 and v.status in ('no', 'invalid')) as said_no
      from clients c where c.route_code = any(codes) and c.lat is not null
  ), p as (
    select *, case when unpaid > 0 then 'owed' when jobs_now > 0 and jobs_before > 0 then 'done' when jobs_now > 0 then 'new'
                   when said_no then 'no' when hist > 0 then 'past' else 'none' end as cat from c
  )
  select jsonb_build_object(
           'points', coalesce(jsonb_agg(jsonb_build_array(id, round(lat::numeric, 6), round(lng::numeric, 6), route_code, cat,
                                                          trim(concat_ws(' ', house_no, street_name)), name, paid)), '[]'::jsonb),
           'totals', jsonb_build_object(
             'customers', count(*), 'done', count(*) filter (where jobs_now > 0), 'new', count(*) filter (where cat = 'new'),
             'back', count(*) filter (where jobs_now > 0 and jobs_before > 0), 'past', count(*) filter (where jobs_before > 0),
             'owed', count(*) filter (where cat = 'owed'), 'paid', coalesce(sum(paid), 0),
             'owed_amount', coalesce((select sum(nullif(regexp_replace(coalesce(h->>'price', ''), '[^0-9.]', '', 'g'), '')::numeric)
                                        from clients cc, jsonb_array_elements(cc.history) h
                                       where cc.route_code = any(codes) and h->>'year' = yr::text and h->>'paid' in ('owed', 'to_confirm')), 0)))
    into pts from p;

  -- houses that said no / invalid this season and aren't customers
  select coalesce(jsonb_agg(jsonb_build_array(null, round(rh.lat::numeric, 6), round(rh.lng::numeric, 6), v.route_code, 'no',
                                              trim(concat_ws(' ', rh.civic_no::text || coalesce(rh.civic_suffix, ''), rh.street_name)), null, 0)), '[]'::jsonb)
    into extra
    from (select distinct on (route_code, house_key) route_code, house_key from client_visits
           where route_code = any(codes) and day >= y0 and status in ('no', 'invalid') order by route_code, house_key, day desc) v
    join route_houses rh on rh.route_code = v.route_code and rh.house_key = v.house_key
   where rh.lat is not null
     and not exists (select 1 from clients c where c.route_code = v.route_code and crm_house_key(c.house_no, c.street_norm) = v.house_key);

  return pts || jsonb_build_object('points', (pts->'points') || extra, 'routes', cardinality(codes), 'year', yr,
                                   'said_no', jsonb_array_length(extra) + (select count(*) from jsonb_array_elements(pts->'points') x where x->>4 = 'no'));
end $$;
revoke all on function public.app_area_customers(text) from public, anon;
grant execute on function public.app_area_customers(text) to authenticated;
