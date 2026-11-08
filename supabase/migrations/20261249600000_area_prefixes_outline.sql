-- Map Builder › Auto-build: a master map's outline, the ring of [lng, lat] corners its routes are cut inside. Drawn in
-- the builder (or traced from the paper master map) and kept with the map, so Auto-build can run again and the next
-- map knows where this one ends (a road between two maps is counted once). Additive only.
alter table public.area_prefixes add column if not exists outline jsonb;
comment on column public.area_prefixes.outline is 'Master map outline: [[lng, lat], …] (a ring; the closing point may be left off). Map Builder Auto-build cuts routes inside it.';
