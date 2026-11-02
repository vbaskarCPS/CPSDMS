-- MainstreetAI: the booked call needs no admin approval, but the deal only counts once it's won.
-- Booking leaves the deal open (pending = "Onboarding booked"); the host's outcome on the call decides it:
-- Closed -> approved (won), Not a fit -> rejected (lost), No-show or back to booked -> pending again.
-- Replaces the auto-approve added in 20261247400000. Additive only.
do $mig$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.ms_book_meeting'::regproc);
  d2 := replace(d, $q$
    -- a booked onboarding needs no approval
    update ms_deals set status = 'approved', decided_at = now(), decision_note = 'Onboarding booked' where id = v_deal and status = 'pending';$q$, '');
  if d2 = d then raise exception 'ms_book_meeting: the auto-approve step was not found'; end if;
  execute d2;

  d := pg_get_functiondef('public.ms_meeting_outcome'::regproc);
  d2 := replace(d, $q$   where id = p_meeting;
  return ms_meeting_json(p_meeting);$q$, $q$   where id = p_meeting;
  -- the host's outcome decides the deal: won, lost, or still open
  if m.visit_id is not null then
    update ms_deals set status = case p_status when 'closed' then 'approved' when 'not_fit' then 'rejected' else 'pending' end,
           decided_at = case when p_status in ('closed', 'not_fit') then now() end,
           decided_by = case when p_status in ('closed', 'not_fit') then auth.uid() end,
           decision_note = case p_status when 'closed' then 'Won on the onboarding call' when 'not_fit' then 'Not a fit on the onboarding call' end
     where visit_id = m.visit_id;
  end if;
  return ms_meeting_json(p_meeting);$q$);
  if d2 = d then raise exception 'ms_meeting_outcome: the update step was not found'; end if;
  execute d2;
end $mig$;
