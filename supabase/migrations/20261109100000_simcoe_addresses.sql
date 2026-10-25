-- Simcoe County civic addresses into the address register (RUN_52). ADDITIVE ONLY (one new function).
--
-- The National Address Register load only covered Oakville, Burlington and Milton, so routes in
-- New Tecumseth (Alliston, Beeton, Tottenham) found no houses in step 1 of the house build. Simcoe
-- County publishes every civic address (Operational_Layers_Dynamic / layer 1 "Address Numbers").
-- This loads one municipality of it into nar_addresses, page by page, server-side:
--
--   load_simcoe_addresses_batch(muni, csd_code, csd_name, pages)
--       reads `pages` × 2000 addresses per call from where the last call stopped (town_load_progress,
--       key 'simcoe:<MUNI>'); returns how many were added; 0 when the municipality is finished.
--       Rows are marked csd_code/csd_name and bu_use = 1 (the county doesn't say residential vs
--       business, so every address counts as a house). Starting over deletes that CSD's rows first.
--
-- Super Admin › Territory permission. The county's licence: Open Government Licence – Simcoe County.

create or replace function public.load_simcoe_addresses_batch(p_muni text, p_csd_code text, p_csd_name text, p_pages integer default 3)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key   text := 'simcoe:' || upper(p_muni);
  v_off   integer;
  v_resp  jsonb;
  v_added integer := 0;
  v_n     integer;
  v_page  integer;
  i       integer;
begin
  if not (app_has_perm('sa_territory') or current_user in ('postgres', 'supabase_admin')) then raise exception 'Not allowed'; end if;
  if p_csd_code !~ '^35\d{5}$' then raise exception 'csd_code must be an Ontario census subdivision code (35xxxxx)'; end if;
  insert into town_load_progress (town) values (v_key) on conflict do nothing;
  select next_offset into v_off from town_load_progress where town = v_key and not finished;
  if v_off is null then return 0; end if;
  if v_off = 0 then delete from nar_addresses where csd_code = p_csd_code; end if;   -- a fresh start replaces the CSD

  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '45000');
  for i in 1..greatest(1, least(p_pages, 10)) loop
    select content::jsonb into v_resp
      from http_get('https://maps2.simcoe.ca/arcgis/rest/services/Public/Operational_Layers_Dynamic/MapServer/1/query'
        || '?f=json&outSR=4326&returnGeometry=true&orderByFields=OBJECTID&resultRecordCount=2000'
        || '&outFields=OBJECTID,STNUM,DIRPREF,PREFIX,STNAME,SUFFIX,DIR,Unit,MUNI'
        || '&where=' || replace(replace('MUNI=''' || upper(p_muni) || '''', ' ', '%20'), '''', '%27')
        || '&resultOffset=' || v_off);
    if v_resp is null or v_resp ? 'error' then
      raise exception 'Simcoe County''s server didn''t answer properly at % (%). Run this again.', v_off, left(coalesce(v_resp->>'error', 'no reply'), 200);
    end if;
    v_page := jsonb_array_length(coalesce(v_resp->'features', '[]'::jsonb));
    if v_page = 0 then
      update town_load_progress set finished = true where town = v_key;
      exit;
    end if;

    insert into nar_addresses (civic_no, civic_suffix, street_name, street_type, street_dir, unit, csd_code, csd_name, prov_code, bu_use, lat, lng)
    select x.civic_no, null, x.street_name, x.street_type, x.street_dir, x.unit, p_csd_code, p_csd_name, 35, 1, x.lat, x.lng
      from (
        select nullif(f->'attributes'->>'STNUM', '')::numeric::int civic_no,
               nullif(trim(concat_ws(' ', nullif(trim(f->'attributes'->>'DIRPREF'), ''), nullif(trim(f->'attributes'->>'PREFIX'), ''), initcap(f->'attributes'->>'STNAME'))), '') street_name,
               nullif(trim(f->'attributes'->>'SUFFIX'), '') street_type,
               nullif(trim(f->'attributes'->>'DIR'), '') street_dir,
               nullif(trim(f->'attributes'->>'Unit'), '') unit,
               (f->'geometry'->>'y')::float8 lat,
               (f->'geometry'->>'x')::float8 lng
          from jsonb_array_elements(v_resp->'features') f
      ) x
     where x.civic_no is not null and x.civic_no > 0 and x.street_name is not null and x.lat between 41 and 57 and x.lng between -96 and -74;
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
    v_off := v_off + v_page;
    update town_load_progress set next_offset = v_off, loaded = loaded + v_n where town = v_key;
    if v_page < 2000 then
      update town_load_progress set finished = true where town = v_key;
      exit;
    end if;
  end loop;
  return v_added;
end $$;
revoke all on function public.load_simcoe_addresses_batch(text, text, text, integer) from public, anon, authenticated;
