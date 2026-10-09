-- RUN_20 — a city on each digital-map area, so Territory can list maps by city.
-- ADDITIVE ONLY: one new nullable column. The app fills it once per area (the municipality at
-- the centre of the area's routes, from Mapbox) and it can be changed in the area's edit box.
alter table public.area_prefixes add column if not exists city text;
