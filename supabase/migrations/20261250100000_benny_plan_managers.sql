-- The Benny, starting the day: say WHY a manager can't take a crew, and who can.
--
-- "Give me the good guys" from a super admin whose RM center is another center came back as
-- "Vijay Baskaran isn't a route manager available at this center on 2026-11-11." True, but it doesn't say what to do.
-- Now the check says which it is (their RM center is another center, or they are marked off that day), where to change
-- it, and who is available that day, so the answer can offer the fix or another manager.
--
-- Additive: a patch to benny_plan_day's message only. Nothing about who may start a day, or what a plan is, changes.

do $$
declare
  v_def text; v_new text;
  v_old text := $o$      elsif not (m.id = any (v_avail)) then v_probs := v_probs || (m.full_name || ' isn’t a route manager available at this center on ' || p_date || '.');$o$;
  v_fix text := $n$      elsif not (m.id = any (v_avail)) then v_probs := v_probs || ((case
          when m.rm_center_id is distinct from p_center then m.full_name || ' isn’t set up as a route manager at this center'
            || coalesce(' (their RM center is ' || (select cc.display_name from command_centers cc where cc.id = m.rm_center_id) || ')', ' (they have no RM center)')
            || '. Set their RM center to this one in User Management, or name another manager.'
          when exists (select 1 from manager_days_off o where o.user_id = m.id and o.day = p_date) then m.full_name || ' is marked off on ' || p_date || '.'
          else m.full_name || ' isn’t a route manager available at this center on ' || p_date || '.' end)
        || coalesce(' Available that day: ' || (select string_agg(u.full_name, ', ' order by u.full_name) from app_users u where u.id = any (v_avail)) || '.', ' No route manager is available that day.'));$n$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'benny_plan_day';
  if v_def is null then raise exception 'benny_plan_day not found'; end if;
  v_new := replace(v_def, v_old, v_fix);
  if v_new = v_def then raise exception 'benny_plan_day: the manager message was not found to patch'; end if;
  execute v_new;
end $$;
