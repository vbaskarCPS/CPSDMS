-- Finishing a client import refreshes the map lists (PCL) of every route it touched. A big file
-- touches hundreds of routes, and doing them all in the finishing call ran past the API's time
-- limit (the import was saved, but it stayed "running" and the maps weren't refreshed).
-- Now finishing only marks the import done and keeps the routes to refresh; the app then refreshes
-- them a few at a time with app_client_import_refresh until none are left.

alter table public.client_imports add column if not exists refresh_routes text[];

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
  select array_agg(distinct rc order by rc) into v_routes from (
    select c.route_code as rc from client_import_changes ch join clients c on c.id = ch.client_id where ch.import_id = p_import
    union select ch.before->>'route_code' from client_import_changes ch where ch.import_id = p_import) x
   where rc is not null;
  update client_imports set status = 'done', counts = v_counts, finished_at = now(), recipe_id = coalesce(v_recipe, recipe_id),
         refresh_routes = coalesce(v_routes, '{}')
   where id = p_import;
  return v_counts || jsonb_build_object('routes_to_refresh', coalesce(cardinality(v_routes), 0));
end $$;

-- Refresh the map lists of up to p_count of the import's routes still waiting; returns how many are left.
create or replace function public.app_client_import_refresh(p_import uuid, p_count int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_all text[]; v_batch text[]; v_n int;
begin
  if not app_has_perm('sa_territory') then raise exception 'Not allowed'; end if;
  select refresh_routes into v_all from client_imports where id = p_import for update;
  if v_all is null then return jsonb_build_object('done', 0, 'remaining', 0); end if;
  v_n := least(greatest(coalesce(p_count, 20), 1), 100);
  v_batch := v_all[1:v_n];
  if cardinality(v_batch) > 0 then perform client_refresh_map_pcl(v_batch); end if;
  update client_imports set refresh_routes = v_all[v_n + 1:] where id = p_import;
  return jsonb_build_object('done', cardinality(v_batch), 'remaining', greatest(cardinality(v_all) - cardinality(v_batch), 0));
end $$;

revoke all on function public.app_client_import_refresh(uuid, int) from public, anon;
grant execute on function public.app_client_import_refresh(uuid, int) to authenticated;
