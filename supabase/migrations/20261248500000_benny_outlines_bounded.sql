-- (1) The Benny's map reads the master-map outlines it needs from the kept copy (no rebuild, no Territory permission
--     needed, so route managers get them too).
-- (2) app_territory_outlines rebuilt every changed outline in one request; after a day of map changes (127 maps,
--     ~0.3 s each) that passed the 8 s request limit and failed every time. It now rebuilds at most 12 per request,
--     oldest first, and returns the kept copy for the rest, so each request makes progress and none can time out.
-- Additive only.

create or replace function public.benny_outlines(p_center uuid, p_maps text[])
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform benny_ok_any(p_center);
  return (select coalesce(jsonb_object_agg(o.area_name, o.outline), '{}'::jsonb)
            from map_area_outlines o where o.area_name = any (coalesce(p_maps, '{}')) and o.outline is not null);
end $$;
revoke all on function public.benny_outlines(uuid, text[]) from public, anon;
grant execute on function public.benny_outlines(uuid, text[]) to authenticated;

do $$ declare src text; nsrc text; begin
  select pg_get_functiondef('public.app_territory_outlines()'::regprocedure) into src;
  nsrc := replace(src,
    $a$  select a.area_name, map_area_outline(a.area_name), now()
    from (select rm.area_name,$a$,
    $b$  select s.area_name, map_area_outline(s.area_name), now() from (select a.area_name
    from (select rm.area_name,$b$);
  if nsrc = src then raise exception 'app_territory_outlines: select line not found'; end if;
  src := nsrc;
  nsrc := replace(src,
    $a$   where o.area_name is null or o.made_at is null or a.changed > o.made_at
  on conflict$a$,
    $b$   where o.area_name is null or o.made_at is null or a.changed > o.made_at
   order by o.made_at nulls first, a.area_name limit 12) s   -- a few per request: never past the request time limit
  on conflict$b$);
  if nsrc = src then raise exception 'app_territory_outlines: where line not found'; end if;
  execute nsrc;
end $$;
