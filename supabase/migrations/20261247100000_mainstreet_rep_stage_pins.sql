-- MainstreetAI rep app: pins by stage. The map (ms_rep_map) and a zone's list (ms_rep_zone) now also send each
-- business's stage (new, talked, pitched, booked, won, lost), worked out by ms_biz_state, the one place stages are
-- decided. The app colours pins by it (amber while a follow-up is open). Same functions as before otherwise.
-- Additive only.

create or replace function public.ms_rep_map()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
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
           's', ms_pin_state2(l.outcome, l.resolution, l.deal, l.at, r.retry_days), 'at', l.at, 'f', l.follow_up_at,
           'st', case when r.campaign_id is not null then ms_biz_state(r.id, r.campaign_id) ->> 'stage' end))), '[]'::jsonb)
    into v_biz
    from rows r
    left join ms_plazas pl on pl.id = r.plaza_id
    left join latest l on l.business_id = r.id and l.campaign_id = r.campaign_id;

  return jsonb_build_object('pairs', v_pairs, 'businesses', v_biz);
end $function$;

create or replace function public.ms_rep_zone(p_zone uuid, p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
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
               'visits', coalesce(l.visits, 0), 'stage', ms_biz_state(t.id, p_campaign) ->> 'stage')
             order by p.name nulls last, t.address, t.name)
        from ms_zone_targets(p_zone, p_campaign) t
        left join ms_plazas p on p.id = t.plaza_id
        left join ms_rep_latest(auth.uid(), p_campaign) l on l.business_id = t.id), '[]'::jsonb));
end $function$;
