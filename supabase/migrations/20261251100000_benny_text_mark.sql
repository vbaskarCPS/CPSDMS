-- The Benny, "who didn't show": say how each worker is marked.
--
-- "Didn't show" means on the day's list and not marked as showed. That covers two things: marked as a no-show at roll
-- call, and not marked at all. The lookup only said showed or not, so an answer could read "marked as no-shows" for
-- workers nobody had marked. Each worker now carries mark: showed, no_show, or not marked.
--
-- Additive: one more field per worker from benny_text_set (benny_text_people hands it on). Who is listed doesn't change.

do $$
declare
  v_def text; v_new text;
  v_old text := $o$'showed', r.attendance = 'showed',$o$;
  v_fix text := $n$'showed', r.attendance = 'showed', 'mark', coalesce(r.attendance, 'not marked'),$n$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'benny_text_set';
  if v_def is null then raise exception 'benny_text_set not found'; end if;
  v_new := replace(v_def, v_old, v_fix);
  if v_new = v_def then raise exception 'benny_text_set: the showed field was not found to patch'; end if;
  execute v_new;
end $$;
