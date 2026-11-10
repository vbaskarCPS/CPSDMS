-- The Benny can change a Master Booking (what people also call a prebook, a job or a "service ticket"): mark it done,
-- cancelled or open again; add to or replace its field note or office note; move it to another route.
-- As with every change, these functions only FIND the booking and CHECK the change. The app saves it, with the Bookings
-- screen's own save (app_mb_booking_save), after the person taps Save on the card. Super admins only.
-- Additive only.

-- One booking as the Benny sees it: no phone numbers, no emails.
create or replace function public.benny_booking_json(b mb_bookings)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', b.id,
    'address', trim(b.house_no || ' ' || b.street_name) || coalesce(', unit ' || nullif(trim(b.unit), ''), ''),
    'city', b.city,
    'list', (select l.name || ' ' || l.year from mb_lists l where l.id = b.list_id),
    'job', nullif(b.job_code, ''),
    'status', b.status, 'done_on', b.done_on, 'done_by', b.done_by_name,
    'tried', nullif(jsonb_array_length(coalesce(b.attempts, '[]'::jsonb)), 0),
    'last_try', case when jsonb_array_length(coalesce(b.attempts, '[]'::jsonb)) > 0
                     then concat_ws(': ', b.attempts->-1->>'day', coalesce(b.attempts->-1->>'reason', b.attempts->-1->>'kind')) end,
    'route', b.route_code, 'map', b.area_name, 'placed', b.map_state, 'prepaid', b.prepaid,
    'people', (select jsonb_agg(x.n) from (select nullif(trim(concat_ws(' ', p->>'first', p->>'last')), '') n
                                             from jsonb_array_elements(coalesce(b.people, '[]'::jsonb)) p) x where x.n is not null),
    'field_note', nullif(trim(b.field_notes), ''), 'office_note', nullif(trim(b.office_notes), ''),
    'on_live_map', case when exists (select 1 from bookings lb where lb.booking_id = 'mb:' || b.id::text) then true end,
    'round', case when coalesce(b.round, 1) > 1 then b.round end,
    'refund_requested', case when b.refund_requested_at is not null then true end,
    'lat', b.lat, 'lng', b.lng,
    'stamp', b.updated_at))
$$;

-- Find a booking in a center: by its id, by "house number + street" ("3575 Latimer"), by street alone or by the
-- client's name. One match = found. Several = which. None = the nearest by sound (a misheard street) or by house number.
create or replace function public.benny_booking_find(p_center uuid, p_q text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'extensions' as $$
declare q text := trim(regexp_replace(split_part(coalesce(p_q, ''), ',', 1), '\s+', ' ', 'g'));
        v_house text; v_rest text; v_norm text; v_ids uuid[]; v jsonb; n int; best real; second real; pass int;
begin
  if q = '' then return jsonb_build_object('found', false, 'q', q); end if;
  if q ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select benny_booking_json(b) into v from mb_bookings b join mb_lists l on l.id = b.list_id where b.id = q::uuid and l.center_id = p_center;
    if v is null then return jsonb_build_object('found', false, 'q', q); end if;
    return jsonb_build_object('found', true, 'booking', v);
  end if;

  -- pass 1: the first word is the house number; pass 2: the whole thing is a street or a name ("82 Ave", "Smith")
  for pass in 1..2 loop
    if pass = 1 and split_part(q, ' ', 1) ~* '^[0-9]+[a-z]?$' then
      v_house := lower(split_part(q, ' ', 1));
      v_rest := nullif(trim(substr(q, length(split_part(q, ' ', 1)) + 1)), '');
    elsif pass = 1 then continue;
    else v_house := null; v_rest := q; end if;
    v_norm := norm_street(v_rest);
    select array_agg(b.id) into v_ids
      from mb_bookings b join mb_lists l on l.id = b.list_id
     where l.center_id = p_center
       and ((v_house is not null and lower(trim(b.house_no)) = v_house
             and (v_norm is null or b.street_norm = v_norm or b.street_norm like v_norm || ' %' or ' ' || b.street_norm || ' ' like '% ' || v_norm || ' %'))
         or (v_house is null and v_norm is not null
             and (b.street_norm = v_norm or b.street_norm like v_norm || ' %' or ' ' || b.street_norm || ' ' like '% ' || v_norm || ' %'
                  or exists (select 1 from jsonb_array_elements(coalesce(b.people, '[]'::jsonb)) p
                              where position(lower(v_rest) in lower(concat_ws(' ', p->>'first', p->>'last'))) > 0))));
    exit when coalesce(cardinality(v_ids), 0) > 0;
  end loop;
  n := coalesce(cardinality(v_ids), 0);

  if n = 1 then
    select benny_booking_json(b) into v from mb_bookings b where b.id = v_ids[1];
    return jsonb_build_object('found', true, 'booking', v);
  end if;
  if n > 1 then
    select jsonb_agg(x.j) into v from (
      select jsonb_strip_nulls(jsonb_build_object('id', b.id, 'address', trim(b.house_no || ' ' || b.street_name), 'city', b.city,
               'list', (select l.name || ' ' || l.year from mb_lists l where l.id = b.list_id), 'status', b.status, 'route', b.route_code)) j
        from mb_bookings b where b.id = any (v_ids) order by (b.status = 'open') desc, b.street_name, b.house_no limit 8) x;
    return jsonb_build_object('found', false, 'q', q, 'which', v, 'matches', n);
  end if;

  -- nothing exact: back to "house number + street", and look for the nearest
  if split_part(q, ' ', 1) ~* '^[0-9]+[a-z]?$' then
    v_house := lower(split_part(q, ' ', 1)); v_rest := nullif(trim(substr(q, length(split_part(q, ' ', 1)) + 1)), '');
  else v_house := null; v_rest := q; end if;
  v_norm := norm_street(v_rest);
  if v_norm is null then return jsonb_build_object('found', false, 'q', q); end if;

  -- a misheard street: the same house number (when given), the street nearest by sound. Scored with and without
  -- the street type, so "Briar Wood" finds "Briarwood Cr".
  select jsonb_agg(z.j order by z.s desc), max(z.s), (array_agg(z.s order by z.s desc))[2] into v, best, second
    from (select y.j, y.s from (
            select jsonb_strip_nulls(jsonb_build_object('id', b.id, 'address', trim(b.house_no || ' ' || b.street_name), 'city', b.city,
                     'list', (select l.name || ' ' || l.year from mb_lists l where l.id = b.list_id), 'status', b.status, 'route', b.route_code)) j,
                   greatest(benny_name_score(v_norm, b.street_norm),
                            benny_name_score(v_norm, regexp_replace(b.street_norm, ' [a-z]+$', '')),
                            benny_name_score(regexp_replace(v_norm, ' [a-z]+$', ''), regexp_replace(b.street_norm, ' [a-z]+$', ''))) s
              from mb_bookings b join mb_lists l on l.id = b.list_id
             where l.center_id = p_center and (v_house is null or lower(trim(b.house_no)) = v_house)) y
           where y.s >= 0.3 order by y.s desc limit 5) z;
  if v is not null then
    if v_house is not null and best >= 0.55 and coalesce(second, 0) <= best - 0.15 then
      select benny_booking_json(b) into v from mb_bookings b where b.id = (v->0->>'id')::uuid;
      return jsonb_build_object('found', true, 'heard_as', q, 'booking', v);
    end if;
    return jsonb_build_object('found', false, 'q', q, 'closest', v);
  end if;

  -- the street is right but no booking at that number: the nearest numbers on it
  if v_house is not null then
    select jsonb_agg(z.j order by z.d) into v
      from (select jsonb_strip_nulls(jsonb_build_object('id', b.id, 'address', trim(b.house_no || ' ' || b.street_name), 'city', b.city,
                     'list', (select l.name || ' ' || l.year from mb_lists l where l.id = b.list_id), 'status', b.status, 'route', b.route_code)) j,
                   abs(coalesce(nullif(regexp_replace(b.house_no, '\D', '', 'g'), ''), '0')::numeric - coalesce(nullif(regexp_replace(v_house, '\D', '', 'g'), ''), '0')::numeric) d
              from mb_bookings b join mb_lists l on l.id = b.list_id
             where l.center_id = p_center
               and (b.street_norm = v_norm or b.street_norm like v_norm || ' %' or ' ' || b.street_norm || ' ' like '% ' || v_norm || ' %')
             order by 2 limit 5) z;
    if v is not null then return jsonb_build_object('found', false, 'q', q, 'closest', v); end if;
  end if;
  return jsonb_build_object('found', false, 'q', q);
end $$;

-- The Benny's lookup of one booking. Super admins.
create or replace function public.benny_booking(p_center uuid, p_q text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare f jsonb;
begin
  if benny_ok_any(p_center) <> 'admin' then raise exception 'Not allowed' using errcode = '42501'; end if;
  f := benny_booking_find(p_center, p_q);
  if f ? 'booking' then f := jsonb_set(f, '{booking}', (f->'booking') - 'lat' - 'lng' - 'stamp'); end if;
  return f;
end $$;

-- Check a change to one booking, and say exactly what would be saved. Changes nothing.
-- p_change: { status: open|done|cancelled, route: code, field_note: text, office_note: text, note_mode: add|replace }
-- Returns ok + the booking as it is, the change in words (change), the fields to save (patch), cautions (notes), and
-- ask + stamp so the app can run the same check again right before saving and see that nothing moved in between.
create or replace function public.benny_check_booking(p_center uuid, p_booking text, p_change jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare f jsonb; b mb_bookings; ch jsonb := coalesce(p_change, '{}'::jsonb);
        v_probs text[] := '{}'; v_notes text[] := '{}'; v_already text[] := '{}';
        v_status text := nullif(lower(trim(ch->>'status')), ''); v_route text := nullif(upper(regexp_replace(coalesce(ch->>'route', ''), '\s', '', 'g')), '');
        v_mode text := case when lower(coalesce(ch->>'note_mode', 'add')) = 'replace' then 'replace' else 'add' end;
        v_patch jsonb := '{}'; v_change jsonb := '{}'; v_ask jsonb := '{}'; v_map text; v_region text;
        k text; v_text text; v_was text; v_res text; v_label text;
begin
  if benny_ok_any(p_center) <> 'admin' then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Only super admins can change a booking from here. Use Bookings › List.')); end if;
  f := benny_booking_find(p_center, p_booking);
  if not coalesce((f->>'found')::boolean, false) then
    return jsonb_strip_nulls(jsonb_build_object('ok', false, 'problems', jsonb_build_array(
      case when jsonb_array_length(coalesce(f->'which', '[]'::jsonb)) > 0
             then 'Which one: ' || (select string_agg((e->>'address') || coalesce(', ' || (e->>'city'), '') || ' (' || concat_ws(', ', e->>'list', e->>'status') || ')', '; ')
                                      from jsonb_array_elements(f->'which') e) || '?'
           when jsonb_array_length(coalesce(f->'closest', '[]'::jsonb)) > 0
             then 'No booking at “' || coalesce(p_booking, '') || '”. Closest: ' || (select string_agg((e->>'address') || coalesce(', ' || (e->>'city'), ''), '; ')
                                                                                        from jsonb_array_elements(f->'closest') e) || '.'
           else 'No booking found for “' || coalesce(p_booking, '') || '” in this center.' end),
      'which', f->'which', 'closest', f->'closest'));
  end if;
  select * into b from mb_bookings where id = (f->'booking'->>'id')::uuid;

  -- status
  if v_status is not null then
    if v_status not in ('open', 'done', 'cancelled') then v_probs := v_probs || 'A booking can be open, done or cancelled.'::text;
    elsif v_status = b.status then v_already := v_already || ('It’s already ' || b.status || '.');
    else
      v_patch := v_patch || jsonb_build_object('status', v_status);
      v_change := v_change || jsonb_build_object('status', jsonb_build_object('from', b.status, 'to', v_status));
      v_ask := v_ask || jsonb_build_object('status', v_status);
      if v_status = 'done' then v_notes := v_notes || 'Marked done by the office: no worker is credited.'::text; end if;
      if b.status = 'done' then v_notes := v_notes || 'Clears who did it and when.'::text; end if;
      if v_status = 'cancelled' and coalesce(b.prepaid, false) then v_notes := v_notes || 'It’s prepaid: cancelling here doesn’t mark it for a refund.'::text; end if;
    end if;
  end if;

  -- route
  if v_route is not null then
    select area_name into v_map from route_maps where route_code = v_route and status = 'approved' limit 1;
    select region into v_region from command_centers where id = p_center;
    if v_map is null then v_probs := v_probs || ('Route ' || v_route || ' isn’t on a built map.');
    elsif v_region is not null and exists (select 1 from area_prefixes ap where ap.area_name = v_map)
          and not exists (select 1 from area_prefixes ap where ap.area_name = v_map and ap.region = v_region) then
      v_probs := v_probs || ('Route ' || v_route || ' (' || v_map || ') is in another region.');
    elsif v_route = upper(coalesce(b.route_code, '')) then v_already := v_already || ('It’s already on ' || v_route || '.');
    else
      v_patch := v_patch || jsonb_build_object('route_code', v_route);
      v_change := v_change || jsonb_build_object('route', jsonb_strip_nulls(jsonb_build_object('from', b.route_code, 'to', v_route, 'map', v_map)));
      v_ask := v_ask || jsonb_build_object('route', v_route);
    end if;
  end if;

  -- notes: add puts the text under what is there; replace overwrites (empty = clear)
  foreach k in array array['field', 'office'] loop
    continue when not (ch ? (k || '_note'));
    v_text := trim(coalesce(ch->>(k || '_note'), ''));
    v_was := nullif(trim(coalesce(case k when 'field' then b.field_notes else b.office_notes end, '')), '');
    v_label := case k when 'field' then 'field note' else 'office note' end;
    if length(v_text) > 500 then v_probs := v_probs || ('That ' || v_label || ' is too long (500 characters at most).');
    elsif v_mode = 'add' and v_text = '' then v_probs := v_probs || ('What should the ' || v_label || ' say?');
    elsif v_mode = 'add' and v_was is not null and position(lower(v_text) in lower(v_was)) > 0 then v_already := v_already || ('The ' || v_label || ' already says that.');
    elsif v_mode = 'replace' and v_text = coalesce(v_was, '') then
      v_already := v_already || (case when v_text = '' then 'There’s no ' || v_label || ' to clear.' else 'The ' || v_label || ' already says that.' end);
    else
      v_res := case when v_mode = 'add' and v_was is not null then v_was || E'\n' || v_text else v_text end;
      v_patch := v_patch || jsonb_build_object(k || '_notes', v_res);
      v_change := v_change || jsonb_build_object(k || '_note', jsonb_strip_nulls(jsonb_build_object(
        'mode', case when v_text = '' then 'clear' when v_mode = 'replace' and v_was is not null then 'replace' when v_was is not null then 'add' else 'set' end,
        'text', v_text, 'was', v_was)));
      v_ask := v_ask || jsonb_build_object(k || '_note', v_text, 'note_mode', v_mode);
    end if;
  end loop;

  if cardinality(v_probs) = 0 and v_patch = '{}'::jsonb then
    v_probs := v_probs || coalesce(v_already[1], 'Nothing to change: tell me the status, a note or the route.');
  elsif cardinality(v_probs) = 0 then
    v_notes := v_already || v_notes;
    if coalesce((f->'booking'->>'on_live_map')::boolean, false) then
      v_notes := v_notes || 'It’s loaded on today’s live map: the crew’s copy stays as it was loaded.'::text; end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', cardinality(v_probs) = 0, 'problems', to_jsonb(v_probs),
    'booking', (f->'booking') - 'lat' - 'lng' - 'stamp', 'heard_as', f->'heard_as',
    'change', v_change, 'patch', v_patch, 'notes', to_jsonb(v_notes), 'ask', v_ask, 'stamp', b.updated_at,
    'map', v_map, 'route', case when v_patch ? 'route_code' then v_route end,
    'pin', case when v_patch ? 'route_code' and b.lat is not null and b.lng is not null
                then jsonb_build_object('lat', b.lat, 'lng', b.lng, 'label', trim(b.house_no || ' ' || b.street_name), 'route', v_route) end));
end $$;

-- the helpers are for the functions above only; the two tools are for signed-in people (each checks who is asking)
revoke all on function public.benny_booking_json(mb_bookings) from public, anon, authenticated;
revoke all on function public.benny_booking_find(uuid, text) from public, anon, authenticated;
revoke all on function public.benny_booking(uuid, text) from public, anon;
revoke all on function public.benny_check_booking(uuid, text, jsonb) from public, anon;
grant execute on function public.benny_booking(uuid, text) to authenticated;
grant execute on function public.benny_check_booking(uuid, text, jsonb) to authenticated;
