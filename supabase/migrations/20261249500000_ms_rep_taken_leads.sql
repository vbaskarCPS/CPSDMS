-- MainstreetAI rep app: another rep's lead is off-limits on your map. A business is "taken" for a rep when someone
-- else is working it on that campaign (added it as a lead, or has visits on it) and its stage isn't Lost, and this rep
-- hasn't worked it themselves. The rep map and the zone list send the other rep's name ('by'); the app greys the pin
-- out, leaves it out of the walk and the counts (the zone's "left" on the home screen too), and the business sheet says whose it is. Additive only.

create or replace function public.ms_biz_owner(p_business uuid, p_campaign uuid, p_me uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v_rep uuid;
begin
  if p_campaign is null then return null; end if;
  -- the most recent other rep on it (their lead, or their visit on this campaign)
  select x.rep into v_rep from (
    select b.added_by rep, coalesce(b.added_at, b.created_at) at from ms_businesses b
     where b.id = p_business and b.added_by is not null and b.added_by <> p_me and b.lead_campaign = p_campaign
       and coalesce(b.lead_status, 'new') not in ('merged', 'removed')
    union all
    select v.rep_id, v.at from ms_visits v where v.business_id = p_business and v.campaign_id = p_campaign and v.rep_id <> p_me
  ) x order by x.at desc nulls last limit 1;
  if v_rep is null then return null; end if;
  -- shared once this rep has worked it too; free again once it's Lost
  if exists (select 1 from ms_visits v where v.business_id = p_business and v.campaign_id = p_campaign and v.rep_id = p_me) then return null; end if;
  if (ms_biz_state(p_business, p_campaign) ->> 'stage') = 'lost' then return null; end if;
  return (select full_name from app_users where id = v_rep);
end $$;
revoke all on function public.ms_biz_owner(uuid, uuid, uuid) from public, anon, authenticated;

do $mig$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.ms_rep_map()'::regprocedure);
  d2 := replace(d, $q$'lead', case when r.added_by is not null then true end,$q$,
                   $q$'lead', case when r.added_by is not null then true end, 'by', ms_biz_owner(r.id, r.campaign_id, auth.uid()),$q$);
  if d2 = d then raise exception 'ms_rep_map: the lead field was not found'; end if;
  execute d2;

  d := pg_get_functiondef('public.ms_rep_zone(uuid,uuid)'::regprocedure);
  d2 := replace(d, $q$'visits', coalesce(l.visits, 0),$q$, $q$'visits', coalesce(l.visits, 0), 'by', ms_biz_owner(t.id, p_campaign, auth.uid()),$q$);
  if d2 = d then raise exception 'ms_rep_zone: the visits field was not found'; end if;
  execute d2;

  d := pg_get_functiondef('public.ms_rep_home()'::regprocedure);
  d2 := replace(d, $q$in ('new', 'retry'))::int left_,$q$, $q$in ('new', 'retry') and ms_biz_owner(t.id, p.campaign_id, auth.uid()) is null)::int left_,$q$);
  if d2 = d then raise exception 'ms_rep_home: the left count was not found'; end if;
  execute d2;
end $mig$;
