-- RUN_22 — client-list imports that can't go wrong quietly. ADDITIVE ONLY: adds tables and
-- columns, widens one status list, replaces three functions (app_client_import_add,
-- app_client_import_undo, and nothing else changes shape), adds the rest.
--
-- 1. THE DATABASE CHECKS EVERY JOB before it is saved, whatever the app sends: the year must be a
--    real service year (2010 to next year), a date must be a real day in the job's own year, and
--    the service line must be one of ours. A row carrying what looks like a payment card number
--    (or a SIN written next to the word SIN) is refused: those are never stored.
-- 2. STAGE → PREVIEW → SAVE. An import's rows are first put in a holding table
--    (client_import_rows). The preview runs the real save and then rolls it back, so what it shows
--    is exactly what saving will do. Saving goes through the held rows in steps; if the page is
--    closed half way, the import can be finished (or undone) later without the file.
-- 3. UNDO REMOVES ONLY WHAT THE IMPORT ADDED. Each change records what the import added to the
--    customer (jobs, details filled in, phones, emails, tags, people, empty fields filled). Undo
--    takes exactly that back out, so later changes (another import, a repair, an edit) survive.
--    Imports saved before this change keep the old undo, but it now refuses when a customer was
--    changed after the import, instead of wiping that change.
-- 4. THE BENNY'S LESSONS: short rules the office confirmed ("YEAR decides, the DATE column has no
--    year"), given to The Benny every time it reads a file.
-- 5. DATA HEALTH, nightly at 3:15 a.m. Toronto (2:15 in winter), or within a minute when asked for from the app: jobs
--    with impossible years or dates, the same job saved twice, and routes whose past-client map
--    lists are behind. Report only; fixes are run from Client Lists.

-- ───────────── imports ─────────────
alter table public.client_imports
  add column if not exists file_hash text,
  add column if not exists checks jsonb,
  add column if not exists audit jsonb,
  add column if not exists preview jsonb,
  add column if not exists fingerprint text,
  add column if not exists recipe_name text,
  add column if not exists headers text[],
  add column if not exists mapping jsonb,
  add column if not exists notes text;
alter table public.client_imports drop constraint if exists client_imports_status_check;
alter table public.client_imports add constraint client_imports_status_check
  check (status in ('staged', 'running', 'done', 'undone', 'cancelled'));
create index if not exists client_imports_hash on public.client_imports (file_hash);

alter table public.client_import_changes add column if not exists added jsonb;

-- the rows of an import as they will be (or were) saved, and the sheet cells they came from
create table if not exists public.client_import_rows (
  import_id uuid not null references public.client_imports(id) on delete cascade,
  seq integer not null,
  row jsonb not null,
  source jsonb,
  applied_at timestamptz,
  result text,
  primary key (import_id, seq)
);
alter table public.client_import_rows enable row level security;
revoke all on public.client_import_rows from anon, authenticated;

-- ───────────── what the database refuses ─────────────
create or replace function public.luhn_ok(d text)
returns boolean language sql immutable set search_path = public as $$
  select d ~ '^\d{2,}$' and coalesce((
    select sum(case when (length(d) - i) % 2 = 1
                    then case when substr(d, i, 1)::int * 2 > 9 then substr(d, i, 1)::int * 2 - 9 else substr(d, i, 1)::int * 2 end
                    else substr(d, i, 1)::int end) % 10 = 0
      from generate_series(1, length(d)) i), false)
$$;

-- A payment card number (Visa, Mastercard, Amex, Discover: 15 or 16 digits that pass the card
-- check) anywhere in the text, or a SIN (9 digits that pass the check) next to the word SIN.
create or replace function public.looks_like_card_or_sin(t text)
returns boolean language sql immutable set search_path = public as $$
  select exists (
           select 1 from regexp_matches(coalesce(t, ''),
             '(?<!\d)((?:4\d{3}|5[1-5]\d{2}|2[2-7]\d{2}|6011|65\d{2})(?:[ -]?\d{4}){3}|3[47]\d{2}[ -]?\d{6}[ -]?\d{5})(?!\d)', 'g') m
            where luhn_ok(regexp_replace(m[1], '\D', '', 'g')))
      or ((coalesce(t, '') ~ '(^|[^A-Za-z])(SIN|S\.I\.N\.?)([^A-Za-z]|$)' or coalesce(t, '') ~* 'social insurance')
          and exists (select 1 from regexp_matches(t, '(?<!\d)(\d{3}[ -]?\d{3}[ -]?\d{3})(?!\d)', 'g') m
                       where luhn_ok(regexp_replace(m[1], '\D', '', 'g'))))
$$;

-- The first year the company has jobs from. Anything earlier is a misread (a date with no year
-- in it is read as 2001). Change it here if older records ever need importing.
create or replace function public.client_first_service_year()
returns integer language sql immutable set search_path = public as $$ select 2010 $$;

-- Why one history entry can't be saved, or null when it's fine.
create or replace function public.client_job_problem(h jsonb)
returns text language plpgsql stable set search_path = public as $$
declare y text; d text; l text; top int := extract(year from now())::int + 1; low int := client_first_service_year(); dd date;
begin
  if h is null or jsonb_typeof(h) <> 'object' then return 'a job that isn''t a record'; end if;
  y := nullif(h->>'year', ''); d := nullif(h->>'date', ''); l := coalesce(h->>'line', '');
  if y is not null then
    if y !~ '^\d{4}$' then return format('job year “%s” is not a year', y); end if;
    if y::int < low or y::int > top then return format('job year %s can''t be a service year (%s to %s)', y, low, top); end if;
  end if;
  if d is not null then
    if d !~ '^\d{4}-\d{2}-\d{2}$' then return format('date “%s” is not a full date', d); end if;
    begin dd := d::date; exception when others then return format('date %s is not a real day', d); end;
    if extract(year from dd)::int < low or extract(year from dd)::int > top then return format('date %s can''t be a service date', d); end if;
    if y is not null and left(d, 4) <> y then return format('date %s is in a different year than the job (%s)', d, y); end if;
  end if;
  if l not in ('', 'aeration', 'sealing', 'lawn_rejuv', 'cleaning') then return format('service line “%s” isn''t one of ours', l); end if;
  return null;
end $$;

-- Why one import row can't be saved, or null when it's fine.
create or replace function public.client_row_problem(r jsonb)
returns text language plpgsql stable set search_path = public as $$
declare h jsonb; p text; addr text := concat_ws(' ', r->>'house_no', r->>'street_name');
begin
  if jsonb_typeof(coalesce(r->'history', '[]')) <> 'array' then return format('%s: its jobs aren''t a list', addr); end if;
  for h in select * from jsonb_array_elements(coalesce(r->'history', '[]')) loop
    p := client_job_problem(h);
    if p is not null then return format('%s: %s', addr, p); end if;
  end loop;
  if looks_like_card_or_sin(concat_ws(' | ', r->>'notes', r->>'call_first', r->>'tags', r->>'people', r->>'emails', r->>'phones',
                                      r->>'history', r->>'unit', r->>'house_no', r->>'street_name', r->>'postal_code', r->>'city', r->>'province')) then
    return format('%s: has what looks like a card number or SIN. Those are never saved; set that column to Ignore.', addr);
  end if;
  return null;
end $$;

-- ───────────── what an import added to a customer ─────────────
create or replace function public.client_import_diff(b public.clients, a public.clients)
returns jsonb language sql stable set search_path = public as $$
  with bh as (select h from jsonb_array_elements(b.history) h),
       ah as (select h from jsonb_array_elements(a.history) h),
       added as (select h from ah where not exists (select 1 from bh where bh.h = ah.h)),
       removed as (select h from bh where not exists (select 1 from ah where ah.h = bh.h)),
       -- a saved job the import filled in pairs with what it became (one saved job per new one; a
       -- second saved job folded into the same one is recorded as dropped, and comes back on undo)
       pairs0 as (select r.h as was, (select x.h from added x where x.h @> r.h limit 1) as now from removed r),
       pairs as (select was, now, row_number() over (partition by now order by was::text) rn from pairs0),
       bp as (select p from jsonb_array_elements(b.people) p),
       ap as (select p from jsonb_array_elements(a.people) p),
       padded as (select p from ap where not exists (select 1 from bp where bp.p = ap.p)),
       premoved as (select p from bp where not exists (select 1 from ap where ap.p = bp.p)),
       ppairs0 as (select r.p as was, (select x.p from padded x where x.p @> r.p limit 1) as now from premoved r),
       ppairs as (select was, now, row_number() over (partition by now order by was::text) rn from ppairs0)
  select jsonb_strip_nulls(jsonb_build_object(
    'history', (select coalesce(jsonb_agg(h), '[]') from added where not exists (select 1 from pairs where pairs.now = added.h and pairs.rn = 1)),
    'replaced', (select jsonb_agg(jsonb_build_object('was', was, 'now', now)) from pairs where now is not null and rn = 1),
    'dropped', (select jsonb_agg(was) from pairs where now is null or rn > 1),
    'people', (select jsonb_agg(p) from padded where not exists (select 1 from ppairs where ppairs.now = padded.p and ppairs.rn = 1)),
    'people_replaced', (select jsonb_agg(jsonb_build_object('was', was, 'now', now)) from ppairs where now is not null and rn = 1),
    'people_dropped', (select jsonb_agg(was) from ppairs where now is null or rn > 1),
    'phones', (select jsonb_agg(x) from unnest(a.phones) x where not (x = any(b.phones))),
    'emails', (select jsonb_agg(x) from unnest(a.emails) x where not (x = any(b.emails))),
    'tags', (select jsonb_agg(x) from unnest(a.tags) x where not (x = any(b.tags))),
    'fields', nullif(jsonb_strip_nulls(jsonb_build_object(
       'address_key', case when a.address_key is distinct from b.address_key then jsonb_build_object('was', b.address_key, 'now', a.address_key) end,
       'city', case when a.city is distinct from b.city then jsonb_build_object('was', b.city, 'now', a.city) end,
       'province', case when a.province is distinct from b.province then jsonb_build_object('was', b.province, 'now', a.province) end,
       'postal_code', case when a.postal_code is distinct from b.postal_code then jsonb_build_object('was', b.postal_code, 'now', a.postal_code) end,
       'lat', case when a.lat is distinct from b.lat then jsonb_build_object('was', b.lat, 'now', a.lat) end,
       'lng', case when a.lng is distinct from b.lng then jsonb_build_object('was', b.lng, 'now', a.lng) end,
       'route_code', case when a.route_code is distinct from b.route_code then jsonb_build_object('was', b.route_code, 'now', a.route_code) end,
       'match_how', case when a.match_how is distinct from b.match_how then jsonb_build_object('was', b.match_how, 'now', a.match_how) end,
       'notes', case when a.notes is distinct from b.notes then jsonb_build_object('was', b.notes, 'now', a.notes) end,
       'call_first', case when a.call_first is distinct from b.call_first then jsonb_build_object('was', b.call_first, 'now', a.call_first) end,
       'do_not_call', case when a.do_not_call is distinct from b.do_not_call then jsonb_build_object('was', b.do_not_call, 'now', a.do_not_call) end,
       'do_not_text', case when a.do_not_text is distinct from b.do_not_text then jsonb_build_object('was', b.do_not_text, 'now', a.do_not_text) end
    )), '{}'::jsonb)))
$$;

-- Two rows of one import that land on the same customer: one record of everything both added.
create or replace function public.client_import_added_merge(x jsonb, y jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case when x is null then y when y is null then x else jsonb_strip_nulls(jsonb_build_object(
    'insert', coalesce(x->'insert', y->'insert'),
    'history', coalesce(x->'history', '[]') || coalesce(y->'history', '[]'),
    'replaced', nullif(coalesce(x->'replaced', '[]') || coalesce(y->'replaced', '[]'), '[]'),
    'dropped', nullif(coalesce(x->'dropped', '[]') || coalesce(y->'dropped', '[]'), '[]'),
    'people', nullif(coalesce(x->'people', '[]') || coalesce(y->'people', '[]'), '[]'),
    'people_replaced', nullif(coalesce(x->'people_replaced', '[]') || coalesce(y->'people_replaced', '[]'), '[]'),
    'people_dropped', nullif(coalesce(x->'people_dropped', '[]') || coalesce(y->'people_dropped', '[]'), '[]'),
    'phones', nullif(coalesce(x->'phones', '[]') || coalesce(y->'phones', '[]'), '[]'),
    'emails', nullif(coalesce(x->'emails', '[]') || coalesce(y->'emails', '[]'), '[]'),
    'tags', nullif(coalesce(x->'tags', '[]') || coalesce(y->'tags', '[]'), '[]'),
    -- a field changed twice: it was what the first row found, and is what the second row left
    'fields', (select nullif(jsonb_object_agg(k, jsonb_strip_nulls(jsonb_build_object(
                   'was', case when x->'fields' ? k then x->'fields'->k->'was' else y->'fields'->k->'was' end,
                   'now', case when y->'fields' ? k then y->'fields'->k->'now' else x->'fields'->k->'now' end))), '{}'::jsonb)
                 from (select jsonb_object_keys(coalesce(x->'fields', '{}')) k
                       union select jsonb_object_keys(coalesce(y->'fields', '{}'))) ks)
  )) end
$$;

-- ───────────── saving one row (the only place an import writes to customers) ─────────────
create or replace function public.client_import_apply_row(p_import uuid, r jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_norm text := norm_street(r->>'street_name'); v_house text := nullif(trim(r->>'house_no'), '');
        v_city text := nullif(trim(r->>'city'), ''); v_id uuid; v_old clients; v_new clients; v_problem text;
begin
  v_problem := client_row_problem(r);
  if v_problem is not null then raise exception '%', v_problem using errcode = 'check_violation'; end if;
  if v_norm is null or v_house is null then return 'skipped'; end if;
  v_id := client_find(v_house, v_norm, r->>'unit', v_city);
  if v_id is null then
    insert into clients (address_key, house_no, street_name, street_norm, unit, city, province, postal_code,
                         lat, lng, route_code, match_how, people, phones, emails, history, tags, notes, call_first,
                         do_not_call, do_not_text)
    values (client_address_key(v_house, v_norm, r->>'unit', v_city), v_house, trim(r->>'street_name'), v_norm,
            nullif(trim(r->>'unit'), ''), v_city, nullif(trim(r->>'province'), ''), nullif(trim(r->>'postal_code'), ''),
            (r->>'lat')::float8, (r->>'lng')::float8, nullif(r->>'route_code', ''), nullif(r->>'match_how', ''),
            coalesce(r->'people', '[]'),
            coalesce((select array_agg(x order by o) from (
                        select x, min(o) o from jsonb_array_elements_text(coalesce(r->'phones', '[]')) with ordinality u(x, o)
                         where x <> '' group by x) z), '{}'),
            coalesce((select array_agg(distinct lower(x)) from jsonb_array_elements_text(coalesce(r->'emails', '[]')) x where x <> ''), '{}'),
            coalesce(r->'history', '[]'),
            coalesce((select array_agg(distinct x) from jsonb_array_elements_text(coalesce(r->'tags', '[]')) x where x <> ''), '{}'),
            nullif(trim(r->>'notes'), ''), nullif(trim(r->>'call_first'), ''),
            coalesce((r->>'do_not_call')::boolean, false), coalesce((r->>'do_not_text')::boolean, false))
    returning * into v_new;
    insert into client_import_changes (import_id, client_id, action, added)
    values (p_import, v_new.id, 'insert', jsonb_build_object('insert', true, 'history', v_new.history))
    on conflict (import_id, client_id) do update set added = client_import_added_merge(client_import_changes.added, excluded.added);
    return 'inserted';
  end if;

  select * into v_old from clients where id = v_id for update;
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
    -- one entry per name; a name saved without a phone takes its phone from the new row
    people = (select coalesce(jsonb_agg(p order by ord), '[]') from (
                select distinct on (k)
                       case when nullif(trim(p->>'phone'), '') is null and ph is not null then p || jsonb_build_object('phone', ph) else p end as p, ord
                  from (select p, ord, lower(coalesce(p->>'first', '')) || '|' || lower(coalesce(p->>'last', '')) as k,
                               first_value(nullif(trim(p->>'phone'), '')) over (
                                 partition by lower(coalesce(p->>'first', '')) || '|' || lower(coalesce(p->>'last', ''))
                                 order by (nullif(trim(p->>'phone'), '') is null), ord) as ph
                          from jsonb_array_elements(c.people || coalesce(r->'people', '[]')) with ordinality as t(p, ord)) s
                 order by k, ord) d),
    phones = (select coalesce(array_agg(x order by o), '{}') from (
                select x, min(o) o from unnest(c.phones || coalesce((select array_agg(y) from jsonb_array_elements_text(coalesce(r->'phones', '[]')) y where y <> ''), '{}'))
                  with ordinality as u(x, o) group by x) z),
    emails = (select coalesce(array_agg(x order by o), '{}') from (
                select x, min(o) o from unnest(c.emails || coalesce((select array_agg(lower(y)) from jsonb_array_elements_text(coalesce(r->'emails', '[]')) y where y <> ''), '{}'))
                  with ordinality as u(x, o) group by x) z),
    -- a job already on the customer isn't added again: the uploaded copy only fills in what the
    -- saved one is missing
    history = (select coalesce(jsonb_agg(h order by coalesce((h->>'year')::int, 0) desc, coalesce(h->>'date', '') desc), '[]') from (
                 select distinct on (coalesce(h->>'year', '') || '|' || lower(coalesce(h->>'service', '')) || '|' || coalesce(h->>'price', '') || '|' || lower(coalesce(h->>'contractor', '')) || '|' || coalesce(h->>'date', '')) h
                   from (
                     select coalesce((select i.h || e.h from jsonb_array_elements(coalesce(r->'history', '[]')) i(h)
                                       where crm_same_job(e.h, i.h) limit 1), e.h) as h
                       from jsonb_array_elements(c.history) e(h)
                     union all
                     select i.h from jsonb_array_elements(coalesce(r->'history', '[]')) i(h)
                      where not exists (select 1 from jsonb_array_elements(c.history) e(h) where crm_same_job(e.h, i.h))
                   ) x) d),
    tags = (select coalesce(array_agg(distinct x), '{}') from unnest(c.tags || coalesce((select array_agg(y) from jsonb_array_elements_text(coalesce(r->'tags', '[]')) y where y <> ''), '{}')) x),
    notes = case when nullif(trim(r->>'notes'), '') is null or position(trim(r->>'notes') in coalesce(c.notes, '')) > 0 then c.notes
                 else concat_ws(E'\n', c.notes, trim(r->>'notes')) end,
    call_first = coalesce(nullif(trim(r->>'call_first'), ''), c.call_first),
    do_not_call = c.do_not_call or coalesce((r->>'do_not_call')::boolean, false),
    do_not_text = c.do_not_text or coalesce((r->>'do_not_text')::boolean, false),
    updated_at = now()
  where c.id = v_id
  returning * into v_new;
  insert into client_import_changes (import_id, client_id, action, before, added)
  values (p_import, v_id, 'merge', to_jsonb(v_old), client_import_diff(v_old, v_new))
  on conflict (import_id, client_id) do update set added = client_import_added_merge(client_import_changes.added, excluded.added);
  return 'merged';
end $$;
revoke all on function public.client_import_apply_row(uuid, jsonb) from public, anon, authenticated;

-- The old one-call save, kept for anything still calling it: same checks, same record of changes.
create or replace function public.app_client_import_add(p_import uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; v text; v_inserted int := 0; v_merged int := 0; v_skipped int := 0;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  if not exists (select 1 from client_imports where id = p_import and status = 'running') then
    raise exception 'This import is not open';
  end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'At most 1,000 rows per call'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v := client_import_apply_row(p_import, r);
    if v = 'inserted' then v_inserted := v_inserted + 1; elsif v = 'merged' then v_merged := v_merged + 1; else v_skipped := v_skipped + 1; end if;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'merged', v_merged, 'skipped', v_skipped);
end $$;

-- ───────────── stage → preview → save ─────────────
create or replace function public.app_client_import_open(p_file text, p_source text, p_sheet_url text, p_fingerprint text,
  p_recipe_name text, p_headers text[], p_mapping jsonb, p_notes text, p_file_hash text, p_checks jsonb, p_audit jsonb, p_counts jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_checks) = 'array' then p_checks else '[]' end) c where c->>'level' = 'stop') then
    raise exception 'This import has a check that stops it. Fix the layout or the file first.';
  end if;
  insert into client_imports (file_name, source, sheet_url, status, created_by, file_hash, checks, audit,
                              fingerprint, recipe_name, headers, mapping, notes, counts)
  values (p_file, p_source, p_sheet_url, 'staged', auth.uid(), nullif(p_file_hash, ''), p_checks, p_audit,
          p_fingerprint, nullif(trim(p_recipe_name), ''), coalesce(p_headers, '{}'), p_mapping, p_notes, coalesce(p_counts, '{}'))
  returning id into v_id;
  return v_id;
end $$;

-- Earlier imports of exactly the same file.
create or replace function public.app_client_import_same_file(p_hash text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'file_name', file_name, 'created_at', created_at, 'status', status) order by created_at desc), '[]')
            from client_imports where file_hash = p_hash and status in ('running', 'done'));
end $$;

create or replace function public.app_client_import_stage(p_import uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_next int; r jsonb; o bigint; v_problem text;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  if not exists (select 1 from client_imports where id = p_import and status = 'staged') then raise exception 'This import is not open for rows'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then raise exception 'At most 1,000 rows per call'; end if;
  select coalesce(max(seq), 0) into v_next from client_import_rows where import_id = p_import;
  for r, o in select * from jsonb_array_elements(p_rows) with ordinality loop
    v_problem := client_row_problem(r - 'source');
    if v_problem is not null then raise exception '%', v_problem using errcode = 'check_violation'; end if;
    if looks_like_card_or_sin((r->'source')::text) then
      raise exception '%: the sheet cells kept with this row have what looks like a card number or SIN.', concat_ws(' ', r->>'house_no', r->>'street_name') using errcode = 'check_violation';
    end if;
    insert into client_import_rows (import_id, seq, row, source) values (p_import, v_next + o, r - 'source', r->'source');
  end loop;
  return v_next + jsonb_array_length(p_rows);
end $$;

-- What saving the held rows would do, worked out by doing it and then rolling it back.
create or replace function public.client_import_preview_stats(p_import uuid)
returns jsonb language sql stable set search_path = public as $$
  with ch as (select * from client_import_changes where import_id = p_import),
       jobs as (select coalesce(nullif(h->>'line', ''), '—') || '|' || coalesce(h->>'year', 'no year') k from ch, jsonb_array_elements(coalesce(ch.added->'history', '[]')) h),
       filled as (select coalesce(nullif(p->'now'->>'line', ''), '—') || '|' || coalesce(p->'now'->>'year', 'no year') k from ch, jsonb_array_elements(coalesce(ch.added->'replaced', '[]')) p)
  select jsonb_build_object(
    'inserted', (select count(*) from ch where action = 'insert'),
    'merged', (select count(*) from ch where action = 'merge'),
    'nothing_new', (select count(*) from ch where action = 'merge' and jsonb_array_length(coalesce(added->'history', '[]')) = 0
                      and added->'replaced' is null and added->'people' is null and added->'phones' is null and added->'emails' is null
                      and added->'tags' is null and added->'fields' is null and added->'people_replaced' is null),
    'jobs_added', (select coalesce(jsonb_object_agg(k, n), '{}') from (select k, count(*) n from jobs group by k) z),
    'jobs_filled', (select coalesce(jsonb_object_agg(k, n), '{}') from (select k, count(*) n from filled group by k) z),
    'phones_added', (select coalesce(sum(jsonb_array_length(added->'phones')), 0) from ch where added ? 'phones'),
    'people_added', (select coalesce(sum(jsonb_array_length(added->'people')), 0) from ch where added ? 'people'),
    'routes_set', (select count(*) from ch where added->'fields' ? 'route_code'),
    'examples', (select coalesce(jsonb_agg(x), '[]') from (
                   select jsonb_build_object('address', concat_ws(' ', c.house_no, c.street_name), 'city', c.city,
                            'added', ch.added->'history', 'filled', ch.added->'replaced') x
                     from ch join clients c on c.id = ch.client_id
                    where ch.action = 'merge' and (jsonb_array_length(coalesce(ch.added->'history', '[]')) > 0 or ch.added ? 'replaced')
                    order by ch.id limit 8) e)
  )
$$;
revoke all on function public.client_import_preview_stats(uuid) from public, anon, authenticated;

create or replace function public.app_client_import_preview(p_import uuid, p_from integer, p_count integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_out jsonb; r record;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  if not exists (select 1 from client_imports where id = p_import and status = 'staged') then raise exception 'This import can''t be previewed now'; end if;
  if p_count > 600 then raise exception 'At most 600 rows per preview call'; end if;
  begin
    for r in select row from client_import_rows where import_id = p_import and seq > p_from and seq <= p_from + p_count order by seq loop
      perform client_import_apply_row(p_import, r.row);
    end loop;
    v_out := client_import_preview_stats(p_import);
    raise exception 'cps_preview_done';           -- rolls back everything since the inner begin
  exception when raise_exception then
    if sqlerrm <> 'cps_preview_done' then raise; end if;
  end;
  return v_out;
end $$;

-- Save the next held rows. The first call starts the save; call again until nothing remains.
create or replace function public.app_client_import_apply(p_import uuid, p_count integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; r record; v text; v_inserted int := 0; v_merged int := 0; v_skipped int := 0;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  select status into v_status from client_imports where id = p_import for update;
  if v_status = 'staged' then update client_imports set status = 'running' where id = p_import;
  elsif v_status is distinct from 'running' then raise exception 'This import is not open'; end if;
  for r in select seq, row from client_import_rows where import_id = p_import and applied_at is null
            order by seq limit least(greatest(coalesce(p_count, 300), 1), 1000) loop
    v := client_import_apply_row(p_import, r.row);
    update client_import_rows set applied_at = now(), result = v where import_id = p_import and seq = r.seq;
    if v = 'inserted' then v_inserted := v_inserted + 1; elsif v = 'merged' then v_merged := v_merged + 1; else v_skipped := v_skipped + 1; end if;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'merged', v_merged, 'skipped', v_skipped,
    'remaining', (select count(*) from client_import_rows where import_id = p_import and applied_at is null));
end $$;

-- Every held row is saved: mark the import done, keep its layout as a recipe, refresh the maps.
create or replace function public.app_client_import_complete(p_import uuid, p_counts jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare i client_imports; v_recipe uuid; v_routes text[]; v_counts jsonb;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  select * into i from client_imports where id = p_import for update;
  if i.id is null or i.status <> 'running' then raise exception 'This import is not open'; end if;
  if exists (select 1 from client_import_rows where import_id = p_import and applied_at is null) then
    raise exception 'Not every row is saved yet';
  end if;
  if i.fingerprint is not null and i.mapping is not null then
    insert into client_import_recipes (fingerprint, name, headers, mapping, notes, created_by, times_used, last_used_at)
    values (i.fingerprint, coalesce(i.recipe_name, i.file_name), coalesce(i.headers, '{}'), i.mapping, i.notes, auth.uid(), 1, now())
    on conflict (fingerprint) do update
      set mapping = excluded.mapping, headers = excluded.headers,
          notes = coalesce(excluded.notes, client_import_recipes.notes),
          name = coalesce(i.recipe_name, client_import_recipes.name), active = true,
          times_used = client_import_recipes.times_used + 1, last_used_at = now()
    returning id into v_recipe;
  end if;
  select coalesce(i.counts, '{}') || coalesce(p_counts, '{}') || jsonb_build_object(
           'inserted', count(*) filter (where action = 'insert'), 'merged', count(*) filter (where action = 'merge'))
    into v_counts from client_import_changes where import_id = p_import;
  update client_imports set status = 'done', counts = v_counts, finished_at = now(), recipe_id = coalesce(v_recipe, recipe_id)
   where id = p_import;
  select array_agg(distinct rc) into v_routes from (
    select c.route_code as rc from client_import_changes ch join clients c on c.id = ch.client_id where ch.import_id = p_import
    union select ch.before->>'route_code' from client_import_changes ch where ch.import_id = p_import) x
   where rc is not null;
  perform client_refresh_map_pcl(v_routes);
  return v_counts;
end $$;

create or replace function public.app_client_import_cancel(p_import uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  update client_imports set status = 'cancelled', finished_at = now() where id = p_import and status = 'staged';
  if not found then raise exception 'Only an import that hasn''t started saving can be cancelled'; end if;
  delete from client_import_rows where import_id = p_import;
end $$;

-- ───────────── undo: take back exactly what the import added ─────────────
create or replace function public.client_json_remove_one(arr jsonb, x jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(e order by o), '[]') from jsonb_array_elements(arr) with ordinality t(e, o)
   where o is distinct from (select min(o2) from jsonb_array_elements(arr) with ordinality t2(e2, o2) where e2 = x)
$$;
create or replace function public.client_json_replace_one(arr jsonb, x jsonb, y jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(case when o = (select min(o2) from jsonb_array_elements(arr) with ordinality t2(e2, o2) where e2 = x) then y else e end order by o), '[]')
    from jsonb_array_elements(arr) with ordinality t(e, o)
$$;
-- a field goes back only if it still holds what the import put there
create or replace function public.client_field_back(cur jsonb, f jsonb)
returns jsonb language sql immutable set search_path = public as $$
  select case when f is null then cur
              when coalesce(cur, 'null'::jsonb) = coalesce(f->'now', 'null'::jsonb) then coalesce(f->'was', 'null'::jsonb)
              else cur end
$$;

create or replace function public.client_undo_change(p_change bigint, p_saved_until timestamptz)
returns text language plpgsql security definer set search_path = public as $$
declare ch client_import_changes; c clients; a jsonb; h jsonb; pp jsonb; x jsonb; f jsonb; v_key text;
begin
  select * into ch from client_import_changes where id = p_change;
  a := coalesce(ch.added, '{}');
  select * into c from clients where id = ch.client_id for update;
  if not found then return 'gone'; end if;
  h := c.history; pp := c.people;
  for x in select e from jsonb_array_elements(coalesce(a->'replaced', '[]')) with ordinality t(e, o) order by o desc loop
    h := client_json_replace_one(h, x->'now', x->'was');
  end loop;
  for x in select * from jsonb_array_elements(coalesce(a->'history', '[]')) loop h := client_json_remove_one(h, x); end loop;
  for x in select * from jsonb_array_elements(coalesce(a->'dropped', '[]')) loop
    if not exists (select 1 from jsonb_array_elements(h) e where e = x) then h := h || jsonb_build_array(x); end if;
  end loop;

  if ch.action = 'insert' then
    -- a customer this import created goes away, unless something else has been added to it since
    -- (another import, or an edit after the import was saved: a do-not-call, a note, a phone…)
    -- (an undo of a later import also touches the customer; that doesn't count as an edit)
    if jsonb_array_length(h) = 0
       and c.updated_at <= greatest(p_saved_until, (select max(i.undone_at) from client_import_changes o join client_imports i on i.id = o.import_id
                                                     where o.client_id = c.id and i.status = 'undone')) + interval '2 seconds'
       and not exists (
         select 1 from client_import_changes o join client_imports i on i.id = o.import_id
          where o.client_id = c.id and o.import_id <> ch.import_id and i.status in ('running', 'done')) then
      delete from clients where id = c.id;
      return 'removed';
    end if;
    update clients set history = h, updated_at = now() where id = c.id;
    return 'kept';
  end if;

  for x in select e from jsonb_array_elements(coalesce(a->'people_replaced', '[]')) with ordinality t(e, o) order by o desc loop
    pp := client_json_replace_one(pp, x->'now', x->'was');
  end loop;
  for x in select * from jsonb_array_elements(coalesce(a->'people', '[]')) loop pp := client_json_remove_one(pp, x); end loop;
  for x in select * from jsonb_array_elements(coalesce(a->'people_dropped', '[]')) loop
    if not exists (select 1 from jsonb_array_elements(pp) e where e = x) then pp := pp || jsonb_build_array(x); end if;
  end loop;
  f := coalesce(a->'fields', '{}');
  v_key := client_field_back(to_jsonb(c.address_key), f->'address_key') #>> '{}';
  if v_key is distinct from c.address_key and exists (select 1 from clients where address_key = v_key and id <> c.id) then v_key := c.address_key; end if;
  update clients set
    history = h, people = pp,
    phones = array(select u.val from unnest(c.phones) with ordinality u(val, o)
                    where not (u.val = any(coalesce(array(select jsonb_array_elements_text(a->'phones')), '{}'))) order by u.o),
    emails = array(select u.val from unnest(c.emails) with ordinality u(val, o)
                    where not (u.val = any(coalesce(array(select jsonb_array_elements_text(a->'emails')), '{}'))) order by u.o),
    tags = array(select u.val from unnest(c.tags) with ordinality u(val, o)
                    where not (u.val = any(coalesce(array(select jsonb_array_elements_text(a->'tags')), '{}'))) order by u.o),
    address_key = coalesce(v_key, c.address_key),
    city = client_field_back(to_jsonb(c.city), f->'city') #>> '{}',
    province = client_field_back(to_jsonb(c.province), f->'province') #>> '{}',
    postal_code = client_field_back(to_jsonb(c.postal_code), f->'postal_code') #>> '{}',
    lat = (client_field_back(to_jsonb(c.lat), f->'lat') #>> '{}')::float8,
    lng = (client_field_back(to_jsonb(c.lng), f->'lng') #>> '{}')::float8,
    route_code = client_field_back(to_jsonb(c.route_code), f->'route_code') #>> '{}',
    match_how = client_field_back(to_jsonb(c.match_how), f->'match_how') #>> '{}',
    notes = client_field_back(to_jsonb(c.notes), f->'notes') #>> '{}',
    call_first = client_field_back(to_jsonb(c.call_first), f->'call_first') #>> '{}',
    -- do-not-call and do-not-text are never switched back off by an undo
    updated_at = now()
  where id = c.id;
  return 'restored';
end $$;
revoke all on function public.client_undo_change(bigint, timestamptz) from public, anon, authenticated;

create or replace function public.app_client_import_undo(p_import uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; v_created timestamptz; v_finished timestamptz; v_later int; v_routes text[]; v_removed int := 0; v_restored int := 0;
        v_kept int := 0; v_legacy boolean; v_changed int; v_ch record; v text;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  select status, created_at, finished_at into v_status, v_created, v_finished from client_imports where id = p_import for update;
  if v_status is null then raise exception 'Unknown import'; end if;
  if v_status = 'undone' then raise exception 'This import was already undone'; end if;
  if v_status in ('staged', 'cancelled') then raise exception 'Nothing was saved from this import'; end if;

  select array_agg(distinct rc) into v_routes from (
    select c.route_code as rc from client_import_changes ch join clients c on c.id = ch.client_id where ch.import_id = p_import
    union select ch.before->>'route_code' from client_import_changes ch where ch.import_id = p_import) x
   where rc is not null;

  v_legacy := exists (select 1 from client_import_changes where import_id = p_import and added is null);
  if v_legacy then
    -- saved before imports recorded what they added: the old undo puts customers back exactly as
    -- they were, so it can only run when nothing has touched them since
    select count(distinct ch2.import_id) into v_later
      from client_import_changes ch join client_import_changes ch2 on ch2.client_id = ch.client_id and ch2.import_id <> ch.import_id
      join client_imports i2 on i2.id = ch2.import_id
     where ch.import_id = p_import and i2.status in ('running', 'done') and i2.created_at > v_created;
    if v_later > 0 then raise exception 'A later import changed some of the same clients. Undo the later import first.'; end if;
    select count(*) into v_changed from client_import_changes ch join clients c on c.id = ch.client_id
     where ch.import_id = p_import and c.updated_at > coalesce(v_finished, v_created + interval '30 minutes') + interval '2 seconds';
    if v_changed > 0 then
      raise exception '% of these customers were changed after this import (by hand, by a later import or by a repair). Undoing it would wipe those changes too, so it can''t be undone safely.', v_changed;
    end if;
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
  else
    -- a later import that filled in or merged what this one added has to be undone first
    select count(distinct ch2.import_id) into v_later
      from client_import_changes ch join client_import_changes ch2 on ch2.client_id = ch.client_id and ch2.import_id <> ch.import_id
      join client_imports i2 on i2.id = ch2.import_id
     where ch.import_id = p_import and i2.status in ('running', 'done') and ch2.id > ch.id
       and (ch.action = 'insert' or ch2.added is null
            or ch2.added ?| array['replaced', 'dropped', 'people_replaced', 'people_dropped', 'fields']);
    if v_later > 0 then raise exception 'A later import changed what this one added to some customers. Undo the later import first.'; end if;
    for v_ch in select id from client_import_changes where import_id = p_import order by id desc loop
      v := client_undo_change(v_ch.id, coalesce(v_finished, now()));
      if v = 'removed' then v_removed := v_removed + 1; elsif v = 'restored' then v_restored := v_restored + 1; elsif v = 'kept' then v_kept := v_kept + 1; end if;
    end loop;
  end if;

  update client_imports set status = 'undone', undone_at = now(), undone_by = auth.uid() where id = p_import;
  update client_import_rows set applied_at = null, result = null, source = null where import_id = p_import;
  perform client_refresh_map_pcl(v_routes);
  return jsonb_build_object('removed', v_removed, 'restored', v_restored, 'kept', v_kept);
end $$;

-- ───────────── The Benny's lessons ─────────────
create table if not exists public.benny_lessons (
  id uuid primary key default gen_random_uuid(),
  text text not null check (length(text) between 3 and 400),
  fingerprint text,                 -- null: every list; else only lists with this layout
  layout_name text,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.benny_lessons enable row level security;
revoke all on public.benny_lessons from anon, authenticated;

-- The lessons that apply to a file (every-list ones and this layout's), oldest first.
create or replace function public.app_benny_lessons(p_fingerprint text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'text', text, 'layout', layout_name) order by created_at), '[]')
            from (select * from benny_lessons where active and (fingerprint is null or fingerprint = p_fingerprint)
                   order by created_at limit 80) l);
end $$;

create or replace function public.app_benny_lessons_all()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(l) order by l.active desc, l.created_at desc), '[]') from benny_lessons l);
end $$;

create or replace function public.app_benny_lesson_save(p_id uuid, p_text text, p_fingerprint text, p_layout_name text, p_active boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  if p_text is not null and looks_like_card_or_sin(p_text) then raise exception 'A lesson can''t hold a card number or SIN'; end if;
  if p_id is null then
    insert into benny_lessons (text, fingerprint, layout_name, active, created_by)
    values (trim(p_text), nullif(p_fingerprint, ''), nullif(trim(p_layout_name), ''), coalesce(p_active, true), auth.uid())
    returning id into v_id;
  else
    update benny_lessons set text = coalesce(nullif(trim(p_text), ''), text), active = coalesce(p_active, active), updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Unknown lesson'; end if;
  end if;
  return v_id;
end $$;

-- ───────────── data health ─────────────
create table if not exists public.client_integrity_reports (
  id bigint generated always as identity primary key,
  requested_at timestamptz not null default now(),
  ran_at timestamptz,                -- null while a check asked for from the app is waiting its turn
  report jsonb
);
alter table public.client_integrity_reports enable row level security;
revoke all on public.client_integrity_reports from anon, authenticated;

create or replace function public.client_integrity_check()
returns jsonb language sql stable security definer set search_path = public as $$
  with e as (select c.id, c.house_no, c.street_name, c.city, c.route_code, h, o
               from clients c, jsonb_array_elements(c.history) with ordinality t(h, o)),
  bad as (select e.*, client_job_problem(h) why from e where client_job_problem(h) is not null),
  dup as (select a.id, a.house_no, a.street_name, a.city, a.h, b.h h2 from e a join e b on a.id = b.id and a.o < b.o and crm_same_job(a.h, b.h)),
  -- each customer's jobs, and what the map lists show, as house|street|year|price|date
  ct as (select c.route_code r, h->>'line' line, lower(c.house_no) hn, c.street_norm sn, coalesce(h->>'year', '0') y,
                round(nullif(regexp_replace(coalesce(h->>'price', ''), '[^0-9.]', '', 'g'), '')::numeric, 2) p, coalesce(h->>'date', '') d
           from clients c, jsonb_array_elements(c.history) h where c.route_code is not null),
  mt as (select m.route_code r, 'sealing' line, lower(x->>'houseNum') hn, norm_street(x->>'streetName') sn, x->>'src' = 'crm' crm,
                coalesce(h->>'year', '0') y, round(nullif(regexp_replace(coalesce(h->>'price', ''), '[^0-9.]', '', 'g'), '')::numeric, 2) p, coalesce(h->>'date', '') d
           from map_pcl_cache m, jsonb_array_elements(m.clients) x, jsonb_array_elements(coalesce(x->'history', '[]')) h
         union all
         select s.route_code, s.service, lower(x->>'houseNum'), norm_street(x->>'streetName'), true,
                coalesce(h->>'year', '0'), round(nullif(regexp_replace(coalesce(h->>'price', ''), '[^0-9.]', '', 'g'), '')::numeric, 2), coalesce(h->>'date', '')
           from map_pcl_by_service s, jsonb_array_elements(s.clients) x, jsonb_array_elements(coalesce(x->'history', '[]')) h),
  bt as (select b.route_code r, lower(x->>'houseNum') hn, norm_street(x->>'streetName') sn, coalesce(h->>'year', '0') y,
                round(nullif(regexp_replace(coalesce(h->>'price', ''), '[^0-9.]', '', 'g'), '')::numeric, 2) p
           from map_pcl_cache_base b, jsonb_array_elements(b.clients) x, jsonb_array_elements(coalesce(x->'history', '[]')) h),
  behind as (
    select distinct r, line from ct where line in ('sealing', 'aeration', 'lawn_rejuv', 'cleaning') and not exists (
      select 1 from mt where mt.r = ct.r and mt.line = ct.line and mt.hn = ct.hn and mt.sn = ct.sn and mt.y = ct.y
                         and mt.p is not distinct from ct.p and (mt.d = ct.d or mt.d = ''))
    union
    select distinct r, line from mt where crm and not exists (
      select 1 from ct where ct.r = mt.r and ct.line = mt.line and ct.hn = mt.hn and ct.sn = mt.sn and ct.y = mt.y
                         and ct.p is not distinct from mt.p and (ct.d = mt.d or mt.d = ''))
      and not exists (select 1 from bt where bt.r = mt.r and bt.hn = mt.hn and bt.sn = mt.sn and bt.y = mt.y and bt.p is not distinct from mt.p))
  select jsonb_build_object(
    'clients', (select count(*) from clients),
    'jobs', (select count(*) from e),
    'bad_jobs', jsonb_build_object('count', (select count(*) from bad), 'examples', (select coalesce(jsonb_agg(x), '[]') from (
        select jsonb_build_object('id', id, 'address', concat_ws(' ', house_no, street_name), 'city', city, 'job', h, 'why', why) x from bad limit 25) z)),
    'duplicate_jobs', jsonb_build_object('count', (select count(*) from dup), 'examples', (select coalesce(jsonb_agg(x), '[]') from (
        select jsonb_build_object('id', id, 'address', concat_ws(' ', house_no, street_name), 'city', city, 'job', h, 'same_as', h2) x from dup limit 25) z)),
    'routes_behind', jsonb_build_object('count', (select count(distinct r) from behind),
        'routes', (select coalesce(jsonb_agg(distinct r), '[]') from behind),
        'by_service', (select coalesce(jsonb_object_agg(line, n), '{}') from (select line, count(*) n from behind group by line) z))
  )
$$;
revoke all on function public.client_integrity_check() from public, anon, authenticated;

create or replace function public.client_integrity_run()
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into client_integrity_reports (ran_at, report) values (now(), client_integrity_check()) returning id into v_id;
  delete from client_integrity_reports where requested_at < now() - interval '120 days';
  -- the every-minute job's run log stays a week
  begin
    execute 'delete from cron.job_run_details where end_time < now() - interval ''7 days''';
  exception when others then null;
  end;
  return v_id;
end $$;
revoke all on function public.client_integrity_run() from public, anon, authenticated;

-- A check asked for from the app runs here, within a minute (it takes longer than the app may
-- wait for one request).
create or replace function public.client_integrity_run_requested()
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from client_integrity_reports where ran_at is null) then
    update client_integrity_reports set ran_at = now(), report = client_integrity_check() where ran_at is null;
  end if;
end $$;
revoke all on function public.client_integrity_run_requested() from public, anon, authenticated;

create or replace function public.client_integrity_latest()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ran_at', (select ran_at from client_integrity_reports where ran_at is not null order by ran_at desc limit 1),
    'report', (select report from client_integrity_reports where ran_at is not null order by ran_at desc limit 1),
    'pending_since', (select min(requested_at) from client_integrity_reports where ran_at is null))
$$;
revoke all on function public.client_integrity_latest() from public, anon, authenticated;

create or replace function public.app_client_integrity_latest()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  return client_integrity_latest();
end $$;

create or replace function public.app_client_integrity_run_now()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  if not exists (select 1 from client_integrity_reports where ran_at is null) then
    insert into client_integrity_reports (requested_at) values (now());
  end if;
  return client_integrity_latest();
end $$;

-- Rebuild the past-client map lists of some routes (Data health › Rebuild), 40 at a time.
create or replace function public.app_client_refresh_routes(p_routes text[])
returns integer language plpgsql security definer set search_path = public as $$
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  if coalesce(array_length(p_routes, 1), 0) > 40 then raise exception 'At most 40 routes per call'; end if;
  perform client_refresh_map_pcl(p_routes);
  return coalesce(array_length(p_routes, 1), 0);
end $$;

-- the app's functions: signed-in people only (each checks the Territory permission itself)
do $$
declare f text;
begin
  foreach f in array array[
    'app_client_import_open(text, text, text, text, text, text[], jsonb, text, text, jsonb, jsonb, jsonb)',
    'app_client_import_same_file(text)', 'app_client_import_stage(uuid, jsonb)', 'app_client_import_preview(uuid, integer, integer)',
    'app_client_import_apply(uuid, integer)', 'app_client_import_complete(uuid, jsonb)', 'app_client_import_cancel(uuid)',
    'app_client_import_undo(uuid)', 'app_benny_lessons(text)', 'app_benny_lessons_all()',
    'app_benny_lesson_save(uuid, text, text, text, boolean)', 'app_client_integrity_latest()', 'app_client_integrity_run_now()',
    'app_client_refresh_routes(text[])'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
-- the old one-step import (begin → add → finish) skipped the checks and the preview: the app no
-- longer uses it, so nobody can call it
revoke all on function public.app_client_import_begin(text, text, text, text, text, text[], jsonb, text) from public, anon, authenticated;
revoke all on function public.app_client_import_add(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.app_client_import_finish(uuid, jsonb) from public, anon, authenticated;

-- ───────────── nightly data health at 7:15 UTC (3:15 a.m. Toronto in summer, 2:15 in winter) ─────────────
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
select cron.schedule('client-data-health', '15 7 * * *', $$select public.client_integrity_run()$$);
select cron.schedule('client-data-health-asked', '* * * * *', $$select public.client_integrity_run_requested()$$);
-- the first check runs within a minute
insert into public.client_integrity_reports (requested_at) values (now());
