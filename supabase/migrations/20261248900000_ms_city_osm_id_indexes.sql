-- MainstreetAI › the server-side city loader checks each map item against what the city already has. Additive only.
create index if not exists ms_city_lines_city_osm on public.ms_city_lines (city_id, osm_id);
create index if not exists ms_plazas_city_osm on public.ms_plazas (city_id, osm_id);
