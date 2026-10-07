-- Center types and the road-trip Crew List. ADDITIVE ONLY.
--
--   command_centers.center_type   'in_city' (default) or 'road_trip'
--   hires.current_center_id       where the worker is working now; null = at their home center
--                                 (home = hires.center_id, the center behind their CN # prefix)
--   hires.room                    hotel room while at a road-trip center
--
-- A worker works at one center at a time. Either center can move them (the home center pushes,
-- the road-trip center pulls). Coming off a road trip always lands them on their home city's
-- WDR list. All moves go through app_crew_move; the app can't write these columns directly.

alter table public.command_centers
  add column if not exists center_type text not null default 'in_city' check (center_type in ('in_city', 'road_trip'));
grant select (center_type) on public.command_centers to anon, authenticated;

-- Sealing RTs starts as a road-trip center (asked for 2026-10-07).
update public.command_centers set center_type = 'road_trip' where display_name = 'Sealing RTs' and center_type = 'in_city';

alter table public.hires
  add column if not exists current_center_id uuid references public.command_centers(id) on delete set null,
  add column if not exists room text,
  add column if not exists moved_at timestamptz;
create index if not exists hires_current_center on public.hires (current_center_id) where current_center_id is not null;
grant select (current_center_id, room, moved_at) on public.hires to authenticated;

-- ───────────── Super Admin: center type ─────────────
create or replace function public.app_set_center_type(p_center uuid, p_type text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not app_is_super_admin() then raise exception 'Only the Super Admin can change a center''s type'; end if;
  if p_type not in ('in_city', 'road_trip') then raise exception 'Unknown center type'; end if;
  update command_centers set center_type = p_type where id = p_center;
  insert into audit_log (actor, entity, entity_id, action, after)
  values (auth.uid(), 'command_centers', p_center::text, 'update', jsonb_build_object('center_type', p_type));
end $$;

-- Active road-trip centers (for "Send to a road trip").
create or replace function public.app_road_trip_centers()
returns table (id uuid, display_name text) language sql stable security definer set search_path = public as $$
  select c.id, c.display_name from command_centers c
   where c.center_type = 'road_trip' and c.is_active and app_has_perm('workerbook')
   order by c.display_name
$$;

-- One worker as the Crew List shows them.
create or replace function public.app_crew_row(h public.hires)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'hire_id', h.id, 'cn', h.cn, 'status', h.status, 'room', h.room, 'moved_at', h.moved_at, 'shuttle', h.shuttle,
    'first_name', p.first_name, 'last_name', p.last_name, 'cell_phone', p.cell_phone,
    'home_id', h.center_id, 'home', hc.display_name,
    'current_id', h.current_center_id, 'current', cc.display_name)
    from people p
    join command_centers hc on hc.id = h.center_id
    left join command_centers cc on cc.id = h.current_center_id
   where p.id = h.person_id
$$;

-- The crew at a center this year: who's working here (home here and not away, or moved in),
-- and this center's own people who are away at another center.
create or replace function public.app_crew_list(p_center uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare y int := extract(year from current_date)::int;
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'type', (select center_type from command_centers where id = p_center),
    'here', coalesce((select jsonb_agg(app_crew_row(h) order by h.room nulls last, h.cn) from hires h
                       where h.year = y and (h.current_center_id = p_center or (h.center_id = p_center and h.current_center_id is null))
                         and h.status not in ('Q', 'F')), '[]'::jsonb),
    'away', coalesce((select jsonb_agg(app_crew_row(h) order by h.cn) from hires h
                       where h.year = y and h.center_id = p_center and h.current_center_id is not null
                         and h.current_center_id <> p_center), '[]'::jsonb));
end $$;

-- Find workers to move. scope 'others': anyone this year not already working at p_center (for a
-- road-trip center pulling in). scope 'home': p_center's own people who are at home (to push out).
create or replace function public.app_crew_search(p_center uuid, p_q text, p_scope text default 'others')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  y int := extract(year from current_date)::int;
  q text := lower(trim(coalesce(p_q, '')));
  digits text := regexp_replace(coalesce(p_q, ''), '\D', '', 'g');
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  if length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(app_crew_row(x) order by x.cn) from (
      select h.* from hires h join people p on p.id = h.person_id
       where h.year = y
         and case when p_scope = 'home' then h.center_id = p_center and h.current_center_id is null
                  else coalesce(h.current_center_id, h.center_id) <> p_center end
         and (lower(h.cn) like q || '%'
              or lower(p.first_name || ' ' || p.last_name) like '%' || q || '%'
              or (length(digits) >= 4 and regexp_replace(coalesce(p.cell_phone, ''), '\D', '', 'g') like '%' || digits || '%'))
       order by h.cn limit 40) x), '[]'::jsonb);
end $$;

-- Move workers. p_to_center null (or their home) = send them home; otherwise move them there.
-- Coming off a road-trip center always lands them on WDR at home. Moving onto a center makes
-- them active (they're there to work); Quit, Fired and Waitlist people can't be moved.
create or replace function public.app_crew_move(p_hire_ids uuid[], p_to_center uuid, p_room text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  h hires;
  here uuid;
  to_home boolean;
  from_type text;
  n int := 0;
begin
  if not app_has_perm('workerbook') then raise exception 'Not allowed'; end if;
  if p_to_center is not null and not exists (select 1 from command_centers where id = p_to_center and is_active) then
    raise exception 'That center isn''t active';
  end if;
  for h in select * from hires where id = any(p_hire_ids) for update loop
    here := coalesce(h.current_center_id, h.center_id);
    to_home := p_to_center is null or p_to_center = h.center_id;
    -- either end may move them: where they are now, where they're going, or their home center
    if not (app_can_see_center(here) or app_can_see_center(h.center_id) or (p_to_center is not null and app_can_see_center(p_to_center))) then
      raise exception 'You can''t move % (not at one of your centers)', h.cn;
    end if;
    if to_home then
      if h.current_center_id is null then continue; end if;   -- already home
      select center_type into from_type from command_centers where id = h.current_center_id;
      update hires set current_center_id = null, room = null, moved_at = now(),
             status = case when from_type = 'road_trip' then 'WDR' else status end, updated_at = now()
       where id = h.id;
    else
      if here = p_to_center then
        if p_room is not null then update hires set room = nullif(trim(p_room), '') where id = h.id; end if;
        continue;
      end if;
      if h.status in ('Q', 'F', 'WL') then
        raise exception '% is on the % list at home; change that first', h.cn, h.status;
      end if;
      update hires set current_center_id = p_to_center, room = nullif(trim(coalesce(p_room, '')), ''), moved_at = now(),
             status = 'active', updated_at = now()
       where id = h.id;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- Room number for someone at a road-trip center (any time, as it changes).
create or replace function public.app_crew_set_room(p_hire uuid, p_room text)
returns void language plpgsql security definer set search_path = public as $$
declare here uuid;
begin
  select coalesce(current_center_id, center_id) into here from hires where id = p_hire;
  if here is null then raise exception 'Contractor not found'; end if;
  if not (app_has_perm('workerbook') and app_can_see_center(here)) then raise exception 'Not allowed'; end if;
  update hires set room = nullif(trim(coalesce(p_room, '')), ''), updated_at = now() where id = p_hire;
end $$;

revoke all on function public.app_set_center_type(uuid, text) from public, anon;
revoke all on function public.app_road_trip_centers() from public, anon;
revoke all on function public.app_crew_row(public.hires) from public, anon, authenticated;
revoke all on function public.app_crew_list(uuid) from public, anon;
revoke all on function public.app_crew_search(uuid, text, text) from public, anon;
revoke all on function public.app_crew_move(uuid[], uuid, text) from public, anon;
revoke all on function public.app_crew_set_room(uuid, text) from public, anon;
grant execute on function public.app_set_center_type(uuid, text) to authenticated;
grant execute on function public.app_road_trip_centers() to authenticated;
grant execute on function public.app_crew_list(uuid) to authenticated;
grant execute on function public.app_crew_search(uuid, text, text) to authenticated;
grant execute on function public.app_crew_move(uuid[], uuid, text) to authenticated;
grant execute on function public.app_crew_set_room(uuid, text) to authenticated;
