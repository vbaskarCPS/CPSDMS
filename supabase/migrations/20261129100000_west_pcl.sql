-- RUN_68 — West past clients (PCL): one lime-green lawn list, the call book and 2026 logsheets.
--
-- ADDITIVE ONLY.
--   clients.sheet_route      the route code the list gave. A West customer whose area has no built
--                            map yet is saved with no route (match_how 'waiting') and this code, so
--                            the waiting ones can be counted by area.
--   client_import_apply_row  unchanged except that it keeps sheet_route (and a 'waiting' mark).
--   app_place_points         where points land on the built maps, by location only (the West
--                            import uses this instead of matching by street or route code, which
--                            can reach across provinces: NEW13 is New Westminster and Newmarket).
--   mb_lines_added           when new route lines are drawn, waiting customers near them are placed
--                            too (as waiting bookings already are), and those routes' past-client
--                            lists are rebuilt.
--   mb_client_flags          a job carries its season (part: spring / summer / fall). A job from an
--                            earlier season of this year counts as a past client, not "this season".
--   app_clients_waiting      waiting customers by the list's route prefix.

alter table public.clients add column if not exists sheet_route text;
create index if not exists clients_waiting on public.clients (sheet_route) where route_code is null and match_how = 'waiting';

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
                         do_not_call, do_not_text, sheet_route)
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
            coalesce((r->>'do_not_call')::boolean, false), coalesce((r->>'do_not_text')::boolean, false),
            nullif(upper(trim(r->>'sheet_route')), ''))
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
    match_how = case when c.route_code is null then coalesce(nullif(r->>'match_how', ''), c.match_how) else c.match_how end,
    sheet_route = coalesce(c.sheet_route, nullif(upper(trim(r->>'sheet_route')), '')),
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

-- in: [{i, lat, lng, street, house_no}]   out: [{i, route_code, area_name, how}]
create or replace function public.app_place_points(p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_out jsonb := '[]'; v_route text; v_area text; v_how text;
begin
  if not (coalesce(app_has_perm('sa_territory'), false) or coalesce(app_is_super_admin(), false)) then raise exception 'Not allowed'; end if;
  if jsonb_array_length(p_items) > 1000 then raise exception 'At most 1,000 points per call'; end if;
  for r in select * from jsonb_array_elements(p_items) loop
    v_route := null; v_area := null; v_how := null;
    if (r->>'lat') is not null and (r->>'lng') is not null then
      select m.route_code, m.area_name, m.how into v_route, v_area, v_how
        from mb_route_at((r->>'lat')::float8, (r->>'lng')::float8, coalesce(norm_street(r->>'street'), lower(trim(r->>'street'))), r->>'house_no') m;
    end if;
    v_out := v_out || jsonb_build_object('i', r->'i', 'route_code', v_route, 'area_name', v_area, 'how', v_how);
  end loop;
  return v_out;
end $$;
revoke all on function public.app_place_points(jsonb) from public, anon;
grant execute on function public.app_place_points(jsonb) to authenticated;

-- New route lines: waiting bookings and waiting customers near them are placed again.
create or replace function public.mb_lines_added()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare v_ids uuid[]; v_routes text[];
begin
  select array_agg(distinct b.id) into v_ids
    from mb_bookings b
   where b.map_state = 'waiting' and b.lat is not null
     and exists (select 1 from new_lines l
                  where ST_DWithin(l.line, ST_SetSRID(ST_MakePoint(b.lng, b.lat), 4326)::geography, 400));
  if v_ids is not null then perform mb_place(v_ids); end if;

  with c as (
    select c.id, p.route_code
      from clients c
      cross join lateral mb_route_at(c.lat, c.lng, c.street_norm, c.house_no) p
     where c.route_code is null and c.match_how = 'waiting' and c.lat is not null
       and exists (select 1 from new_lines l
                    where ST_DWithin(l.line, ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326)::geography, 400))
  ), u as (
    update clients x set route_code = c.route_code, match_how = 'map', updated_at = now()
      from c where x.id = c.id and c.route_code is not null
    returning x.route_code
  )
  select array_agg(distinct route_code) into v_routes from u;
  if v_routes is not null then perform client_refresh_map_pcl(v_routes); end if;
  return null;
end $$;
revoke all on function public.mb_lines_added() from public, anon, authenticated;

-- the part of the year it is now (BC time): Jan–May spring, Jun–Jul summer, Aug–Dec fall
create or replace function public.mb_current_part()
returns text language sql stable set search_path = public as $$
  select case when extract(month from now() at time zone 'America/Vancouver') <= 5 then 'spring'
              when extract(month from now() at time zone 'America/Vancouver') <= 7 then 'summer' else 'fall' end
$$;

-- a past client's job flags for a season: 1 aeration before, 2 sealing before, 4 aeration this
-- season, 8 sealing this season, 16 rejuvenation before, 32 rejuvenation this season. A job from an
-- earlier part of the season's year (spring 2026 seen in fall 2026) counts as before.
create or replace function public.mb_client_flags(p_history jsonb, p_season int)
returns int language sql stable set search_path = public as $$
  select coalesce(bit_or(case
           when x.line = 'aeration' and x.b then 1
           when x.line = 'sealing' and x.b then 2
           when x.line = 'aeration' and x.n then 4
           when x.line = 'sealing' and x.n then 8
           when x.line = 'lawn_rejuv' and x.b then 16
           when x.line = 'lawn_rejuv' and x.n then 32
           else 0 end), 0)
    from (select h->>'line' as line,
                 (h->>'year')::int < p_season
                   or ((h->>'year')::int = p_season and coalesce(array_position(array['spring', 'summer', 'fall'], h->>'part'), 99)
                                                        < array_position(array['spring', 'summer', 'fall'], k.cur)) as b,
                 (h->>'year')::int = p_season and coalesce(array_position(array['spring', 'summer', 'fall'], h->>'part'), 99)
                                                  >= array_position(array['spring', 'summer', 'fall'], k.cur) as n
            from jsonb_array_elements(case when jsonb_typeof(p_history) = 'array' then p_history else '[]'::jsonb end) h,
                 (select mb_current_part() as cur) k
           where h->>'year' ~ '^\d{4}$') x
$$;

-- waiting customers (no built map yet) by the list's route prefix
create or replace function public.app_clients_waiting()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not crm_can_read() then raise exception 'Not allowed'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('prefix', prefix, 'n', n, 'cities', cities) order by n desc, prefix)
      from (select coalesce(substring(sheet_route from '^[A-Z]+'), '—') prefix, count(*)::int n,
                   to_jsonb(array_remove(array_agg(distinct city), null)) cities
              from clients where route_code is null and match_how = 'waiting'
             group by 1) x), '[]'::jsonb);
end $$;
revoke all on function public.app_clients_waiting() from public, anon;
grant execute on function public.app_clients_waiting() to authenticated;
