-- Roll call: each worker's answer for after today. ADDITIVE ONLY.
--
--   day_roster.next_day     the next day they're working (already existed)
--   day_roster.next_action  'book' (book them on next_day), 'WDR' (not rebooking) or 'Q' (today is their last day)
--
-- Answers are recorded at roll call and applied when the session starts (app_apply_next_days):
-- 'book' books them onto next_day; WDR / Quit put them on that list (they still work today).
-- Once a day is live, an answer given later is applied straight away (the app calls it with p_hire).

alter table public.day_roster
  add column if not exists next_action text check (next_action in ('book', 'WDR', 'Q'));

create or replace function public.app_apply_next_days(p_day uuid, p_hire uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d days;
  r record;
  booked int := 0; wdr int := 0; quit int := 0;
begin
  select * into d from days where id = p_day;
  if d.id is null then raise exception 'Day not found'; end if;
  if not (app_has_perm('workerbook') and app_can_see_center(d.center_id)) then raise exception 'Not allowed'; end if;
  for r in select dr.hire_id, dr.next_day, coalesce(dr.next_action, case when dr.next_day is not null then 'book' end) act
             from day_roster dr
            where dr.day_id = p_day and dr.attendance = 'showed' and (p_hire is null or dr.hire_id = p_hire)
              and (dr.next_action is not null or dr.next_day is not null) loop
    if r.act = 'book' and r.next_day is not null and r.next_day > d.day then
      perform app_book(d.center_id, r.next_day, array[r.hire_id]);
      booked := booked + 1;
    elsif r.act in ('WDR', 'Q') then
      update hires set status = r.act, status_since = d.day + 1, updated_at = now() where id = r.hire_id and status <> r.act;
      if r.act = 'WDR' then wdr := wdr + 1; else quit := quit + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('booked', booked, 'wdr', wdr, 'quit', quit);
end $$;
revoke all on function public.app_apply_next_days(uuid, uuid) from public, anon;
grant execute on function public.app_apply_next_days(uuid, uuid) to authenticated;
