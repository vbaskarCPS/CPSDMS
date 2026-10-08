-- Speed: The Benny finding misspelled streets, and Clients with 46,000 records. ADDITIVE ONLY.
--
-- app_client_street_candidates compared every unplaced address with every street in the list's map
-- areas one by one (25,000 streets × 300 addresses per call), so a big list ran past the 8-second
-- limit on a request and The Benny gave up ("canceling statement due to statement timeout").
-- Now each address asks a trigram index for its 30 nearest street names directly (a few ms each),
-- and the app sends 50 addresses per request instead of 300:
--   route_street_lines_street_knn   nearest-name index on the street names
--   app_client_street_candidates     same inputs and output; names in the list's own areas still come
--                                    first unless a much closer name is elsewhere

create index if not exists route_street_lines_street_knn on public.route_street_lines using gist (street_norm extensions.gist_trgm_ops);

-- in:  p_items [{i, house_no, street, city}], p_routes = routes already matched in this list
-- out: [{i, street_norm, candidates: [{street, near, score}]}]
create or replace function public.app_client_street_candidates(p_items jsonb, p_routes text[])
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare r jsonb; v_out jsonb := '[]'; v_norm text; v_near text[]; v_c jsonb;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  if jsonb_array_length(p_items) > 300 then raise exception 'At most 300 addresses per call'; end if;
  -- every route in the map areas this list's other addresses fell in
  select coalesce(array_agg(distinct rm2.route_code), '{}') into v_near
    from route_maps rm
    join route_maps rm2 on rm2.area_name = rm.area_name and rm2.status = 'approved'
   where rm.route_code = any(coalesce(p_routes, '{}')) and rm.status = 'approved';

  for r in select * from jsonb_array_elements(p_items) loop
    v_norm := coalesce(norm_street(r->>'street'), lower(trim(r->>'street')));
    if v_norm is null or v_norm = '' then
      v_out := v_out || jsonb_build_object('i', r->'i', 'street_norm', v_norm, 'candidates', '[]'::jsonb);
      continue;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('street', c.street, 'near', c.near, 'score', round(c.sim::numeric, 2))
                              order by c.sim + case when c.near then 0.1 else 0 end desc), '[]')
      into v_c
      from (
        select u.street, bool_or(u.near) near, max(u.sim) sim from (
          -- the closest street names anywhere on the maps, nearest first (index), marked when
          -- they're in the list's own map areas
          select l.street_norm street, l.route_code = any(v_near) near, similarity(l.street_norm, v_norm) sim
            from route_street_lines l
           where l.street_norm is not null
           order by l.street_norm <-> v_norm
           limit 30
        ) u
        where u.sim >= 0.2
        group by u.street
        order by max(u.sim) + case when bool_or(u.near) then 0.1 else 0 end desc   -- the list's own areas first, unless a much closer name is elsewhere
        limit 8
      ) c;
    v_out := v_out || jsonb_build_object('i', r->'i', 'street_norm', v_norm, 'candidates', v_c);
  end loop;
  return v_out;
end $$;
revoke all on function public.app_client_street_candidates(jsonb, text[]) from public, anon;
grant execute on function public.app_client_street_candidates(jsonb, text[]) to authenticated;

-- ───────────── Clients: fast with 46,000 records ─────────────
-- The read rule asked "may this person see clients?" once per row (46,000 times per page, and per
-- count), so Clients only loaded some of the time. Asked once per query now (same rule).
drop policy if exists clients_read on public.clients;
create policy clients_read on public.clients for select to authenticated
  using ((select app_has_perm('sa_territory')) or (select app_has_perm('dialer')));

-- city › route map › route counts read small indexes instead of every whole record
create index if not exists clients_route_city on public.clients (route_code, city) include (services);
create index if not exists route_maps_approved_area on public.route_maps (route_code, area_name) where status = 'approved';
-- search by address, name or phone without reading every record
create index if not exists clients_search_trgm on public.clients using gin (search_text extensions.gin_trgm_ops);
analyze public.clients;
