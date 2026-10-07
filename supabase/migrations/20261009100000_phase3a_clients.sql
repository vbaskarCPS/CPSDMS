-- Phase 3a · client lists → clients (one per address) with The Benny's import.
--
-- ADDITIVE ONLY.
--   clients                 one record per property address: people, phones, emails, every
--                           year's service history, tags, do-not-call / do-not-text, route
--   client_import_recipes   how a file layout is read (column → field), keyed by a fingerprint
--                           of its headers, so the same layout runs the same way next time
--   client_imports          each import: file, counts, status (running / done / undone)
--   client_import_changes   what each import inserted or merged (with the record before), so
--                           an import can be undone
--   map_pcl_cache_base      the map's past-client lists as they were before imports touched
--                           them, so imported clients can be added and taken away cleanly
--
-- Writes go only through the security-definer functions below (Super Admin › Territory).
-- Approved imports also refresh map_pcl_cache, which the RM map and the worker map
-- logsheet already read, so imported clients appear there on their routes.

-- ───────────────────────── tables ─────────────────────────
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  address_key text not null unique,            -- house|street_norm|unit|city (lower case)
  house_no text not null,
  street_name text not null,
  street_norm text not null,
  unit text,
  city text,
  province text,
  postal_code text,
  lat double precision,
  lng double precision,
  route_code text,
  match_how text,                              -- house | address_point | geocode | street | given | manual
  people jsonb not null default '[]',          -- [{first, last}]
  phones text[] not null default '{}',
  emails text[] not null default '{}',
  history jsonb not null default '[]',         -- [{year, service, price, contractor, payment, notes}]
  tags text[] not null default '{}',
  notes text,
  call_first text,
  do_not_call boolean not null default false,
  do_not_text boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search_text text                             -- kept up to date by the trigger below, for the Clients search
);
create index if not exists clients_route on public.clients (route_code);

create or replace function public.clients_search_text()
returns trigger language plpgsql set search_path = public as $$
begin
  new.search_text := lower(concat_ws(' ', new.house_no, new.street_name, new.unit, new.city, new.route_code,
    (select string_agg(concat_ws(' ', p->>'first', p->>'last'), ' ') from jsonb_array_elements(new.people) p),
    array_to_string(new.phones, ' '), array_to_string(new.emails, ' ')));
  return new;
end $$;
drop trigger if exists search_text on public.clients;
create trigger search_text before insert or update on public.clients for each row execute function public.clients_search_text();
create index if not exists clients_street on public.clients (street_norm, house_no);

create table if not exists public.client_import_recipes (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  name text not null,
  headers text[] not null default '{}',
  mapping jsonb not null,
  notes text,
  times_used integer not null default 0,
  last_used_at timestamptz,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.client_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  source text not null check (source in ('file', 'sheet')),
  sheet_url text,
  recipe_id uuid references public.client_import_recipes(id) on delete set null,
  status text not null default 'running' check (status in ('running', 'done', 'undone')),
  counts jsonb not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  undone_at timestamptz,
  undone_by uuid
);

create table if not exists public.client_import_changes (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.client_imports(id) on delete cascade,
  client_id uuid not null,
  action text not null check (action in ('insert', 'merge')),
  before jsonb,                                -- the client as it was (merge only)
  unique (import_id, client_id)
);
create index if not exists client_import_changes_client on public.client_import_changes (client_id);

create table if not exists public.map_pcl_cache_base (
  route_code text primary key,
  clients jsonb not null default '[]',
  saved_at timestamptz not null default now()
);

create index if not exists route_houses_house_key on public.route_houses (house_key);

-- ───────────────────────── access ─────────────────────────
alter table public.clients enable row level security;
alter table public.client_import_recipes enable row level security;
alter table public.client_imports enable row level security;
alter table public.client_import_changes enable row level security;
alter table public.map_pcl_cache_base enable row level security;

drop policy if exists clients_read on public.clients;
create policy clients_read on public.clients for select to authenticated
  using (app_has_perm('sa_territory') or app_has_perm('dialer'));
drop policy if exists recipes_read on public.client_import_recipes;
create policy recipes_read on public.client_import_recipes for select to authenticated using (app_has_perm('sa_territory'));
drop policy if exists imports_read on public.client_imports;
create policy imports_read on public.client_imports for select to authenticated using (app_has_perm('sa_territory'));

revoke all on public.clients, public.client_import_recipes, public.client_imports,
              public.client_import_changes, public.map_pcl_cache_base from anon, authenticated;
grant select on public.clients, public.client_import_recipes, public.client_imports to authenticated;

drop trigger if exists audit on public.client_imports;
create trigger audit after insert or update or delete on public.client_imports for each row execute function public.audit_row();
drop trigger if exists audit on public.client_import_recipes;
create trigger audit after insert or update or delete on public.client_import_recipes for each row execute function public.audit_row();

-- ───────────────────────── matching ─────────────────────────
-- The route a point falls on: the zone of the same street, else the nearest line of the
-- same street within 150 m, else any route zone the point is inside.
create or replace function public.client_route_at(p_lat double precision, p_lng double precision, p_street_norm text)
returns text language sql stable set search_path = public, extensions as $$
  with pt as (select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326) as g)
  select coalesce(
    (select l.route_code from route_street_lines l, pt
      where l.street_norm = p_street_norm and l.zone is not null and ST_Covers(l.zone, pt.g) limit 1),
    (select l.route_code from route_street_lines l, pt
      where l.street_norm = p_street_norm and ST_DWithin(l.line, pt.g::geography, 150)
      order by ST_Distance(l.line, pt.g::geography) limit 1),
    (select l.route_code from route_street_lines l, pt
      where l.zone is not null and ST_Covers(l.zone, pt.g) limit 1))
$$;
revoke all on function public.client_route_at(double precision, double precision, text) from public, anon, authenticated;

create or replace function public.client_address_key(p_house text, p_street_norm text, p_unit text, p_city text)
returns text language sql immutable as $$
  select lower(trim(coalesce(p_house, ''))) || '|' || coalesce(p_street_norm, '') || '|'
      || lower(trim(coalesce(p_unit, ''))) || '|' || lower(trim(coalesce(p_city, '')))
$$;

-- Existing client for an address: same key, or — when one side has no city — the only
-- client at that house, street and unit.
create or replace function public.client_find(p_house text, p_street_norm text, p_unit text, p_city text)
returns uuid language sql stable set search_path = public as $$
  select coalesce(
    (select id from clients where address_key = client_address_key(p_house, p_street_norm, p_unit, p_city)),
    (select (array_agg(id))[1] from clients
      where lower(house_no) = lower(trim(p_house)) and street_norm = p_street_norm
        and lower(coalesce(unit, '')) = lower(trim(coalesce(p_unit, '')))
        and (coalesce(trim(p_city), '') = '' or coalesce(city, '') = '')
     having count(*) = 1))
$$;

-- Match rows of a file to routes before anything is saved.
-- in:  [{i, house_no, street, unit, city, lat?, lng?, route?}]
-- out: [{i, street_norm, route_code, lat, lng, how, client_id}]
create or replace function public.app_client_match(p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare r jsonb; v_out jsonb := '[]'; v_norm text; v_civic int; v_suffix text; v_route text; v_lat float8; v_lng float8;
        v_how text; v_city text; v_n int;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'At most 1,000 rows per call'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_norm := norm_street(r->>'street'); v_route := null; v_lat := null; v_lng := null; v_how := null;
    v_city := nullif(trim(r->>'city'), '');
    v_civic := nullif(substring(coalesce(r->>'house_no', '') from '^\s*(\d+)'), '')::int;
    v_suffix := nullif(lower(substring(coalesce(r->>'house_no', '') from '^\s*\d+\s*([A-Za-z])\s*$')), '');
    if v_norm is not null and v_civic is not null then
      -- 1. a house already on a route
      select rh.route_code, rh.lat, rh.lng into v_route, v_lat, v_lng
        from route_houses rh where rh.house_key = house_key(v_civic, v_suffix, v_norm)
       order by rh.lat is null limit 1;
      if v_route is not null then v_how := 'house'; end if;
      -- 2. an official address point, then the route there
      if v_route is null then
        select a.lat, a.lng into v_lat, v_lng from (
          select lat, lng, csd_name as town from nar_addresses where civic_no = v_civic and street_norm = v_norm
          union all
          select lat, lng, town from town_address_points where civic_no = v_civic and street_norm = v_norm
        ) a
        where v_city is null or lower(a.town) = lower(v_city)
        limit 1;
        if v_lat is not null then v_route := client_route_at(v_lat, v_lng, v_norm); v_how := 'address_point'; end if;
      end if;
    end if;
    -- 3. a point found by the browser's geocoder
    if v_route is null and (r->>'lat') is not null and (r->>'lng') is not null and v_norm is not null then
      v_lat := (r->>'lat')::float8; v_lng := (r->>'lng')::float8;
      v_route := client_route_at(v_lat, v_lng, v_norm);
      if v_route is not null then v_how := 'geocode'; end if;
    end if;
    -- 4. a street that only one route has
    if v_route is null and v_norm is not null then
      select count(distinct route_code), min(route_code) into v_n, v_route from route_street_lines where street_norm = v_norm;
      if v_n = 1 then v_how := 'street'; else v_route := null; end if;
    end if;
    -- 5. the route the file itself gives, if it's a real route
    if v_route is null and nullif(trim(r->>'route'), '') is not null then
      select route_code into v_route from route_maps where status = 'approved' and upper(route_code) = upper(trim(r->>'route')) limit 1;
      if v_route is not null then v_how := 'given'; end if;
    end if;
    v_out := v_out || jsonb_build_object('i', r->'i', 'street_norm', v_norm, 'route_code', v_route,
      'lat', v_lat, 'lng', v_lng, 'how', v_how,
      'client_id', case when v_norm is not null then client_find(r->>'house_no', v_norm, r->>'unit', v_city) end);
  end loop;
  return v_out;
end $$;
revoke all on function public.app_client_match(jsonb) from public, anon;
grant execute on function public.app_client_match(jsonb) to authenticated;

-- ───────────────────────── the map's past-client layer ─────────────────────────
-- Rebuilds map_pcl_cache for the given routes: the clients the map had before imports
-- (kept in map_pcl_cache_base) plus the imported clients on that route. An imported client
-- at the same address replaces the old entry and carries its history.
create or replace function public.client_refresh_map_pcl(p_routes text[])
returns void language plpgsql security definer set search_path = public as $$
declare v_route text; v_base jsonb; v_cur jsonb; v_ours jsonb; v_keys text[]; v_area text; v_prefix text; v_region text; v_all jsonb;
begin
  foreach v_route in array coalesce(p_routes, '{}') loop
    continue when v_route is null;
    -- keep the map's own (non-imported) entries, adding any loaded since last time
    select clients into v_cur from map_pcl_cache where route_code = v_route;
    select clients into v_base from map_pcl_cache_base where route_code = v_route;
    v_base := coalesce(v_base, '[]');
    select coalesce(jsonb_agg(e), '[]') into v_cur
      from jsonb_array_elements(coalesce(v_cur, '[]')) e
     where coalesce(e->>'src', '') <> 'crm'
       and not exists (select 1 from jsonb_array_elements(v_base) b
                        where lower(coalesce(b->>'houseNum', '')) = lower(coalesce(e->>'houseNum', ''))
                          and norm_street(b->>'streetName') is not distinct from norm_street(e->>'streetName'));
    v_base := v_base || v_cur;
    insert into map_pcl_cache_base (route_code, clients, saved_at) values (v_route, v_base, now())
      on conflict (route_code) do update set clients = excluded.clients, saved_at = now();

    -- imported clients on this route, in the shape the map reads
    select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'firstName', coalesce(c.people->0->>'first', ''),
             'lastName', coalesce(c.people->0->>'last', ''),
             'houseNum', c.house_no,
             'streetName', c.street_name,
             'phone', coalesce(c.phones[1], ''),
             'city', c.city, 'lat', c.lat, 'lng', c.lng,
             'history', (select coalesce(jsonb_agg(jsonb_build_object(
                            'year', coalesce((h->>'year')::int, 0),
                            'price', coalesce(case when (h->>'price') ~ '^\d+(\.\d+)?$' then '$' || to_char((h->>'price')::numeric, 'FM999990.00') else h->>'price' end, ''),
                            'serviceType', coalesce(h->>'service', ''),
                            'contractor', coalesce(h->>'contractor', ''))
                          order by coalesce((h->>'year')::int, 0) desc), '[]')
                         from jsonb_array_elements(c.history) h),
             'src', 'crm', 'cid', c.id)) order by c.street_norm, c.house_no), '[]'),
           coalesce(array_agg(lower(c.house_no) || '|' || c.street_norm), '{}')
      into v_ours, v_keys
      from clients c where c.route_code = v_route;

    -- an old entry at an imported address gives its history to the imported one
    select coalesce(jsonb_agg(b.e) filter (where not (b.k = any(v_keys))), '[]')
      into v_all
      from (select e, lower(coalesce(e->>'houseNum', '')) || '|' || coalesce(norm_street(e->>'streetName'), '') as k
              from jsonb_array_elements(v_base) e) b;
    select coalesce(jsonb_agg(
             case when old.e is null then o
                  else o || jsonb_build_object('history', (
                    select coalesce(jsonb_agg(distinct h), '[]') from (
                      select jsonb_array_elements(o->'history') h
                      union all select jsonb_array_elements(coalesce(old.e->'history', '[]'))) hh)) end), '[]')
      into v_ours
      from jsonb_array_elements(v_ours) o
      left join lateral (
        select e from jsonb_array_elements(v_base) e
         where lower(coalesce(e->>'houseNum', '')) = lower(o->>'houseNum')
           and norm_street(e->>'streetName') = norm_street(o->>'streetName') limit 1) old on true;
    v_all := v_all || v_ours;

    if exists (select 1 from map_pcl_cache where route_code = v_route) then
      update map_pcl_cache set clients = v_all, client_count = jsonb_array_length(v_all), updated_at = now() where route_code = v_route;
    elsif jsonb_array_length(v_all) > 0 then
      select rm.area_name into v_area from route_maps rm where rm.route_code = v_route and rm.status = 'approved' limit 1;
      select ap.prefix, ap.region into v_prefix, v_region from area_prefixes ap where ap.area_name = v_area;
      insert into map_pcl_cache (route_code, area_name, region, prefix, clients, client_count, updated_at)
      values (v_route, coalesce(v_area, ''), v_region, v_prefix, v_all, jsonb_array_length(v_all), now());
    end if;
  end loop;
end $$;
revoke all on function public.client_refresh_map_pcl(text[]) from public, anon, authenticated;

-- ───────────────────────── import: begin, add rows, finish, undo ─────────────────────────
create or replace function public.app_client_import_begin(p_file text, p_source text, p_sheet_url text,
  p_fingerprint text, p_recipe_name text, p_headers text[], p_mapping jsonb, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_recipe uuid; v_id uuid;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  insert into client_import_recipes (fingerprint, name, headers, mapping, notes, created_by)
  values (p_fingerprint, coalesce(nullif(trim(p_recipe_name), ''), p_file), coalesce(p_headers, '{}'), p_mapping, p_notes, auth.uid())
  on conflict (fingerprint) do update
    set mapping = excluded.mapping, headers = excluded.headers,
        notes = coalesce(excluded.notes, client_import_recipes.notes),
        name = coalesce(nullif(trim(p_recipe_name), ''), client_import_recipes.name), active = true
  returning id into v_recipe;
  insert into client_imports (file_name, source, sheet_url, recipe_id, created_by)
  values (p_file, p_source, p_sheet_url, v_recipe, auth.uid()) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.app_client_import_begin(text, text, text, text, text, text[], jsonb, text) from public, anon;
grant execute on function public.app_client_import_begin(text, text, text, text, text, text[], jsonb, text) to authenticated;

-- rows: [{house_no, street_name, unit, city, province, postal_code, lat, lng, route_code, match_how,
--         people:[{first,last}], phones:[], emails:[], history:[{year,service,price,contractor,payment,notes}],
--         tags:[], notes, call_first, do_not_call, do_not_text}]
create or replace function public.app_client_import_add(p_import uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; v_norm text; v_id uuid; v_old clients; v_inserted int := 0; v_merged int := 0; v_skipped int := 0;
        v_city text; v_house text;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  if not exists (select 1 from client_imports where id = p_import and status = 'running') then
    raise exception 'This import is not open';
  end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'At most 1,000 rows per call'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_norm := norm_street(r->>'street_name');
    v_house := nullif(trim(r->>'house_no'), '');
    v_city := nullif(trim(r->>'city'), '');
    if v_norm is null or v_house is null then v_skipped := v_skipped + 1; continue; end if;
    v_id := client_find(v_house, v_norm, r->>'unit', v_city);
    if v_id is null then
      insert into clients (address_key, house_no, street_name, street_norm, unit, city, province, postal_code,
                           lat, lng, route_code, match_how, people, phones, emails, history, tags, notes, call_first,
                           do_not_call, do_not_text)
      values (client_address_key(v_house, v_norm, r->>'unit', v_city), v_house, trim(r->>'street_name'), v_norm,
              nullif(trim(r->>'unit'), ''), v_city, nullif(trim(r->>'province'), ''), nullif(trim(r->>'postal_code'), ''),
              (r->>'lat')::float8, (r->>'lng')::float8, nullif(r->>'route_code', ''), nullif(r->>'match_how', ''),
              coalesce(r->'people', '[]'),
              coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(r->'phones', '[]')) x where x <> ''), '{}'),
              coalesce((select array_agg(distinct lower(x)) from jsonb_array_elements_text(coalesce(r->'emails', '[]')) x where x <> ''), '{}'),
              coalesce(r->'history', '[]'),
              coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(r->'tags', '[]')) x where x <> ''), '{}'),
              nullif(trim(r->>'notes'), ''), nullif(trim(r->>'call_first'), ''),
              coalesce((r->>'do_not_call')::boolean, false), coalesce((r->>'do_not_text')::boolean, false))
      returning id into v_id;
      insert into client_import_changes (import_id, client_id, action) values (p_import, v_id, 'insert');
      v_inserted := v_inserted + 1;
    else
      select * into v_old from clients where id = v_id for update;
      insert into client_import_changes (import_id, client_id, action, before)
      values (p_import, v_id, 'merge', to_jsonb(v_old)) on conflict (import_id, client_id) do nothing;
      update clients c set
        city = coalesce(c.city, v_city),
        address_key = case when c.city is null and v_city is not null
                             and not exists (select 1 from clients x where x.address_key = client_address_key(c.house_no, c.street_norm, c.unit, v_city))
                           then client_address_key(c.house_no, c.street_norm, c.unit, v_city) else c.address_key end,
        province = coalesce(c.province, nullif(trim(r->>'province'), '')),
        postal_code = coalesce(c.postal_code, nullif(trim(r->>'postal_code'), '')),
        lat = coalesce(c.lat, (r->>'lat')::float8), lng = coalesce(c.lng, (r->>'lng')::float8),
        route_code = coalesce(c.route_code, nullif(r->>'route_code', '')),
        match_how = case when c.route_code is null then nullif(r->>'match_how', '') else c.match_how end,
        people = (select coalesce(jsonb_agg(p order by ord), '[]') from (
                    select distinct on (lower(coalesce(p->>'first', '')) || '|' || lower(coalesce(p->>'last', ''))) p, ord
                      from (select p, ord from jsonb_array_elements(c.people || coalesce(r->'people', '[]')) with ordinality as t(p, ord)) s
                     order by lower(coalesce(p->>'first', '')) || '|' || lower(coalesce(p->>'last', '')), ord) d),
        phones = (select coalesce(array_agg(x order by o), '{}') from (
                    select x, min(o) o from unnest(c.phones || coalesce((select array_agg(y) from jsonb_array_elements_text(coalesce(r->'phones', '[]')) y where y <> ''), '{}'))
                      with ordinality as u(x, o) group by x) z),
        emails = (select coalesce(array_agg(x order by o), '{}') from (
                    select x, min(o) o from unnest(c.emails || coalesce((select array_agg(lower(y)) from jsonb_array_elements_text(coalesce(r->'emails', '[]')) y where y <> ''), '{}'))
                      with ordinality as u(x, o) group by x) z),
        history = (select coalesce(jsonb_agg(h order by coalesce((h->>'year')::int, 0) desc), '[]') from (
                     select distinct on (coalesce(h->>'year', '') || '|' || lower(coalesce(h->>'service', '')) || '|' || coalesce(h->>'price', '') || '|' || lower(coalesce(h->>'contractor', ''))) h
                       from jsonb_array_elements(c.history || coalesce(r->'history', '[]')) h) d),
        tags = (select coalesce(array_agg(distinct x), '{}') from unnest(c.tags || coalesce((select array_agg(y) from jsonb_array_elements_text(coalesce(r->'tags', '[]')) y where y <> ''), '{}')) x),
        notes = case when nullif(trim(r->>'notes'), '') is null or position(trim(r->>'notes') in coalesce(c.notes, '')) > 0 then c.notes
                     else concat_ws(E'\n', c.notes, trim(r->>'notes')) end,
        call_first = coalesce(nullif(trim(r->>'call_first'), ''), c.call_first),
        do_not_call = c.do_not_call or coalesce((r->>'do_not_call')::boolean, false),
        do_not_text = c.do_not_text or coalesce((r->>'do_not_text')::boolean, false),
        updated_at = now()
      where c.id = v_id;
      v_merged := v_merged + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'merged', v_merged, 'skipped', v_skipped);
end $$;
revoke all on function public.app_client_import_add(uuid, jsonb) from public, anon;
grant execute on function public.app_client_import_add(uuid, jsonb) to authenticated;

create or replace function public.app_client_import_finish(p_import uuid, p_counts jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_routes text[];
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  update client_imports set status = 'done', counts = coalesce(p_counts, '{}'), finished_at = now()
   where id = p_import and status = 'running';
  if not found then raise exception 'This import is not open'; end if;
  update client_import_recipes set times_used = times_used + 1, last_used_at = now()
   where id = (select recipe_id from client_imports where id = p_import);
  select array_agg(distinct rc) into v_routes from (
    select c.route_code as rc from client_import_changes ch join clients c on c.id = ch.client_id where ch.import_id = p_import
    union select ch.before->>'route_code' from client_import_changes ch where ch.import_id = p_import) x
   where rc is not null;
  perform client_refresh_map_pcl(v_routes);
end $$;
revoke all on function public.app_client_import_finish(uuid, jsonb) from public, anon;
grant execute on function public.app_client_import_finish(uuid, jsonb) to authenticated;

-- Undo an import: inserted clients are removed, merged ones go back to how they were.
-- Refused if a later import has since changed any of the same clients (undo that first).
create or replace function public.app_client_import_undo(p_import uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; v_created timestamptz; v_later int; v_routes text[]; v_removed int; v_restored int;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  select status, created_at into v_status, v_created from client_imports where id = p_import for update;
  if v_status is null then raise exception 'Unknown import'; end if;
  if v_status = 'undone' then raise exception 'This import was already undone'; end if;
  select count(distinct ch2.import_id) into v_later
    from client_import_changes ch join client_import_changes ch2 on ch2.client_id = ch.client_id and ch2.import_id <> ch.import_id
    join client_imports i2 on i2.id = ch2.import_id
   where ch.import_id = p_import and i2.status <> 'undone' and i2.created_at > v_created;
  if v_later > 0 then raise exception 'A later import changed some of the same clients. Undo the later import first.'; end if;

  select array_agg(distinct rc) into v_routes from (
    select c.route_code as rc from client_import_changes ch join clients c on c.id = ch.client_id where ch.import_id = p_import
    union select ch.before->>'route_code' from client_import_changes ch where ch.import_id = p_import) x
   where rc is not null;

  delete from clients c using client_import_changes ch
   where ch.import_id = p_import and ch.action = 'insert' and c.id = ch.client_id;
  get diagnostics v_removed = row_count;
  update clients c set
    address_key = b.address_key, house_no = b.house_no, street_name = b.street_name, street_norm = b.street_norm,
    unit = b.unit, city = b.city, province = b.province, postal_code = b.postal_code, lat = b.lat, lng = b.lng,
    route_code = b.route_code, match_how = b.match_how, people = b.people, phones = b.phones, emails = b.emails,
    history = b.history, tags = b.tags, notes = b.notes, call_first = b.call_first,
    do_not_call = b.do_not_call, do_not_text = b.do_not_text, updated_at = now()
  from client_import_changes ch, jsonb_populate_record(null::clients, ch.before) b
  where ch.import_id = p_import and ch.action = 'merge' and c.id = ch.client_id;
  get diagnostics v_restored = row_count;

  update client_imports set status = 'undone', undone_at = now(), undone_by = auth.uid() where id = p_import;
  perform client_refresh_map_pcl(v_routes);
  return jsonb_build_object('removed', v_removed, 'restored', v_restored);
end $$;
revoke all on function public.app_client_import_undo(uuid) from public, anon;
grant execute on function public.app_client_import_undo(uuid) to authenticated;

-- An import left running (browser closed half way) can be finished as-is or undone;
-- Super Admin › Territory shows both buttons. Recipes can be renamed or retired.
create or replace function public.app_client_recipe_update(p_id uuid, p_name text, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  update client_import_recipes set name = coalesce(nullif(trim(p_name), ''), name), active = coalesce(p_active, active) where id = p_id;
end $$;
revoke all on function public.app_client_recipe_update(uuid, text, boolean) from public, anon;
grant execute on function public.app_client_recipe_update(uuid, text, boolean) to authenticated;
