-- The Benny on the floater map (Route Manager › Floater view).
--
-- A floater (the Floater Route Manager permission) picks managers at a center with a live session and opens one map
-- covering all their teams. On that map the old app knows them as "floater_<username>", an id with no row of its own.
-- The Benny there works for the managers followed: "my team" is their teams together, and a pin or an order is the
-- floater's own, for those managers' carts.
--
-- The open map reaches the database as p_manager, as before. For the floater view it is the floater's id followed by
-- the managers followed: "floater_basvi,rm_franklynmitchell,rm_jovanchung". Every part is checked here: the id must be
-- the caller's own, the caller must be a floater (or a super admin), and each manager must be a route manager of that
-- center. Nothing is stored.
--
-- Additive only.

-- A floater can open the floater map of any center with a live session (app_floater_managers lists exactly those), so
-- the Benny answers them there too, not only at the centers on their account.
create or replace function public.benny_ok_any(p_center uuid default null)
returns text language plpgsql stable security definer set search_path to 'public' as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Not allowed' using errcode = '42501'; end if;
  if coalesce(app_is_super_admin(), false) then v_role := 'admin';
  elsif coalesce(app_has_perm('route_manager'), false) or coalesce(app_has_perm('rm_floater'), false) then v_role := 'rm';
  else raise exception 'Not allowed' using errcode = '42501'; end if;
  if p_center is not null and not coalesce(app_can_see_center(p_center), false)
     and not (coalesce(app_has_perm('rm_floater'), false)
              and exists (select 1 from daily_sessions d join command_centers c on c.id = d.command_center_id and not c.is_demo
                           where d.command_center_id = p_center and d.is_active)) then
    raise exception 'Not allowed' using errcode = '42501'; end if;
  return v_role;
end $$;

-- Whose teams the caller may act on. null = anyone's (a super admin). A route manager: their own and those they float
-- for. A floater: every route manager of the center, because the Floater view lets them follow any of them.
create or replace function public.benny_my_reach(p_center uuid)
returns text[] language plpgsql stable security definer set search_path to 'public' as $$
declare v_mine text[] := benny_my_rm_ids(p_center);
begin
  if v_mine is null then return null; end if;
  if coalesce(app_has_perm('rm_floater'), false) then
    return v_mine || coalesce((select array_agg(u.user_id) from users u where u.command_center_id = p_center and u.role = 'RouteManager' and not (u.user_id = any (v_mine))), '{}');
  end if;
  return v_mine;
end $$;
revoke all on function public.benny_my_reach(uuid) from public, anon, authenticated;

-- Whose map is open: who the pins belong to, and whose carts are theirs.
--   the floater view ("floater_<me>,<manager>,…"): the floater, for the managers followed
--   a route manager: their own, for their team (and anyone they float for)
--   a super admin: the manager whose map is open
create or replace function public.benny_pin_manager(p_center uuid, p_manager text, out manager text, out team text[], out problem text)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_role text := benny_ok_any(p_center); v_mine text[]; v_me text;
        v_ids text[] := array(select trim(x) from unnest(string_to_array(coalesce(p_manager, ''), ',')) x where trim(x) <> '');
begin
  if v_ids[1] like 'floater\_%' then
    if v_role <> 'admin' and not coalesce(app_has_perm('rm_floater'), false) then
      problem := 'The floater view needs the Floater Route Manager permission.'; return; end if;
    select 'floater_' || u.username into v_me from app_users u where u.id = auth.uid();
    if v_ids[1] is distinct from v_me then problem := 'That floater view isn’t yours.'; return; end if;
    team := array(select u.user_id from users u
                   where u.command_center_id = p_center and u.role = 'RouteManager' and u.user_id = any (v_ids[2:]) order by u.name);
    if cardinality(team) = 0 then problem := 'Pick the managers to follow in the Floater view first.'; team := null; return; end if;
    manager := v_me; team := array[v_me] || team; return;
  end if;
  if v_role = 'rm' then
    v_mine := benny_my_rm_ids(p_center); manager := v_mine[1]; team := v_mine; return;
  end if;
  if nullif(trim(coalesce(p_manager, '')), '') is null then
    problem := 'Open a route manager’s map first: pins live on a manager’s map.'; return; end if;
  if not exists (select 1 from users u where u.user_id = p_manager and u.command_center_id = p_center) then
    problem := 'That manager isn’t in this center.'; return; end if;
  manager := p_manager;
  team := array[p_manager] || coalesce((select array_agg(x) from users u,
            jsonb_array_elements_text(case when jsonb_typeof(u.metadata->'floatingFor') = 'array' then u.metadata->'floatingFor' else '[]'::jsonb end) x
           where u.user_id = p_manager and u.command_center_id = p_center), '{}');
end $$;
revoke all on function public.benny_pin_manager(uuid, text) from public, anon, authenticated;

-- The live team, the two cart checks and the spoken-name list learn the floater view (patched in place).
do $patch$
declare src text; was text;
begin
  -- benny_live: on the floater view "my team" is the managers followed; a floater may also look at any one manager
  src := pg_get_functiondef('public.benny_live(uuid,text)'::regprocedure); was := src;
  src := replace(src, $a$v_mgrs text[];
begin$a$, $a$v_mgrs text[]; v_reach text[] := benny_my_reach(p_center); v_prob text;
begin$a$);
  if src = was then raise exception 'benny_live: declare not found'; end if;
  was := src;
  src := replace(src, $a$  v_mgrs := case when p_manager is not null then array[p_manager] else v_mine end;
  if v_mine is not null and p_manager is not null and not (p_manager = any (v_mine)) then raise exception 'That isn’t your team' using errcode = '42501'; end if;$a$,
$a$  if p_manager like 'floater\_%' then
    select t.team, t.problem into v_mgrs, v_prob from benny_pin_manager(p_center, p_manager) t;
    if v_prob is not null then raise exception '%', v_prob using errcode = '42501'; end if;
  else
    v_mgrs := case when p_manager is not null then array[p_manager] else v_mine end;
    if v_reach is not null and p_manager is not null and not (p_manager = any (v_reach)) then raise exception 'That isn’t your team' using errcode = '42501'; end if;
  end if;$a$);
  if src = was then raise exception 'benny_live: scope not found'; end if;
  execute src;

  -- giving a route, partnering, solo carts: a floater may do them for any manager's team at the center
  src := pg_get_functiondef('public.benny_check_give(uuid,text,text)'::regprocedure); was := src;
  src := replace(src, 'v_mine text[] := benny_my_rm_ids(p_center);', 'v_mine text[] := benny_my_reach(p_center);');
  if src = was then raise exception 'benny_check_give: not found'; end if;
  execute src;
  src := pg_get_functiondef('public.benny_check_move(uuid,text,text)'::regprocedure); was := src;
  src := replace(src, 'v_mine text[] := benny_my_rm_ids(p_center);', 'v_mine text[] := benny_my_reach(p_center);');
  if src = was then raise exception 'benny_check_move: not found'; end if;
  execute src;

  -- spoken names: the workers of the managers followed
  src := pg_get_functiondef('public.benny_vocab(uuid,date,text)'::regprocedure); was := src;
  src := replace(src, $a$  v_mgrs := case when v_mine is not null then v_mine when p_manager is not null then array[p_manager] else null end;$a$,
$a$  v_mgrs := case when p_manager like 'floater\_%' then coalesce((select t.team from benny_pin_manager(p_center, p_manager) t), v_mine, '{}')
                 when v_mine is not null then v_mine when p_manager is not null then array[p_manager] else null end;$a$);
  if src = was then raise exception 'benny_vocab: not found'; end if;
  execute src;
end $patch$;
