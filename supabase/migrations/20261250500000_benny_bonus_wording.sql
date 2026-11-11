-- The Benny, bonuses: the line about carts not paid out yet reads right for one cart or several.
-- ("Andile, Kyle, Michael still has jobs not paid out" → "Not paid out yet, with jobs: Andile, Kyle, Michael.")
-- Additive: wording only, in benny_bonus_rank and benny_check_bonus.

do $$
declare
  v_def text; v_new text; r record;
begin
  for r in select * from (values
    ('benny_bonus_rank',
     $a$v_notes := v_notes || ((select string_agg(e->'workers'->>0, ', ') from jsonb_array_elements(v_open) e where (e->>'jobs')::int > 0)
      || ' still has jobs not paid out: not ranked yet, and the ranking can change once they are.');$a$,
     $b$v_notes := v_notes || ('Not paid out yet, with jobs: ' || (select string_agg(e->'workers'->>0, ', ') from jsonb_array_elements(v_open) e where (e->>'jobs')::int > 0)
      || '. They aren’t ranked, and the ranking can change once they are.');$b$),
    ('benny_check_bonus',
     $a$v_cautions := v_cautions || ((select string_agg(y->'workers'->>0, ', ') from jsonb_array_elements(t) y where not (y->>'paid_out')::boolean and (y->>'jobs')::int > 0)
      || ' still has jobs not paid out: the ranking can change once they are.');$a$,
     $b$v_cautions := v_cautions || ('Not paid out yet, with jobs: ' || (select string_agg(y->'workers'->>0, ', ') from jsonb_array_elements(t) y where not (y->>'paid_out')::boolean and (y->>'jobs')::int > 0)
      || '. The ranking can change once they are.');$b$)) as x(fn, old, new)
  loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = r.fn;
    if v_def is null then raise exception '% not found', r.fn; end if;
    v_new := replace(replace(v_def, E'\r', ''), r.old, r.new);
    if v_new = replace(v_def, E'\r', '') then raise exception '%: the line to reword was not found', r.fn; end if;
    execute v_new;
  end loop;
end $$;
