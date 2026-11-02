-- MainstreetAI: four stages — New → Pitched → Booked → Won (Lost stays the off-ramp: Not interested, Not a fit).
-- "Talked to" is gone: a business with visits but no pitch is still New. Only that one rule changes, in the two
-- functions that use it (ms_biz_state decides the stage; ms_followups_due_all sends follow-up emails to New and
-- Pitched businesses that have been visited). Each function is rewritten from its live definition with just
-- that rule replaced, and the change is checked. Additive only.
do $mig$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.ms_biz_state(uuid,uuid)'::regprocedure);
  d2 := replace(d, $q$when v_visits > 0 then 'talked'$q$, $q$when v_visits > 0 then 'new'$q$);
  if d2 = d then raise exception 'ms_biz_state: the talked rule was not found'; end if;
  execute d2;

  d := pg_get_functiondef('public.ms_followups_due_all()'::regprocedure);
  d2 := replace(d, $q$in ('talked', 'pitched')$q$, $q$in ('new', 'pitched')$q$);
  if d2 = d then raise exception 'ms_followups_due_all: the talked rule was not found'; end if;
  execute d2;
end $mig$;
