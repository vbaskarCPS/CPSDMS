-- MainstreetAI › pipeline: where each business stands (per campaign), how hot it is, and its whole history.
--
-- Stage (worked out, not typed in):
--   new          a business a rep added, nothing logged yet
--   talked       a visit was logged
--   pitched      the owner answered the deck's questions (or missed their onboarding call)
--   booked       an onboarding call is booked
--   won          the host marked the call Closed
--   lost         marked lost (with a reason), the call was Not a fit, or the last visit was Not interested /
--                Can't sell here with nothing booked since
-- Score: points from the deck answers, who the rep met and the last visit; Hot 6+, Warm 3–5, Cold under 3
-- (no answers and no visits: no score). Each point comes with its reason, shown to reps and admins.
-- Additive only.

create table if not exists public.ms_business_status (
  business_id uuid not null references public.ms_businesses(id),
  campaign_id uuid not null references public.ms_campaigns(id),
  lost_reason text,
  lost_at timestamptz,
  lost_by uuid references public.app_users(id),
  primary key (business_id, campaign_id)
);
alter table public.ms_business_status enable row level security;

create or replace function public.ms_biz_state(p_business uuid, p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a jsonb; ans ms_business_answers; st ms_business_status; mt ms_meetings; lv ms_visits; v_visits int;
  pts int := 0; why text[] := '{}'; v_stage text; v_heat text; v_dm boolean; v_save numeric; v_booked_after boolean;
begin
  select * into ans from ms_business_answers where business_id = p_business and campaign_id = p_campaign;
  select * into st from ms_business_status where business_id = p_business and campaign_id = p_campaign;
  select * into mt from ms_meetings where business_id = p_business and campaign_id = p_campaign and status <> 'cancelled' order by created_at desc limit 1;
  select * into lv from ms_visits where business_id = p_business and campaign_id = p_campaign order by at desc limit 1;
  select count(*) into v_visits from ms_visits where business_id = p_business and campaign_id = p_campaign;
  a := ans.data -> 'answers';
  -- the score
  if a is not null then
    case a ->> 'expenses'
      when 'o100' then pts := pts + 2; why := array_append(why, 'Over $100K a month in expenses'::text);
      when '50_100' then pts := pts + 2; why := array_append(why, '$50K–$100K a month in expenses'::text);
      when '25_50' then pts := pts + 2; why := array_append(why, '$25K–$50K a month in expenses'::text);
      when '10_25' then pts := pts + 1; why := array_append(why, '$10K–$25K a month in expenses'::text);
      else null;
    end case;
    case a ->> 'books'
      when 'nobody' then pts := pts + 2; why := array_append(why, 'Behind on the books'::text);
      when 'bookkeeper' then pts := pts + 1; why := array_append(why, 'Pays a bookkeeper'::text);
      when 'accountant' then pts := pts + 1; why := array_append(why, 'Pays an accountant'::text);
      else null;
    end case;
    case a ->> 'pay_now'
      when 'o1000' then pts := pts + 2; why := array_append(why, 'Pays over $1,000 a month now'::text);
      when '600_1000' then pts := pts + 2; why := array_append(why, 'Pays $600–$1,000 a month now'::text);
      when '300_600' then pts := pts + 1; why := array_append(why, 'Pays $300–$600 a month now'::text);
      else null;
    end case;
    v_save := nullif(ans.data #>> '{proposal,savings}', '')::numeric;
    if v_save > 0 then pts := pts + 1; why := array_append(why, ('Saves about $' || to_char(round(v_save, -2), 'FM999,999') || ' a year')::text); end if;
  end if;
  v_dm := exists (select 1 from ms_business_contacts k where k.business_id = p_business and k.active and (k.decides or k.role in ('Owner', 'Partner')))
       or coalesce(ans.data #>> '{contact,role}', '') in ('Owner', 'Partner');
  if v_dm then pts := pts + 2; why := array_append(why, 'Decision maker met'::text); end if;
  if lv.outcome = 'interested' then pts := pts + 1; why := array_append(why, 'Interested'::text);
  elsif lv.outcome = 'follow_up' then pts := pts + 1; why := array_append(why, 'Asked for a follow-up'::text);
  elsif lv.outcome = 'not_interested' then pts := pts - 3; why := array_append(why, 'Said not interested'::text);
  end if;
  v_heat := case when a is null and v_visits = 0 then null when pts >= 6 then 'hot' when pts >= 3 then 'warm' else 'cold' end;
  -- the stage
  v_booked_after := mt.id is not null and lv.id is not null and mt.created_at > lv.at;
  v_stage := case
    when st.lost_reason is not null then 'lost'
    when mt.status = 'closed' then 'won'
    when mt.status = 'not_fit' then 'lost'
    when mt.status = 'booked' then 'booked'
    when lv.outcome in ('not_interested', 'cant_sell') and not v_booked_after then 'lost'
    when ans.business_id is not null or mt.status = 'no_show' then 'pitched'
    when v_visits > 0 then 'talked'
    else 'new' end;
  return jsonb_strip_nulls(jsonb_build_object(
    'stage', v_stage, 'heat', v_heat, 'points', pts, 'why', to_jsonb(why),
    'lost_reason', coalesce(st.lost_reason, case when mt.status = 'not_fit' then 'Not a fit (onboarding call)'
                                              when v_stage = 'lost' and lv.outcome = 'not_interested' then 'Said not interested'
                                              when v_stage = 'lost' and lv.outcome = 'cant_sell' then 'Can’t sell here' end),
    'meeting', case when mt.id is not null then jsonb_build_object('id', mt.id, 'starts_at', mt.starts_at, 'status', mt.status,
                 'host', (select full_name from app_users where id = mt.host_id)) end,
    'yearly', (ans.data #>> '{proposal,yearly}')::numeric,
    'decider', (select k.name from ms_business_contacts k where k.business_id = p_business and k.active and k.decides limit 1),
    'last_at', greatest(lv.at, ans.updated_at, mt.created_at),
    'visits', v_visits));
end $$;

-- the rep (on a business they work) or an admin
create or replace function public.ms_business_state(p_business uuid, p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (ms_is_admin() or ms_rep_can(p_business, p_campaign)) then raise exception 'Not allowed'; end if;
  return ms_biz_state(p_business, p_campaign);
end $$;

-- mark lost (with a reason), or undo it (null)
create or replace function public.ms_set_lost(p_business uuid, p_campaign uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (ms_is_admin() or ms_rep_can(p_business, p_campaign)) then raise exception 'Not allowed'; end if;
  insert into ms_business_status (business_id, campaign_id, lost_reason, lost_at, lost_by)
  values (p_business, p_campaign, left(nullif(trim(coalesce(p_reason, '')), ''), 120), case when nullif(trim(coalesce(p_reason, '')), '') is not null then now() end,
          case when nullif(trim(coalesce(p_reason, '')), '') is not null then auth.uid() end)
  on conflict (business_id, campaign_id) do update set lost_reason = excluded.lost_reason, lost_at = excluded.lost_at, lost_by = excluded.lost_by;
  return ms_biz_state(p_business, p_campaign);
end $$;

-- the admins' board: every business someone has worked (a lead added, a visit, deck answers, a person, a call)
create or replace function public.ms_pipeline(p_campaign uuid default null, p_rep uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  return coalesce((
    with pairs as (
      select business_id, campaign_id from ms_visits
      union select business_id, campaign_id from ms_business_answers
      union select business_id, campaign_id from ms_meetings
      union select business_id, campaign_id from ms_business_contacts where campaign_id is not null and active
      union select id, lead_campaign from ms_businesses where added_by is not null and lead_campaign is not null
                                                           and coalesce(lead_status, 'new') not in ('merged', 'removed')),
    rows as (
      select p.business_id, p.campaign_id, b.name, b.address, b.kind, b.zone_id, c.name campaign, c.color,
             coalesce((select v.rep_id from ms_visits v where v.business_id = p.business_id and v.campaign_id = p.campaign_id order by v.at desc limit 1), b.added_by) rep_id,
             ms_biz_state(p.business_id, p.campaign_id) s
        from pairs p join ms_businesses b on b.id = p.business_id join ms_campaigns c on c.id = p.campaign_id
       where (p_campaign is null or p.campaign_id = p_campaign) and b.do_not_knock is null and b.status <> 'closed')
    select jsonb_agg(jsonb_build_object('id', r.business_id, 'campaign_id', r.campaign_id, 'name', r.name, 'address', r.address, 'kind', r.kind,
             'campaign', r.campaign, 'color', r.color, 'zone', (select z.name from ms_zones z where z.id = r.zone_id),
             'rep_id', r.rep_id, 'rep', (select full_name from app_users where id = r.rep_id)) || r.s
             order by (r.s ->> 'last_at') desc nulls last)
      from rows r where p_rep is null or r.rep_id = p_rep), '[]'::jsonb);
end $$;

-- everything on a business, newest first: from every rep
create or replace function public.ms_business_timeline(p_business uuid, p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (ms_is_admin() or ms_rep_can(p_business, p_campaign)) then raise exception 'Not allowed'; end if;
  return coalesce((select jsonb_agg(e order by (e ->> 'at') desc) from (
    select jsonb_build_object('at', b.added_at, 'kind', 'added', 'title', 'Added', 'by', u.full_name,
             'text', nullif(concat_ws(' · ', b.address, case when 'rep' = any (b.sources) then 'by a rep at the door' end), '')) e
      from ms_businesses b left join app_users u on u.id = b.added_by where b.id = p_business and b.added_at is not null
    union all
    select jsonb_strip_nulls(jsonb_build_object('at', v.at, 'kind', 'visit', 'outcome', v.outcome, 'by', u.full_name, 'text', v.notes,
             'who', nullif(concat_ws(' · ', v.contact_name, v.contact_phone, v.contact_email), ''),
             'far', case when v.far then true end, 'follow_up_at', v.follow_up_at))
      from ms_visits v left join app_users u on u.id = v.rep_id where v.business_id = p_business and v.campaign_id = p_campaign
    union all
    select jsonb_build_object('at', s.at, 'kind', 'send', 'title', 'Info sent by ' || s.channel, 'by', u.full_name, 'text', s.sent_to)
      from ms_sends s left join app_users u on u.id = s.rep_id where s.business_id = p_business and (s.campaign_id is null or s.campaign_id = p_campaign)
    union all
    select jsonb_strip_nulls(jsonb_build_object('at', k.created_at, 'kind', 'person',
             'title', case when k.source = 'card' then 'Card scanned' when k.source = 'deck' then 'Met on the deck' else 'Person added' end,
             'by', u.full_name, 'text', concat_ws(' · ', coalesce(k.name, 'No name') || coalesce(' (' || k.role || ')', ''), k.phone, k.email)))
      from ms_business_contacts k left join app_users u on u.id = k.added_by where k.business_id = p_business and k.active
    union all
    select jsonb_strip_nulls(jsonb_build_object('at', a.updated_at, 'kind', 'deck',
             'title', 'Deck questions answered' || coalesce(' · proposal about $' || to_char(round((a.data #>> '{proposal,yearly}')::numeric), 'FM999,999') || ' a year', ''),
             'by', u.full_name))
      from ms_business_answers a left join app_users u on u.id = a.updated_by where a.business_id = p_business and a.campaign_id = p_campaign
    union all
    select jsonb_strip_nulls(jsonb_build_object('at', m.created_at, 'kind', 'meeting',
             'title', 'Onboarding call booked for ' || to_char(m.starts_at at time zone 'America/Toronto', 'Dy Mon DD, HH12:MI AM'),
             'by', u.full_name, 'text', 'With ' || h.full_name))
      from ms_meetings m left join app_users u on u.id = m.created_by left join app_users h on h.id = m.host_id
     where m.business_id = p_business and m.campaign_id = p_campaign
    union all
    select jsonb_strip_nulls(jsonb_build_object('at', m.outcome_at, 'kind', 'outcome',
             'title', 'Onboarding call: ' || case m.status when 'closed' then 'Closed' when 'no_show' then 'No-show' when 'not_fit' then 'Not a fit' when 'cancelled' then 'Cancelled' else m.status end,
             'by', u.full_name, 'text', m.outcome_note))
      from ms_meetings m left join app_users u on u.id = m.outcome_by
     where m.business_id = p_business and m.campaign_id = p_campaign and m.outcome_at is not null
    union all
    select jsonb_strip_nulls(jsonb_build_object('at', s.lost_at, 'kind', 'lost', 'title', 'Marked lost', 'by', u.full_name, 'text', s.lost_reason))
      from ms_business_status s left join app_users u on u.id = s.lost_by
     where s.business_id = p_business and s.campaign_id = p_campaign and s.lost_at is not null) t), '[]'::jsonb);
end $$;

revoke all on function public.ms_biz_state(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ms_business_state(uuid, uuid), public.ms_set_lost(uuid, uuid, text), public.ms_pipeline(uuid, uuid),
  public.ms_business_timeline(uuid, uuid) from public, anon;
grant execute on function public.ms_business_state(uuid, uuid), public.ms_set_lost(uuid, uuid, text), public.ms_pipeline(uuid, uuid),
  public.ms_business_timeline(uuid, uuid) to authenticated;
