-- The Benny, maps: a map's first and last route by number, not by spelling.
--
-- RICHMOND #5 runs RMD88 to RMD106. Its range was read as "RMD100 to RMD99", because the first and last route were
-- taken in spelling order, where RMD100 comes before RMD88. They are now taken by the number at the end of the code.
-- Only maps whose routes cross a round number (99 to 100) were affected; counts and past clients were always right.
--
-- Additive: a patch to benny_maps_pcl's route range only.

do $$
declare
  v_def text; v_new text;
  v_old text := $o$min(route_code) first_route, max(route_code) last_route from rm group by 1$o$;
  v_fix text := $n$(array_agg(route_code order by substring(route_code from '(\d+)\D*$')::int nulls last, route_code))[1] first_route,
      (array_agg(route_code order by substring(route_code from '(\d+)\D*$')::int desc nulls last, route_code desc))[1] last_route from rm group by 1$n$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'benny_maps_pcl';
  if v_def is null then raise exception 'benny_maps_pcl not found'; end if;
  v_new := replace(v_def, v_old, v_fix);
  if v_new = v_def then raise exception 'benny_maps_pcl: the route range was not found to patch'; end if;
  execute v_new;
end $$;
