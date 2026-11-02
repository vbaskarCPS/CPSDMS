-- MainstreetAI: reps only see businesses reps have added (or that already have a visit, so no history is lost).
-- Businesses loaded when a city is built (OpenStreetMap, Google) stay in the database but are hidden from reps'
-- lists and maps. When a rep adds one of those hidden businesses at the door (same name within 60 m), it becomes
-- theirs instead of a duplicate. Additive only.

create or replace function public.ms_zone_targets(p_zone uuid, p_campaign uuid)
returns setof public.ms_businesses language sql stable security definer set search_path = public as $$
  select b.* from ms_businesses b
   where b.zone_id = p_zone and b.status <> 'closed' and b.do_not_knock is null and coalesce(b.lead_status, 'new') not in ('merged', 'removed')
     and (b.added_by is not null or exists (select 1 from ms_visits v where v.business_id = b.id))
     and (b.added_by is not null
          or (not b.is_chain
              and (not exists (select 1 from ms_campaign_categories cc where cc.campaign_id = p_campaign)
                   or b.kind in (select cc.category from ms_campaign_categories cc where cc.campaign_id = p_campaign))))
$$;
revoke all on function public.ms_zone_targets(uuid, uuid) from public, anon, authenticated;

create or replace function public.ms_rep_add_lead(
  p_name text, p_kind text, p_address text, p_lat double precision, p_lng double precision,
  p_phone text default null, p_website text default null, p_campaign uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pt geometry; v_zone ms_zones; v_city uuid; v_id uuid; v_dupe text; v_hidden uuid; v_camp uuid := p_campaign;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'What’s the business called?'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Where is it? Set the pin or type the address.'; end if;
  if p_kind is null or not (p_kind = any (ms_business_kinds())) then raise exception 'Pick what kind of business it is'; end if;
  v_pt := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
  -- already added by a rep (or visited): that one, not a second
  select b.name into v_dupe from ms_businesses b
   where b.status <> 'closed' and b.name_norm = ms_name_norm(p_name) and ST_DWithin(b.geom::geography, v_pt::geography, 60)
     and (b.added_by is not null or exists (select 1 from ms_visits v where v.business_id = b.id)) limit 1;
  if v_dupe is not null then raise exception 'It’s already on the map: %', v_dupe; end if;
  select * into v_zone from ms_zones z where z.status = 'active' and z.geom is not null and ST_Contains(z.geom, v_pt) limit 1;
  if v_camp is null then
    select zc.campaign_id into v_camp from ms_zone_campaigns zc where zc.rep_id = auth.uid() and zc.zone_id = v_zone.id limit 1;
  end if;
  if v_camp is null then
    select zc.campaign_id into v_camp from ms_zone_campaigns zc where zc.rep_id = auth.uid() limit 1;
  end if;
  if v_camp is null or not ms_rep_has_campaign(v_camp) then raise exception 'You aren’t on that campaign'; end if;
  -- loaded with the city but hidden: it becomes the rep's
  select b.id into v_hidden from ms_businesses b
   where b.status <> 'closed' and b.name_norm = ms_name_norm(p_name) and ST_DWithin(b.geom::geography, v_pt::geography, 60) and b.added_by is null
   order by b.geom <-> v_pt limit 1;
  if v_hidden is not null then
    update ms_businesses set added_by = auth.uid(), added_at = now(), lead_status = 'new', lead_campaign = v_camp, kind = p_kind,
           address = coalesce(nullif(trim(coalesce(p_address, '')), ''), address), phone = coalesce(nullif(trim(coalesce(p_phone, '')), ''), phone),
           website = coalesce(nullif(trim(coalesce(p_website, '')), ''), website),
           sources = case when 'rep' = any (sources) then sources else sources || '{rep}'::text[] end,
           zone_id = coalesce(v_zone.id, zone_id), updated_at = now()
     where id = v_hidden and added_by is null;
    return jsonb_build_object('id', v_hidden, 'zone_id', v_zone.id, 'zone_name', v_zone.name, 'campaign_id', v_camp,
                              'in_my_zone', v_zone.id is not null and ms_rep_has(v_zone.id, v_camp));
  end if;
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

-- "already added here": only what reps added or visited
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
       and (b.added_by is not null or exists (select 1 from ms_visits v where v.business_id = b.id))
       and ST_DWithin(b.geom::geography, v_pt::geography, 60)
     order by b.geom <-> v_pt limit 8) s), '[]'::jsonb);
end $$;
