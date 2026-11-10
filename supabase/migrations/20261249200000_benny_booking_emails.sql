-- The Benny can set up the booking emails to customers ("service notification emails"): the day-before reminder, and
-- the next-try note for a missed visit. It never sends one. This function only CHECKS the request and COUNTS who would
-- get an email; the card opens Bookings › Send booking emails with the day and routes picked and the emails written, and
-- the person reads them and presses Send there, as they do by hand today. Super admins only.
-- No customer name or address leaves the database here: only counts.
-- Additive only.

create or replace function public.benny_check_emails(p_center uuid, p_kind text, p_date date default null, p_today date default null,
                                                     p_routes text[] default null, p_maps text[] default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_kind text := lower(trim(coalesce(p_kind, 'day_before')));
        v_today date := coalesce(p_today, (now() at time zone 'America/Vancouver')::date);
        v_date date; v_label text; v_key text;
        v_probs text[] := '{}'; v_notes text[] := '{}';
        v_maps text[] := coalesce(benny_resolve_maps(p_maps), '{}');
        v_asked text[] := array(select distinct upper(regexp_replace(x, '\s', '', 'g')) from unnest(coalesce(p_routes, '{}')) x where trim(x) <> '');
        v_routes jsonb; v_codes text[]; v_areas text[]; v_out text[]; v_list mb_lists; v_from text;
        n_all int := 0; n_ready int := 0; n_noemail int := 0; n_sent int := 0;
begin
  if benny_ok_any(p_center) <> 'admin' then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Only super admins can set up booking emails from here. Use Bookings › Send booking emails.')); end if;
  if v_kind not in ('day_before', 'next_try') then
    return jsonb_build_object('ok', false, 'problems', jsonb_build_array('There are two booking emails: the day before, and the next try after a missed visit.')); end if;
  v_label := case v_kind when 'day_before' then 'day-before' else 'next-try' end;
  v_date := coalesce(p_date, v_today + 1);
  if v_date not in (v_today + 1, v_today + 2) then
    v_probs := v_probs || 'Booking emails go out for tomorrow or the day after.'::text; end if;
  v_key := v_kind || ':' || v_date::text;

  -- the routes: named codes and whole maps, on this center's own maps (the ones its screen can pick)
  select jsonb_agg(jsonb_build_object('code', rm.route_code, 'area', rm.area_name, 'number', rm.route_number) order by rm.area_name, rm.route_number),
         array_agg(upper(rm.route_code)), array_agg(distinct rm.area_name)
    into v_routes, v_codes, v_areas
    from route_maps rm
   where rm.status = 'approved'
     and (upper(rm.route_code) = any (v_asked) or rm.area_name = any (v_maps))
     and exists (select 1 from map_area_centers mc where mc.area_name = rm.area_name and mc.center_id = p_center);
  v_codes := coalesce(v_codes, '{}');
  -- what was asked for and left out
  v_out := array(select x from unnest(v_asked) x where not (x = any (v_codes)) order by 1)
        || array(select m from unnest(v_maps) m where not (m = any (coalesce(v_areas, '{}'))) order by 1);
  if cardinality(v_codes) = 0 then
    v_probs := v_probs || (case when cardinality(v_asked) = 0 and cardinality(v_maps) = 0 then 'Which routes or maps? Tell me the ones being worked that day.'
                                else 'None of those are on this center’s maps: ' || array_to_string(v_out, ', ') || '.' end);
  elsif cardinality(v_out) > 0 then
    v_notes := v_notes || ('Left out, not on this center’s maps: ' || array_to_string(v_out, ', ') || '.');
  end if;

  -- the center's booking list with the most bookings on those routes
  select l.* into v_list from mb_lists l
   where l.center_id = p_center
   order by (select count(*) from mb_bookings b where b.list_id = l.id and b.status = 'open'
                and (upper(b.route_code) = any (v_codes) or upper(coalesce(b.sheet_route, '')) = any (v_codes))) desc, l.year desc
   limit 1;
  if v_list.id is null then v_probs := v_probs || 'This center has no booking list yet.'::text; end if;

  -- who would get one: the same rules as the screen (open, or tried for the next-try email; a real email address; not sent this one for that day)
  if v_list.id is not null and cardinality(v_codes) > 0 then
    select count(*), count(*) filter (where c.has_email and not c.sent), count(*) filter (where not c.has_email), count(*) filter (where c.has_email and c.sent)
      into n_all, n_ready, n_noemail, n_sent
      from (select exists (select 1 from unnest(coalesce(b.emails, '{}')) e where trim(e) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') has_email,
                   exists (select 1 from jsonb_array_elements(coalesce(b.sent_emails, '[]'::jsonb)) s where s->>'kind' = v_key) sent
              from mb_bookings b
             where b.list_id = v_list.id and b.status = 'open'
               and (v_kind = 'day_before' or jsonb_array_length(coalesce(b.attempts, '[]'::jsonb)) > 0)
               and (upper(b.route_code) = any (v_codes) or upper(coalesce(b.sheet_route, '')) = any (v_codes))) c;
    if cardinality(v_probs) = 0 and n_ready = 0 then
      v_probs := v_probs || (case when n_all = 0 then 'No ' || case v_kind when 'day_before' then 'open' else 'tried' end || ' bookings on those routes, so there’s nobody to email.'
                                  when n_sent > 0 and n_noemail = 0 then 'All ' || n_sent || ' on those routes already got the ' || v_label || ' email for that day.'
                                  when n_sent = 0 then 'None of the ' || n_all || ' bookings on those routes has an email address.'
                                  else 'Nobody left to email: ' || n_sent || ' already got it and ' || n_noemail || ' have no email address.' end);
    end if;
  end if;

  -- what the screen needs to send: the center's saved template, and a seat on its customer mailbox
  if not exists (select 1 from email_templates e where e.command_center_id = p_center and e.template_type = v_kind and e.is_active) then
    v_probs := v_probs || ('There’s no ' || v_label || ' email template saved for this center. Make one in Bookings › Templates first.'); end if;
  select b.local || '@propertystars.app' into v_from from mail_boxes b
   where b.center_id = p_center and b.role = 'client' and b.id = any (mail_my_box_ids()) and not (b.id = any (mail_hidden_box_ids())) limit 1;
  if v_from is null then
    v_probs := v_probs || 'You’re not on this center’s customer mailbox, so you can’t send from it. It’s set up in Centers › Email.'::text; end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', cardinality(v_probs) = 0, 'problems', to_jsonb(v_probs),
    'kind', v_kind, 'date', v_date, 'list', case when v_list.id is not null then jsonb_build_object('id', v_list.id, 'name', v_list.name || ' ' || v_list.year) end,
    'routes', coalesce(v_routes, '[]'::jsonb), 'maps', to_jsonb(coalesce(v_areas, '{}')),
    'counts', jsonb_build_object('bookings', n_all, 'to_email', n_ready, 'no_email', n_noemail, 'already_sent', n_sent),
    'from', v_from, 'notes', to_jsonb(v_notes)));
end $$;

revoke all on function public.benny_check_emails(uuid, text, date, date, text[], text[]) from public, anon;
grant execute on function public.benny_check_emails(uuid, text, date, date, text[], text[]) to authenticated;
