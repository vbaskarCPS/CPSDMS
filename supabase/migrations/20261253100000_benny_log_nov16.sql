-- The log of Nov 15 and 16 (Franklyn's questions the Benny handled badly, none of them logged):
--   1. "Change Tim's $0.00 to a prepaid AFSL": the job card could change an amount and how it was paid, never what the
--      line IS. It can now turn a sale (or a plain production job) into an office flat: Production, the flat's code, the
--      season's set value, prepaid. The app works the value out (it has the season's flats); the database refuses a
--      save that comes without it (an older tab), and steers to the prebook card when the address has an open prebook.
--   2. "Credit Michael and Andy" for a booking done on a closed day: marking a booking done from here always read
--      "Marked done by the office", dated today. When the address is on a closed day's payout as a Production job, the
--      booking is now dated that day and credited to that cart (benny_booking_credit), also for one already marked by hand.
--   3. "Who knocked LNG53 and what was the date": the route look-up now gives each day the route was knocked (knocks,
--      houses, sales, prebooks done) and, with Workerbook, by whom.
--   4. "Find Chris Rand on a logsheet": the already-done look-up took addresses only. An entry with no house number is
--      now read as a client's name and looked up on every closed day's payout, the live logsheets and the bookings.

-- The closed-day logsheet line a booking's address is on: the latest Production job at that address in this center's payouts.
create or replace function public.benny_booking_line(p_center uuid, p_house text, p_street text) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select jsonb_strip_nulls(jsonb_build_object('id', s.id, 'day', s.day, 'shown_as', nullif(s.display_price, ''),
           'workers', coalesce((select string_agg(trim(concat_ws(' ', m->>'first_name', m->>'last_name')), ' + ') from jsonb_array_elements(coalesce(c.members, '[]'::jsonb)) m), c.label),
           'cn', (select m->>'cn' from jsonb_array_elements(coalesce(c.members, '[]'::jsonb)) m limit 1)))
    from payout_sales s left join payout_carts c on c.id = s.cart_id
   where s.center_id = p_center and s.type = 'Production'
     and lower(trim(coalesce(p_house, ''))) ~ '^[0-9]+[a-z]?$' and split_part(trim(coalesce(p_street, '')), ' ', 1) <> ''
     and s.address ~* ('^\s*' || regexp_replace(lower(trim(p_house)), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M.*\m'
                       || regexp_replace(split_part(trim(p_street), ' ', 1), '([.*+?^${}()|\[\]\\])', '\\\1', 'g'))
   order by s.day desc, s.sort desc nulls last limit 1
$$;
revoke all on function public.benny_booking_line(uuid, text, text) from public, anon, authenticated;

-- After the Bookings save marked it done: date it to the closed day it was done on and name the cart that did it.
create or replace function public.benny_booking_credit(p_center uuid, p_booking uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare b mb_bookings; v_line jsonb;
begin
  perform benny_need(p_center, 'bookings');
  select bk.* into b from mb_bookings bk join mb_lists l on l.id = bk.list_id where bk.id = p_booking and l.center_id = p_center;
  if b.id is null then return jsonb_build_object('ok', false, 'why', 'no such booking in this center'); end if;
  if b.status <> 'done' or b.done_tx is not null then return jsonb_build_object('ok', false, 'why', 'it isn’t a booking marked done by hand'); end if;
  v_line := benny_booking_line(p_center, b.house_no, b.street_name);
  if v_line is null then return jsonb_build_object('ok', false, 'why', 'it is on no closed day’s logsheet as a production job'); end if;
  update mb_bookings set done_on = (v_line->>'day')::date, done_by_name = v_line->>'workers', done_by = v_line->>'cn',
         done_tx = 'payout:' || (v_line->>'id'), updated_at = now(), updated_by = auth.uid()
   where id = b.id;
  return jsonb_build_object('ok', true, 'done_on', v_line->>'day', 'done_by', v_line->>'workers');
end $$;
revoke all on function public.benny_booking_credit(uuid, uuid) from public, anon;
grant execute on function public.benny_booking_credit(uuid, uuid) to authenticated;

-- ── the functions that change: each is patched where it is (the rest of it stays as it was) ──
do $do$
declare d text;
begin
  -- changing a booking: done is dated and credited from the closed day's logsheet when the job is on one
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_check_booking';
  if position($m$benny_booking_line($m$ in d) = 0 then
    if position($a$k text; v_text text; v_was text; v_res text; v_label text;$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_check_booking (1)'; end if;
    d := replace(d, $a$k text; v_text text; v_was text; v_res text; v_label text;$a$, $b$k text; v_text text; v_was text; v_res text; v_label text; v_line jsonb; v_credit jsonb;$b$);
    if position($a$    elsif v_status = b.status then v_already := v_already || ('It’s already ' || b.status || '.');$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_check_booking (2)'; end if;
    d := replace(d, $a$    elsif v_status = b.status then v_already := v_already || ('It’s already ' || b.status || '.');$a$, $b$    elsif v_status = 'done' and b.status = 'done' and b.done_tx is null and benny_booking_line(p_center, b.house_no, b.street_name) is not null then
      -- marked done by hand, and the job is on a closed day's logsheet: date it to that day and name who did it
      v_line := benny_booking_line(p_center, b.house_no, b.street_name);
      v_credit := jsonb_strip_nulls(jsonb_build_object('day', v_line->>'day', 'workers', v_line->>'workers', 'shown_as', v_line->>'shown_as', 'was_on', b.done_on, 'was_by', b.done_by_name));
      v_patch := v_patch || jsonb_build_object('credit', true);
      v_change := v_change || jsonb_build_object('credit', v_credit);
      v_ask := v_ask || jsonb_build_object('status', v_status);
      v_notes := v_notes || ('It’s already done. It’s on the ' || to_char((v_line->>'day')::date, 'FMMon FMDD') || ' logsheet of ' || coalesce(v_line->>'workers', 'that day’s cart') || ': the booking is dated that day and credited to them.');
    elsif v_status = b.status then v_already := v_already || ('It’s already ' || b.status || '.');$b$);
    if position($a$      if v_status = 'done' then v_notes := v_notes || 'Marked done by the office: no worker is credited.'::text; end if;$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_check_booking (3)'; end if;
    d := replace(d, $a$      if v_status = 'done' then v_notes := v_notes || 'Marked done by the office: no worker is credited.'::text; end if;$a$, $b$      if v_status = 'done' then
        v_line := benny_booking_line(p_center, b.house_no, b.street_name);
        if v_line is not null then
          v_credit := jsonb_strip_nulls(jsonb_build_object('day', v_line->>'day', 'workers', v_line->>'workers', 'shown_as', v_line->>'shown_as'));
          v_patch := v_patch || jsonb_build_object('credit', true);
          v_change := v_change || jsonb_build_object('credit', v_credit);
          v_notes := v_notes || ('It’s on the ' || to_char((v_line->>'day')::date, 'FMMon FMDD') || ' logsheet of ' || coalesce(v_line->>'workers', 'that day’s cart') || ': the booking is dated that day and credited to them.');
        else v_notes := v_notes || 'Marked done by the office: no worker is credited (it is on no closed day’s logsheet as a production job).'::text; end if;
      end if;$b$);
    execute d;
  end if;

  -- a logsheet job's change: also into an office flat (Production, the code, the season's set value, prepaid)
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_check_job';
  if position($m$ch->>'flat'$m$ in d) = 0 then
    if position($a$fmt constant text := 'FM999999990.00';$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_check_job (1)'; end if;
    d := replace(d, $a$fmt constant text := 'FM999999990.00';$a$, $b$v_flat text; v_fval numeric; v_bk jsonb;
        fmt constant text := 'FM999999990.00';$b$);
    if position($a$  if t_type = 'Production' and t_display ~ '^[A-Za-z]' then
    v_probs := v_probs || ('It’s an office flat (' || substring(t_display from '^[A-Za-z]+') || '): its value is set by the office. Change it on the edit screen if it is really wrong.'); end if;$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_check_job (2)'; end if;
    d := replace(d, $a$  if t_type = 'Production' and t_display ~ '^[A-Za-z]' then
    v_probs := v_probs || ('It’s an office flat (' || substring(t_display from '^[A-Za-z]+') || '): its value is set by the office. Change it on the edit screen if it is really wrong.'); end if;$a$, $b$  -- turning the line into an office flat (AFSL, FSL, SP, RJ…): Production, the flat's code, its set value, prepaid
  v_flat := upper(nullif(regexp_replace(coalesce(ch->>'flat', ''), '[^A-Za-z]', '', 'g'), ''));
  if t_type = 'Production' and t_display ~ '^[A-Za-z]' then
    v_probs := v_probs || (case when v_flat is not null and upper(substring(t_display from '^[A-Za-z]+')) = v_flat then 'It already reads ' || v_flat || '.'
                                else 'It’s an office flat (' || substring(t_display from '^[A-Za-z]+') || '): its value is set by the office. Change it on the edit screen if it is really wrong.' end); end if;
  if v_flat is not null then
    ch := ch - 'amount' - 'paid_by';   -- a flat is worth its set value and is prepaid: nothing else is taken with it
    if length(v_flat) < 2 or length(v_flat) > 6 then v_probs := v_probs || 'An office flat is a short code, like AFSL.'::text; end if;
    if t_type not in ('Sale', 'Production') then
      v_probs := v_probs || ('Only a sale or a production job can become an office flat; this one is ' || case t_type when 'Upgrade' then 'an upgrade' else 'an add-on' end || '.'); end if;
    if coalesce(ch->>'flat_value', '') ~ '^[0-9]+(\.[0-9]+)?$' then
      v_fval := round((ch->>'flat_value')::numeric, 2);
      if v_fval <= 0 or v_fval > 20000 then v_fval := null; end if;
    end if;
    -- an open prebook at that address is completed as the prebook, so its booking closes with it
    if t_job not like 'mb:%' and coalesce(v_job->>'address', '') ~ '^\s*[0-9]' then
      begin v_bk := benny_booking_find(p_center, v_job->>'address'); exception when others then v_bk := null; end;
      if coalesce((v_bk->>'found')::boolean, false) and v_bk #>> '{booking,status}' = 'open' then
        v_probs := v_probs || ('There’s an open prebook at ' || (v_bk #>> '{booking,address}') || ': put that prebook on ' || v_first || '’s logsheet as done instead, so the booking closes with it.'); end if;
    end if;
  end if;$b$);
    if position($a$  if (ch->>'amount') is null and v_raw = '' then$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_check_job (3)'; end if;
    d := replace(d, $a$  if (ch->>'amount') is null and v_raw = '' then$a$, $b$  if v_flat is not null then null;
  elsif (ch->>'amount') is null and v_raw = '' then$b$);
    if position($a$  -- what the save writes: the same fields, in the same shape, as the edit screen's save.$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_check_job (4)'; end if;
    d := replace(d, $a$  -- what the save writes: the same fields, in the same shape, as the edit screen's save.$a$, $b$  if v_flat is not null then
    v_change := jsonb_build_object('flat', jsonb_build_object('to', v_flat, 'from', jsonb_strip_nulls(jsonb_build_object('type', t_type, 'amount', t_price, 'paid_by', nullif(t_method, ''), 'shown_as', nullif(t_display, '')))));
    v_ask := jsonb_build_object('flat', v_flat);
    v_notes := v_notes || 'It becomes a production job at the flat’s set value: it no longer counts as a sale.'::text;
  end if;

  -- what the save writes: the same fields, in the same shape, as the edit screen's save.$b$);
    if position($a$  return jsonb_strip_nulls(jsonb_build_object(
    'ok', cardinality(v_probs) = 0, 'problems', to_jsonb(v_probs), 'date', c.day, 'worker', c.worker,$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_check_job (5)'; end if;
    d := replace(d, $a$  return jsonb_strip_nulls(jsonb_build_object(
    'ok', cardinality(v_probs) = 0, 'problems', to_jsonb(v_probs), 'date', c.day, 'worker', c.worker,$a$, $b$  -- an office flat: the app fills in what the code is worth this season (flat_value) and sends it with the save
  if v_flat is not null then
    v_patch := jsonb_strip_nulls(jsonb_build_object('type', 'Production', 'flat', v_flat, 'display_price', v_flat, 'payment_method', 'Prepaid', 'price', v_fval,
                 'payment_breakdown', case when v_fval is not null then jsonb_build_object('Prepaid', v_fval) end));
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', cardinality(v_probs) = 0, 'problems', to_jsonb(v_probs), 'date', c.day, 'worker', c.worker,$b$);
    execute d;
  end if;

  -- an office flat is saved only with the value the app read from the season's flats
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_job_begin';
  if position($m$? 'flat'$m$ in d) = 0 then
    if position($a$  if (k->>'stamp') is distinct from p_stamp then$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_job_begin (1)'; end if;
    d := replace(d, $a$  if (k->>'stamp') is distinct from p_stamp then$a$, $b$  -- an office flat is saved at the value the app read from the season's flats: a save without it comes from an older tab
  if (k->'ask') ? 'flat' and (k->'patch'->>'price') is null then
    return k || jsonb_build_object('ok', false, 'problems', jsonb_build_array('This screen is on an older version of the app. Refresh the page, then ask me again.')); end if;
  if (k->>'stamp') is distinct from p_stamp then$b$);
    if position($a$jsonb_build_object('amount', k->'patch'->'price', 'paid_by', k->'patch'->'payment_method', 'display', k->'patch'->'display_price'))$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_job_begin (2)'; end if;
    d := replace(d, $a$jsonb_build_object('amount', k->'patch'->'price', 'paid_by', k->'patch'->'payment_method', 'display', k->'patch'->'display_price'))$a$, $b$jsonb_strip_nulls(jsonb_build_object('amount', k->'patch'->'price', 'paid_by', k->'patch'->'payment_method', 'display', k->'patch'->'display_price', 'type', k->'patch'->'type')))$b$);
    execute d;
  end if;

  -- the read-back also checks that the line became the flat
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_job_done';
  if position($m$'type', t.type$m$ in d) = 0 then
    if position($a$select jsonb_build_object('amount', t.price, 'paid_by', t.payment_method, 'display', t.display_price) into v_after$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_job_done (1)'; end if;
    d := replace(d, $a$select jsonb_build_object('amount', t.price, 'paid_by', t.payment_method, 'display', t.display_price) into v_after$a$, $b$select jsonb_build_object('amount', t.price, 'paid_by', t.payment_method, 'display', t.display_price, 'type', t.type) into v_after$b$);
    if position($a$when (v_after->>'amount')::numeric = (r.want->>'amount')::numeric and v_after->>'paid_by' = r.want->>'paid_by' then 'done'$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_job_done (2)'; end if;
    d := replace(d, $a$when (v_after->>'amount')::numeric = (r.want->>'amount')::numeric and v_after->>'paid_by' = r.want->>'paid_by' then 'done'$a$, $b$when (v_after->>'amount')::numeric = (r.want->>'amount')::numeric and v_after->>'paid_by' = r.want->>'paid_by'
                       and (r.want->>'type' is null or (v_after->>'type' = r.want->>'type' and v_after->>'display' = r.want->>'display')) then 'done'$b$);
    execute d;
  end if;

  -- one route: also the days it was knocked, and with Workerbook by whom
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_route';
  if position($m$'knocked'$m$ in d) = 0 then
    if position($a$declare rc text := upper(trim(coalesce(p_route, ''))); rm route_maps;$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_route (1)'; end if;
    d := replace(d, $a$declare rc text := upper(trim(coalesce(p_route, ''))); rm route_maps;$a$, $b$declare rc text := upper(trim(coalesce(p_route, ''))); rm route_maps; v_role text;$b$);
    if position($a$  perform benny_ok_office(p_center);$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_route (2)'; end if;
    d := replace(d, $a$  perform benny_ok_office(p_center);$a$, $b$  v_role := benny_ok_office(p_center);$b$);
    if position($a$    'on_day', case when p_date is null then null else$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_route (3)'; end if;
    d := replace(d, $a$    'on_day', case when p_date is null then null else$a$, $b$    -- each day it was knocked, from what was entered in the app (the same events the areas look-up counts); who, with Workerbook
    'knocks_since', (select min(v.day) from client_visits v where v.center_id = p_center::text),
    'knocked', (with ev as materialized (select e.day, e.kind, e.cn, e.house from benny_areas_ev(p_center, date '2020-01-01', current_date + 1, benny_live_date(p_center)) e where e.route = rc),
                     w as (select ev.day, ev.cn, count(*) filter (where ev.kind = 'knock') k, count(*) filter (where ev.kind = 'sale') s, count(*) filter (where ev.kind = 'production') p from ev where ev.cn is not null group by 1, 2),
                     d as (select ev.day, count(*) filter (where ev.kind = 'knock') k, count(distinct ev.house) filter (where ev.kind = 'knock') h,
                                  count(*) filter (where ev.kind = 'sale') s, count(*) filter (where ev.kind = 'production') p from ev group by 1 order by 1 desc limit 40)
                select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('day', d.day, 'knocks', d.k, 'houses', d.h, 'sales', nullif(d.s, 0), 'prebooks_done', nullif(d.p, 0),
                         'workers', case when v_role = 'admin' then (select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                        'name', coalesce((select u.name from users u where u.user_id = w.cn order by (u.command_center_id = p_center) desc nulls last limit 1), w.cn), 'cn', w.cn,
                                        'knocks', w.k, 'sales', nullif(w.s, 0), 'prebooks_done', nullif(w.p, 0))) order by w.k desc, w.cn) from w where w.day = d.day) end)) order by d.day)
                  from d),
    'on_day', case when p_date is null then null else$b$);
    execute d;
  end if;

  -- already done?: an entry with no house number is a client's name
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_job_history';
  if position($m$v_words$m$ in d) = 0 then
    if position($a$v_jobs jsonb; v_out jsonb := '[]'::jsonb; v_note text;$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_job_history (1)'; end if;
    d := replace(d, $a$v_jobs jsonb; v_out jsonb := '[]'::jsonb; v_note text;$a$, $b$v_jobs jsonb; v_out jsonb := '[]'::jsonb; v_note text; v_words text[];$b$);
    if position($a$    if v_house !~ '^[0-9]+[a-z]?$' or split_part(q, ' ', 2) = '' then$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_job_history (2)'; end if;
    d := replace(d, $a$    if v_house !~ '^[0-9]+[a-z]?$' or split_part(q, ' ', 2) = '' then$a$, $b$    if v_house !~ '^[0-9]' and q ~ '[[:alpha:]]{2}' then
      -- no house number: a client's name. Every word of it has to start a word of the client's name on the line.
      v_words := (select array_agg(x) from (select x from unnest(regexp_split_to_array(lower(regexp_replace(q, '[^[:alnum:] ]', ' ', 'g')), '\s+')) x where length(x) > 1 limit 4) y);
      if v_words is null then
        v_out := v_out || jsonb_build_object('asked', q, 'problem', 'I need a name or an address to look for.'); continue; end if;
      select coalesce(jsonb_agg(j.row order by j.day, j.who), '[]'::jsonb) into v_jobs from (
        select * from (
          select s.day, coalesce(c.label, '') as who,
                 jsonb_strip_nulls(jsonb_build_object('day', s.day, 'client', s.client_name, 'address', s.address,
                   'workers', coalesce((select string_agg(trim(concat_ws(' ', m->>'first_name', m->>'last_name')), ' + ') from jsonb_array_elements(coalesce(c.members, '[]'::jsonb)) m), c.label),
                   'type', s.type, 'shown_as', nullif(s.display_price, ''), 'service', nullif(s.service, ''), 'route', nullif(s.route_code, ''), 'from', 'that day’s payout')) as row
            from payout_sales s left join payout_carts c on c.id = s.cart_id
           where s.center_id = p_center and s.type in ('Sale', 'Production') and coalesce(s.client_name, '') <> ''
             and not exists (select 1 from unnest(v_words) w where s.client_name !~* ('\m' || regexp_replace(w, esc, '\\\1', 'g')))
          union all
          select coalesce(l.date, (t."timestamp" at time zone 'America/Vancouver')::date), coalesce(u.name, t.worker_id),
                 jsonb_strip_nulls(jsonb_build_object('day', coalesce(l.date, (t."timestamp" at time zone 'America/Vancouver')::date), 'client', t.customer_name,
                   'address', coalesce(t.customer_snapshot->>'address', t.address), 'workers', coalesce(u.name, t.worker_id),
                   'type', t.type, 'shown_as', nullif(t.display_price, ''), 'route', nullif(t.route_code, ''),
                   'from', case when coalesce(l.date, (t."timestamp" at time zone 'America/Vancouver')::date) = v_live then 'today’s logsheet' else 'a logsheet not closed yet' end))
            from transactions t left join logsheet_sessions l on l.id = t.session_id left join users u on u.user_id = t.worker_id and u.command_center_id = p_center
           where t.command_center_id = p_center and t.type in ('Sale', 'Production') and coalesce(t.customer_name, '') <> ''
             and not exists (select 1 from unnest(v_words) w where t.customer_name !~* ('\m' || regexp_replace(w, esc, '\\\1', 'g')))) z
         order by z.day desc limit 20) j;
      f := benny_booking_find(p_center, q);
      v_out := v_out || jsonb_strip_nulls(jsonb_build_object('asked', q, 'looked_for', 'a client’s name',
        'booking', case when coalesce((f->>'found')::boolean, false) then jsonb_strip_nulls(jsonb_build_object('address', f #>> '{booking,address}', 'city', f #>> '{booking,city}', 'route', f #>> '{booking,route}',
                     'status', f #>> '{booking,status}', 'done_on', f #>> '{booking,done_on}', 'done_by', f #>> '{booking,done_by}')) end,
        'bookings_like_it', case when not coalesce((f->>'found')::boolean, false) then coalesce(f->'which', f->'closest') end,
        'on_logsheets', v_jobs,
        'note', case when jsonb_array_length(v_jobs) = 0 then 'No logsheet job under that client’s name in this center. The name on the logsheet may be spelled another way: an address finds it for sure.' end));
      continue;
    end if;
    if v_house !~ '^[0-9]+[a-z]?$' or split_part(q, ' ', 2) = '' then$b$);
    execute d;
  end if;

end $do$;

-- A worker's name from their CN. The day's users are cleared when a day closes, so between days a CN had no name:
-- the hires keep it.
create or replace function public.benny_cn_name(p_center uuid, p_cn text) returns text
language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select u.name from users u where u.user_id = p_cn order by (u.command_center_id = p_center) desc nulls last limit 1),
    (select nullif(trim(p.first_name || ' ' || coalesce(p.last_name, '')), '') from hires h join people p on p.id = h.person_id where upper(h.cn) = upper(p_cn) order by h.year desc nulls last limit 1),
    p_cn)
$$;
revoke all on function public.benny_cn_name(uuid, text) from public, anon, authenticated;

do $do$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_route';
  if position('benny_cn_name(' in d) = 0 then
    if position($a$coalesce((select u.name from users u where u.user_id = w.cn order by (u.command_center_id = p_center) desc nulls last limit 1), w.cn)$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_route (names)'; end if;
    execute replace(d, $a$coalesce((select u.name from users u where u.user_id = w.cn order by (u.command_center_id = p_center) desc nulls last limit 1), w.cn)$a$, $b$benny_cn_name(p_center, w.cn)$b$);
  end if;
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'benny_areas';
  if position('benny_cn_name(' in d) = 0 then
    if position($a$'name', coalesce(u.name, w.cn), 'knocks', w.knocks$a$ in d) = 0 then raise exception 'benny log nov16: could not patch benny_areas (names)'; end if;
    execute replace(d, $a$'name', coalesce(u.name, w.cn), 'knocks', w.knocks$a$, $b$'name', benny_cn_name(p_center, w.cn), 'knocks', w.knocks$b$);
  end if;
end $do$;
