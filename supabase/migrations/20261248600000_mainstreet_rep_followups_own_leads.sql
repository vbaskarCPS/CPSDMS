-- MainstreetAI rep app › Follow-ups: list follow-ups on the businesses a rep added themselves too. ADDITIVE ONLY
-- (one function replaced).
--
-- ms_rep_followups only looked inside the rep's zones, so a rep with no zones (they work the businesses they add)
-- had follow-ups saved that never showed on the Follow-ups tab. Now: every active campaign the rep is on, their
-- latest visit per business is a follow-up, and they can work that business (in their zone, as before, or a lead
-- they added: ms_rep_can). Same fields as before; zone_id / zone_name are null for a lead outside every zone.

create or replace function public.ms_rep_followups()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date := (now() at time zone 'America/Toronto')::date;
begin
  if not ms_is_rep() then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'business_id', b.id, 'name', b.name, 'address', b.address, 'zone_id', z.id, 'zone_name', z.name,
             'campaign_id', c.id, 'campaign_name', c.name, 'follow_up_at', l.follow_up_at,
             'when', case when (l.follow_up_at at time zone 'America/Toronto')::date < v_today then 'overdue'
                          when (l.follow_up_at at time zone 'America/Toronto')::date = v_today then 'today' else 'later' end,
             'contact_name', v.contact_name, 'contact_phone', v.contact_phone, 'notes', v.notes)
           order by l.follow_up_at)
      from ms_campaigns c
      join lateral ms_rep_latest(auth.uid(), c.id) l on l.outcome = 'follow_up' and l.follow_up_at is not null
      join ms_businesses b on b.id = l.business_id and b.status <> 'closed'
      join ms_visits v on v.id = l.visit_id
      left join ms_zones z on z.id = b.zone_id and z.status = 'active'
     where c.is_active and ms_rep_has_campaign(c.id)
       and (exists (select 1 from ms_zone_campaigns zc join ms_zones zz on zz.id = zc.zone_id and zz.status = 'active'
                     where zc.rep_id = auth.uid() and zc.campaign_id = c.id and zc.zone_id = b.zone_id)
            or ms_rep_can(b.id, c.id))), '[]'::jsonb);
end $$;
