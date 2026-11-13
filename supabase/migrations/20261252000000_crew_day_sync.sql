-- Road trips: a day gets its crew without anyone opening it. The same copy the Day page does (syncCrewDay in
-- src/v2/lib/crew.ts), in the database: everyone active on the center's crew goes on the day's roster, ticked as
-- working, and anyone no longer on the crew comes off it when nothing is recorded for them that day. A day that has
-- started (live or closed) is never touched. Runs every hour for today and tomorrow (each center's own date), and the
-- Day page can call it too. Additive only.

create or replace function public.wb_sync_crew_day(p_center uuid, p_day date)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare v_day uuid; v_state text; v_added int := 0; v_ticked int := 0; v_removed int := 0; v_had_ticks boolean; y int := extract(year from p_day)::int;
begin
  if (select center_type from command_centers where id = p_center) is distinct from 'road_trip' then return jsonb_build_object('ok', false, 'why', 'not a road trip'); end if;
  select id, state into v_day, v_state from days where center_id = p_center and day = p_day;
  if v_state is not null and v_state <> 'planned' then return jsonb_build_object('ok', true, 'started', true); end if;
  if v_day is null then
    insert into days (center_id, day) values (p_center, p_day) on conflict (center_id, day) do nothing;
    select id into v_day from days where center_id = p_center and day = p_day;
  end if;
  select exists (select 1 from day_roster where day_id = v_day and confirmed_at is not null) into v_had_ticks;

  with crew as (
    select h.id, h.shuttle from hires h
     where h.year = y and (h.current_center_id = p_center or (h.center_id = p_center and h.current_center_id is null))
       and h.status = 'active'),
  ins as (
    insert into day_roster (day_id, hire_id, shuttle, confirmed_at, confirmed_via)
    select v_day, c.id, c.shuttle, now(), 'staff' from crew c
    on conflict (day_id, hire_id) do nothing returning 1)
  select count(*) into v_added from ins;

  -- a day nobody has ticked yet gets everyone ticked once (as the Day page does)
  if not v_had_ticks then
    update day_roster r set confirmed_at = now(), confirmed_via = 'staff'
     where r.day_id = v_day and r.confirmed_at is null
       and exists (select 1 from hires h where h.id = r.hire_id and h.status = 'active');
    get diagnostics v_ticked = row_count;
  end if;

  with gone as (
    delete from day_roster r
     where r.day_id = v_day and r.attendance is null and r.team is null and r.next_action is null and r.next_day is null
       and not exists (select 1 from hires h where h.id = r.hire_id and h.year = y and h.status = 'active'
                         and (h.current_center_id = p_center or (h.center_id = p_center and h.current_center_id is null)))
    returning 1)
  select count(*) into v_removed from gone;

  return jsonb_build_object('ok', true, 'added', v_added, 'ticked', v_ticked, 'removed', v_removed);
end $$;
revoke all on function public.wb_sync_crew_day(uuid, date) from public, anon, authenticated;

-- for the app: the same, for someone who runs the workerbook or the routes at that center
create or replace function public.app_sync_crew_day(p_center uuid, p_day date)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
begin
  if not ((app_has_perm('workerbook') or app_has_perm('route_manager') or app_is_super_admin()) and app_can_see_center(p_center)) then
    raise exception 'Not allowed' using errcode = '42501'; end if;
  return wb_sync_crew_day(p_center, p_day);
end $$;
revoke all on function public.app_sync_crew_day(uuid, date) from public, anon;
grant execute on function public.app_sync_crew_day(uuid, date) to authenticated;

-- every hour: today and tomorrow on each road trip (not the demo), by the center's own date
create or replace function public.wb_sync_crew_days()
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare c record; d date; out jsonb := '[]'::jsonb; r jsonb;
begin
  for c in select id, display_name, case when region = 'West' then 'America/Vancouver' else 'America/Toronto' end tz
             from command_centers where center_type = 'road_trip' and not coalesce(is_demo, false) loop
    foreach d in array array[(now() at time zone c.tz)::date, (now() at time zone c.tz)::date + 1] loop
      begin
        r := wb_sync_crew_day(c.id, d);
        if coalesce((r->>'added')::int, 0) + coalesce((r->>'ticked')::int, 0) + coalesce((r->>'removed')::int, 0) > 0 then
          out := out || jsonb_build_array(jsonb_build_object('center', c.display_name, 'day', d) || r); end if;
      exception when others then
        out := out || jsonb_build_array(jsonb_build_object('center', c.display_name, 'day', d, 'error', sqlerrm));
      end;
    end loop;
  end loop;
  return out;
end $$;
revoke all on function public.wb_sync_crew_days() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'crew-day-sync') then
    perform cron.schedule('crew-day-sync', '5 * * * *', 'select public.wb_sync_crew_days()');
  end if;
end $$;
