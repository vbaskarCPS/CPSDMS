-- Master Bookings knows lawn rejuvenation (RUN_57). Run after the migration in the same transaction;
-- everything is rolled back.
\set ON_ERROR_STOP 1
\i :mig

insert into command_centers (id, username, password, display_name, workerbook_sheet_id, masterbookings_sheet_id, center_type, services, region)
values ('c0000000-0000-0000-0000-0000000000a7', 'rjq-test', 'test-only', 'RJQ West', '', '', 'road_trip', '{lawn_rejuv}', 'West');
insert into area_prefixes (area_name, prefix, region, route_start, route_count, city) values ('RJQ #1', 'RJQ', 'West', 1, 1, 'Testwack');
insert into map_area_centers (area_name, center_id) values ('RJQ #1', 'c0000000-0000-0000-0000-0000000000a7');
insert into route_maps (area_name, route_number, route_code, route_color, segments, status) values
  ('RJQ #1', 1, 'RJQ01', '#f00', '[{"osmId":1,"name":"Elm Rd","coordinates":[[-121.90,49.15],[-121.89,49.15]]}]', 'approved');
insert into route_houses (route_code, house_key, civic_no, street_name, street_norm, lat, lng, source)
select 'RJQ01', n || '|elm rd', n, 'Elm Rd', 'elm rd', 49.15, -121.90 + n * 0.0001, 'nar' from generate_series(1, 4) n;
insert into clients (address_key, house_no, street_name, street_norm, city, route_code, lat, lng, history) values
  ('rjq-1', '1', 'Elm Rd', 'elm rd', 'Testwack', 'RJQ01', 49.15, -121.8999, '[{"line":"lawn_rejuv","year":2025}]'),
  ('rjq-2', '2', 'Elm Rd', 'elm rd', 'Testwack', 'RJQ01', 49.15, -121.8998, '[{"line":"lawn_rejuv","year":2026},{"line":"aeration","year":2024}]'),
  ('rjq-3', '3', 'Elm Rd', 'elm rd', 'Testwack', 'RJQ01', 49.15, -121.8997, '[{"line":"cleaning","year":2025}]');

insert into auth.users (id) values ('a0000000-0000-0000-0000-0000000000a7');
insert into app_users (id, username, full_name) values ('a0000000-0000-0000-0000-0000000000a7', 'rjqad', 'RJQ Admin');
insert into user_permissions values ('a0000000-0000-0000-0000-0000000000a7', 'bookings');
insert into user_centers values ('a0000000-0000-0000-0000-0000000000a7', 'c0000000-0000-0000-0000-0000000000a7');
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-0000000000a7', true);

do $$
declare v jsonb; m jsonb; yr int := extract(year from now() at time zone 'America/Toronto')::int;
begin
  -- flags: 16 rejuvenation before, 32 this season; other lines unchanged
  if mb_client_flags('[{"line":"lawn_rejuv","year":2025}]', 2026) <> 16 then raise exception 'prev rejuv flag'; end if;
  if mb_client_flags('[{"line":"lawn_rejuv","year":2026},{"line":"aeration","year":2024}]', 2026) <> 33 then raise exception 'this-season rejuv + prev aeration'; end if;
  if mb_client_flags('[{"line":"sealing","year":2025}]', 2026) <> 2 then raise exception 'sealing changed'; end if;

  -- level 1 for Lawn Rejuv 2026: map counted, season offered, no "pick aeration or sealing"
  v := app_mb_overview('c0000000-0000-0000-0000-0000000000a7', 'lawn_rejuv', 2026, null);
  m := v->'maps'->0;
  if (m->>'prev_rejuv')::int <> 1 or (m->>'done_rejuv')::int <> 1 or (m->>'prev_aeration')::int <> 1 then raise exception 'counts: %', m; end if;
  if not (v->'seasons' @> jsonb_build_array(jsonb_build_object('service', 'lawn_rejuv', 'season', yr))) then raise exception 'season not offered: %', v->'seasons'; end if;

  -- level 2 shows both rejuvenation clients (the cleaning-only one has no flag)
  v := app_mb_area_view(array['RJQ #1'], 'lawn_rejuv', 2026, null);
  if jsonb_array_length(v->'clients') <> 2 then raise exception 'clients on the map: %', v->'clients'; end if;

  -- level 3 route
  v := app_mb_route('RJQ01', 'lawn_rejuv', 2026, null);
  if (select count(*) from jsonb_array_elements(v->'houses') h where (h->>'f')::int > 0) <> 2 then raise exception 'route houses: %', v->'houses'; end if;

  -- settings and a round
  perform app_mb_save_settings('c0000000-0000-0000-0000-0000000000a7', 'lawn_rejuv', yr, null, 50);
  if (app_mb_settings('c0000000-0000-0000-0000-0000000000a7')->>'service') <> 'lawn_rejuv' then raise exception 'settings not saved'; end if;
  v := app_mb_start_round('RJQ #1', 'lawn_rejuv', yr);
  if (v->>'round')::int <> 1 then raise exception 'round: %', v; end if;
  if not exists (select 1 from mb_rounds where area_name = 'RJQ #1' and service = 'lawn_rejuv') then raise exception 'round not kept'; end if;

  -- still refused: a service that isn't one of the three
  begin perform app_mb_overview('c0000000-0000-0000-0000-0000000000a7', 'cleaning', 2026, null); raise exception 'cleaning allowed';
  exception when others then if sqlerrm not like 'Pick aeration, sealing or lawn rejuv%' then raise; end if; end;
  raise notice 'mb lawn rejuv: ok';
end $$;
