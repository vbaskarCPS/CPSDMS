-- MainstreetAI: an onboarding booked from the deck is the deal, and it needs no admin approval. ms_book_meeting
-- now marks the deal it creates approved (decided_by stays empty: nobody decided it). Rewritten from the live
-- definition with only that step added, and checked. Additive only.
do $mig$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.ms_book_meeting'::regproc);
  d2 := replace(d, $q$select d.id into v_deal from ms_deals d where d.visit_id = v_visit_id;$q$,
    $q$select d.id into v_deal from ms_deals d where d.visit_id = v_visit_id;
    -- a booked onboarding needs no approval
    update ms_deals set status = 'approved', decided_at = now(), decision_note = 'Onboarding booked' where id = v_deal and status = 'pending';$q$);
  if d2 = d then raise exception 'ms_book_meeting: the deal step was not found'; end if;
  execute d2;
end $mig$;
