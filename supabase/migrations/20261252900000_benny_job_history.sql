-- The Benny: "are these addresses already done on a logsheet?" (a route manager asked, 2026-11-14, with three
-- addresses; the Benny could only read today's logsheets on his own team and said nothing of what it found).
--   benny_job_history   for each address: every day it was on a logsheet in this center (closed days from the payouts,
--                       the live day from the logsheets: the day, who, what) and where its booking stands. It also says
--                       when the two disagree: done on a logsheet with the booking still open, or the other way round.
--                       No amounts, no client, no phone numbers: a route manager may ask it about any address.
--   benny_check_prebook_done / benny_prebook_after
--                       a prebook that was logged as a sale can still be fixed after someone marked its booking done by
--                       hand in Bookings: the line becomes the prebook and is tied to the booking.

create or replace function public.benny_job_history(p_center uuid, p_addresses text[])
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_role text := benny_ok_any(p_center); a text; q text; v_house text; v_word text; v_word2 text; f jsonb; b mb_bookings; v_pat text; v_pat2 text;
        v_jobs jsonb; v_out jsonb := '[]'::jsonb; v_note text; v_live date := benny_live_date(p_center); esc constant text := '([.*+?^${}()|\[\]\\])';
begin
  if v_role not in ('admin', 'rm') then raise exception 'Not allowed' using errcode = '42501'; end if;
  for a in select x from unnest(coalesce(p_addresses, '{}'::text[])) x where length(trim(coalesce(x, ''))) > 0 limit 12 loop
    q := trim(regexp_replace(split_part(a, ',', 1), '\s+', ' ', 'g'));
    v_house := lower(split_part(q, ' ', 1));
    if v_house !~ '^[0-9]+[a-z]?$' or split_part(q, ' ', 2) = '' then
      v_out := v_out || jsonb_build_object('asked', q, 'problem', 'I need the house number and the street, like 46542 MacGregor Pl.');
      continue;
    end if;
    v_word := split_part(q, ' ', 2);
    -- the booking at that address, if there is one (a street heard or typed a little off still finds it)
    b := null; v_word2 := null;
    f := benny_booking_find(p_center, q);
    if coalesce((f->>'found')::boolean, false) then
      select * into b from mb_bookings where id = (f #>> '{booking,id}')::uuid;
      v_word2 := split_part(trim(b.street_name), ' ', 1);
    end if;
    v_pat := '^\s*' || regexp_replace(v_house, esc, '\\\1', 'g') || '\M.*\m' || regexp_replace(v_word, esc, '\\\1', 'g');
    v_pat2 := case when v_word2 is not null and lower(v_word2) <> lower(v_word) then '^\s*' || regexp_replace(v_house, esc, '\\\1', 'g') || '\M.*\m' || regexp_replace(v_word2, esc, '\\\1', 'g') end;

    select coalesce(jsonb_agg(j.row order by j.day, j.who), '[]'::jsonb) into v_jobs from (
      -- closed days: what the payouts kept
      select s.day, coalesce((select string_agg(trim(concat_ws(' ', m->>'first_name', m->>'last_name')), ' + ') from jsonb_array_elements(coalesce(c.members, '[]'::jsonb)) m), c.label, '') as who,
             jsonb_strip_nulls(jsonb_build_object('day', s.day, 'workers', coalesce((select string_agg(trim(concat_ws(' ', m->>'first_name', m->>'last_name')), ' + ') from jsonb_array_elements(coalesce(c.members, '[]'::jsonb)) m), c.label),
               'type', s.type, 'shown_as', nullif(s.display_price, ''), 'service', nullif(s.service, ''), 'route', nullif(s.route_code, ''), 'address', s.address, 'from', 'that day’s payout')) as row
        from payout_sales s left join payout_carts c on c.id = s.cart_id
       where s.center_id = p_center and s.type in ('Sale', 'Production') and (s.address ~* v_pat or (v_pat2 is not null and s.address ~* v_pat2))
      union all
      -- the live day (and any day not closed yet): the logsheets themselves
      select coalesce(l.date, (t."timestamp" at time zone 'America/Vancouver')::date), coalesce(u.name, t.worker_id),
             jsonb_strip_nulls(jsonb_build_object('day', coalesce(l.date, (t."timestamp" at time zone 'America/Vancouver')::date), 'workers', coalesce(u.name, t.worker_id),
               'type', t.type, 'shown_as', nullif(t.display_price, ''), 'route', nullif(t.route_code, ''), 'address', t.customer_snapshot->>'address',
               'from', case when coalesce(l.date, (t."timestamp" at time zone 'America/Vancouver')::date) = v_live then 'today’s logsheet' else 'a logsheet not closed yet' end))
        from transactions t left join logsheet_sessions l on l.id = t.session_id left join users u on u.user_id = t.worker_id and u.command_center_id = p_center
       where t.command_center_id = p_center and t.type in ('Sale', 'Production')
         and ((t.customer_snapshot->>'address') ~* v_pat or (v_pat2 is not null and (t.customer_snapshot->>'address') ~* v_pat2))
         and not exists (select 1 from payout_sales s2 where s2.center_id = p_center and s2.day = coalesce(l.date, (t."timestamp" at time zone 'America/Vancouver')::date)
                          and (s2.address ~* v_pat or (v_pat2 is not null and s2.address ~* v_pat2)))
    ) j;

    v_note := case
      when b.id is not null and b.status = 'open' and exists (select 1 from jsonb_array_elements(v_jobs) x where x->>'type' = 'Production')
        then 'It was done on a logsheet, but its booking is still open: the booking was never closed.'
      when b.id is not null and b.status = 'open' and jsonb_array_length(v_jobs) > 0
        then 'It is on a logsheet as a sale, and its booking is still open: check whether that sale was really this prebook.'
      when b.id is not null and b.status = 'done' and jsonb_array_length(v_jobs) = 0
        then 'Its booking is marked done, but it is on no logsheet in the app.'
      when b.id is not null and b.status = 'done' and b.done_tx is null and not exists (select 1 from jsonb_array_elements(v_jobs) x where x->>'type' = 'Production')
        then 'Its booking is marked done, but the logsheet has it as a sale, not as the prebook: the worker’s pay doesn’t count it as the prebook until that line is fixed.'
      when b.id is not null and b.status = 'open' then 'An open prebook: on no logsheet yet.'
      when b.id is null and jsonb_array_length(v_jobs) = 0 then 'No booking and no logsheet job at that address in this center.'
    end;
    v_out := v_out || jsonb_strip_nulls(jsonb_build_object('asked', q,
      'booking', case when b.id is not null then jsonb_strip_nulls(jsonb_build_object('address', trim(b.house_no || ' ' || b.street_name), 'city', b.city, 'route', b.route_code, 'job_code', nullif(b.job_code, ''),
                   'status', b.status, 'done_on', b.done_on, 'done_by', b.done_by_name, 'heard_as', f->>'heard_as')) end,
      'booking_closest', case when b.id is null then coalesce(f->'which', f->'closest') end,
      'on_logsheets', v_jobs, 'note', v_note));
  end loop;
  if jsonb_array_length(v_out) = 0 then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Which addresses? House number first.')); end if;
  return jsonb_build_object('ok', true, 'center_live_day', v_live, 'addresses', v_out,
    'covers', 'Every closed day’s payout in this center and the logsheets of the live day. A job logged under a different address, or on paper only, isn’t here.');
end $$;
revoke all on function public.benny_job_history(uuid, text[]) from public, anon;
grant execute on function public.benny_job_history(uuid, text[]) to authenticated;

-- the fix card, when the booking was already marked done by hand
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.benny_check_prebook_done(uuid, text, text)'::regprocedure);
  if position('v_done_by_hand' in d) = 0 then
    n := replace(d, 'v_cautions text[] := ''{}''; v_replaces jsonb; v_client text;', 'v_cautions text[] := ''{}''; v_replaces jsonb; v_client text; v_done_by_hand boolean := false;');
    -- a booking closed by hand (no logsheet line tied to it) while the cart still has a line at that address: go on to the fix
    n := replace(n, '  if b.status = ''done'' then
    return', '  v_done_by_hand := b.status = ''done'' and b.done_tx is null and exists (
      select 1 from transactions x where x.command_center_id = p_center and x.session_id = c.cart_id and x.type in (''Sale'', ''Production'') and coalesce(x.job_id, '''') not like ''mb:%''
         and (x.customer_snapshot->>''address'') ~* (''^\s*'' || regexp_replace(trim(b.house_no), ''([.*+?^${}()|\[\]\\])'', ''\\\1'', ''g'') || ''\M.*\m'' || regexp_replace(split_part(trim(b.street_name), '' '', 1), ''([.*+?^${}()|\[\]\\])'', ''\\\1'', ''g'')));
  if b.status = ''done'' and not v_done_by_hand then
    return');
    n := replace(n, '  elsif b.status <> ''open'' then', '  elsif b.status not in (''open'', ''done'') then');
    n := replace(n, '  v_client := nullif(trim(concat_ws', '  if v_done_by_hand then
    if v_replaces is null then return jsonb_build_object(''ok'', false, ''worker'', c.worker, ''problems'', jsonb_build_array(v_addr || '' is already marked done'' || coalesce('' ('' || to_char(b.done_on, ''Mon FMDD'') || '')'', '''') || ''.'')); end if;
    v_cautions := v_cautions || (''The booking was already marked done'' || coalesce('' in Bookings ('' || to_char(b.done_on, ''Mon FMDD'') || '')'', '''') || '': it stays done, and now names '' || v_first || ''.'');
  end if;
  v_client := nullif(trim(concat_ws');
    n := replace(n, '''replaces'', v_replaces,', '''replaces'', v_replaces, ''booking_done'', case when v_done_by_hand then true end,');
    if position('v_done_by_hand then true end' in n) = 0 or position('not v_done_by_hand' in n) = 0 or position('it stays done' in n) = 0 or position('not in (''open'', ''done'')' in n) = 0 then raise exception 'benny_check_prebook_done: not patched'; end if;
    execute n;
  end if;
  d := pg_get_functiondef('public.benny_prebook_after(uuid, text, uuid, text)'::regprocedure);
  if position('b.done_tx is null' in d) = 0 then
    n := replace(d, 'is not null and b.status = ''open'' then', 'is not null and (b.status = ''open'' or (b.status = ''done'' and b.done_tx is null)) then');
    if n = d then raise exception 'benny_prebook_after: not patched'; end if;
    execute n;
  end if;
end $$;
