-- The Benny: a prebook done on today's live day ("put the rt 35 prebook on Andile's logsheet and mark it done").
-- A route manager asked for exactly that (2026-11-14) and the only card there was added it as a SALE with the price he
-- typed and "Unknown" for the client, and left the booking open. A prebook is a Production job with the booking's own
-- job code (an office flat is worth its set value), client and services, and its booking is done with it.
--   benny_check_prebook_done  checks it for a card (changes nothing). The app saves with the logsheet's own save
--                             (sessionService.completeJob with the booking's id, as the worker's own tap does), and the
--                             bookings sync (mb_from_transaction) marks the booking done.
--                             When the cart already has that address on it today (the prebook logged as a sale), the
--                             card changes that line instead of adding a second one.
--   benny_check_add_job       now refuses an address that is an open prebook, and says what to use instead.

create or replace function public.benny_check_prebook_done(p_center uuid, p_worker text, p_booking text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare c record; f jsonb; b mb_bookings; v_first text; v_addr text; v_pat text; v_n int; t record; v_other text;
        v_cautions text[] := '{}'; v_replaces jsonb; v_client text;
begin
  select * into c from benny_job_cart(p_center, p_worker);
  if c.problem is not null then return jsonb_strip_nulls(jsonb_build_object('ok', false, 'problems', jsonb_build_array(c.problem), 'worker', c.worker)); end if;
  v_first := split_part(c.worker->>'name', ' ', 1);
  if c.status = 'PAID' then
    return jsonb_build_object('ok', false, 'worker', c.worker, 'problems', jsonb_build_array(v_first || '’s logsheet is already paid out, so I won’t add to it from here: the pay wouldn’t follow. Add it in Payout.')); end if;
  if nullif(trim(coalesce(p_booking, '')), '') is null then
    return jsonb_build_object('ok', false, 'worker', c.worker, 'problems', jsonb_build_array('Which prebook? Give me its address, house number first.')); end if;

  f := benny_booking_find(p_center, p_booking);
  if not coalesce((f->>'found')::boolean, false) then
    return jsonb_strip_nulls(jsonb_build_object('ok', false, 'worker', c.worker,
      'problems', jsonb_build_array(case when f ? 'which' then 'More than one booking fits “' || trim(p_booking) || '”. Which one?'
                                         when f ? 'closest' then 'No booking at “' || trim(p_booking) || '”. Is it one of the closest ones?'
                                         else 'No booking at “' || trim(p_booking) || '” in this center.' end),
      'which', f->'which', 'closest', f->'closest'));
  end if;
  select * into b from mb_bookings where id = (f #>> '{booking,id}')::uuid;
  v_addr := trim(b.house_no || ' ' || b.street_name);
  if b.status = 'done' then
    return jsonb_build_object('ok', false, 'worker', c.worker, 'problems', jsonb_build_array(v_addr || ' is already marked done' || coalesce(' (' || to_char(b.done_on, 'Mon FMDD') || coalesce(', ' || b.done_by_name, '') || ')', '') || '.'));
  elsif b.status <> 'open' then
    return jsonb_build_object('ok', false, 'worker', c.worker, 'problems', jsonb_build_array(v_addr || ' is ' || b.status || ', so it can’t be done. Reopen it in Bookings first if that’s wrong.'));
  end if;
  if nullif(trim(coalesce(b.job_code, '')), '') is null then
    return jsonb_build_object('ok', false, 'worker', c.worker, 'problems', jsonb_build_array(v_addr || ' has no job code on its booking, so I can’t tell what it is worth. Complete it on the logsheet screen.')); end if;
  if not coalesce(b.prepaid, false) then
    return jsonb_build_object('ok', false, 'worker', c.worker, 'problems', jsonb_build_array(v_addr || ' isn’t prepaid, so its payment has to be taken: complete it on the logsheet screen.')); end if;

  -- what today's logsheets already have at that address: "40781 Thunderbird…" (the house number, then the street's first word)
  v_pat := '^\s*' || regexp_replace(trim(b.house_no), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\M.*\m'
           || regexp_replace(split_part(trim(b.street_name), ' ', 1), '([.*+?^${}()|\[\]\\])', '\\\1', 'g');
  if exists (select 1 from transactions x where x.command_center_id = p_center and x.job_id = 'mb:' || b.id::text and x.type = 'Production') then
    return jsonb_build_object('ok', false, 'worker', c.worker, 'problems', jsonb_build_array(v_addr || ' is already on a logsheet today as the prebook. The booking will show done once it syncs.')); end if;
  select count(*) into v_n from transactions x
   where x.command_center_id = p_center and x.session_id = c.cart_id and x.type in ('Sale', 'Production') and (x.customer_snapshot->>'address') ~* v_pat;
  if v_n > 1 then
    return jsonb_build_object('ok', false, 'worker', c.worker, 'problems', jsonb_build_array(v_first || '’s logsheet has ' || v_n || ' jobs at ' || v_addr || ' today. Sort those out on the edit screen (RM map › the worker › tap the job) first.'));
  elsif v_n = 1 then
    select x.id, x.type, x.price, x.payment_method, x.display_price into t from transactions x
     where x.command_center_id = p_center and x.session_id = c.cart_id and x.type in ('Sale', 'Production') and (x.customer_snapshot->>'address') ~* v_pat limit 1;
    if coalesce(t.payment_method, '') in ('Credit Card', 'Split') then
      return jsonb_build_object('ok', false, 'worker', c.worker, 'problems', jsonb_build_array(v_first || '’s logsheet already has a job at ' || v_addr || ' paid by ' || lower(t.payment_method) || ', so it isn’t the prepaid prebook logged wrong. Check it on the edit screen.')); end if;
    v_replaces := jsonb_build_object('id', t.id, 'type', t.type, 'amount', t.price, 'paid_by', t.payment_method, 'shown_as', t.display_price);
  end if;
  select coalesce(u.name, x.worker_id) into v_other from transactions x left join users u on u.user_id = x.worker_id and u.command_center_id = p_center
   where x.command_center_id = p_center and x.session_id is distinct from c.cart_id and x.type in ('Sale', 'Production') and (x.customer_snapshot->>'address') ~* v_pat limit 1;
  if v_other is not null then v_cautions := v_cautions || ('This address is already on ' || v_other || '’s logsheet today. Check it isn’t the same job twice.'); end if;
  if upper(coalesce(b.route_code, '')) <> '' and not exists (select 1 from bookings k where k.command_center_id = p_center and k.booking_id = 'mb:' || b.id::text) then
    v_cautions := v_cautions || ('It isn’t loaded on today’s map' || case when b.map_state = 'moved' then ' (it was moved to ' || b.route_code || ' after the day started)' else '' end || ', which is why it isn’t on the logsheet to tap.');
  end if;

  v_client := nullif(trim(concat_ws(' ', b.people->0->>'first', b.people->0->>'last')), '');
  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'date', c.day, 'worker', c.worker, 'cart', jsonb_build_object('id', c.cart_id, 'workers', to_jsonb(c.cns), 'names', to_jsonb(c.names)),
    'booking', jsonb_build_object('id', b.id, 'address', v_addr || coalesce(', unit ' || nullif(trim(b.unit), ''), ''), 'street_address', v_addr, 'city', b.city, 'route', upper(b.route_code),
                                  'job_code', upper(trim(b.job_code)), 'prepaid', coalesce(b.prepaid, false), 'client', v_client,
                                  'services', case when jsonb_typeof(b.services) = 'object' and b.services <> '{}'::jsonb then b.services end,
                                  'property_type', nullif(b.property_type, ''), 'field_notes', nullif(trim(coalesce(b.field_notes, '')), '')),
    'contact', jsonb_strip_nulls(jsonb_build_object('phone', b.phones[1], 'email', b.emails[1])),
    'replaces', v_replaces,
    'cautions', case when cardinality(v_cautions) > 0 then to_jsonb(v_cautions) end,
    'stamp', md5(b.id::text || b.status || coalesce(b.updated_at::text, '') || c.cart_id || coalesce(v_replaces->>'id', '') || coalesce(v_replaces->>'type', '') || coalesce(v_replaces->>'amount', ''))));
end $$;
revoke all on function public.benny_check_prebook_done(uuid, text, text) from public, anon;
grant execute on function public.benny_check_prebook_done(uuid, text, text) to authenticated;

-- adding a job: an address that is an open prebook is not a sale
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.benny_check_add_job(uuid, text, jsonb)'::regprocedure);
  if position('propose_prebook_done' in d) > 0 then return; end if;
  n := replace(d, '  if v_route is null then v_missing := v_missing || ''the route''::text; end if;',
'  if v_address is not null then
    declare pf jsonb := benny_booking_find(p_center, v_address);
    begin
      if coalesce((pf->>''found'')::boolean, false) and not (pf ? ''heard_as'') and pf #>> ''{booking,status}'' = ''open'' then
        v_probs := v_probs || (v_address || '' is an open prebook'' || coalesce('' ('' || nullif(pf #>> ''{booking,job}'', '''') || '')'', '''') || ''. It goes on the logsheet as the prebook, not as a sale: use propose_prebook_done with the worker and this address.'');
      end if;
    end;
  end if;
  if v_route is null then v_missing := v_missing || ''the route''::text; end if;');
  if n = d then raise exception 'benny_check_add_job: not patched'; end if;
  execute n;
end $$;

-- After the save. With p_tx (the line that was already on the logsheet and has just been changed into the prebook with
-- the logsheet's own edit save): puts the booking's id on that line, so it is the same as a prebook the worker
-- completed themselves, and the bookings sync marks the booking done (and reopens it if the line is ever deleted).
-- Without p_tx it changes nothing. Either way it says whether the booking now reads done.
create or replace function public.benny_prebook_after(p_center uuid, p_worker text, p_booking uuid, p_tx text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c record; b mb_bookings; v_n int;
begin
  select * into c from benny_job_cart(p_center, p_worker);
  if c.problem is not null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array(c.problem)); end if;
  select m.* into b from mb_bookings m join mb_lists l on l.id = m.list_id where m.id = p_booking and l.center_id = p_center;
  if b.id is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('That booking isn’t in this center.')); end if;
  if nullif(trim(coalesce(p_tx, '')), '') is not null and b.status = 'open' then
    update transactions x set job_id = 'mb:' || b.id::text
     where x.command_center_id = p_center and x.id::text = trim(p_tx) and x.session_id = c.cart_id and x.type = 'Production'
       and upper(coalesce(x.display_price, '')) = upper(trim(b.job_code)) and coalesce(x.job_id, '') not like 'mb:%';
    get diagnostics v_n = row_count;
    if v_n = 0 then return jsonb_build_object('ok', false, 'status', b.status, 'problems', jsonb_build_array('That line isn’t the prebook on this logsheet, so the booking was left as it is.')); end if;
    update bookings k set status = 'completed', contractor_id = c.worker->>'cn' where k.command_center_id = p_center and k.booking_id = 'mb:' || b.id::text and k.status is distinct from 'completed';
    select m.* into b from mb_bookings m where m.id = p_booking;
  end if;
  return jsonb_build_object('ok', true, 'status', b.status);
end $$;
revoke all on function public.benny_prebook_after(uuid, text, uuid, text) from public, anon;
grant execute on function public.benny_prebook_after(uuid, text, uuid, text) to authenticated;
