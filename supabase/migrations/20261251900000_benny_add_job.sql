-- The Benny: add a job to a worker's logsheet today (a sale and its add-ons), for the person to confirm on a card.
-- Only the address and the price are needed. The client's name, phone and email, how it was paid, the service and the
-- route are asked for once, and the card is made without them when the person doesn't have them. Changes nothing: the
-- app saves the job with the logsheet's own save (the same as adding it on the logsheet screen), after the tap.
-- Additive only.
--
-- p_job = { address, price, client, phone, email, paid_by, service, route, add_ons: [{ name, price }] }
create or replace function public.benny_check_add_job(p_center uuid, p_worker text, p_job jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_role text := benny_ok_any(p_center); c record; j jsonb := coalesce(p_job, '{}'::jsonb);
        v_probs text[] := '{}'; v_cautions text[] := '{}'; v_missing text[] := '{}'; v_first text;
        v_address text; v_price numeric; v_raw text; v_paid text; v_service text; v_route text; v_client text;
        v_phone text; v_email text; v_addons jsonb := '[]'::jsonb; a jsonb; v_name text; v_amt numeric;
        v_civic text; v_street text; v_dupe text;
begin
  select * into c from benny_job_cart(p_center, p_worker);
  if c.problem is not null then return jsonb_strip_nulls(jsonb_build_object('ok', false, 'problems', jsonb_build_array(c.problem), 'worker', c.worker)); end if;
  v_first := split_part(c.worker->>'name', ' ', 1);
  if c.status = 'PAID' then
    v_probs := v_probs || (v_first || '’s logsheet is already paid out, so I won’t add to it from here: the pay wouldn’t follow. Add it in Payout.'); end if;

  -- needed: the address (with its house number) and the price
  v_address := nullif(regexp_replace(trim(coalesce(j->>'address', '')), '\s+', ' ', 'g'), '');
  if v_address is null then v_probs := v_probs || 'What’s the address? The house number and street are enough.'::text;
  elsif v_address !~ '\d' then v_probs := v_probs || ('“' || v_address || '” has no house number. Give me the number and street.'); end if;
  v_raw := nullif(regexp_replace(coalesce(j->>'price', ''), '[$, ]', '', 'g'), '');
  if v_raw is null then v_probs := v_probs || 'What’s the price?'::text;
  elsif v_raw !~ '^[0-9]+(\.[0-9]+)?$' then v_probs := v_probs || ('I didn’t get the price (“' || (j->>'price') || '”). Say it in dollars, like 729.75.');
  else
    v_price := round(v_raw::numeric, 2);
    if v_price <= 0 or v_price > 20000 then v_probs := v_probs || 'The price has to be more than $0 and no more than $20,000.'::text; v_price := null; end if;
  end if;

  -- add-ons sold with it (each its own line on the logsheet, paid as an upsell)
  for a in select x from jsonb_array_elements(case when jsonb_typeof(j->'add_ons') = 'array' then j->'add_ons' else '[]'::jsonb end) x limit 6 loop
    v_name := nullif(trim(coalesce(a->>'name', '')), '');
    v_raw := nullif(regexp_replace(coalesce(a->>'price', ''), '[$, ]', '', 'g'), '');
    if v_name is null or v_raw is null or v_raw !~ '^[0-9]+(\.[0-9]+)?$' or v_raw::numeric <= 0 or v_raw::numeric > 20000 then
      v_probs := v_probs || ('I need a name and a price for each add-on' || coalesce(' (“' || v_name || '”)', '') || '.'); continue; end if;
    if v_name ~* 'grub|chafer|beetle' then v_name := 'European Chafer Beetle Protection Plan'; end if;
    v_addons := v_addons || jsonb_build_object('name', v_name, 'price', round(v_raw::numeric, 2));
  end loop;

  -- how it was paid: cash when they don't say (asked for once)
  v_raw := lower(regexp_replace(coalesce(j->>'paid_by', ''), '[^a-zA-Z]', '', 'g'));
  v_paid := case when v_raw = '' then null when v_raw = 'cash' then 'Cash' when v_raw in ('cheque', 'check', 'chq') then 'Cheque'
                 when v_raw in ('etransfer', 'emt', 'interac', 'transfer') then 'E-Transfer'
                 when v_raw in ('prepaid', 'prepay', 'pp') then 'Prepaid' when v_raw in ('billed', 'bill', 'invoice', 'invoiced') then 'Billed'
                 when v_raw in ('card', 'creditcard', 'credit', 'debit', 'visa', 'mastercard', 'amex') then 'card' else 'unknown' end;
  if v_paid = 'card' then v_probs := v_probs || 'A card payment is taken on the logsheet screen, with the card machine. I can add it as cash, cheque, e-transfer, prepaid or billed.'::text; v_paid := null;
  elsif v_paid = 'unknown' then v_probs := v_probs || ('I didn’t get how it was paid (“' || (j->>'paid_by') || '”): cash, cheque, e-transfer, prepaid or billed?'); v_paid := null;
  elsif v_paid = 'Billed' then v_cautions := v_cautions || 'Billed: no invoice number is saved with it.'::text; end if;
  if v_paid is null and v_raw = '' then v_paid := 'Cash'; v_missing := v_missing || 'how it was paid (it goes in as cash)'::text; end if;

  v_service := coalesce(nullif(trim(coalesce(j->>'service', '')), ''), 'Lawn Rejuvenation');
  if v_service ~* '^(rj|rejuv|lawn ?rejuv\w*)$' then v_service := 'Lawn Rejuvenation'; end if;

  -- the route: as said, else the house on the maps, else left off
  v_route := upper(nullif(regexp_replace(coalesce(j->>'route', ''), '\s', '', 'g'), ''));
  if v_route is not null and not exists (select 1 from route_maps where upper(route_code) = v_route) then
    v_cautions := v_cautions || ('There’s no route ' || v_route || ' on the maps, so I left the route off.'); v_route := null; end if;
  if v_address is not null then
    v_civic := substring(v_address from '^\s*(\d+)');
    v_street := lower(trim(regexp_replace(substring(v_address from '^\s*\d+[A-Za-z]?\s+([^,]+)'), '\s+(st|street|ave|avenue|rd|road|dr|drive|cres|crescent|crt|court|pl|place|blvd|way|lane|ln)\.?$', '', 'i')));
    if v_route is null and v_civic is not null and v_street is not null then
      select upper(h.route_code) into v_route from route_houses h where h.civic_no::text = v_civic and h.street_norm ilike v_street || '%' limit 1;
    end if;
    -- the same address already on a logsheet today
    select coalesce(u.name, t.worker_id) into v_dupe from transactions t left join users u on u.user_id = t.worker_id and u.command_center_id = p_center
     where t.command_center_id = p_center and t.type in ('Sale', 'Production') and v_civic is not null
       and (t.customer_snapshot->>'address') ~* ('^\s*' || v_civic || '\s+' || regexp_replace(coalesce(v_street, ''), '([.*+?^${}()|\[\]\\])', '\\\1', 'g'))
     limit 1;
    if v_dupe is not null then v_cautions := v_cautions || ('This address is already on ' || v_dupe || '’s logsheet today. Check it isn’t the same job twice.'); end if;
  end if;
  if v_route is null then v_missing := v_missing || 'the route'::text; end if;

  -- the client: asked for, never needed
  v_client := nullif(regexp_replace(trim(coalesce(j->>'client', '')), '\s+', ' ', 'g'), '');
  if v_client is null then v_missing := v_missing || 'the client’s name'::text; end if;
  v_phone := nullif(regexp_replace(coalesce(j->>'phone', ''), '\D', '', 'g'), '');
  if v_phone is not null and length(v_phone) = 11 and v_phone like '1%' then v_phone := substr(v_phone, 2); end if;
  if v_phone is not null and length(v_phone) <> 10 then v_cautions := v_cautions || 'The phone number didn’t look like 10 digits, so I left it off.'::text; v_phone := null; end if;
  if v_phone is not null then v_phone := substr(v_phone, 1, 3) || '-' || substr(v_phone, 4, 3) || '-' || substr(v_phone, 7); end if;
  if v_phone is null and nullif(j->>'phone', '') is null then v_missing := v_missing || 'a phone number'::text; end if;
  v_email := lower(nullif(trim(coalesce(j->>'email', '')), ''));
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_cautions := v_cautions || 'The email didn’t look right, so I left it off.'::text; v_email := null; end if;
  if v_email is null and nullif(j->>'email', '') is null then v_missing := v_missing || 'an email'::text; end if;

  if cardinality(v_probs) > 0 then return jsonb_build_object('ok', false, 'worker', c.worker, 'problems', to_jsonb(v_probs)); end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'date', c.day, 'worker', c.worker, 'cart', jsonb_build_object('id', c.cart_id, 'workers', to_jsonb(c.cns), 'names', to_jsonb(c.names)),
    'job', jsonb_build_object('address', v_address, 'route', v_route, 'client', v_client, 'service', v_service, 'price', v_price, 'paid_by', v_paid,
                              'add_ons', v_addons, 'total', v_price + coalesce((select sum((x->>'price')::numeric) from jsonb_array_elements(v_addons) x), 0)),
    'contact', jsonb_strip_nulls(jsonb_build_object('phone', v_phone, 'email', v_email)),
    'missing', case when cardinality(v_missing) > 0 then to_jsonb(v_missing) end,
    'cautions', case when cardinality(v_cautions) > 0 then to_jsonb(v_cautions) end,
    'stamp', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')));
end $$;
revoke all on function public.benny_check_add_job(uuid, text, jsonb) from public, anon;
grant execute on function public.benny_check_add_job(uuid, text, jsonb) to authenticated;
