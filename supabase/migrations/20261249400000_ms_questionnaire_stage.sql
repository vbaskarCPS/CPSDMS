-- MainstreetAI: a Questionnaire stage between Pitched and Onboarding booked (New → Pitched → Questionnaire → Booked → Won,
-- Lost the off-ramp). A business is at Questionnaire once the deck's questionnaire answers are saved on it; Pitched
-- when it was presented with nothing filled in. Follow-up emails go to Questionnaire businesses as they did to Pitched.
-- The pipeline also sends each business's map point (lat, lng) for the pins on the Zones map. Each function is
-- rewritten from its live definition with just those rules changed, and each change is checked. Additive only.
do $mig$
declare d text; d2 text;
begin
  d := pg_get_functiondef('public.ms_biz_state(uuid,uuid)'::regprocedure);
  d2 := replace(d, $q$    when ans.business_id is not null or st.pitched_at is not null$q$,
                   $q$    when a is not null then 'questionnaire'
    when ans.business_id is not null or st.pitched_at is not null$q$);
  if d2 = d then raise exception 'ms_biz_state: the pitched rule was not found'; end if;
  execute d2;

  d := pg_get_functiondef('public.ms_followups_due_all()'::regprocedure);
  d2 := replace(d, $q$->> 'stage') in ('new', 'pitched')$q$, $q$->> 'stage') in ('new', 'pitched', 'questionnaire')$q$);
  if d2 = d then raise exception 'ms_followups_due_all: the stage rule was not found'; end if;
  execute d2;

  d := pg_get_functiondef('public.ms_pipeline(uuid,uuid)'::regprocedure);
  d2 := replace(replace(d, $q$b.zone_id, c.name campaign$q$, $q$b.zone_id, b.lat, b.lng, c.name campaign$q$),
                $q$'kind', r.kind,$q$, $q$'kind', r.kind, 'lat', r.lat, 'lng', r.lng,$q$);
  if d2 = d or position('r.lat' in d2) = 0 or position('b.lat' in d2) = 0 then raise exception 'ms_pipeline: the columns were not found'; end if;
  execute d2;
end $mig$;
