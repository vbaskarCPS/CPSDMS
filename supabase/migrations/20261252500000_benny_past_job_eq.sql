-- The Benny, a job on a closed day's payout: the check also says when the cart's equiv was set at payout (eq_set).
-- A day closed from the live map keeps each cart's equiv as it was paid out; with that set, changing a sale changes
-- nothing in the pay. The card says so, and its save switches that cart back to its sales ("Use the sales" on the
-- payout list), so the equiv and the pay follow the job as it now reads.
create or replace function public.benny_check_past_job(p_center uuid, p_date date, p_worker text, p_job jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_live date; v_day date := p_date; q text := trim(coalesce(p_worker, '')); v_cart payout_carts; v_n int; v_which text;
  v_add boolean := coalesce((p_job->>'add')::boolean, false);
  v_find text := nullif(trim(coalesce(p_job->>'find', '')), ''); v_amt numeric; v_line text := nullif(trim(coalesce(p_job->>'line', '')), '');
  v_sale payout_sales; v_type text; v_paid text; v_price numeric; v_display text; v_addr text; v_num text; v_street text;
  v_booking jsonb := null; v_line_now jsonb; v_cands jsonb; v_stamp text; v_member jsonb; fmt constant text := 'FM999999990.00';
begin
  perform benny_ok(p_center);
  v_live := benny_live_date(p_center);
  if v_day is null then return jsonb_build_object('ok', false, 'problems', jsonb_build_array('Which day? Give the date (YYYY-MM-DD).')); end if;
  if v_day = v_live then return jsonb_build_object('ok', false, 'date', v_day, 'problems', jsonb_build_array(v_day || ' is the live day: change its jobs on the logsheet (propose_job_change / propose_add_job).')); end if;
  if not exists (select 1 from payout_carts c where c.center_id = p_center and c.day = v_day) then
    return jsonb_build_object('ok', false, 'date', v_day, 'problems', jsonb_build_array('There are no saved payouts for ' || v_day || ' at this center.')); end if;
  if exists (select 1 from payout_lines l where l.center_id = p_center and l.day = v_day and l.payslip_id is not null) then
    return jsonb_build_object('ok', false, 'date', v_day, 'problems', jsonb_build_array(v_day || ' is on a payslip already, so its payouts are locked. Change it on the payslip.')); end if;
  if q = '' then return jsonb_build_object('ok', false, 'date', v_day, 'problems', jsonb_build_array('Whose cart? Name the worker.')); end if;

  -- the cart: by CN, else by name (first, last, or both)
  select count(*) into v_n
    from payout_carts c, jsonb_array_elements(c.members) m
   where c.center_id = p_center and c.day = v_day
     and (upper(m->>'cn') = upper(q) or (m->>'first_name') || ' ' || (m->>'last_name') ilike '%' || q || '%' or (m->>'first_name') ilike q || '%' or (m->>'last_name') ilike q || '%');
  if v_n = 0 then return jsonb_build_object('ok', false, 'date', v_day, 'problems', jsonb_build_array('Nobody called ' || q || ' has a payout on ' || v_day || '.')); end if;
  select c.* into v_cart from payout_carts c, jsonb_array_elements(c.members) m
   where c.center_id = p_center and c.day = v_day
     and (upper(m->>'cn') = upper(q) or (m->>'first_name') || ' ' || (m->>'last_name') ilike '%' || q || '%' or (m->>'first_name') ilike q || '%' or (m->>'last_name') ilike q || '%')
   order by (upper(m->>'cn') = upper(q)) desc limit 1;
  if (select count(distinct c.id) from payout_carts c, jsonb_array_elements(c.members) m where c.center_id = p_center and c.day = v_day
        and ((m->>'first_name') || ' ' || (m->>'last_name') ilike '%' || q || '%' or (m->>'first_name') ilike q || '%' or (m->>'last_name') ilike q || '%')) > 1
     and not exists (select 1 from jsonb_array_elements(v_cart.members) m where upper(m->>'cn') = upper(q)) then
    return jsonb_build_object('ok', false, 'date', v_day, 'which', (select jsonb_agg(distinct c.label) from payout_carts c, jsonb_array_elements(c.members) m where c.center_id = p_center and c.day = v_day
        and ((m->>'first_name') || ' ' || (m->>'last_name') ilike '%' || q || '%')), 'problems', jsonb_build_array('Which one? More than one cart has a ' || q || '.')); end if;
  if v_cart.finalized is false then return jsonb_build_object('ok', false, 'date', v_day, 'problems', jsonb_build_array(v_cart.label || '’s payout isn’t finished yet: finish it on the day’s payout list first.')); end if;
  select m into v_member from jsonb_array_elements(v_cart.members) m where upper(m->>'cn') = upper(q) or (m->>'first_name') || ' ' || (m->>'last_name') ilike '%' || q || '%' or (m->>'first_name') ilike q || '%' or (m->>'last_name') ilike q || '%' limit 1;
  v_stamp := md5(coalesce((select string_agg(s.id::text || '|' || s.price || '|' || s.payment_type || '|' || s.type || '|' || coalesce(s.display_price, ''), ',' order by s.sort, s.id) from payout_sales s where s.cart_id = v_cart.id), '') || '|' || v_cart.updated_at);

  -- the job to change: by id, else by address (and amount when the address has more than one)
  if not v_add then
    if v_line is not null then
      select s.* into v_sale from payout_sales s where s.cart_id = v_cart.id and s.id::text = v_line;
    elsif v_find is not null then
      begin v_amt := nullif(p_job->>'find_amount', '')::numeric; exception when others then v_amt := null; end;
      select jsonb_agg(jsonb_build_object('line', s.id, 'address', s.address, 'type', s.type, 'amount', s.price, 'paid_by', s.payment_type, 'shown_as', s.display_price) order by s.sort)
        into v_cands from payout_sales s where s.cart_id = v_cart.id and benny_past_addr(s.address) = benny_past_addr(v_find) and (v_amt is null or s.price = v_amt);
      if coalesce(jsonb_array_length(v_cands), 0) = 0 then
        return jsonb_build_object('ok', false, 'date', v_day, 'problems', jsonb_build_array('No job at ' || v_find || coalesce(' for ' || to_char(v_amt, fmt), '') || ' on ' || v_cart.label || '’s payout for ' || v_day || '.'),
          'jobs', (select jsonb_agg(jsonb_build_object('line', s.id, 'address', s.address, 'type', s.type, 'amount', s.price, 'paid_by', s.payment_type) order by s.sort) from payout_sales s where s.cart_id = v_cart.id)); end if;
      if jsonb_array_length(v_cands) > 1 then
        return jsonb_build_object('ok', false, 'date', v_day, 'which', v_cands, 'problems', jsonb_build_array('Which job at ' || v_find || '? There are ' || jsonb_array_length(v_cands) || ': give its amount.')); end if;
      select s.* into v_sale from payout_sales s where s.id = (v_cands->0->>'line')::uuid;
    end if;
    if v_sale.id is null then return jsonb_build_object('ok', false, 'date', v_day, 'problems', jsonb_build_array('Which job? Give its address (house number first), or say to add a new one.')); end if;
  end if;

  -- what it becomes (anything not given stays as it is)
  v_type := coalesce(nullif(initcap(trim(coalesce(p_job->>'type', ''))), ''), v_sale.type, 'Sale');
  if v_type = 'Add-on' then v_type := 'Add-On'; end if;
  if v_type not in ('Sale', 'Production', 'Upgrade', 'Add-On') then return jsonb_build_object('ok', false, 'date', v_day, 'problems', jsonb_build_array('A job is a Sale, Production, Upgrade or Add-On.')); end if;
  v_paid := case lower(trim(coalesce(p_job->>'paid_by', ''))) when 'cash' then 'Cash' when 'cheque' then 'Cheque' when 'check' then 'Cheque'
    when 'e-transfer' then 'E-Transfer' when 'etransfer' then 'E-Transfer' when 'prepaid' then 'Prepaid' when 'billed' then 'Billed'
    when 'card' then 'Credit Card' when 'credit card' then 'Credit Card' when '' then coalesce(v_sale.payment_type, 'Cash') else null end;
  if v_paid is null then return jsonb_build_object('ok', false, 'date', v_day, 'problems', jsonb_build_array('Paid by cash, cheque, e-transfer, card, prepaid or billed?')); end if;
  begin v_price := coalesce(nullif(p_job->>'price', '')::numeric, v_sale.price); exception when others then v_price := null; end;
  if v_price is null or v_price < 0 or v_price > 20000 then return jsonb_build_object('ok', false, 'date', v_day, 'problems', jsonb_build_array('What is the job’s amount?')); end if;
  v_display := coalesce(nullif(upper(trim(coalesce(p_job->>'display', ''))), ''), case when v_sale.id is not null and v_price = v_sale.price and nullif(p_job->>'display', '') is null then v_sale.display_price end, trim(to_char(v_price, 'FM999999990.##')));
  v_addr := coalesce(v_sale.address, v_find);
  if v_add and v_addr is null then return jsonb_build_object('ok', false, 'date', v_day, 'problems', jsonb_build_array('What is the new job’s address?')); end if;

  -- the open booking at that address, to mark done with it
  if coalesce((p_job->>'booking')::boolean, true) and v_addr is not null then
    v_num := (regexp_match(v_addr, '^\s*(\d+)'))[1];
    v_street := substr(benny_past_addr(v_addr), length(coalesce(v_num, '')) + 1);
    if v_num is not null and v_street <> '' then
      select jsonb_build_object('id', b.id, 'address', trim(b.house_no || ' ' || b.street_name), 'route', b.route_code, 'job_code', b.job_code, 'prepaid', b.prepaid, 'status', b.status)
        into v_booking
        from mb_bookings b join mb_lists l on l.id = b.list_id
       where l.center_id = p_center and b.status = 'open' and b.house_no = v_num and benny_past_addr(b.street_name) like v_street || '%'
       order by b.updated_at desc limit 1;
    end if;
  end if;

  select jsonb_build_object('equiv', l.equiv, 'pay', l.total_payout) into v_line_now from payout_lines l
   where l.center_id = p_center and l.day = v_day and upper(l.cn) = upper(v_member->>'cn') limit 1;

  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'date', v_day, 'stamp', v_stamp, 'add', v_add,
    'worker', jsonb_build_object('cn', v_member->>'cn', 'name', trim((v_member->>'first_name') || ' ' || coalesce(v_member->>'last_name', ''))),
    'cart', jsonb_build_object('id', v_cart.id, 'label', v_cart.label, 'members', jsonb_array_length(v_cart.members), 'eq_set', v_cart.eq_override),
    'line', v_sale.id,
    'from', case when v_sale.id is null then null else jsonb_build_object('address', v_sale.address, 'type', v_sale.type, 'amount', v_sale.price, 'paid_by', v_sale.payment_type, 'shown_as', v_sale.display_price, 'service', v_sale.service, 'route', v_sale.route_code) end,
    'to', jsonb_build_object('address', v_addr, 'type', v_type, 'amount', v_price, 'paid_by', v_paid, 'shown_as', v_display,
      'service', coalesce(nullif(trim(coalesce(p_job->>'service', '')), ''), v_sale.service, 'FP'),
      'route', coalesce(nullif(upper(trim(coalesce(p_job->>'route', ''))), ''), v_sale.route_code, v_booking->>'route'),
      'client', coalesce(nullif(trim(coalesce(p_job->>'client', '')), ''), v_sale.client_name)),
    'booking', v_booking, 'pay_now', v_line_now,
    'ask', jsonb_strip_nulls(jsonb_build_object('find', v_find, 'find_amount', p_job->'find_amount', 'line', v_sale.id, 'add', v_add, 'type', p_job->'type', 'paid_by', p_job->'paid_by',
      'price', p_job->'price', 'display', p_job->'display', 'service', p_job->'service', 'route', p_job->'route', 'client', p_job->'client', 'booking', p_job->'booking'))));
end $$;
revoke all on function public.benny_check_past_job(uuid, date, text, jsonb) from public, anon;
grant execute on function public.benny_check_past_job(uuid, date, text, jsonb) to authenticated;
