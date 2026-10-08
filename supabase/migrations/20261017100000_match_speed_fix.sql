-- Fix: matching a client list timed out (RUN_12's street-name index). ADDITIVE ONLY for data:
-- one index is replaced by an equivalent one; no rows change.
--
-- RUN_12 added a trigram index on route_street_lines.street_norm so The Benny could find the nearest
-- street names fast. Postgres then started using that index for every plain "this exact street"
-- lookup too, where it is about 100 times slower than the normal index (≈150 ms instead of ≈1 ms).
-- Matching a client list does several of those per address, so a batch of 400 addresses ran past
-- the 8-second limit and the import stopped at "Matching addresses to routes…".
--
-- The trigram index now covers lower(street_norm) (street names are already lower case, so it finds
-- the same names), which exact-street lookups don't use; they go back to the normal index.
--   route_street_lines_name_knn      the new nearest-name index (on lower(street_norm))
--   app_client_street_candidates      same inputs and output; asks the new index
--   route_street_lines_street_knn     removed (replaced by the one above)

create index if not exists route_street_lines_name_knn on public.route_street_lines using gist (lower(street_norm) extensions.gist_trgm_ops);

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
          select l.street_norm street, l.route_code = any(v_near) near, similarity(lower(l.street_norm), v_norm) sim
            from route_street_lines l
           where l.street_norm is not null
           order by lower(l.street_norm) <-> v_norm
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

drop index if exists public.route_street_lines_street_knn;
analyze public.route_street_lines;
