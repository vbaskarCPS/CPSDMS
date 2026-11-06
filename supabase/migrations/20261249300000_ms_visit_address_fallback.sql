-- MainstreetAI › a visit saved without the phone's GPS is placed at the business's address instead, labelled 'address'
-- (not verified, still flagged far for an admin), so it shows in the right place on maps and reports. 'gps' visits
-- are the only ones that prove the rep was at the door. Visits already saved without a location get the same. Additive only.
alter table public.ms_visits add column if not exists location_source text not null default 'gps' check (location_source in ('gps', 'address', 'none'));

update public.ms_visits v set lat = b.lat, lng = b.lng, location_source = 'address', far = true
  from public.ms_businesses b where b.id = v.business_id and v.lat is null and b.lat is not null;
update public.ms_visits set location_source = 'none' where lat is null;

create or replace function public.ms_rep_log_visit(p_business uuid, p_campaign uuid, p_outcome text, p_notes text DEFAULT NULL::text, p_contact_name text DEFAULT NULL::text, p_contact_phone text DEFAULT NULL::text, p_contact_email text DEFAULT NULL::text, p_follow_up_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_accuracy numeric DEFAULT NULL::numeric, p_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_client_id uuid DEFAULT NULL::uuid, p_photos text[] DEFAULT NULL::text[])
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare b ms_businesses; v ms_visits; v_dist int; v_far boolean; v_at timestamptz := coalesce(p_at, clock_timestamp()); ph text;
  v_lat double precision := p_lat; v_lng double precision := p_lng; v_src text := 'gps';
begin
  if p_client_id is not null then
    select * into v from ms_visits where client_id = p_client_id;
    if v.id is not null then
      if v.rep_id <> auth.uid() then raise exception 'Not allowed'; end if;
      return jsonb_build_object('id', v.id, 'at', v.at, 'outcome', v.outcome, 'far', v.far, 'distance_m', v.distance_m, 'again', true, 'location', v.location_source);
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
    v_far := true;
  end if;
  -- no GPS from the phone: place it at the business's address (not verified, still far)
  if p_lat is null then
    if b.lat is not null then v_lat := b.lat; v_lng := b.lng; v_src := 'address'; else v_src := 'none'; end if;
  end if;

  insert into ms_visits (business_id, campaign_id, zone_id, rep_id, at, logged_at, outcome, notes, contact_name, contact_phone, contact_email,
                         follow_up_at, lat, lng, accuracy_m, distance_m, far, photos, client_id, location_source)
  values (b.id, p_campaign, b.zone_id, auth.uid(), v_at, now(), p_outcome, nullif(trim(coalesce(p_notes, '')), ''),
          nullif(trim(coalesce(p_contact_name, '')), ''), nullif(trim(coalesce(p_contact_phone, '')), ''), nullif(trim(coalesce(p_contact_email, '')), ''),
          case when p_outcome = 'follow_up' then p_follow_up_at end, v_lat, v_lng, p_accuracy, v_dist, v_far, coalesce(p_photos, '{}'), p_client_id, v_src)
  returning * into v;

  if p_outcome = 'closed' then
    insert into ms_deals (visit_id, business_id, campaign_id, zone_id, rep_id) values (v.id, b.id, p_campaign, b.zone_id, auth.uid());
  end if;
  return jsonb_build_object('id', v.id, 'at', v.at, 'outcome', v.outcome, 'far', v.far, 'distance_m', v.distance_m, 'location', v.location_source,
                            'state', ms_pin_state(v.outcome, null, case when p_outcome = 'closed' then 'pending' end));
end $function$;
