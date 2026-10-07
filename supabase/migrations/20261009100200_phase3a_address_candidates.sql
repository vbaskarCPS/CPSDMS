-- Phase 3a (part 3) · help The Benny place addresses that couldn't be found (spelling mistakes).
--
-- ADDITIVE ONLY.
--   pg_trgm                       fuzzy text matching (in the extensions schema)
--   route_street_lines trigram    index so "Baronwod Drv" finds "baronwood dr" quickly
--   app_client_street_candidates  for each unplaced address, the real street names it most
--                                 likely meant: first from the same map areas as the rest of
--                                 the list, then from every route
-- The Benny picks among these candidates (it never invents a street), and the corrected
-- address is matched to its route the normal way before it is used.

create extension if not exists pg_trgm with schema extensions;
create index if not exists route_street_lines_street_trgm on public.route_street_lines using gin (street_norm extensions.gin_trgm_ops);

-- in:  p_items [{i, house_no, street, city}], p_routes = routes already matched in this list
-- out: [{i, street_norm, candidates: [{street, near, score}]}]
create or replace function public.app_client_street_candidates(p_items jsonb, p_routes text[])
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare r jsonb; v_out jsonb := '[]'; v_norm text; v_near text[]; v_c jsonb;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  if jsonb_array_length(p_items) > 300 then raise exception 'At most 300 addresses per call'; end if;
  -- every street in the map areas this list's other addresses fell in
  select coalesce(array_agg(distinct l.street_norm), '{}') into v_near
    from route_maps rm
    join route_maps rm2 on rm2.area_name = rm.area_name and rm2.status = 'approved'
    join route_street_lines l on l.route_code = rm2.route_code
   where rm.route_code = any(coalesce(p_routes, '{}')) and rm.status = 'approved' and l.street_norm is not null;

  for r in select * from jsonb_array_elements(p_items) loop
    v_norm := coalesce(norm_street(r->>'street'), lower(trim(r->>'street')));
    if v_norm is null or v_norm = '' then
      v_out := v_out || jsonb_build_object('i', r->'i', 'street_norm', v_norm, 'candidates', '[]'::jsonb);
      continue;
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('street', c.street, 'near', c.near, 'score', round(c.sim::numeric, 2))
                              order by c.near desc, c.sim desc), '[]')
      into v_c
      from (
        select distinct on (street) street, near, sim from (
          (select s as street, true as near, similarity(s, v_norm) as sim
             from unnest(v_near) s where similarity(s, v_norm) >= 0.2
            order by 3 desc limit 6)
          union all
          (select l.street_norm, l.street_norm = any(v_near), similarity(l.street_norm, v_norm)
             from route_street_lines l where l.street_norm % v_norm
            group by l.street_norm order by 3 desc limit 6)
        ) u order by street, near desc
      ) c;
    v_c := (select coalesce(jsonb_agg(e), '[]') from (select e from jsonb_array_elements(v_c) e limit 8) x);
    v_out := v_out || jsonb_build_object('i', r->'i', 'street_norm', v_norm, 'candidates', v_c);
  end loop;
  return v_out;
end $$;
revoke all on function public.app_client_street_candidates(jsonb, text[]) from public, anon;
grant execute on function public.app_client_street_candidates(jsonb, text[]) to authenticated;
