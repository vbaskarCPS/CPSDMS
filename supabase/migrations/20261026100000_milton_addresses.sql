-- RUN_24 — Milton's houses, from the Town of Milton's own address points.
--
-- Burlington and Oakville routes get their houses from the address tables:
--   nar_addresses        what build_route_houses reads to put houses on a route
--   town_address_points  the town's own list, used to clear OpenStreetMap "ghosts" and to place clients
-- Milton had neither, so its 120 MLT routes had no houses (one route fell back to OpenStreetMap).
--
-- Source: the Town of Milton's "Address Points" (Discover Milton open data: "all of the current
-- active address points in Milton, updated on a daily schedule"), downloaded as a CSV through the
-- ArcGIS hub, already in GPS coordinates (WGS84). The town's own points are the accurate ones, so
-- they go into both tables at the town's positions (Burlington and Oakville's register positions
-- were moved onto their towns' points the same way).
--
-- Additive only: it adds Milton rows and changes nothing else. It refuses to run twice (Milton
-- already loaded) and refuses a short or broken download (fewer than 40,000 points).
-- Routes build their houses the first time a manager opens them on the map.

select http_set_curlopt('CURLOPT_TIMEOUT_MS', '60000');

do $$
declare
  v_csv text;
  v_status int;
  v_points int;
  v_nar int;
begin
  if exists (select 1 from town_address_points where town = 'Milton') or exists (select 1 from nar_addresses where csd_name = 'Milton') then
    raise notice 'Milton is already loaded: nothing done.';
    return;
  end if;

  select status, content into v_status, v_csv
  from http_get('https://opendata.arcgis.com/api/v3/datasets/7b543a0d714a4930a90e771db838594b_0/downloads/data?format=csv&spatialRefId=4326&where=1%3D1');
  if v_status <> 200 or v_csv is null or left(ltrim(v_csv, chr(65279)), 2) <> 'X,' then
    raise exception 'Milton''s open data didn''t answer properly (status %). Nothing was changed; run this again in a minute.', v_status;
  end if;

  -- X,Y,OBJECTID,ADDRESS_NUM,GEOSTNAME,STREET_TYPE,ST_DIR_SUFFIX,UNIT_NUMBER,BLOCK,LOT,DISPLAY_NAME,Address_ID,ADU,ADU_UNIT_NO
  create temp table milton_pts on commit drop as
  select x.*, norm_street(x.street_name || ' ' || coalesce(x.street_type, '') || ' ' || coalesce(x.street_dir, '')) as street_norm
  from (
    select f[1]::float8 as lng, f[2]::float8 as lat,
           (regexp_match(f[4], '^\s*(\d+)'))[1]::int as civic_no,
           nullif(upper(trim((regexp_match(f[4], '^\s*\d+\s*([A-Za-z])\s*$'))[1])), '') as civic_suffix,
           nullif(trim(f[5]), '') as street_name,
           nullif(trim(f[6]), '') as street_type,
           nullif(trim(f[7]), '') as street_dir,
           coalesce(nullif(trim(f[8]), ''), nullif(trim(f[14]), '')) as unit
    from regexp_split_to_table(replace(ltrim(v_csv, chr(65279)), chr(13), ''), '\n') with ordinality as t(line, n),
         lateral (select string_to_array(t.line, ',') as f) a
    where t.n > 1 and t.line <> '' and array_length(a.f, 1) = 14   -- a row with a comma inside a field is skipped
      and a.f[1] ~ '^-?\d+(\.\d+)?$' and a.f[2] ~ '^-?\d+(\.\d+)?$'
  ) x
  where x.civic_no is not null and x.street_name is not null
    and x.lat between 43.3 and 43.7 and x.lng between -80.3 and -79.6;  -- inside Milton

  select count(*) into v_points from milton_pts;
  if v_points < 40000 then
    raise exception 'Only % Milton address points came through (expected about 46,000). Nothing was changed.', v_points;
  end if;

  -- 1. The town's list (as Burlington's and Oakville's)
  insert into town_address_points (town, civic_no, civic_suffix, street_name, street_type, street_dir, unit, postal_code, lat, lng, street_norm)
  select 'Milton', civic_no, civic_suffix, street_name, street_type, street_dir, unit, null, lat, lng, street_norm
  from milton_pts;

  -- 2. The register rows routes are built from, at the town's positions. Names as the register
  --    writes them ("Steeles", "AVE", "E") so house names read the same as Burlington's and Oakville's.
  --    The town's list has no home/business flag, so every point counts as a home (bu_use 1).
  with ins as (
    insert into nar_addresses (civic_no, civic_suffix, street_name, street_type, street_dir, unit, csd_code, csd_name, prov_code, bu_use, postal_code, lat, lng, street_norm, geom)
    select civic_no, civic_suffix, initcap(lower(street_name)),
           nullif(upper(norm_street(street_type)), ''), street_dir, unit,
           '3524009', 'Milton', 35, 1, null, lat, lng, street_norm,
           ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    from milton_pts
    returning id, lat, lng
  ), bk as (
    -- the positions as loaded, like the other towns' backup
    insert into nar_addresses_position_backup (id, lat, lng, town)
    select id, lat, lng, 'Milton' from ins
    returning 1
  )
  select count(*) into v_nar from bk;

  insert into town_load_progress (town, next_offset, finished, loaded)
  values ('Milton', v_points, true, v_points)
  on conflict do nothing;

  raise notice 'Milton loaded: % address points.', v_nar;
end $$;
