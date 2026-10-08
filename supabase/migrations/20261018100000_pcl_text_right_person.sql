-- RUN_16 — PCL texts go to the right person.
--
-- The problem: a client with two or more people on it (spouses, old and new owners, a stray
-- callbook row) kept the names in order but SORTED the phone numbers, so which phone belonged
-- to which name was lost. The map's PCL list (and so PCL Outreach) paired the first name with
-- whichever number sorted first: "Hi Evelyn… 588 Wilene" went to a neighbour's phone.
--
-- The fix (additive, no data removed):
--   1. client_contact(): the name and phone for a client's text come from the SAME person —
--      a person saved with their own phone. When several people are on file and we can't tell
--      whose the phone is, nameUnsure is set and the text greets "there".
--   2. client_pcl_entries() uses it.
--   3. app_client_import_add() keeps phones in the order they came (no more sorting) and keeps
--      each person's own phone when a client is merged.
--   4. The map lists of every route with a multi-person client are rebuilt, so their texts
--      greet "there" from now on. Re-uploading a client list afterwards puts each person's own
--      phone back on them (the merge now pairs them), and the names come back.

-- 1 ────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.client_contact(p_people jsonb, p_phones text[])
returns table (first text, last text, phone text, unsure boolean)
language sql immutable set search_path = public as $$
  with ppl as (
    select p, o from jsonb_array_elements(case when jsonb_typeof(p_people) = 'array' then p_people else '[]' end) with ordinality t(p, o)
  ), own as (
    select p, o from ppl where nullif(trim(p->>'phone'), '') is not null order by o limit 1
  )
  select coalesce(x.p->>'first', ''), coalesce(x.p->>'last', ''), x.phone, x.unsure
    from (
      select own.p, trim(own.p->>'phone') as phone, false as unsure from own
      union all
      select (select p from ppl order by o limit 1), p_phones[1],
             (select count(*) from ppl) > 1 and coalesce(cardinality(p_phones), 0) > 0
       where not exists (select 1 from own)
    ) x
$$;
revoke all on function public.client_contact(jsonb, text[]) from public, anon, authenticated;

-- 2 ────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.client_pcl_entries(p_route text, p_line text)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'firstName', k.first,
           'lastName', k.last,
           'nameUnsure', case when k.unsure then true end,
           'houseNum', c.house_no,
           'streetName', c.street_name,
           'phone', coalesce(k.phone, ''),
           'city', c.city, 'lat', c.lat, 'lng', c.lng,
           'history', (select coalesce(jsonb_agg(jsonb_build_object(
                          'year', coalesce((h->>'year')::int, 0),
                          'price', coalesce(case when (h->>'price') ~ '^\d+(\.\d+)?$' then '$' || to_char((h->>'price')::numeric, 'FM999990.00') else h->>'price' end, ''),
                          'serviceType', coalesce(h->>'service', ''),
                          'contractor', coalesce(h->>'contractor', ''))
                        order by coalesce((h->>'year')::int, 0) desc), '[]')
                       from jsonb_array_elements(c.history) h where h->>'line' = p_line),
           'src', 'crm', 'cid', c.id)) order by c.street_norm, c.house_no), '[]')
    from clients c
    cross join lateral client_contact(c.people, c.phones) k
   where c.route_code = p_route and p_line = any(c.services)
$$;
revoke all on function public.client_pcl_entries(text, text) from public, anon, authenticated;

-- 3 ────────────────────────────────────────────────────────────────────────────────────────
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

-- 4 ── rebuild the map lists of every route with a multi-person client ──
select client_refresh_map_pcl(array_agg(distinct route_code))
  from clients where jsonb_array_length(people) > 1 and route_code is not null;
