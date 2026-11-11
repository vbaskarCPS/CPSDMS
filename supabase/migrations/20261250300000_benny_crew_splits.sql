-- The Benny, crews: the worker-averages lookup hands over the usual splits ready-made.
--
-- On the live check the Benny once counted the "worst half" one worker off in its answer (rank 7 of 14 named with the
-- bottom half). A split decides who works where, so it should not hang on the model's counting. The lookup now carries
--   halves: { better, worse }    the ranking cut in two (with an odd number the middle worker is in the better half)
--   draft:  { two, three }       managers taking turns down the ranking in snake order (1st to A, 2nd and 3rd to B, ...)
-- each a list of { cn, name }, best first, to pass on as they are.
--
-- Additive: two more keys in benny_crew_stats's result. Who may call it (super admins) is unchanged.

do $$
declare
  v_def text; v_new text;
  v_old text := $o$    'no_shows', (select jsonb_agg(c.name order by c.name) from benny_crew(p_center, d.id) c where not c.showed),$o$;
  v_add text := $n$
    'halves', (select jsonb_build_object(
                 'better', coalesce(jsonb_agg(z.w order by z.rk) filter (where z.rk <= ceil(z.n / 2.0)), '[]'::jsonb),
                 'worse',  coalesce(jsonb_agg(z.w order by z.rk) filter (where z.rk >  ceil(z.n / 2.0)), '[]'::jsonb))
                 from (select jsonb_build_object('cn', c.cn, 'name', c.name) w, count(*) over () n,
                              row_number() over (order by c.avg_equiv desc, c.avg_gross desc, c.name) rk
                         from benny_crew(p_center, d.id) c where c.showed and c.days > 0) z),
    'draft', (select jsonb_build_object(
                 'two', jsonb_build_array(
                    coalesce(jsonb_agg(z.w order by z.rk) filter (where z.s2 = 0), '[]'::jsonb),
                    coalesce(jsonb_agg(z.w order by z.rk) filter (where z.s2 = 1), '[]'::jsonb)),
                 'three', jsonb_build_array(
                    coalesce(jsonb_agg(z.w order by z.rk) filter (where z.s3 = 0), '[]'::jsonb),
                    coalesce(jsonb_agg(z.w order by z.rk) filter (where z.s3 = 1), '[]'::jsonb),
                    coalesce(jsonb_agg(z.w order by z.rk) filter (where z.s3 = 2), '[]'::jsonb)))
                 from (select y.w, y.rk,
                              case when ((y.rk - 1) / 2) % 2 = 0 then (y.rk - 1) % 2 else 1 - (y.rk - 1) % 2 end s2,
                              case when ((y.rk - 1) / 3) % 2 = 0 then (y.rk - 1) % 3 else 2 - (y.rk - 1) % 3 end s3
                         from (select jsonb_build_object('cn', c.cn, 'name', c.name) w,
                                      row_number() over (order by c.avg_equiv desc, c.avg_gross desc, c.name) rk
                                 from benny_crew(p_center, d.id) c where c.showed and c.days > 0) y) z),$n$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'benny_crew_stats';
  if v_def is null then raise exception 'benny_crew_stats not found'; end if;
  v_new := replace(v_def, v_old, v_old || v_add);
  if v_new = v_def then raise exception 'benny_crew_stats: the place to add the splits was not found'; end if;
  execute v_new;
end $$;
