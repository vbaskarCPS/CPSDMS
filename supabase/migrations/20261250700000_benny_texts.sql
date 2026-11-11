-- The Benny can set up texts to workers for the person to send from their own phone.
--
-- "Set up a text for all the guys that didn't show today that says <name> if you don't get out of bed…" had no tool.
-- Now: a card with one Text button per worker. Each button is an ordinary sms: link: it opens the phone's Messages
-- with the text written, and the person presses send. Nothing here sends a text, and there is no texting service.
--   * benny_text_people: who would be texted (the day's list: those not marked as showed, those who showed, everyone,
--     or the workers named), with what the app knows about each (days worked against days on the list, the last day
--     worked, the texts opened for them before). NO phone numbers: the Benny writes from this.
--   * benny_check_texts: the same people with their text (the person's own wording with the first name filled in, or
--     one written for each) and, for the card only, the cell number its link needs.
--   * benny_text_opened: the app records a text when its button is tapped (benny_texts), so a later text can refer
--     to it. Opened is not proof it was sent: the phone sends it, and the app never sees that or any reply.
-- Super admins only. Additive only.

create table if not exists public.benny_texts (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null,
  day date not null,
  hire_id uuid not null,
  cn text, worker_name text,
  body text not null,
  tone text, about text,
  by_user uuid not null, by_name text,
  opened_at timestamptz not null default now()
);
create index if not exists benny_texts_hire on public.benny_texts (hire_id, opened_at desc);
create index if not exists benny_texts_day on public.benny_texts (center_id, day);
alter table public.benny_texts enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'benny_texts' and policyname = 'benny_texts_read') then
    create policy benny_texts_read on public.benny_texts for select to authenticated using (coalesce(app_is_super_admin(), false));
  end if;
end $p$;
revoke all on public.benny_texts from public, anon, authenticated;
grant select on public.benny_texts to authenticated;

-- The people a text is for, with the cell number (kept inside: only benny_check_texts hands it on, for the card's links).
--   p_who = { "group": "no_shows" | "showed" | "booked", "workers": ["name or CN", …] }
--   no_shows = on that day's list and not marked as showed (the day has to be started); workers, when given, are
--   found on that day's list whatever their mark.
create or replace function public.benny_text_set(p_center uuid, p_date date, p_who jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_date date := coalesce(p_date, benny_live_date(p_center)); v_day days; v_group text := coalesce(nullif(p_who->>'group', ''), 'no_shows');
        v_named boolean := jsonb_typeof(p_who->'workers') = 'array' and jsonb_array_length(p_who->'workers') > 0;
        v_probs text[] := '{}'; v_ids uuid[] := '{}'; q text; v_id uuid; v_n int; v_best real; v_second real; v_which text; v_people jsonb;
begin
  if v_date is null then return jsonb_build_object('problems', jsonb_build_array('Which day? No day is live.')); end if;
  select * into v_day from days where center_id = p_center and day = v_date;
  if not found then return jsonb_build_object('date', v_date, 'problems', jsonb_build_array('There is no day ' || v_date || ' at this center.')); end if;
  if v_group not in ('no_shows', 'showed', 'booked') then v_group := 'no_shows'; end if;
  if not v_named and v_group in ('no_shows', 'showed') and v_day.state not in ('live', 'closed') then
    return jsonb_build_object('date', v_date, 'problems', jsonb_build_array(v_date || ' isn’t started yet, so nobody is marked as showed or not. Start the day first, or name the workers.'));
  end if;

  if v_named then
    for q in select trim(x) from jsonb_array_elements_text(p_who->'workers') x where trim(x) <> '' loop
      v_id := null; v_which := null;
      select h.id into v_id from day_roster r join hires h on h.id = r.hire_id where r.day_id = v_day.id and upper(h.cn) = upper(q) limit 1;
      if v_id is null then
        select count(*), (array_agg(z.id))[1], string_agg(z.name, ', ') into v_n, v_id, v_which
          from (select h.id, trim(p.first_name || ' ' || p.last_name) name from day_roster r join hires h on h.id = r.hire_id join people p on p.id = h.person_id
                 where r.day_id = v_day.id) z
         where z.name ilike q || '%' or z.name ilike '% ' || q || '%';
        if v_n > 1 then v_probs := v_probs || ('Which one: ' || v_which || '?'); continue; end if;
      end if;
      if v_id is null then
        select max(z.s), (array_agg(z.s order by z.s desc))[2], (array_agg(z.id order by z.s desc))[1], string_agg(z.name, ', ' order by z.s desc) into v_best, v_second, v_id, v_which
          from (select h.id, trim(p.first_name || ' ' || p.last_name) name, benny_person_score(q, trim(p.first_name || ' ' || p.last_name)) s
                  from day_roster r join hires h on h.id = r.hire_id join people p on p.id = h.person_id where r.day_id = v_day.id) z where z.s >= 0.3;
        if v_id is null then v_probs := v_probs || ('Nobody called “' || q || '” is on the list for ' || v_date || '.'); continue; end if;
        if not (v_best >= 0.55 and coalesce(v_second, 0) <= v_best - 0.15) then v_probs := v_probs || ('Which one: ' || v_which || '?'); continue; end if;
      end if;
      if not (v_id = any (v_ids)) then v_ids := v_ids || v_id; end if;
    end loop;
    if cardinality(v_probs) > 0 then return jsonb_build_object('date', v_date, 'problems', to_jsonb(v_probs)); end if;
  end if;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'hire_id', h.id, 'cn', h.cn, 'name', trim(p.first_name || ' ' || p.last_name), 'first', split_part(trim(p.first_name), ' ', 1),
           'phone', case when length(regexp_replace(coalesce(p.cell_phone, ''), '[^0-9]', '', 'g')) >= 7 then regexp_replace(p.cell_phone, '[^0-9+]', '', 'g') end,
           'showed', r.attendance = 'showed',
           'days_on_list', (select count(*) from day_roster r2 join days d2 on d2.id = r2.day_id where r2.hire_id = h.id and d2.center_id = p_center and d2.state = 'closed'),
           'days_worked', (select count(distinct pl.day) from payout_lines pl where pl.center_id = p_center and upper(pl.cn) = upper(h.cn) and pl.day >= make_date(extract(year from v_date)::int, 1, 1)),
           'last_worked', (select max(pl.day) from payout_lines pl where pl.center_id = p_center and upper(pl.cn) = upper(h.cn)),
           'earlier_texts', (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('day', t.day, 'text', t.body, 'about', t.about)) order by t.opened_at desc)
                               from (select t0.* from benny_texts t0 where t0.hire_id = h.id order by t0.opened_at desc limit 3) t)))
         order by p.first_name, p.last_name), '[]'::jsonb) into v_people
    from day_roster r join hires h on h.id = r.hire_id join people p on p.id = h.person_id
   where r.day_id = v_day.id
     and case when v_named then h.id = any (v_ids)
              when v_group = 'no_shows' then r.attendance is distinct from 'showed'
              when v_group = 'showed' then r.attendance = 'showed' else true end;
  return jsonb_build_object('date', v_date, 'state', v_day.state, 'who', case when v_named then 'named' else v_group end, 'people', v_people, 'problems', '[]'::jsonb,
    'on_list', (select count(*) from day_roster r where r.day_id = v_day.id));
end $$;

-- For the Benny to write from: the same people, without their numbers.
create or replace function public.benny_text_people(p_center uuid, p_date date, p_who jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare s jsonb;
begin
  perform benny_ok(p_center);
  s := benny_text_set(p_center, p_date, coalesce(p_who, '{}'::jsonb));
  if jsonb_array_length(coalesce(s->'problems', '[]')) > 0 then return jsonb_build_object('ok', false, 'date', s->'date', 'problems', s->'problems'); end if;
  return jsonb_build_object('ok', true, 'date', s->'date', 'day_state', s->'state', 'who', s->'who', 'on_list', s->'on_list',
    'people', (select coalesce(jsonb_agg((e - 'phone' - 'hire_id') || jsonb_build_object('has_cell', e ? 'phone') order by o), '[]'::jsonb)
                 from jsonb_array_elements(s->'people') with ordinality t(e, o)));
end $$;

-- The texts, checked: p_template (the person's own wording; {name} or <name> = the first name) for everyone, or
-- p_texts = [{ worker: CN or name, text }] written one by one. Changes nothing.
create or replace function public.benny_check_texts(p_center uuid, p_date date, p_who jsonb, p_template text, p_texts jsonb, p_tone text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare s jsonb; e jsonb; v_tpl text := nullif(trim(coalesce(p_template, '')), ''); v_text text; v_probs text[] := '{}'; v_out jsonb := '[]'::jsonb; v_no jsonb := '[]'::jsonb;
begin
  perform benny_ok(p_center);
  s := benny_text_set(p_center, p_date, coalesce(p_who, '{}'::jsonb));
  if jsonb_array_length(coalesce(s->'problems', '[]')) > 0 then return jsonb_build_object('ok', false, 'date', s->'date', 'problems', s->'problems'); end if;
  if jsonb_array_length(s->'people') = 0 then
    return jsonb_build_object('ok', false, 'date', s->'date', 'problems', jsonb_build_array(case s->>'who'
      when 'no_shows' then 'Everyone on the list for ' || (s->>'date') || ' is marked as showed: nobody to text.'
      when 'showed' then 'Nobody is marked as showed on ' || (s->>'date') || '.' else 'Nobody is on the list for ' || (s->>'date') || '.' end));
  end if;
  if jsonb_array_length(s->'people') > 60 then
    return jsonb_build_object('ok', false, 'date', s->'date', 'problems', jsonb_build_array('That is ' || jsonb_array_length(s->'people') || ' texts: 60 at most on one card. Name a smaller group.'));
  end if;
  if v_tpl is null and (jsonb_typeof(p_texts) is distinct from 'array' or jsonb_array_length(p_texts) = 0) then
    return jsonb_build_object('ok', false, 'date', s->'date', 'problems', jsonb_build_array('What should the text say?'));
  end if;

  for e in select * from jsonb_array_elements(s->'people') loop
    if v_tpl is not null then
      v_text := replace(replace(replace(replace(v_tpl, '{name}', e->>'first'), '{Name}', e->>'first'), '<name>', e->>'first'), '<Name>', e->>'first');
    else
      select nullif(trim(x->>'text'), '') into v_text from jsonb_array_elements(p_texts) x
       where upper(trim(coalesce(x->>'worker', ''))) = upper(e->>'cn') or lower(trim(coalesce(x->>'worker', ''))) = lower(e->>'name') limit 1;
    end if;
    v_text := trim(regexp_replace(coalesce(v_text, ''), '\s+', ' ', 'g'));
    if v_text = '' then v_probs := v_probs || ('No text for ' || (e->>'name') || '.'); continue; end if;
    if length(v_text) > 480 then v_probs := v_probs || ((e->>'name') || '’s text is ' || length(v_text) || ' characters: 480 at most.'); continue; end if;
    if not (e ? 'phone') then v_no := v_no || to_jsonb(e->>'name'); end if;
    v_out := v_out || jsonb_strip_nulls(jsonb_build_object('hire_id', e->>'hire_id', 'cn', e->>'cn', 'name', e->>'name', 'first', e->>'first', 'phone', e->>'phone', 'text', v_text,
      'days_worked', e->'days_worked', 'days_on_list', e->'days_on_list', 'last_worked', e->'last_worked', 'earlier', jsonb_array_length(coalesce(e->'earlier_texts', '[]'))));
  end loop;

  return jsonb_strip_nulls(jsonb_build_object('ok', cardinality(v_probs) = 0, 'problems', to_jsonb(v_probs), 'date', s->'date', 'who', s->'who',
    'tone', nullif(left(trim(coalesce(p_tone, '')), 60), ''), 'own_words', v_tpl is not null,
    'people', case when cardinality(v_probs) = 0 then v_out end,
    'no_cell', case when cardinality(v_probs) = 0 and jsonb_array_length(v_no) > 0 then v_no end));
end $$;

-- A Text button was tapped: keep what was written for that worker (the text as it read then, after any change).
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
  insert into benny_texts (center_id, day, hire_id, cn, worker_name, body, tone, about, by_user, by_name)
  values (p_center, p_date, v_hire, upper(trim(p_cn)), v_name, v_body, nullif(left(trim(coalesce(p_tone, '')), 60), ''), nullif(left(trim(coalesce(p_about, '')), 40), ''),
          auth.uid(), (select u.full_name from app_users u where u.id = auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

do $g$ declare f text; begin
  execute 'revoke all on function public.benny_text_set(uuid,date,jsonb) from public, anon, authenticated';
  foreach f in array array['benny_text_people(uuid,date,jsonb)', 'benny_check_texts(uuid,date,jsonb,text,jsonb,text)', 'benny_text_opened(uuid,date,text,text,text,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $g$;
