-- The Benny can read one cart's logsheet for the live day, and prepare a change to one job on it: its amount, how it
-- was paid, or both. Super admins for any cart; route managers for their own teams (floaters for the teams they can
-- follow), the same people who can already edit a job on the RM map.
--
-- This changes pay, so it is narrow on purpose:
--   * the Benny never saves it. The check below changes nothing; the card is saved by the app with the old app's own
--     edit save (sessionService.updateTransaction), which works the cart's equiv and totals out again;
--   * a logsheet that is already paid out is never changed from here (the pay would not follow);
--   * card and split payments, office flats and asphalt jobs stay on the edit screen;
--   * every change is recorded: who, when, what it read before and what it reads after (benny_job_changes).
-- No phone number, email or card detail is read anywhere here: every query names its columns.
-- Additive only.

-- A record of each change made through the Benny. Written only by the two functions at the bottom.
create table if not exists public.benny_job_changes (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null,
  day date not null,
  job_id text not null,              -- transactions.id
  cart_id text,                      -- logsheet_sessions.id
  worker_id text, worker_name text, client text,
  by_user uuid not null, by_name text,
  asked jsonb not null,              -- { amount?, paid_by? } as asked
  before jsonb not null,             -- { amount, paid_by, display, parts } read here before the save
  want jsonb not null,               -- what it should read after
  after jsonb,                       -- what it did read after, read here once the app had saved
  state text not null default 'started' check (state in ('started', 'done', 'not_saved', 'differs')),
  started_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists benny_job_changes_job on public.benny_job_changes (job_id, started_at desc);
alter table public.benny_job_changes enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'benny_job_changes' and policyname = 'benny_job_changes_read') then
    create policy benny_job_changes_read on public.benny_job_changes for select to authenticated using (coalesce(app_is_super_admin(), false));
  end if;
end $p$;
revoke all on public.benny_job_changes from public, anon, authenticated;
grant select on public.benny_job_changes to authenticated;

-- The jobs on one cart's logsheet, oldest first. Names its columns: no phone, email or card detail.
create or replace function public.benny_cart_jobs(p_center uuid, p_cart text, p_cns text[])
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(z.j order by z.ts), '[]'::jsonb) from (
    select t.timestamp ts, jsonb_strip_nulls(jsonb_build_object(
      'id', t.id, 'at', t.timestamp,
      'client', coalesce(nullif(trim(coalesce(t.customer_snapshot->>'firstName', '') || ' ' || coalesce(t.customer_snapshot->>'lastName', '')), ''), nullif(trim(t.customer_name), '')),
      'address', coalesce(nullif(t.customer_snapshot->>'address', ''), nullif(t.address, '')),
      'route', coalesce(nullif(t.customer_snapshot->>'routeCode', ''), nullif(t.route_code, '')),
      'type', t.type,
      'service', coalesce(nullif(case when jsonb_typeof(t.items) = 'array' then t.items->0->>'name' end, ''), nullif(t.customer_snapshot->>'serviceName', '')),
      'does', (select jsonb_agg(e.key order by e.key) from jsonb_each(case when jsonb_typeof(t.services) = 'object' then t.services else '{}'::jsonb end) e where e.value = 'true'::jsonb),
      'note', nullif(t.item_description, ''),
      'amount', t.price, 'paid_by', t.payment_method,
      'parts', case when t.payment_method = 'Split' and jsonb_typeof(t.payment_breakdown) = 'object' then t.payment_breakdown end,
      'flat', case when t.type = 'Production' and t.display_price ~ '^[A-Za-z]' then substring(t.display_price from '^[A-Za-z]+') end,
      'asphalt', case when t.asphalt_meta is not null or t.payout_share is not null then true end,
      'changed', (select jsonb_agg(jsonb_build_object('by', c.by_name, 'at', c.done_at, 'from', c.before - 'display', 'to', c.after - 'display') order by c.done_at)
                    from benny_job_changes c where c.job_id = t.id and c.center_id = p_center and c.state = 'done'))) j
      from transactions t
     where t.command_center_id = p_center and (t.session_id = p_cart or (t.session_id is null and t.worker_id = any (p_cns)))) z
$$;

-- Whose logsheet: the worker, their cart, and whether the caller may see it. One place for the lookup and the check.
create or replace function public.benny_job_cart(p_center uuid, p_worker text, out worker jsonb, out cart_id text, out cns text[], out names text[],
                                                 out status text, out stats jsonb, out day date, out problem text)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_reach text[] := benny_my_reach(p_center); w jsonb;
begin
  day := benny_live_date(p_center);
  if day is null then problem := 'No day is live on the map yet.'; return; end if;
  if nullif(trim(coalesce(p_worker, '')), '') is null then problem := 'Whose logsheet? Tell me the worker.'; return; end if;
  w := benny_live_worker(p_center, p_worker);
  if not coalesce((w->>'found')::boolean, false) then
    problem := case when w ? 'which' and jsonb_array_length(w->'which') > 0 then 'Which one: ' || (select string_agg(x, ', ') from jsonb_array_elements_text(w->'which') x) || '?'
                    else 'No worker called “' || p_worker || '” on today’s map.' end;
    return; end if;
  if v_reach is not null and not ((w->>'manager') = any (v_reach)) then problem := (w->>'name') || ' isn’t on your team.'; return; end if;
  worker := jsonb_strip_nulls(jsonb_build_object('cn', w->>'cn', 'name', w->>'name', 'heard_as', w->>'heard_as'));
  if w->>'cart_id' is null then problem := (w->>'name') || ' isn’t on a cart yet (not signed in today), so there’s no logsheet.'; return; end if;
  select l.id, coalesce(nullif(l.team_worker_ids, '{}'), array[l.worker_id]), upper(coalesce(l.status, 'OPEN')), coalesce(l.stats, '{}'::jsonb)
    into cart_id, cns, status, stats
    from logsheet_sessions l where l.id = w->>'cart_id' and l.command_center_id = p_center;
  if cart_id is null then problem := (w->>'name') || '’s logsheet isn’t open today.'; return; end if;
  names := array(select u.name from users u where u.command_center_id = p_center and u.user_id = any (cns) order by u.name);
end $$;

-- One worker's logsheet today: the jobs on their cart, the cart's totals, and whether it is paid out.
create or replace function public.benny_live_jobs(p_center uuid, p_worker text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_role text := benny_ok_any(p_center); c record;
begin
  select * into c from benny_job_cart(p_center, p_worker);
  if c.problem is not null then return jsonb_strip_nulls(jsonb_build_object('ok', false, 'problems', jsonb_build_array(c.problem), 'worker', c.worker)); end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'date', c.day, 'worker', c.worker,
    'cart', jsonb_build_object('id', c.cart_id, 'workers', to_jsonb(c.names), 'paid_out', c.status = 'PAID',
      'totals', jsonb_build_object(
        'steps', coalesce((c.stats->>'stepCount')::numeric, 0), 'equiv', round(coalesce((c.stats->>'totalEQ')::numeric, 0), 2),
        'gross', round(coalesce((c.stats->>'prodGross')::numeric, 0), 2), 'upsells', coalesce((c.stats->>'upsellCount')::numeric, 0),
        'upsell_gross', round(coalesce((c.stats->>'upsellGross')::numeric, 0), 2),
        'cash', round(coalesce((c.stats->>'prodCash')::numeric, 0) + coalesce((c.stats->>'upsellCash')::numeric, 0), 2),
        'cheque', round(coalesce((c.stats->>'prodCheque')::numeric, 0) + coalesce((c.stats->>'upsellCheque')::numeric, 0), 2),
        'e_transfer', round(coalesce((c.stats->>'prodETransfer')::numeric, 0) + coalesce((c.stats->>'upsellETransfer')::numeric, 0), 2),
        'card', round(coalesce((c.stats->>'prodCreditCard')::numeric, 0) + coalesce((c.stats->>'upsellCreditCard')::numeric, 0), 2),
        'prepaid', round(coalesce((c.stats->>'prodPrepaid')::numeric, 0) + coalesce((c.stats->>'upsellPrepaid')::numeric, 0), 2),
        'billed', round(coalesce((c.stats->>'prodBilled')::numeric, 0) + coalesce((c.stats->>'upsellBilled')::numeric, 0), 2),
        'flats', round(coalesce((c.stats->>'prodFlats')::numeric, 0), 2))),
    'jobs', benny_cart_jobs(p_center, c.cart_id, c.cns)));
end $$;

-- Check one change to one job. Changes nothing.
--   p_job    = the job's id (from benny_live_jobs)
--   p_change = { "amount": 250, "paid_by": "prepaid" }   either or both
create or replace function public.benny_check_job(p_center uuid, p_worker text, p_job text, p_change jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_role text := benny_ok_any(p_center); c record; ch jsonb := coalesce(p_change, '{}'::jsonb);
        v_probs text[] := '{}'; v_notes text[] := '{}'; v_first text;
        t_id text; t_type text; t_price numeric; t_display text; t_method text; t_parts jsonb; t_items jsonb; t_job text; t_asphalt boolean;
        v_job jsonb; v_amount numeric; v_raw text; v_to text; v_prefix text; v_newdisplay text; v_patch jsonb; v_change jsonb := '{}'::jsonb; v_ask jsonb := '{}'::jsonb;
        fmt constant text := 'FM999999990.00';
begin
  select * into c from benny_job_cart(p_center, p_worker);
  if c.problem is not null then return jsonb_strip_nulls(jsonb_build_object('ok', false, 'problems', jsonb_build_array(c.problem), 'worker', c.worker)); end if;
  v_first := split_part(c.worker->>'name', ' ', 1);

  select t.id, t.type, t.price, coalesce(t.display_price, ''), coalesce(t.payment_method, ''), case when jsonb_typeof(t.payment_breakdown) = 'object' then t.payment_breakdown end, t.items, coalesce(t.job_id, ''),
         (t.asphalt_meta is not null or t.payout_share is not null)
    into t_id, t_type, t_price, t_display, t_method, t_parts, t_items, t_job, t_asphalt
    from transactions t
   where t.id = trim(coalesce(p_job, '')) and t.command_center_id = p_center
     and (t.session_id = c.cart_id or (t.session_id is null and t.worker_id = any (c.cns)));
  if t_id is null then
    return jsonb_build_object('ok', false, 'worker', c.worker,
      'problems', jsonb_build_array('I can’t find that job on ' || v_first || '’s logsheet. Look the logsheet up first and use the job’s id.')); end if;
  v_job := (select j from jsonb_array_elements(benny_cart_jobs(p_center, c.cart_id, c.cns)) j where j->>'id' = t_id);

  -- jobs that are never changed from here
  if c.status = 'PAID' then
    v_probs := v_probs || (v_first || '’s logsheet is already paid out, so I won’t change it from here: the pay wouldn’t follow. Change it in Payout, where the pay is worked out again.'); end if;
  if t_asphalt then v_probs := v_probs || 'It’s an asphalt job: its split is worked out on the edit screen.'::text; end if;
  if t_method in ('Credit Card', 'Split', 'IOS') or coalesce(t_parts, '{}'::jsonb) ?| array['Credit Card', 'IOS'] or (select count(*) from jsonb_object_keys(coalesce(t_parts, '{}'::jsonb))) > 1 then
    v_probs := v_probs || ('It was paid by ' || case when t_method = 'IOS' then 'IOS' when t_method = 'Credit Card' then 'card' else 'split payment' end
                           || ': change it on the edit screen (RM map › the worker › tap the job).'); end if;
  if t_type = 'Production' and t_display ~ '^[A-Za-z]' then
    v_probs := v_probs || ('It’s an office flat (' || substring(t_display from '^[A-Za-z]+') || '): its value is set by the office. Change it on the edit screen if it is really wrong.'); end if;
  if jsonb_typeof(t_items) = 'array' and jsonb_array_length(t_items) > 1 then
    v_probs := v_probs || 'It has more than one item on it: change it on the edit screen.'::text; end if;

  -- the amount
  v_raw := nullif(trim(regexp_replace(coalesce(ch->>'amount', ''), '[$, ]', '', 'g')), '');
  if v_raw is not null then
    if v_raw !~ '^[0-9]+(\.[0-9]+)?$' then v_probs := v_probs || ('I didn’t get the amount (“' || (ch->>'amount') || '”). Say it in dollars, like 250.');
    else
      v_amount := round(v_raw::numeric, 2);
      if v_amount <= 0 or v_amount > 20000 then v_probs := v_probs || 'The amount has to be more than $0 and no more than $20,000. To remove a job, use the edit screen.'::text; v_amount := null; end if;
    end if;
  end if;
  -- how it was paid
  v_raw := lower(regexp_replace(coalesce(ch->>'paid_by', ''), '[^a-zA-Z]', '', 'g'));
  if v_raw <> '' then
    v_to := case when v_raw = 'cash' then 'Cash' when v_raw in ('cheque', 'check', 'chq') then 'Cheque'
                 when v_raw in ('etransfer', 'emt', 'interac', 'etransfert', 'emailtransfer') then 'E-Transfer'
                 when v_raw in ('prepaid', 'prepay', 'pp') then 'Prepaid' when v_raw in ('billed', 'bill', 'invoice', 'invoiced') then 'Billed' end;
    if v_to is null then
      v_probs := v_probs || 'I can change it to cash, cheque, e-transfer, prepaid or billed. A card or split payment is taken on the edit screen.'::text;
    elsif v_to = 'Billed' and t_type <> 'Production' then v_probs := v_probs || ('Only a production job can be billed; this one is ' || case t_type when 'Sale' then 'a sale' when 'Upgrade' then 'an upgrade' else 'an add-on' end || '.'); v_to := null;
    elsif v_to = 'Prepaid' and t_type not in ('Production', 'Sale') then v_probs := v_probs || ('Only a production job or a sale can be prepaid; this one is ' || case t_type when 'Upgrade' then 'an upgrade' else 'an add-on' end || '.'); v_to := null;
    end if;
  end if;
  if (ch->>'amount') is null and v_raw = '' then
    v_probs := v_probs || 'What should change: the amount, how it was paid, or both?'::text;
  elsif cardinality(v_probs) = 0 and coalesce(v_amount, t_price) = t_price and coalesce(v_to, t_method) = t_method then
    v_probs := v_probs || ('It already reads $' || to_char(t_price, fmt) || ', ' || t_method || '.');
  end if;

  if v_amount is not null and v_amount <> t_price then
    v_change := v_change || jsonb_build_object('amount', jsonb_build_object('from', t_price, 'to', v_amount)); v_ask := v_ask || jsonb_build_object('amount', v_amount);
    if t_price > 0 and (v_amount > t_price * 2 or v_amount < t_price / 2) then v_notes := v_notes || ('That’s a big change from $' || to_char(t_price, fmt) || '.'); end if;
  end if;
  if v_to is not null and v_to <> t_method then
    v_change := v_change || jsonb_build_object('paid_by', jsonb_build_object('from', t_method, 'to', v_to)); v_ask := v_ask || jsonb_build_object('paid_by', v_to);
    if v_to = 'Cheque' then v_notes := v_notes || 'No cheque number is saved with it.'::text; end if;
    if v_to = 'Billed' then v_notes := v_notes || 'No invoice number is saved with it.'::text; end if;
    if t_method = 'Prepaid' and t_job <> '' and t_job not like 'NEW-%' then v_notes := v_notes || 'It came in as a prepaid booking.'::text; end if;
  end if;

  -- what the save writes: the same fields, in the same shape, as the edit screen's save. A production job keeps a plain
  -- price (a lettered price would turn it into an office flat); a sale or an add-on keeps or gets its service's letters.
  v_amount := coalesce(v_amount, t_price); v_to := coalesce(v_to, t_method);
  v_prefix := case when t_type = 'Production' then ''
                   else coalesce(substring(t_display from '^[A-Z]+'),
                                 case (case when jsonb_typeof(t_items) = 'array' then t_items->0->>'name' end)
                                   when 'Star Plan Pro' then 'SP' when 'Lawn Rejuvenation' then 'RJ' when 'Golf Course' then 'GF' end, '') end;
  v_newdisplay := v_prefix || to_char(v_amount, fmt);
  v_patch := jsonb_build_object('price', v_amount, 'display_price', v_newdisplay, 'payment_method', v_to, 'payment_breakdown', jsonb_build_object(v_to, v_amount))
          || case when jsonb_typeof(t_items) = 'array' and jsonb_array_length(t_items) = 1
                  then jsonb_build_object('items', jsonb_build_array((t_items->0) || jsonb_build_object('price', v_amount))) else '{}'::jsonb end;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', cardinality(v_probs) = 0, 'problems', to_jsonb(v_probs), 'date', c.day, 'worker', c.worker,
    'cart', jsonb_build_object('id', c.cart_id, 'workers', to_jsonb(c.names)),
    'job', v_job, 'change', v_change, 'ask', v_ask, 'patch', case when cardinality(v_probs) = 0 then v_patch end,
    'stamp', md5(t_price::text || '|' || t_display || '|' || t_method || '|' || coalesce(t_parts::text, '')),
    'notes', to_jsonb(v_notes)));
end $$;

-- The app is about to save a change the person confirmed: check it once more (nothing may have moved since the card
-- was made) and start its record. Returns the check, with the record's id.
create or replace function public.benny_job_begin(p_center uuid, p_worker text, p_job text, p_change jsonb, p_stamp text)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare k jsonb := benny_check_job(p_center, p_worker, p_job, p_change); v_id uuid;
begin
  if not coalesce((k->>'ok')::boolean, false) then return k; end if;
  if (k->>'stamp') is distinct from p_stamp then
    return k || jsonb_build_object('ok', false, 'problems', jsonb_build_array('That job changed since I checked. Ask me again.')); end if;
  insert into benny_job_changes (center_id, day, job_id, cart_id, worker_id, worker_name, client, by_user, by_name, asked, before, want)
  values (p_center, (k->>'date')::date, k->'job'->>'id', k->'cart'->>'id', k->'worker'->>'cn', k->'worker'->>'name', k->'job'->>'client',
          auth.uid(), (select u.full_name from app_users u where u.id = auth.uid()), k->'ask',
          jsonb_strip_nulls(jsonb_build_object('amount', k->'job'->'amount', 'paid_by', k->'job'->'paid_by', 'parts', k->'job'->'parts')),
          jsonb_build_object('amount', k->'patch'->'price', 'paid_by', k->'patch'->'payment_method', 'display', k->'patch'->'display_price'))
  returning id into v_id;
  return k || jsonb_build_object('change_id', v_id);
end $$;

-- The app has saved (or failed to): read the job as it stands now and close the record.
create or replace function public.benny_job_done(p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path to 'public' as $$
declare r benny_job_changes; v_after jsonb; v_state text;
begin
  select * into r from benny_job_changes where id = p_id and by_user = auth.uid() and state = 'started' and started_at > now() - interval '1 hour';
  if r.id is null then return jsonb_build_object('state', 'unknown'); end if;
  perform benny_ok_any(r.center_id);
  select jsonb_build_object('amount', t.price, 'paid_by', t.payment_method, 'display', t.display_price) into v_after
    from transactions t where t.id = r.job_id and t.command_center_id = r.center_id;
  v_state := case when v_after is null then 'differs'
                  when (v_after->>'amount')::numeric = (r.want->>'amount')::numeric and v_after->>'paid_by' = r.want->>'paid_by' then 'done'
                  when (v_after->>'amount')::numeric = (r.before->>'amount')::numeric and v_after->>'paid_by' = r.before->>'paid_by' then 'not_saved'
                  else 'differs' end;
  update benny_job_changes set after = v_after, state = v_state, done_at = now() where id = r.id;
  return jsonb_build_object('state', v_state, 'after', v_after);
end $$;

do $g$ declare f text; begin
  foreach f in array array['benny_cart_jobs(uuid,text,text[])', 'benny_job_cart(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['benny_live_jobs(uuid,text)', 'benny_check_job(uuid,text,text,jsonb)', 'benny_job_begin(uuid,text,text,jsonb,text)', 'benny_job_done(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $g$;
