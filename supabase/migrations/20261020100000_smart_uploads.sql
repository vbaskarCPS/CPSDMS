-- RUN_18 — smarter uploads. ADDITIVE ONLY (replaces one function, adds one).
--
-- A client list can now carry this season's jobs (the Master Bookings Logsheets tab: Client Type,
-- Property Type, price, payment, contractor, and a date when the list has one). When such a job is
-- already on the customer — the app wrote it when its day closed — uploading it again doesn't add a
-- second copy: the saved job keeps its details and only takes what it was missing (a contractor's
-- name, a payment type…) from the upload.
--
--   crm_same_job(a, b)      two history entries are the same job: same year and service line, the
--                           same price to the cent, and the same size code and day when both say.
--   app_client_import_add   as before (people keep their own phones, phones keep their order), and
--                           merges a job it already has instead of adding it again.

create or replace function public.crm_same_job(a jsonb, b jsonb)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(a->>'year', '') = coalesce(b->>'year', '') and coalesce(a->>'year', '') <> ''
     and (coalesce(a->>'line', '') = coalesce(b->>'line', '') or coalesce(a->>'line', '') = '' or coalesce(b->>'line', '') = '')
     and nullif(regexp_replace(coalesce(a->>'price', ''), '[^0-9.]', '', 'g'), '') is not null
     and abs(nullif(regexp_replace(coalesce(a->>'price', ''), '[^0-9.]', '', 'g'), '')::numeric
           - coalesce(nullif(regexp_replace(coalesce(b->>'price', ''), '[^0-9.]', '', 'g'), '')::numeric, -1)) < 0.01
     and (lower(coalesce(a->>'service', '')) = lower(coalesce(b->>'service', '')) or coalesce(a->>'service', '') = '' or coalesce(b->>'service', '') = '')
     and (coalesce(a->>'date', '') = coalesce(b->>'date', '') or coalesce(a->>'date', '') = '' or coalesce(b->>'date', '') = '')
$$;

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
              -- in the order they came (the first is the first person's), not sorted
              coalesce((select array_agg(x order by o) from (
                          select x, min(o) o from jsonb_array_elements_text(coalesce(r->'phones', '[]')) with ordinality u(x, o)
                           where x <> '' group by x) z), '{}'),
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
        -- a job already on the customer (e.g. written by the app when its day closed) isn't added
        -- again: the uploaded copy only fills in what the saved one is missing
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
      where c.id = v_id;
      v_merged := v_merged + 1;
    end if;
  end loop;
  return jsonb_build_object('inserted', v_inserted, 'merged', v_merged, 'skipped', v_skipped);
end $$;
revoke all on function public.app_client_import_add(uuid, jsonb) from public, anon;
grant execute on function public.app_client_import_add(uuid, jsonb) to authenticated;
