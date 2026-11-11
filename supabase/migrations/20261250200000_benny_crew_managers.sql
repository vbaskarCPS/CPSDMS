-- The Benny, crews: the worker-averages lookup also says which route managers are available that day, and whether the
-- person asking is one.
--
-- "Give Franklyn the worst half and me the good guys" asked three questions (which maps, who takes the new worker) and
-- only then found out that "me" can't take a crew: the asker's RM center was another center. The lookup now carries
--   managers: the route managers available at this center that day (names)
--   you:      { name, can_manage, why_not } for the person asking
-- so the first answer can say it, with the fix, before asking anything else.
--
-- Additive: two more keys in benny_crew_stats's result. Who may call it (super admins) is unchanged.

do $$
declare
  v_def text; v_new text;
  v_old text := $o$    'no_shows', (select jsonb_agg(c.name order by c.name) from benny_crew(p_center, d.id) c where not c.showed),$o$;
  v_add text := $n$
    'managers', (select jsonb_agg(u.full_name order by u.full_name) from app_users u
                  where u.rm_center_id = p_center and u.is_active and not exists (select 1 from manager_days_off o where o.user_id = u.id and o.day = p_date)),
    'you', (select jsonb_build_object('name', u.full_name,
                     'can_manage', coalesce(u.rm_center_id = p_center and u.is_active and not exists (select 1 from manager_days_off o where o.user_id = u.id and o.day = p_date), false),
                     'why_not', case when u.rm_center_id is distinct from p_center
                                       then 'their RM center is ' || coalesce((select cc.display_name from command_centers cc where cc.id = u.rm_center_id), 'not set')
                                            || ', not this center: set it to this one in User Management, or name another manager'
                                     when exists (select 1 from manager_days_off o where o.user_id = u.id and o.day = p_date) then 'they are marked off that day' end)
              from app_users u where u.id = auth.uid()),$n$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'benny_crew_stats';
  if v_def is null then raise exception 'benny_crew_stats not found'; end if;
  v_new := replace(v_def, v_old, v_old || v_add);
  if v_new = v_def then raise exception 'benny_crew_stats: the place to add the managers was not found'; end if;
  execute v_new;
end $$;
