-- MainstreetAI: Present marks a business Pitched; hosts can follow up after a call; known businesses near a
-- spot when a rep adds one. Additive only (new columns and functions; two functions get one rule each, rewritten
-- from their live definitions with a check that the rule was found).

-- 1. Pitched once the rep presents the deck (not only once the owner answers its questions)
alter table public.ms_business_status add column if not exists pitched_at timestamptz;
alter table public.ms_business_status add column if not exists pitched_by uuid references public.app_users(id);

create or replace function public.ms_mark_pitched(p_business uuid, p_campaign uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (ms_is_admin() or ms_rep_can(p_business, p_campaign)) then raise exception 'Not allowed'; end if;
  insert into ms_business_status (business_id, campaign_id, pitched_at, pitched_by) values (p_business, p_campaign, now(), auth.uid())
  on conflict (business_id, campaign_id) do update set pitched_at = coalesce(ms_business_status.pitched_at, excluded.pitched_at),
    pitched_by = coalesce(ms_business_status.pitched_by, excluded.pitched_by);
  return ms_biz_state(p_business, p_campaign);
end $$;
revoke all on function public.ms_mark_pitched(uuid, uuid) from public, anon;
grant execute on function public.ms_mark_pitched(uuid, uuid) to authenticated;

-- 2. A host's follow-up after the call: a time and a note. The call stays booked (the stage stays Booked).
alter table public.ms_meetings add column if not exists follow_up_at timestamptz;

create or replace function public.ms_meeting_follow_up(p_meeting uuid, p_at timestamptz, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m ms_meetings;
begin
  select * into m from ms_meetings where id = p_meeting;
  if m.id is null then raise exception 'That call is gone'; end if;
  if not (ms_is_admin() or m.host_id = auth.uid()) then raise exception 'Not allowed'; end if;
  if m.status in ('cancelled', 'closed', 'not_fit') then raise exception 'That call is already finished'; end if;
  if p_at is not null and p_at < now() - interval '1 hour' then raise exception 'That follow-up time has already passed'; end if;
  update ms_meetings set status = 'booked', follow_up_at = p_at,
         outcome_note = coalesce(nullif(trim(coalesce(p_note, '')), ''), outcome_note),
         outcome_by = case when p_at is null then null else auth.uid() end, outcome_at = case when p_at is null then null else now() end, updated_at = now()
   where id = p_meeting;
  return ms_meeting_json(p_meeting);
end $$;
revoke all on function public.ms_meeting_follow_up(uuid, timestamptz, text) from public, anon;
grant execute on function public.ms_meeting_follow_up(uuid, timestamptz, text) to authenticated;

-- 3. Known businesses near a spot (the ones loaded with the city, hidden from the map): offered when a rep adds
--    one, so they pick it instead of typing. Adding it makes it theirs (the same name within 60 m is reused).
create or replace function public.ms_rep_known_near(p_lat double precision, p_lng double precision)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pt geometry := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326);
begin
  if not (ms_is_rep() or ms_is_admin()) then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', x.id, 'name', x.name, 'address', x.address, 'kind', x.kind,
             'phone', x.phone, 'website', x.website, 'lat', x.lat, 'lng', x.lng, 'm', x.m)) order by x.m)
      from (select b.id, b.name, b.address, b.kind, b.phone, b.website, b.lat, b.lng,
                   round(ST_Distance(b.geom::geography, v_pt::geography))::int m
              from ms_businesses b
             where b.added_by is null and b.status <> 'closed' and b.do_not_knock is null and b.merged_into is null
               and coalesce(b.lead_status, 'new') not in ('merged', 'removed')
               and ST_DWithin(b.geom::geography, v_pt::geography, 90)
             order by b.geom <-> v_pt limit 12) x), '[]'::jsonb);
end $$;
revoke all on function public.ms_rep_known_near(double precision, double precision) from public, anon;
grant execute on function public.ms_rep_known_near(double precision, double precision) to authenticated;

-- 4. The stage reads "presented", and a call's JSON carries its follow-up
do $mig$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.ms_biz_state(uuid,uuid)'::regprocedure);
  d2 := replace(d, $q$when ans.business_id is not null or mt.status = 'no_show' then 'pitched'$q$,
                   $q$when ans.business_id is not null or st.pitched_at is not null or mt.status = 'no_show' then 'pitched'$q$);
  if d2 = d then raise exception 'ms_biz_state: the pitched rule was not found'; end if;
  execute d2;

  d := pg_get_functiondef('public.ms_meeting_json(uuid)'::regprocedure);
  d2 := replace(d, $q$'notes', m.notes,$q$, $q$'notes', m.notes, 'follow_up_at', m.follow_up_at,$q$);
  if d2 = d then raise exception 'ms_meeting_json: the notes field was not found'; end if;
  execute d2;
end $mig$;
