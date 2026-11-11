-- The Benny, texts to workers: the same text opened twice is kept once.
--
-- A Text button can be tapped again (the person backed out of Messages, or the phone put the app to sleep before the
-- app heard back and it tries once more). The same text for the same worker on the same day by the same person is one
-- row: the first time it was opened stands. A changed text is a new row.
--
-- Additive: benny_text_opened only (same inputs, same output). Nothing else changes.

create or replace function public.benny_text_opened(p_center uuid, p_date date, p_cn text, p_body text, p_tone text default null, p_about text default null)
returns uuid language plpgsql volatile security definer set search_path to 'public' as $$
declare v_hire uuid; v_name text; v_body text := trim(coalesce(p_body, '')); v_id uuid;
begin
  perform benny_ok(p_center);
  if v_body = '' or length(v_body) > 600 then raise exception 'A text is between 1 and 600 characters'; end if;
  select h.id, trim(p.first_name || ' ' || p.last_name) into v_hire, v_name
    from day_roster r join days d on d.id = r.day_id join hires h on h.id = r.hire_id join people p on p.id = h.person_id
   where d.center_id = p_center and d.day = p_date and upper(h.cn) = upper(trim(coalesce(p_cn, ''))) limit 1;
  if v_hire is null then raise exception 'That worker isn’t on the list for %', p_date; end if;
  select t.id into v_id from benny_texts t
   where t.center_id = p_center and t.day = p_date and t.hire_id = v_hire and t.by_user = auth.uid() and t.body = v_body
   order by t.opened_at limit 1;
  if v_id is not null then return v_id; end if;
  insert into benny_texts (center_id, day, hire_id, cn, worker_name, body, tone, about, by_user, by_name)
  values (p_center, p_date, v_hire, upper(trim(p_cn)), v_name, v_body, nullif(left(trim(coalesce(p_tone, '')), 60), ''), nullif(left(trim(coalesce(p_about, '')), 40), ''),
          auth.uid(), (select u.full_name from app_users u where u.id = auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.benny_text_opened(uuid,date,text,text,text,text) from public, anon;
grant execute on function public.benny_text_opened(uuid,date,text,text,text,text) to authenticated;
