-- RUN_24c — fills the Milton routes that still aren't built from the town's list:
--   * routes opened just before Milton's addresses loaded, saved with 0 houses (MLT70, MLT84, MLT85)
--   * routes built from OpenStreetMap that already have knocks or hand-added houses (MLT81, MLT65)
-- Adds the town's houses only. Nothing is deleted: existing houses, knocks and hand-added
-- houses all stay (a house the route already has keeps its row, so its knocks stay with it).

do $$
declare r text; before int; after int; done text := '';
begin
  for r in
    select b.route_code from route_house_builds b
    where b.route_code ~ '^MLT\d'
      and (b.house_count = 0
           or exists (select 1 from route_houses h where h.route_code = b.route_code and h.source in ('osm', 'mapbox')))
    order by 1
  loop
    select count(*) into before from route_houses where route_code = r;
    after := build_route_houses(r);
    done := done || format('%s: %s → %s houses; ', r, before, after);
  end loop;
  raise notice '%', coalesce(nullif(done, ''), 'nothing to fill');
end $$;
