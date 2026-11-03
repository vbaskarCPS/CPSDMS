-- MainstreetAI rep app: a rep with no zones assigned can still add businesses (and work the ones they add).
-- ADDITIVE ONLY: two functions replaced, nothing else changes.
--
--   ms_rep_has_campaign: as before, a rep is on a campaign through an active zone on it. NEW: a rep with no active
--     zone at all is on every active campaign, so the kit, presenting and booking work for the businesses they add.
--     A rep with zones is exactly as before.
--   ms_rep_add_lead: when the rep has no zone to take the campaign from, it uses the active campaign (the oldest,
--     when there's more than one); everything else is as before.

create or replace function public.ms_rep_has_campaign(p_campaign uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select ms_is_rep() and (
    exists (select 1 from ms_zone_campaigns zc join ms_zones z on z.id = zc.zone_id join ms_campaigns c on c.id = zc.campaign_id
             where zc.campaign_id = p_campaign and zc.rep_id = auth.uid() and z.status = 'active' and c.is_active)
    or (exists (select 1 from ms_campaigns c where c.id = p_campaign and c.is_active)
        and not exists (select 1 from ms_zone_campaigns zc join ms_zones z on z.id = zc.zone_id and z.status = 'active'
                         where zc.rep_id = auth.uid())))
$$;

create or replace function public.ms_rep_add_lead(p_name text, p_kind text, p_address text, p_lat double precision, p_lng double precision,
  p_phone text default null, p_website text default null, p_campaign uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_pt geometry; v_zone ms_zones; v_city uuid; v_id uuid; v_dupe text; v_hidden uuid; v_camp uuid := p_campaign;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'What’s the business called?'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Where is it? Set the pin or type the address.'; end if;
  if p_kind is null or not (p_kind = any (ms_business_kinds())) then raise exception 'Pick what kind of business it is'; end if;
  v_pt := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
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
  if v_camp is null then   -- no zones: the active campaign
    select c.id into v_camp from ms_campaigns c where c.is_active order by c.created_at, c.name limit 1;
  end if;
  if v_camp is null or not ms_rep_has_campaign(v_camp) then raise exception 'You aren’t on that campaign'; end if;
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
