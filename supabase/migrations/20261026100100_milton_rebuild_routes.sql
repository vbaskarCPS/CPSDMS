-- RUN_24b — run AFTER RUN_24. Rebuilds the Milton routes that were opened before Milton's
-- addresses were loaded: their houses came from OpenStreetMap, and a route that already has
-- houses isn't rebuilt by itself. Only MLT routes with NO knocks and NO hand-added houses are
-- touched; their OpenStreetMap houses are replaced by the town's. Anything else is left alone.

do $$
declare r text; n int; done text := '';
begin
  if not exists (select 1 from nar_addresses where csd_name = 'Milton') then
    raise exception 'Run RUN_24 first: Milton''s addresses aren''t loaded yet.';
  end if;
  for r in
    select b.route_code from route_house_builds b
    where b.route_code ~ '^MLT\d'
      and not exists (select 1 from house_dispositions d where d.route_code = b.route_code)
      and not exists (select 1 from route_houses h where h.route_code = b.route_code and h.source = 'manual')
      and exists (select 1 from route_houses h where h.route_code = b.route_code and h.source <> 'nar')
  loop
    delete from route_houses where route_code = r;
    delete from route_house_builds where route_code = r;
    n := build_route_houses(r);
    done := done || format('%s: %s houses; ', r, n);
  end loop;
  raise notice 'Rebuilt: %', coalesce(nullif(done, ''), 'nothing to rebuild');
end $$;
